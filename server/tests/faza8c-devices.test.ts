import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabaseBackup } from '../src/backup.ts';
import { loadConfig } from '../src/config.ts';
import { createDatabase } from '../src/db.ts';
import { createApp } from '../src/server.ts';
import { createPairingPayload, parsePairingPayload } from '../../src/devicePairing.ts';

let directory = '';
let app: ReturnType<typeof createDatabase>;
let server: Server;
let baseUrl = '';

async function startServer(): Promise<void> {
  server = createServer(createApp(app.db));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function post(path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'servix-faza8c-'));
  app = createDatabase(join(directory, 'servix-local.db'), { seed: true });
  await startServer();
});

after(() => {
  server.close();
  app.close();
});

test('device pairing creates stable identity and never exposes credentials through listing', async () => {
  const paired = await post('/api/devices/pair', { deviceType: 'TABLET', deviceName: 'Tablet Test 01' });
  assert.equal(paired.status, 201);
  assert.equal(typeof paired.body.credential, 'string');
  const device = paired.body.device as { deviceId: string; status: string };
  assert.equal(device.status, 'pending');

  const listed = await fetch(`${baseUrl}/api/devices`);
  const listBody = await listed.json() as { devices: Array<Record<string, unknown>> };
  assert.equal(listed.status, 200);
  assert.equal(listBody.devices[0].deviceId, device.deviceId);
  assert.equal(JSON.stringify(listBody).includes(String(paired.body.credential)), false);
  assert.equal('credentialHash' in listBody.devices[0], false);

  const confirmed = await post('/api/devices/pair/confirm', { deviceId: device.deviceId, credential: paired.body.credential });
  assert.equal(confirmed.status, 200);
  assert.equal((confirmed.body.device as { status: string }).status, 'paired');
});

test('paired device heartbeat updates lastSeen and invalid credentials are rejected', async () => {
  const issued = await post('/api/devices/pair', { deviceType: 'PHONE', deviceName: 'Phone Test 01' });
  const device = issued.body.device as { deviceId: string };
  const credential = String(issued.body.credential);
  await post('/api/devices/pair/confirm', { deviceId: device.deviceId, credential });

  const invalid = await post('/api/devices/heartbeat', {}, { 'x-servix-device-id': device.deviceId, 'x-servix-device-credential': 'invalid' });
  assert.equal(invalid.status, 401);
  const heartbeat = await post('/api/devices/heartbeat', {}, { 'x-servix-device-id': device.deviceId, 'x-servix-device-credential': credential });
  assert.equal(heartbeat.status, 200);
  assert.equal(typeof (heartbeat.body.device as { lastSeenAt: string }).lastSeenAt, 'string');
});

test('revocation rejects heartbeat, and reactivation requires a newly issued credential', async () => {
  const issued = await post('/api/devices/pair', { deviceType: 'PC_COMPANION', deviceName: 'Companion Test 01' });
  const device = issued.body.device as { deviceId: string };
  const oldCredential = String(issued.body.credential);
  await post('/api/devices/pair/confirm', { deviceId: device.deviceId, credential: oldCredential });

  const revoked = await post('/api/devices/revoke', { deviceId: device.deviceId });
  assert.equal(revoked.status, 200);
  assert.equal((revoked.body.device as { status: string }).status, 'revoked');
  assert.equal((await post('/api/devices/heartbeat', {}, { 'x-servix-device-id': device.deviceId, 'x-servix-device-credential': oldCredential })).status, 403);

  const reactivated = await post('/api/devices/reactivate', { deviceId: device.deviceId });
  assert.equal(reactivated.status, 200);
  const newCredential = String(reactivated.body.credential);
  assert.notEqual(newCredential, oldCredential);
  assert.equal((await post('/api/devices/pair/confirm', { deviceId: device.deviceId, credential: newCredential })).status, 200);
});

test('multiple devices persist across a server restart and retain stable IDs', async () => {
  const first = await post('/api/devices/pair', { deviceType: 'TABLET', deviceName: 'Tablet Test 02' });
  const second = await post('/api/devices/pair', { deviceType: 'PHONE', deviceName: 'Phone Test 02' });
  const firstId = (first.body.device as { deviceId: string }).deviceId;
  const secondId = (second.body.device as { deviceId: string }).deviceId;
  const firstCredential = String(first.body.credential);
  await post('/api/devices/pair/confirm', { deviceId: firstId, credential: firstCredential });

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await startServer();
  const listed = await fetch(`${baseUrl}/api/devices`);
  const devices = (await listed.json() as { devices: Array<{ deviceId: string }> }).devices;
  assert.ok(devices.some((device) => device.deviceId === firstId));
  assert.ok(devices.some((device) => device.deviceId === secondId));
  assert.equal((await post('/api/devices/heartbeat', {}, { 'x-servix-device-id': firstId, 'x-servix-device-credential': firstCredential })).status, 200);
});

test('two simultaneous pairing requests create distinct device identities', async () => {
  const [tablet, phone] = await Promise.all([
    post('/api/devices/pair', { deviceType: 'TABLET', deviceName: 'Tablet Concurrent' }),
    post('/api/devices/pair', { deviceType: 'PHONE', deviceName: 'Phone Concurrent' }),
  ]);
  assert.equal(tablet.status, 201);
  assert.equal(phone.status, 201);
  assert.notEqual((tablet.body.device as { deviceId: string }).deviceId, (phone.body.device as { deviceId: string }).deviceId);
  assert.notEqual(tablet.body.credential, phone.body.credential);
});

test('LAN stays disabled by default and a backup exists before the schema upgrade fixture is used', () => {
  assert.equal(loadConfig({}).lanEnabled, false);
  assert.equal(loadConfig({ SERVIX_LAN_ENABLED: 'true' }).host, '0.0.0.0');
  const backup = createDatabaseBackup(app.db, app.dbPath, 'pre-device-test', new Date('2026-09-05T12:00:00.000Z'));
  assert.equal(backup.integrity, 'ok');
});

test('canonical pairing payload is round-trippable and suitable for QR/barcode renderers', () => {
  const payload = createPairingPayload({ serviceId: 'service-test', serverAddress: 'http://192.168.1.10:8787', apiVersion: '1' }, 'device-test', 'credential-test');
  const parsed = parsePairingPayload(payload);
  assert.deepEqual(parsed, {
    protocol: 'servix-pairing/v1',
    serviceId: 'service-test',
    serverAddress: 'http://192.168.1.10:8787',
    apiVersion: '1',
    deviceId: 'device-test',
    credential: 'credential-test',
  });
  assert.equal(parsePairingPayload(payload)?.credential, 'credential-test');
});

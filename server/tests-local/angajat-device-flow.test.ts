/**
 * Angajat Local Client — flux complet end-to-end pe SERVIX Local Server real
 * (SQLite): pairing Admin→dispozitiv, confirmare client, date prin LAN,
 * revocare + redetectare, mai mulți angajați pe același dispozitiv,
 * update live Admin ↔ Angajat (SSE — infrastructura existentă).
 *
 * Ruleaza cu: node --test "server/tests/*.test.ts" "server/tests-local/*.test.ts"
 * (faza8c pattern: server real pe 127.0.0.1, bază temporară în sys temp dir).
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase } from '../src/db.ts';
import { createApp } from '../src/server.ts';
import { LocalDataAdapter } from '../../src/data/LocalDataAdapter.ts';
import { createPairingPayload } from '../../src/devicePairing.ts';
import { pairAngajatDevice, verifyAngajatPairing } from '../../src/angajat/deviceGate.ts';

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

async function getJson(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: 'application/json', ...headers } });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'servix-angajat-flow-'));
  app = createDatabase(join(directory, 'servix-local.db'), { seed: true });
  await startServer();
});

after(() => {
  server.close();
  app.close();
});

// 1. Pairing complet: Admin generează payload (QR/barcode) → client confirmă → pared.
test('pairing: Admin → QR (payload canonic) → confirm client → dispozitivul devine paired', async () => {
  const issued = await post('/api/devices/pair', { deviceType: 'TABLET', deviceName: 'Tabletă atelier 01' });
  assert.equal(issued.status, 201);
  const device = issued.body.device as { deviceId: string };
  const payload = createPairingPayload(
    { serviceId: String(issued.body.pairing.serviceId), serverAddress: baseUrl, apiVersion: '1' },
    device.deviceId,
    String(issued.body.credential),
  );

  const attempt = await pairAngajatDevice(payload, fetch);
  assert.equal(attempt.kind, 'PAIRED');
  if (attempt.kind !== 'PAIRED') return;
  const saved = attempt.saved;
  assert.equal(saved.serverAddress, baseUrl);
  assert.equal(saved.deviceId, device.deviceId);

  const listed = (await getJson('/api/devices')).body.devices as Array<{ deviceId: string; status: string }>;
  assert.equal(listed.find((d) => d.deviceId === device.deviceId)?.status, 'paired');
});

// 2. Date prin LAN: adapterul Local cu credentialele dispozitivului citește date.
test('date prin LAN: LocalDataAdapter cu setDeviceCredentials → citeste employee/cars', async () => {
  const issued = await post('/api/devices/pair', { deviceType: 'TABLET', deviceName: 'Tabletă LAN' });
  const payload = createPairingPayload(
    { serviceId: String(issued.body.pairing.serviceId), serverAddress: baseUrl, apiVersion: '1' },
    (issued.body.device as { deviceId: string }).deviceId,
    String(issued.body.credential),
  );
  const attempt = await pairAngajatDevice(payload, fetch);
  assert.equal(attempt.kind, 'PAIRED');
  if (attempt.kind !== 'PAIRED') return;
  const saved = attempt.saved;

  const adapter = new LocalDataAdapter(saved.serverAddress);
  adapter.setDeviceCredentials(saved.deviceId, saved.credential);
  const employees = await adapter.getEmployees();
  assert.equal(employees.error, null);
  assert.ok((employees.data ?? []).length >= 3, 'listez angajații din SQLite prin LAN');
  const cars = await adapter.getCars();
  assert.equal(cars.error, null);
  assert.ok((cars.data ?? []).length >= 1, 'listez mașinile din SQLite prin LAN');
});

// 3. Reconectare la pornire (fără QR): heartbeat-ul asocierii salvate → PAIRED.
test('pornire după pairing: verifyAngajatPairing(heartbeat) -> PAIRED (fără QR)', async () => {
  const issued = await post('/api/devices/pair', { deviceType: 'PHONE', deviceName: 'Phone Reconectare' });
  const payload = createPairingPayload(
    { serviceId: String(issued.body.pairing.serviceId), serverAddress: baseUrl, apiVersion: '1' },
    (issued.body.device as { deviceId: string }).deviceId,
    String(issued.body.credential),
  );
  const attempt = await pairAngajatDevice(payload, fetch);
  assert.equal(attempt.kind, 'PAIRED');
  if (attempt.kind !== 'PAIRED') return;
  const verification = await verifyAngajatPairing(attempt.saved, fetch);
  assert.equal(verification.kind, 'PAIRED');
});

// 4. MAI MULȚI ANGAJAȚI pe același dispozitiv: datele întregii echipe, în același context de dispozitiv.
test('multi-angajat: același dispozitiv vede TOȚI angajații eligibili (partajat)', async () => {
  const issued = await post('/api/devices/pair', { deviceType: 'TABLET', deviceName: 'Tabletă partajată' });
  const payload = createPairingPayload(
    { serviceId: String(issued.body.pairing.serviceId), serverAddress: baseUrl, apiVersion: '1' },
    (issued.body.device as { deviceId: string }).deviceId,
    String(issued.body.credential),
  );
  const attempt = await pairAngajatDevice(payload, fetch);
  assert.equal(attempt.kind, 'PAIRED');
  if (attempt.kind !== 'PAIRED') return;
  const saved = attempt.saved;
  const adapter = new LocalDataAdapter(saved.serverAddress);
  adapter.setDeviceCredentials(saved.deviceId, saved.credential);
  const employees = (await adapter.getEmployees()).data ?? [];
  const eligible = employees.filter((e) => e.role === 'employee' && e.active);
  // Dispozitivul nu e dedicat unui singur angajat → toți sunt disponibili.
  assert.ok(eligible.length >= 2, 'cel puțin 2 angajați eligibili pe același dispozitiv');
});

// 5. Revocare + redetectare: Admin revocă → verifyAngajatPairing → REVOKED.
test('revocare: Admin revocă dispozitivul -> verifyAngajatPairing: REVOKED (clientul se reconectează QR)', async () => {
  const issued = await post('/api/devices/pair', { deviceType: 'TABLET', deviceName: 'Tabletă de revocat' });
  const deviceId = (issued.body.device as { deviceId: string }).deviceId;
  const payload = createPairingPayload(
    { serviceId: String(issued.body.pairing.serviceId), serverAddress: baseUrl, apiVersion: '1' },
    deviceId,
    String(issued.body.credential),
  );
  const attempt = await pairAngajatDevice(payload, fetch);
  assert.equal(attempt.kind, 'PAIRED');
  if (attempt.kind !== 'PAIRED') return;
  const saved = attempt.saved;

  // Admin (loopback) revocă.
  const revoked = await post('/api/devices/revoke', { deviceId });
  assert.equal(revoked.status, 200);
  assert.equal((revoked.body.device as { status: string }).status, 'revoked');

  const verification = await verifyAngajatPairing(saved, fetch);
  assert.equal(verification.kind, 'REVOKED'); // clientul își șterge asocierea și cere QR nou
});

// 6. Update live Admin ↔ Angajat: SSE deja implementat — Admin scrie, clientul primește evenimentul.
test('update live: Admin POST printr-o scriere -> SSE livreaza evenimentul pe stream-ul dispozitivului', async () => {
  const issued = await post('/api/devices/pair', { deviceType: 'TABLET', deviceName: 'Tabletă Live' });
  const deviceId = (issued.body.device as { deviceId: string }).deviceId;
  const credential = String(issued.body.credential);
  const payload = createPairingPayload(
    { serviceId: String(issued.body.pairing.serviceId), serverAddress: baseUrl, apiVersion: '1' },
    deviceId,
    credential,
  );
  const attempt = await pairAngajatDevice(payload, fetch);
  assert.equal(attempt.kind, 'PAIRED');
  if (attempt.kind !== 'PAIRED') return;

  // Clientul deschide streamul SSE cu headers de dispozitiv (infrastructura existentă).
  const controller = new AbortController();
  const streamResponse = await fetch(`${baseUrl}/api/events`, {
    headers: { Accept: 'text/event-stream', 'x-servix-device-id': deviceId, 'x-servix-device-credential': credential },
    signal: controller.signal,
  });
  assert.equal(streamResponse.status, 200);
  const reader = streamResponse.body!.getReader();
  const decoder = new TextDecoder();
  let received: string | null = null;

  // Admin (loopback) face o scriere → publish pe event bus.
  const writePromise = post('/api/cars', {
    license_plate: 'LIVE-999', client_name: 'Client Live', make: 'Dacia', model: 'Duster', status: 'noua',
  });
  assert.equal((await writePromise).status, 201);

  const deadline = Date.now() + 8000;
  while (received === null && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text.includes('data:')) {
      const match = /data:\s*(\{.*\})/s.exec(text);
      if (match) received = match[1];
    }
  }
  controller.abort();
  assert.ok(received !== null, 'dispozitivul a primit un eveniment SSE după scrierea Admin-ului');
  const event = JSON.parse(received!) as { type?: string; entity?: string };
  assert.ok(typeof event.type === 'string' && event.type.length > 0, 'eveniment SSE structurat (tip non-gol)');
});
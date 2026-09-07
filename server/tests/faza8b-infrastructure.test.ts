import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabaseBackup } from '../src/backup.ts';
import { checkClientCompatibility, LOCAL_VERSION } from '../src/compatibility.ts';
import { createDatabase } from '../src/db.ts';
import { SCHEMA_VERSION } from '../src/schema.ts';
import { createApp } from '../src/server.ts';

let server: Server;
let baseUrl = '';
let app: ReturnType<typeof createDatabase>;

before(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'servix-faza8b-'));
  app = createDatabase(join(directory, 'servix-local.db'), { seed: true });
  server = createServer(createApp(app.db, new Date('2026-09-05T09:00:00.000Z')));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  app.close();
});

test('GET /api/version exposes one Local version contract and schema compatibility', async () => {
  const response = await fetch(`${baseUrl}/api/version`);
  assert.equal(response.status, 200);
  const version = await response.json() as Record<string, unknown>;
  assert.deepEqual(version, {
    ...LOCAL_VERSION,
    currentSchemaVersion: SCHEMA_VERSION,
    targetSchemaVersion: SCHEMA_VERSION,
  });
});

test('GET /api/health exposes startup timestamp, uptime, schema and server version', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const health = await response.json() as Record<string, unknown>;
  assert.equal(health.sqlite, 'connected');
  assert.equal(health.schemaVersion, SCHEMA_VERSION);
  assert.equal(health.serverVersion, LOCAL_VERSION.serverVersion);
  assert.equal(health.apiVersion, LOCAL_VERSION.apiVersion);
  assert.equal(health.startedAt, '2026-09-05T09:00:00.000Z');
  assert.equal(typeof health.uptimeSeconds, 'number');
});

test('SQLite backup is unique, non-empty, and passes its own integrity check', () => {
  const fixedTime = new Date('2026-09-05T10:00:00.000Z');
  const backup = createDatabaseBackup(app.db, app.dbPath, 'pre-upgrade', fixedTime);
  assert.ok(existsSync(backup.path));
  assert.ok(backup.sizeBytes > 0);
  assert.equal(backup.integrity, 'ok');
  assert.throws(() => createDatabaseBackup(app.db, app.dbPath, 'pre-upgrade', fixedTime), /Backup already exists/);
});

test('compatibility reports supported, old client, old server and API mismatch states', () => {
  assert.equal(checkClientCompatibility(LOCAL_VERSION.appVersion, LOCAL_VERSION.apiVersion).status, 'compatible');
  assert.equal(checkClientCompatibility('0.0.1', LOCAL_VERSION.apiVersion).status, 'client_too_old');
  assert.equal(checkClientCompatibility('9.0.0', LOCAL_VERSION.apiVersion).status, 'server_too_old');
  assert.equal(checkClientCompatibility(LOCAL_VERSION.appVersion, '99').status, 'api_incompatible');
});

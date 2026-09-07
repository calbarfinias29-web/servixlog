/**
 * FAZA 8G � END-TO-END QA (automatizabil).
 *
 * Acest test acovera tot ce poate fi verificat prin API-ul Local Server,
 * fara browser UI si fara Windows Service real.
 *
 * Ce NU este testat aici (documentat clar mai jos):
 *   - UI browser (Admin, Employee, tema vizuala, PDF export)
 *   - Windows Service real (sc.exe, auto-start la boot, crash recovery sub SYSTEM)
 *   - Inno Setup .exe compilation (ISCC.exe nu este disponibil in mediul actual)
 *   - Clean Windows install (UAC, ACL, uninstall)
 *   - LAN reale (intentionat dezactivat)
 *
 * Ruleaza cu: node --test server/tests/faza8g-e2e.test.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabaseBackup } from '../src/backup.ts';
import { loadConfig } from '../src/config.ts';
import { createDatabase } from '../src/db.ts';
import { createApp } from '../src/server.ts';
import { LocalEventBus } from '../src/events.ts';
import { SCHEMA_VERSION } from '../src/schema.ts';
import { checkAutoSyncWindows } from '../src/timer.ts';

// ===== Helpers =====

let server: Server;
let baseUrl = '';
let dx: ReturnType<typeof createDatabase>;
let eventBus: LocalEventBus;
let testDir = '';

before(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'servix-faza8g-'));
  dx = createDatabase(join(testDir, 'servix-local.db'), { seed: true });
  eventBus = new LocalEventBus();
  server = createServer(createApp(dx.db, new Date(), { eventBus }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  try { server?.close(); } catch { /* ignore */ }
  dx?.close();
});

async function post(path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, any> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() as Record<string, any> };
}

async function get(path: string): Promise<{ status: number; json: Record<string, any> }> {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, json: await response.json() as Record<string, any> };
}

function count(table: string): number {
  return (dx.db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;
}

function row(table: string, id: string): Record<string, unknown> | null {
  return dx.db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id) as Record<string, unknown> | null;
}

/** Creates a fresh car + job (assigned to the employee) via the API so timer tests don't share state. */
async function createJobForTest(empId: string): Promise<string> {
  const plate = `T${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const car = await post('/api/cars', { license_plate: plate, client_name: 'Timer Test' });
  assert.equal(car.status, 201);
  const job = await post('/api/jobs', { car_id: car.json.car.id, title: 'Timer test job' });
  assert.equal(job.status, 201);
  const jobId = String(job.json.job.id);
  // Assignment lives on the car (getJob joins cars.assigned_employee_id).
  dx.db.prepare('UPDATE cars SET assigned_employee_id = ? WHERE id = ?').run(empId, String(car.json.car.id));
  return jobId;
}

// ===== A. HEALTH / VERSION / SCHEMA =====

describe('A. Health / Version / Schema', () => {
  test('GET /api/health returns ok + sqlite connected + schema version', async () => {
    const res = await get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.sqlite, 'connected');
    assert.equal(res.json.schemaVersion, SCHEMA_VERSION);
    assert.ok(res.json.uptimeSeconds >= 0);
    assert.ok(res.json.startedAt);
  });

  test('GET /api/version returns compatibility info', async () => {
    const res = await get('/api/version');
    assert.equal(res.status, 200);
    assert.ok(res.json.serverVersion);
    assert.ok(res.json.apiVersion);
    assert.equal(res.json.currentSchemaVersion, SCHEMA_VERSION);
    assert.equal(res.json.targetSchemaVersion, SCHEMA_VERSION);
  });

  test('Schema v5 tables exist with required columns', () => {
    const tables = ['employees', 'cars', 'jobs', 'timer_sessions', 'timer_intervals',
      'time_entries', 'activity_log', 'devices', 'rates', 'work_schedule', 'themes',
      'appointments', 'vehicle_makes', 'vehicle_models', 'work_catalog'];
    for (const t of tables) {
      const found = dx.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(t);
      assert.ok(found, `missing table: ${t}`);
    }
    const ver = (dx.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    assert.equal(ver, SCHEMA_VERSION);
  });

  test('Seed data present (3 employees, 1 car, 1 job)', () => {
    assert.equal(count('employees'), 3);
    assert.equal(count('cars'), 1);
    assert.equal(count('jobs'), 1);
  });
});

// ===== B. DATA PRESERVATION (existing data survives operations) =====

describe('B. Data Preservation', () => {
  test('Existing employees/cars/jobs survive timer operations', async () => {
    const initialEmployees = count('employees');
    const initialCars = count('cars');
    const initialJobs = count('jobs');

    const emp = dx.db.prepare("SELECT id FROM employees WHERE role = 'employee' LIMIT 1").get() as { id: string };
    const car = dx.db.prepare("SELECT id FROM cars LIMIT 1").get() as { id: string };
    const job = dx.db.prepare("SELECT id FROM jobs LIMIT 1").get() as { id: string };
    dx.db.prepare('UPDATE cars SET assigned_employee_id = ? WHERE id = ?').run(emp.id, car.id);

    await post('/api/timer/start', { job_id: job.id, employee_id: emp.id });
    await post('/api/timer/finalize', { job_id: job.id, employee_id: emp.id });

    assert.equal(count('employees'), initialEmployees);
    assert.equal(count('cars'), initialCars);
    assert.equal(count('jobs'), initialJobs);

    const empAfter = row('employees', emp.id) as Record<string, unknown>;
    assert.ok(empAfter);
    assert.equal(empAfter.role, 'employee');
  });

  test('New data created by user is NOT overwritten by seed on restart', async () => {
    const newId = 'user-emp-test-001';
    dx.db.prepare("INSERT INTO employees (id, name, role, active, is_demo, created_at) VALUES (?, ?, 'employee', 1, 0, datetime('now'))")
      .run(newId, 'User Created Employee');
    assert.equal(count('employees'), 4);

    const carId = 'user-car-test-001';
    dx.db.prepare("INSERT INTO cars (id, license_plate, client_name, status, is_demo, created_at, updated_at) VALUES (?, ?, ?, 'noua', 0, datetime('now'), datetime('now'))")
      .run(carId, 'USER-01', 'User Client');

    // Restart server (simulating update)
    server.close();
    dx.close();
    dx = createDatabase(join(testDir, 'servix-local.db'), { seed: false });
    server = createServer(createApp(dx.db, new Date(), { eventBus }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const empAfter = row('employees', newId) as Record<string, unknown>;
    assert.ok(empAfter, 'User employee survived restart');
    assert.equal(empAfter.name, 'User Created Employee');
    const carAfter = row('cars', carId) as Record<string, unknown>;
    assert.ok(carAfter, 'User car survived restart');
    assert.equal(carAfter.license_plate, 'USER-01');
  });

// ===== C. TIMER END-TO-END =====

describe('C. Timer End-to-End', () => {
  test('C1. Normal flow: start → pause → resume → stop → finalize', async () => {
    const emp = dx.db.prepare("SELECT id FROM employees WHERE role = 'employee' LIMIT 1").get() as { id: string };
    const jobId = await createJobForTest(String(emp.id));

    const started = await post('/api/timer/start', { job_id: jobId, employee_id: emp.id });
    assert.equal(started.status, 201);
    assert.equal(started.json.ok, true);
    assert.equal(started.json.job.status, 'in_lucru');
    assert.ok(started.json.job.started_at);

    const dup = await post('/api/timer/start', { job_id: jobId, employee_id: emp.id });
    assert.equal(dup.status, 200);
    assert.equal(dup.json.no_op, true);

    const paused = await post('/api/timer/pause', { job_id: jobId, employee_id: emp.id, pause_reason: 'test' });
    assert.equal(paused.status, 200);
    assert.equal(paused.json.job.started_at, null);

    const resumed = await post('/api/timer/resume', { job_id: jobId, employee_id: emp.id });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.json.job.status, 'in_lucru');

    const stopped = await post('/api/timer/stop', { job_id: jobId, employee_id: emp.id });
    assert.equal(stopped.status, 200);
    assert.equal(stopped.json.job.status, 'asteptare');

    // Finalize requires a running session (server contract: TIMER_NOT_ACTIVE otherwise).
    const finalizeFromStopped = await post('/api/timer/finalize', { job_id: jobId, employee_id: emp.id });
    assert.equal(finalizeFromStopped.status, 409);

    const restarted = await post('/api/timer/start', { job_id: jobId, employee_id: emp.id });
    assert.equal(restarted.status, 200);

    const finalized = await post('/api/timer/finalize', { job_id: jobId, employee_id: emp.id });
    assert.equal(finalized.status, 200);
    assert.equal(finalized.json.job.status, 'finalizat');
  });

  test('C2. Timer state query returns session + interval', async () => {
    const emp = dx.db.prepare("SELECT id FROM employees WHERE role = 'employee' LIMIT 1").get() as { id: string };
    const jobId = await createJobForTest(String(emp.id));

    await post('/api/timer/start', { job_id: jobId, employee_id: emp.id });
    const state = await get(`/api/timer/${jobId}`);
    assert.equal(state.status, 200);
    assert.equal(state.json.ok, true);
    assert.ok(state.json.session);
    assert.equal(state.json.session.state, 'running');
    assert.ok(state.json.interval);
    assert.equal(state.json.interval.kind, 'normal');

    await post('/api/timer/stop', { job_id: jobId, employee_id: emp.id });
  });

  test('C3. Invalid timer operations rejected', async () => {
    const emp = dx.db.prepare("SELECT id FROM employees WHERE role = 'employee' LIMIT 1").get() as { id: string };
    const r1 = await post('/api/timer/start', { employee_id: 'emp-demo-1' });
    assert.equal(r1.status, 422);

    const jobId = await createJobForTest(String(emp.id));
    const r2 = await post('/api/timer/start', { job_id: jobId, employee_id: 'nonexistent' });
    assert.equal(r2.status, 404);

    // No session on this fresh job → pause must be rejected with 409.
    const r3 = await post('/api/timer/pause', { job_id: jobId, employee_id: 'emp-demo-1' });
    assert.equal(r3.status, 409);
  });

  test('C4. Activity log records timer actions', async () => {
    const before = count('activity_log');
    const emp = dx.db.prepare("SELECT id FROM employees WHERE role = 'employee' LIMIT 1").get() as { id: string };
    const jobId = await createJobForTest(String(emp.id));

    await post('/api/timer/start', { job_id: jobId, employee_id: emp.id });
    await post('/api/timer/finalize', { job_id: jobId, employee_id: emp.id });

    const after = count('activity_log');
    assert.ok(after > before, 'Activity log should have new entries');
  });
});


// ===== D. MULTI-DEVICE SSE =====

describe('D. Multi-Device SSE', () => {
  test('D1. Multiple SSE clients receive events', async () => {
    const client1 = await fetch(`${baseUrl}/api/events`);
    const client2 = await fetch(`${baseUrl}/api/events`);
    assert.equal(client1.status, 200);
    assert.equal(client2.status, 200);
    assert.equal(client1.headers.get('content-type')?.startsWith('text/event-stream'), true);

    const reader1 = client1.body!.getReader();
    const reader2 = client2.body!.getReader();
    const decoder = new TextDecoder();

    let text1 = '';
    while (!text1.includes('\n\n')) {
      const chunk = await reader1.read();
      if (chunk.done) break;
      text1 += decoder.decode(chunk.value, { stream: true });
    }
    let text2 = '';
    while (!text2.includes('\n\n')) {
      const chunk = await reader2.read();
      if (chunk.done) break;
      text2 += decoder.decode(chunk.value, { stream: true });
    }
    assert.match(text1, /servix-events-connected/);
    assert.match(text2, /servix-events-connected/);

    const created = await post('/api/cars', { license_plate: 'SSE-01', client_name: 'SSE Test' });
    assert.equal(created.status, 201);

    let eventText1 = '';
    while (!eventText1.includes('\n\n')) {
      const chunk = await reader1.read();
      if (chunk.done) break;
      eventText1 += decoder.decode(chunk.value, { stream: true });
    }
    let eventText2 = '';
    while (!eventText2.includes('\n\n')) {
      const chunk = await reader2.read();
      if (chunk.done) break;
      eventText2 += decoder.decode(chunk.value, { stream: true });
    }
    assert.match(eventText1, /event: car\.created/);
    assert.match(eventText2, /event: car\.created/);
    assert.match(eventText1, /"entity":"car"/);

    await reader1.cancel();
    await reader2.cancel();
  });

  test('D2. Failed writes do NOT publish events', async () => {
    const client = await fetch(`${baseUrl}/api/events`);
    const reader = client.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('\n\n')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }

    const failed = await post('/api/cars', { license_plate: '', client_name: 'Invalid' });
    assert.equal(failed.status, 422);

    await new Promise((r) => setTimeout(r, 100));

    // No event must arrive. Race the read against a timeout — a plain await
    // reader.read() would hang forever because the stream never ends.
    const pending = await Promise.race([
      reader.read() as Promise<ReadableStreamReadResult<Uint8Array>>,
      new Promise<ReadableStreamReadResult<Uint8Array>>((r) => setTimeout(() => r({ done: true, value: undefined }), 500)),
    ]);
    if (!pending.done) {
      const chunkText = decoder.decode(pending.value, { stream: true });
      assert.doesNotMatch(chunkText, /event: car/, 'Failed write should not publish event');
    }
    await reader.cancel();
  });

  test('D3. SSE eventId is present and non-empty', async () => {
    const client = await fetch(`${baseUrl}/api/events`);
    const reader = client.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('\n\n')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }

    await post('/api/cars', { license_plate: 'EID-01', client_name: 'EventId Test' });

    let eventText = '';
    while (!eventText.includes('\n\n')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      eventText += decoder.decode(chunk.value, { stream: true });
    }
    assert.match(eventText, /"eventId":"/);
    const eventIdMatch = eventText.match(/"eventId":"([^"]+)"/);
    assert.ok(eventIdMatch, 'eventId should be present');
    assert.ok(eventIdMatch![1].length > 0, 'eventId should not be empty');

    await reader.cancel();
  });
});


// ===== E. DEVICE PAIRING LIFECYCLE =====

describe('E. Device Pairing Lifecycle', () => {
  test('E1. Pair → Confirm → List (no credential exposure)', async () => {
    const paired = await post('/api/devices/pair', { deviceType: 'TABLET', deviceName: 'Test Tablet' });
    assert.equal(paired.status, 201);
    assert.ok(paired.json.credential, 'credential returned on pair');
    assert.equal(paired.json.device.status, 'pending');

    const deviceId = paired.json.device.deviceId;
    assert.ok(deviceId);

    const confirmed = await post('/api/devices/pair/confirm', { deviceId, credential: paired.json.credential });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.json.device.status, 'paired');

    const listed = await get('/api/devices');
    assert.equal(listed.status, 200);
    const listStr = JSON.stringify(listed.json);
    assert.equal(listStr.includes(String(paired.json.credential)), false, 'credential must not be in list');
    assert.equal(listStr.includes('credentialHash'), false, 'credentialHash must not be in list');
    assert.equal(listStr.includes('credentialSalt'), false, 'credentialSalt must not be in list');
  });

  test('E2. Revoke → Re-pair with new credential', async () => {
    const paired = await post('/api/devices/pair', { deviceType: 'PHONE', deviceName: 'Test Phone' });
    const deviceId = paired.json.device.deviceId;
    const oldCredential = String(paired.json.credential);
    await post('/api/devices/pair/confirm', { deviceId, credential: oldCredential });

    const revoked = await post('/api/devices/revoke', { deviceId });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.json.device.status, 'revoked');

    const rePaired = await post('/api/devices/pair', { deviceType: 'PHONE', deviceName: 'Test Phone Re' });
    assert.equal(rePaired.status, 201);
    const newCredential = String(rePaired.json.credential);
    assert.notEqual(newCredential, oldCredential, 'new credential must differ from old');

    const oldConfirm = await post('/api/devices/pair/confirm', { deviceId, credential: oldCredential });
    assert.equal(oldConfirm.status, 403, 'old credential must be rejected (revoked → 403)');
    assert.notEqual(oldConfirm.status, 200);
  });

  test('E3. Invalid device type rejected', async () => {
    const r = await post('/api/devices/pair', { deviceType: 'INVALID', deviceName: 'Bad' });
    assert.equal(r.status, 422);
  });

  test('E4. Heartbeat updates lastSeenAt', async () => {
    const paired = await post('/api/devices/pair', { deviceType: 'PC_COMPANION', deviceName: 'Heartbeat Test' });
    const deviceId = paired.json.device.deviceId;
    const credential = String(paired.json.credential);
    await post('/api/devices/pair/confirm', { deviceId, credential });

    // Heartbeat authenticates via x-servix-device-id / x-servix-device-credential headers.
    const hb = await post('/api/devices/heartbeat', {}, { 'x-servix-device-id': deviceId, 'x-servix-device-credential': credential });
    assert.equal(hb.status, 200);
    assert.ok(hb.json.device?.lastSeenAt, 'lastSeenAt should be set on the device');
  });
});


// ===== F. BACKUP / RECOVERY =====

describe('F. Backup / Recovery', () => {
  test('F1. Backup creates file with integrity check', () => {
    const result = createDatabaseBackup(dx.db, dx.dbPath, 'test-manual');
    assert.equal(result.integrity, 'ok');
    assert.ok(result.sizeBytes > 0);
    assert.ok(existsSync(result.path));
    assert.match(result.path, /test-manual/);
  });

  test('F2. Backup does NOT overwrite existing file', () => {
    const sameSecond = new Date('2026-01-01T10:00:00Z');
    const r1 = createDatabaseBackup(dx.db, dx.dbPath, 'no-overwrite', sameSecond);
    assert.throws(() => createDatabaseBackup(dx.db, dx.dbPath, 'no-overwrite', sameSecond), /Backup already exists/,
      'second backup with identical timestamp must be refused, never overwrite');
    const r2 = createDatabaseBackup(dx.db, dx.dbPath, 'no-overwrite', new Date(sameSecond.getTime() + 1000));
    assert.notEqual(r1.path, r2.path, 'backups should have unique paths');
    assert.ok(existsSync(r1.path));
    assert.ok(existsSync(r2.path));
  });

  test('F3. Backup directory created automatically', () => {
    const backupDir = join(testDir, 'backups');
    assert.ok(existsSync(backupDir), 'backups directory should exist');
    const files = readdirSync(backupDir);
    assert.ok(files.length >= 2, 'should have at least 2 backup files');
  });

  test('F4. Backup integrity verified via PRAGMA', () => {
    const result = createDatabaseBackup(dx.db, dx.dbPath, 'pre-schema-v99');
    assert.equal(result.integrity, 'ok');
    const check = (dx.db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    assert.equal(check, 'ok');
  });
});


// ===== G. SECURITY =====

describe('G. Security', () => {
  test('G1. No SQL injection via query params', async () => {
    const res = await get("/api/activity-log?carId=' OR 1=1 --");
    assert.equal(res.status, 200);
    assert.equal(res.json.count, 0);
  });

  test('G2. Path traversal rejected for static files', async () => {
    const res = await get('/../../etc/passwd');
    assert.equal(res.status, 404);
  });

  test('G3. Invalid JSON body handled gracefully', async () => {
    const response = await fetch(`${baseUrl}/api/timer/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json{{{',
    });
    assert.ok(response.status === 400 || response.status === 500);
    const health = await get('/api/health');
    assert.equal(health.status, 200);
  });

  test('G4. Timer protected fields rejected', async () => {
    const car = await post('/api/cars', { license_plate: `G4-${Date.now()}`, client_name: 'G4' });
    const job = await post('/api/jobs', { car_id: car.json.car.id, title: 'G4 job' });

    const r = await fetch(`${baseUrl}/api/jobs/${job.json.job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worked_seconds: 9999 }),
    });
    assert.equal(r.status, 422, 'timer protected fields should be rejected');
  });

  test('G5. CORS restricted to allowed origins', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://evil.com' },
    });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  test('G6. LAN disabled by default — loopback works without device auth', async () => {
    const res = await get('/api/cars');
    assert.equal(res.status, 200);
    assert.ok(res.json.cars);
  });
});


// ===== H. WRITE OPERATIONS =====

describe('H. Write Operations', () => {
  test('H1. Create car with valid data', async () => {
    const res = await post('/api/cars', { license_plate: 'WR-01', client_name: 'Write Test', status: 'noua' });
    assert.equal(res.status, 201);
    assert.ok(res.json.car?.id, 'created car must include id (server contract: { ok, car })');
    assert.equal(res.json.car.license_plate, 'WR-01');
  });

  test('H2. Duplicate license plate rejected', async () => {
    await post('/api/cars', { license_plate: 'DUP-01', client_name: 'First' });
    const dup = await post('/api/cars', { license_plate: 'DUP-01', client_name: 'Second' });
    assert.equal(dup.status, 409);
  });

  test('H3. Invalid car status rejected', async () => {
    const r = await post('/api/cars', { license_plate: 'INV-01', client_name: 'Test', status: 'invalid_status' });
    assert.equal(r.status, 422);
  });

  test('H4. Update car status', async () => {
    const created = await post('/api/cars', { license_plate: 'UPD-01', client_name: 'Update Test' });
    const carId = created.json.car.id;
    const updated = await fetch(`${baseUrl}/api/cars/${carId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_lucru' }),
    });
    const updatedJson = await updated.json() as Record<string, any>;
    assert.equal(updated.status, 200);
    assert.equal(updatedJson.car.status, 'in_lucru');
  });

  test('H5. Create and delete appointment', async () => {
    const created = await post('/api/appointments', {
      license_plate: 'APT-01',
      client_name: 'Test Appointment',
      appointment_date: '2026-01-01',
      appointment_time: '10:00',
    });
    assert.equal(created.status, 201);
    const apptId = created.json.appointment?.id;
    assert.ok(apptId, 'created appointment must include id (server contract: { ok, appointment })');

    // Server contract: only DEMO appointments can be deleted (demo_only).
    const delNonDemo = await fetch(`${baseUrl}/api/appointments/${apptId}`, { method: 'DELETE' });
    assert.equal(delNonDemo.status, 403, 'non-demo appointment deletion must be rejected');

    dx.db.prepare('UPDATE appointments SET is_demo = 1 WHERE id = ?').run(apptId);
    const del = await fetch(`${baseUrl}/api/appointments/${apptId}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
  });
});


// ===== I. READ OPERATIONS =====

describe('I. Read Operations', () => {
  test('I1. GET /api/cars returns all cars', async () => {
    const res = await get('/api/cars');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.cars));
    assert.ok(res.json.count >= 1);
  });

  test('I2. GET /api/employees returns all employees', async () => {
    const res = await get('/api/employees');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.employees));
    assert.ok(res.json.count >= 3);
  });

  test('I3. GET /api/jobs returns all jobs', async () => {
    const res = await get('/api/jobs');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.jobs));
  });

  test('I4. GET /api/rates returns active rates', async () => {
    const res = await get('/api/rates');
    assert.equal(res.status, 200);
    assert.ok(res.json.rates);
  });

  test('I5. GET /api/schedule returns active schedule', async () => {
    const res = await get('/api/schedule');
    assert.equal(res.status, 200);
    assert.ok(res.json.schedule);
  });

  test('I6. GET /api/themes returns themes with normalized colors', async () => {
    const res = await get('/api/themes');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.themes));
    if (res.json.count > 0) {
      const theme = res.json.themes[0];
      assert.ok(theme.colors, 'theme should have colors object');
      assert.ok(theme.scope === 'admin' || theme.scope === 'employee');
    }
  });

  test('I7. GET /api/activity-log requires carId', async () => {
    const res = await get('/api/activity-log');
    assert.equal(res.status, 400);
  });

  test('I8. GET /api/time-entries requires fromIso and toIso', async () => {
    const res = await get('/api/time-entries');
    assert.equal(res.status, 400);
  });

  test('I9. GET /api/time-entries with valid params returns entries', async () => {
    const res = await get('/api/time-entries?fromIso=2026-01-01T00:00:00Z&toIso=2026-12-31T23:59:59Z');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.entries));
  });
});


// ===== J. CONFIGURATION =====

describe('J. Configuration', () => {
  test('J1. loadConfig defaults are safe', () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 8787);
    assert.equal(config.lanEnabled, false);
    assert.equal(config.seedDemo, true);
  });

  test('J2. LAN disabled by default even with empty env', () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    assert.equal(config.lanEnabled, false);
    assert.equal(config.host, '127.0.0.1');
  });

  test('J3. SERVIX_LAN_ENABLED=true enables LAN', () => {
    const config = loadConfig({ SERVIX_LAN_ENABLED: 'true' } as NodeJS.ProcessEnv);
    assert.equal(config.lanEnabled, true);
    assert.equal(config.host, '0.0.0.0');
  });

  test('J4. Invalid port falls back to default', () => {
    const config = loadConfig({ SERVIX_PORT: '99999' } as NodeJS.ProcessEnv);
    assert.equal(config.port, 8787);
  });
});

// ===== K. AUTO-SYNC / RECOVERY =====

describe('K. Auto-Sync / Recovery', () => {
  test('K1. checkAutoSyncWindows does not crash with no active sessions', () => {
    checkAutoSyncWindows(dx.db, Date.now());
  });

  test('K2. Auto-sync handles active session gracefully', async () => {
    const emp = dx.db.prepare("SELECT id FROM employees WHERE role = 'employee' LIMIT 1").get() as { id: string };
    const jobId = await createJobForTest(String(emp.id));

    await post('/api/timer/start', { job_id: jobId, employee_id: emp.id });

    checkAutoSyncWindows(dx.db, Date.now());

    const state = await get(`/api/timer/${jobId}`);
    assert.equal(state.json.session.state, 'running');
  });
});

// ===== L. ERROR HANDLING =====

describe('L. Error Handling', () => {
  test('L1. 404 for unknown endpoint', async () => {
    const res = await get('/api/nonexistent');
    assert.equal(res.status, 404);
  });

  test('L2. 405 for unsupported method', async () => {
    const res = await fetch(`${baseUrl}/api/cars`, { method: 'PUT' });
    assert.equal(res.status, 405);
  });

  test('L3. Server survives malformed request', async () => {
    await fetch(`${baseUrl}/api/health`, {
      method: 'POST',
      body: '\x00\x01\x02\x03',
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    const health = await get('/api/health');
    assert.equal(health.status, 200);
  });
});

// ===== M. DATA INTEGRITY =====

describe('M. Data Integrity', () => {
  test('M1. Foreign key constraints enforced', () => {
    assert.throws(() => {
      dx.db.prepare("INSERT INTO jobs (id, car_id, title, status, is_demo, created_at, updated_at) VALUES (?, ?, ?, 'asteptare', 0, datetime('now'), datetime('now'))")
        .run('bad-job', 'nonexistent-car', 'Bad Job');
    }, /FOREIGN KEY/);
  });

  test('M2. WAL mode enabled', () => {
    const mode = (dx.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
    assert.equal(mode, 'wal');
  });

  test('M3. Integrity check passes', () => {
    const check = (dx.db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    assert.equal(check, 'ok');
  });
});

});

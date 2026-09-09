import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/server.ts';
import { createDatabase } from '../src/db.ts';
import { dispatchTimer, overlapSeconds } from '../src/timer.ts';
import { LocalDataAdapter } from '../../src/data/LocalDataAdapter.ts';

let server: Server;
let baseUrl = '';
let dx: ReturnType<typeof createDatabase>;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'servix-timer-test-'));
  dx = createDatabase(join(dir, 'timer.db'), { seed: true });
  server = createServer(createApp(dx.db));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  try { server?.close(); } catch { /* ignore */ }
  dx?.close();
});

async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, any> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() as Record<string, any> };
}

test('timer local: start, duplicate start, recovery, pause, resume, stop and finalize', async () => {
  const identity = { job_id: 'job-demo-1', employee_id: 'emp-demo-1' };
  const started = await post('/api/timer/start', identity);
  assert.equal(started.status, 201);
  assert.equal(started.json.ok, true);
  assert.equal(started.json.job.status, 'in_lucru');
  assert.ok(started.json.job.started_at);
  assert.ok(started.json.session);

  const duplicate = await post('/api/timer/start', identity);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.json.no_op, true);

  const state = await fetch(`${baseUrl}/api/timer/job-demo-1`);
  const recovered = await state.json() as Record<string, any>;
  assert.equal(state.status, 200);
  assert.equal(recovered.session.state, 'running');

  const paused = await post('/api/timer/status', { ...identity, status: 'asteptare', pause_reason: 'manual' });
  assert.equal(paused.status, 200);
  assert.equal(paused.json.job.started_at, null);
  assert.equal(paused.json.session.state, 'stopped');

  const resumed = await post('/api/timer/start', identity);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.json.job.status, 'in_lucru');
  assert.notEqual(resumed.json.job.started_at, null);

  const stopped = await post('/api/timer/status', { ...identity, status: 'asteptare' });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.json.job.started_at, null);
  assert.equal(stopped.json.job.is_overtime, 0);

  const restarted = await post('/api/timer/start', identity);
  assert.equal(restarted.status, 200);
  const finalized = await post('/api/timer/status', { ...identity, status: 'finalizat', pause_reason: 'completed' });
  assert.equal(finalized.status, 200);
  assert.equal(finalized.json.job.status, 'finalizat');
  assert.equal(finalized.json.job.started_at, null);
  assert.equal(finalized.json.job.is_overtime, 0);
  assert.ok(finalized.json.job.completed_at);
  const events = dx.db.prepare("SELECT action FROM activity_log WHERE job_id = 'job-demo-1' ORDER BY created_at").all() as Array<{ action: string }>;
  assert.ok(events.some((event) => event.action === 'in_lucru'));
  assert.ok(events.some((event) => event.action === 'asteptare'));
  assert.ok(events.some((event) => event.action === 'finalizat'));
});

test('timer local: wrong employee and second active job are rejected', async () => {
  const wrong = await post('/api/timer/start', { job_id: 'job-demo-1', employee_id: 'emp-missing' });
  assert.equal(wrong.status, 404);

  const employee = dx.db.prepare("INSERT INTO employees (id, name, created_at) VALUES ('emp-2', 'Employee 2', '2026-09-04T00:00:00.000Z')").run();
  assert.ok(employee);
  dx.db.prepare("INSERT INTO cars (id, license_plate, client_name, assigned_employee_id, created_at) VALUES ('car-2', 'TEST-02', 'Client 2', 'emp-demo-1', '2026-09-04T00:00:00.000Z')").run();
  dx.db.prepare("INSERT INTO jobs (id, car_id, title, created_at) VALUES ('job-2', 'car-2', 'Job 2', '2026-09-04T00:00:00.000Z')").run();
  await post('/api/timer/start', { job_id: 'job-2', employee_id: 'emp-demo-1' });
  const other = await post('/api/timer/start', { job_id: 'job-demo-1', employee_id: 'emp-demo-1' });
  assert.equal(other.status, 409);
  assert.equal(other.json.error, 'EMPLOYEE_ALREADY_HAS_ACTIVE_JOB');
  await post('/api/timer/status', { job_id: 'job-2', employee_id: 'emp-demo-1', status: 'asteptare' });
});

test('timer local: normal and overtime overlap use weekly schedule and inactive days', () => {
  const schedule = {
    work_start: '07:00', work_end: '18:00', break_start: '13:00', break_end: '14:00',
    monday_active: 1, monday_start: '07:00', monday_end: '18:00',
    tuesday_active: 1, tuesday_start: '07:00', tuesday_end: '18:00',
    wednesday_active: 1, wednesday_start: '07:00', wednesday_end: '18:00',
    thursday_active: 1, thursday_start: '07:00', thursday_end: '18:00',
    friday_active: 1, friday_start: '07:00', friday_end: '18:00',
    saturday_active: 0, saturday_start: '07:00', saturday_end: '18:00',
    sunday_active: 0, sunday_start: '07:00', sunday_end: '18:00',
  };
  const normal = overlapSeconds(schedule, Date.parse('2026-09-04T11:00:00.000Z'), Date.parse('2026-09-04T14:00:00.000Z'), 'normal');
  const overtime = overlapSeconds(schedule, Date.parse('2026-09-04T14:00:00.000Z'), Date.parse('2026-09-04T17:00:00.000Z'), 'overtime');
  const inactiveNormal = overlapSeconds(schedule, Date.parse('2026-09-06T04:00:00.000Z'), Date.parse('2026-09-06T07:00:00.000Z'), 'normal');
  const inactiveOvertime = overlapSeconds(schedule, Date.parse('2026-09-06T04:00:00.000Z'), Date.parse('2026-09-06T07:00:00.000Z'), 'overtime');
  assert.equal(normal, 3 * 3600);
  assert.equal(overtime, 2 * 3600);
  assert.equal(inactiveNormal, 0);
  assert.equal(inactiveOvertime, 3 * 3600);
});

test('timer local: start overtime requires an active timer and legal window', () => {
  const invalid = dispatchTimer(dx.db, 'POST', '/api/timer/overtime/start', { job_id: 'job-demo-1', employee_id: 'emp-demo-1' }, Date.parse('2026-09-04T10:00:00.000Z'))!;
  assert.equal(invalid.status, 409);
  assert.equal((invalid.payload as { error: string }).error, 'TIMER_NOT_ACTIVE');
});

test('timer local: normal to overtime keeps seconds separate', () => {
  dx.db.prepare("INSERT INTO cars (id, license_plate, client_name, assigned_employee_id, created_at) VALUES ('car-ot', 'OT-TEST', 'OT Client', 'emp-demo-1', '2026-09-04T00:00:00.000Z')").run();
  dx.db.prepare("INSERT INTO jobs (id, car_id, title, created_at) VALUES ('job-ot', 'car-ot', 'OT Job', '2026-09-04T00:00:00.000Z')").run();
  const identity = { job_id: 'job-ot', employee_id: 'emp-demo-1' };
  const start = dispatchTimer(dx.db, 'POST', '/api/timer/start', identity, Date.parse('2026-09-04T11:00:00.000Z'))!;
  assert.equal(start.status, 201);
  const overtimeStart = dispatchTimer(dx.db, 'POST', '/api/timer/overtime/start', identity, Date.parse('2026-09-04T15:00:00.000Z'))!;
  assert.equal(overtimeStart.status, 200);
  const overtimeStop = dispatchTimer(dx.db, 'POST', '/api/timer/overtime/stop', identity, Date.parse('2026-09-04T17:00:00.000Z'))!;
  assert.equal(overtimeStop.status, 200);
  const job = dx.db.prepare('SELECT worked_seconds, overtime_seconds, started_at, is_overtime FROM jobs WHERE id = ?').get('job-ot') as { worked_seconds: number; overtime_seconds: number; started_at: string | null; is_overtime: number };
  assert.equal(job.worked_seconds, 4 * 3600);
  assert.equal(job.overtime_seconds, 2 * 3600);
  assert.equal(job.started_at, null);
  assert.equal(job.is_overtime, 0);
});

test('timer local: adapter recovery survives server restart', async () => {
  dx.db.prepare("INSERT INTO cars (id, license_plate, client_name, assigned_employee_id, created_at) VALUES ('car-restart', 'RST-TEST', 'Restart Client', 'emp-demo-1', '2026-09-04T00:00:00.000Z')").run();
  dx.db.prepare("INSERT INTO jobs (id, car_id, title, created_at) VALUES ('job-restart', 'car-restart', 'Restart Job', '2026-09-04T00:00:00.000Z')").run();
  const adapter = new LocalDataAdapter(baseUrl);
  const started = await adapter.startJobTimer!({ job_id: 'job-restart', employee_id: 'emp-demo-1' });
  assert.equal(started.error, null);
  await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
  server = createServer(createApp(dx.db));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  const recovered = await new LocalDataAdapter(baseUrl).getTimerState!('job-restart');
  assert.equal(recovered.error, null);
  assert.equal(recovered.data?.session?.state, 'running');
  assert.equal(recovered.data?.job?.status, 'in_lucru');
  const stopped = await new LocalDataAdapter(baseUrl).updateJobTimerStatus!({ job_id: 'job-restart', employee_id: 'emp-demo-1', status: 'asteptare' });
  assert.equal(stopped.error, null);
});

test('timer local: pornire -> pauza -> reluare -> pauza -> reluare logheaza 5 evenimente distincte in activity_log', async () => {
  dx.db.prepare("INSERT INTO cars (id, license_plate, client_name, assigned_employee_id, created_at) VALUES ('car-crono', 'CRN-TEST', 'Crono Client', 'emp-demo-1', '2026-09-09T00:00:00.000Z')").run();
  dx.db.prepare("INSERT INTO jobs (id, car_id, title, created_at) VALUES ('job-crono', 'car-crono', 'Job Cronologie', '2026-09-09T00:00:00.000Z')").run();
  const identity = { job_id: 'job-crono', employee_id: 'emp-demo-1' };

  const start = await post('/api/timer/start', identity);
  assert.equal(start.status, 201);
  const pause1 = await post('/api/timer/status', { ...identity, status: 'asteptare' });
  assert.equal(pause1.status, 200);
  const resume1 = await post('/api/timer/start', identity);
  assert.equal(resume1.status, 200);
  const pause2 = await post('/api/timer/status', { ...identity, status: 'asteptare' });
  assert.equal(pause2.status, 200);
  const resume2 = await post('/api/timer/start', identity);
  assert.equal(resume2.status, 200);

  const events = dx.db.prepare(
    "SELECT action, detail, job_id, employee_id FROM activity_log WHERE job_id = 'job-crono' ORDER BY created_at",
  ).all() as Array<{ action: string; detail: string; job_id: string; employee_id: string }>;

  assert.equal(events.length, 5);
  for (const event of events) {
    assert.equal(event.job_id, 'job-crono');
    assert.equal(event.employee_id, 'emp-demo-1');
  }
  assert.deepEqual(events.map((e) => [e.action, e.detail]), [
    ['in_lucru', 'Cronometrul a fost pornit'],
    ['asteptare', 'Lucrarea a fost pusă pe pauză'],
    ['in_lucru', 'Lucrarea a fost reluată'],
    ['asteptare', 'Lucrarea a fost pusă pe pauză'],
    ['in_lucru', 'Lucrarea a fost reluată'],
  ]);

  // Sursa Admin (dataAdapter.getCarActivityLog) trebuie să arate exact aceleași 5 evenimente.
  const adapter = new LocalDataAdapter(baseUrl);
  const carActivity = await adapter.getCarActivityLog('car-crono');
  assert.equal(carActivity.error, null);
  assert.equal(carActivity.data?.length, 5);
  assert.deepEqual((carActivity.data ?? []).map((e) => e.action), events.map((e) => e.action));
});


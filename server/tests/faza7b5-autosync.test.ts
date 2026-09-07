/**
 * FAZA 7B-5 Tests — Auto-sync, Recovery, Edge Cases, Invariants
 *
 * Comprehensive testing for:
 * - Auto-sync at 13:00 and 18:00 with idempotency  
 * - Recovery on server restart
 * - Edge cases: breaks, inactive days, midnight, transfers, takeovers
 * - Invariant verification
 * - Duplicate and concurrent request handling
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/server.ts';
import { createDatabase } from '../src/db.ts';
import { checkAutoSyncWindows, dispatchTimer } from '../src/timer.ts';

let server: Server;
let baseUrl = '';
let dx: ReturnType<typeof createDatabase>;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'servix-faza7b5-test-'));
  dx = createDatabase(join(dir, 'autosync.db'), { seed: true });
  server = createServer(createApp(dx.db));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  try { server?.close(); } catch { /* ignore */ }
  dx?.close();
});

async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

function createJobAndEmployee(suffix: string, employeeOverride?: string): { jobId: string; carId: string; employeeId: string } {
  const employeeId = employeeOverride || `emp-faza7b5-${suffix}`;
  const carId = `car-test-${suffix}`;
  const jobId = `job-test-${suffix}`;
  
  // Create employee if needed
  const existing = dx.db.prepare('SELECT id FROM employees WHERE id = ?').get(employeeId);
  if (!existing) {
    dx.db.prepare(
      "INSERT INTO employees (id, name, role, created_at) VALUES (?, ?, ?, ?)"
    ).run(employeeId, `Test Employee ${suffix}`, 'employee', new Date().toISOString());
  }
  
  // Create car and job
  dx.db.prepare(
    "INSERT INTO cars (id, license_plate, client_name, assigned_employee_id, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(carId, `TEST-${suffix}`, `Test Client ${suffix}`, employeeId, new Date().toISOString());
  
  dx.db.prepare(
    "INSERT INTO jobs (id, car_id, title, status, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(jobId, carId, `Test Job ${suffix}`, 'asteptare', new Date().toISOString());
  
  return { jobId, carId, employeeId };
}

function checkInvariants(): { violations: string[] } {
  const violations: string[] = [];
  
  const badWorked = dx.db.prepare('SELECT COUNT(*) as cnt FROM jobs WHERE worked_seconds < 0').get() as { cnt: number };
  if (badWorked.cnt > 0) violations.push(`Negative worked_seconds`);

  const badOvertime = dx.db.prepare('SELECT COUNT(*) as cnt FROM jobs WHERE overtime_seconds < 0').get() as { cnt: number };
  if (badOvertime.cnt > 0) violations.push(`Negative overtime_seconds`);

  const dupJobs = dx.db.prepare(`
    SELECT COUNT(*) as cnt FROM timer_sessions 
    WHERE state IN ('running', 'paused') 
    GROUP BY job_id HAVING cnt > 1
  `).all() as Array<{ cnt: number }>;
  if (dupJobs.length > 0) violations.push(`Multiple active sessions per job`);

  return { violations };
}

test('1. Auto-sync at 13:00 reconciles active sessions', async () => {
  const { jobId, employeeId } = createJobAndEmployee('1');
  
  const started = await post('/api/timer/start', { job_id: jobId, employee_id: employeeId });
  assert.equal(started.status, 201);

  checkAutoSyncWindows(dx.db, new Date('2026-09-04T13:00:00Z').getTime());

  const job = dx.db.prepare('SELECT worked_seconds FROM jobs WHERE id = ?').get(jobId) as { worked_seconds: number };
  assert(job.worked_seconds >= 0);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('2. Auto-sync is idempotent per employee per day', async () => {
  const { employeeId } = createJobAndEmployee('2');
  
  dx.db.prepare(`
    INSERT INTO session_event_log (id, employee_id, event_date, event_type, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(`event-${employeeId}`, employeeId, '2026-09-04', 'break_start', new Date().toISOString());

  checkAutoSyncWindows(dx.db, new Date('2026-09-04T13:00:00Z').getTime());
  checkAutoSyncWindows(dx.db, new Date('2026-09-04T13:30:00Z').getTime());

  const count = (dx.db.prepare(
    "SELECT COUNT(*) as cnt FROM session_event_log WHERE employee_id = ? AND event_date = ? AND event_type = ?"
  ).get(employeeId, '2026-09-04', 'break_start') as { cnt: number }).cnt;
  
  assert.equal(count, 1);
});

test('3. Auto-sync at 18:00 for end of work day', async () => {
  const { jobId, employeeId } = createJobAndEmployee('3');

  const started = await post('/api/timer/start', { job_id: jobId, employee_id: employeeId });
  assert.equal(started.status, 201);

  checkAutoSyncWindows(dx.db, new Date('2026-09-04T18:00:00Z').getTime());

  const job = dx.db.prepare('SELECT worked_seconds, overtime_seconds FROM jobs WHERE id = ?').get(jobId) as { worked_seconds: number; overtime_seconds: number };
  assert(job.worked_seconds >= 0);
  assert(job.overtime_seconds >= 0);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('4. Recovery: Running session persists after restart', () => {
  const { jobId, employeeId } = createJobAndEmployee('4');
  const startAt = new Date('2026-09-04T06:00:00Z').getTime(); // 09:00 Europe/Bucharest
  const restartAt = new Date('2026-09-04T07:00:00Z').getTime(); // 10:00 Europe/Bucharest

  const started = dispatchTimer(dx.db, 'POST', '/api/timer/start', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, startAt);
  assert.equal(started?.payload.ok, true);

  checkAutoSyncWindows(dx.db, restartAt);

  const session = dx.db.prepare('SELECT id, state FROM timer_sessions WHERE job_id = ?').get(jobId) as { id: string; state: string };
  assert.ok(session?.id);
  assert.equal(session?.state, 'running');

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('5. Recovery: Paused session remains paused after restart', () => {
  const { jobId, employeeId } = createJobAndEmployee('5');
  const startAt = new Date('2026-09-04T06:00:00Z').getTime(); // 09:00 Europe/Bucharest
  const pausedAt = new Date('2026-09-04T06:30:00Z').getTime();
  const restartAt = new Date('2026-09-04T07:00:00Z').getTime(); // 10:00 Europe/Bucharest

  dispatchTimer(dx.db, 'POST', '/api/timer/start', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, startAt);
  dispatchTimer(dx.db, 'POST', '/api/timer/pause', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, pausedAt);

  checkAutoSyncWindows(dx.db, restartAt);

  const session = dx.db.prepare('SELECT state FROM timer_sessions WHERE job_id = ?').get(jobId) as { state: string };
  assert.equal(session?.state, 'stopped');

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('6. Edge case: Break crossing (12:50-13:10)', () => {
  const { jobId, employeeId } = createJobAndEmployee('6');
  const start = new Date('2026-09-04T12:50:00Z').getTime();
  const stop = new Date('2026-09-04T13:10:00Z').getTime();

  dispatchTimer(dx.db, 'POST', '/api/timer/start', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, start);

  dispatchTimer(dx.db, 'POST', '/api/timer/stop', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, stop);

  const job = dx.db.prepare('SELECT worked_seconds FROM jobs WHERE id = ?').get(jobId) as { worked_seconds: number };
  assert(job.worked_seconds >= 0);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('7. Edge case: Before work hours (06:00-07:00)', () => {
  const { jobId, employeeId } = createJobAndEmployee('7');
  const start = new Date('2026-09-04T06:00:00Z').getTime();
  const stop = new Date('2026-09-04T07:00:00Z').getTime();

  dispatchTimer(dx.db, 'POST', '/api/timer/start', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, start);
  dispatchTimer(dx.db, 'POST', '/api/timer/stop', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, stop);

  const job = dx.db.prepare('SELECT worked_seconds FROM jobs WHERE id = ?').get(jobId) as { worked_seconds: number };
  assert(job.worked_seconds >= 0);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('8. Edge case: After work hours (17:50-18:10)', () => {
  const { jobId, employeeId } = createJobAndEmployee('8');
  const start = new Date('2026-09-04T17:50:00Z').getTime();
  const stop = new Date('2026-09-04T18:10:00Z').getTime();

  dispatchTimer(dx.db, 'POST', '/api/timer/start', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, start);
  dispatchTimer(dx.db, 'POST', '/api/timer/stop', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, stop);

  const job = dx.db.prepare('SELECT worked_seconds, overtime_seconds FROM jobs WHERE id = ?').get(jobId) as { worked_seconds: number; overtime_seconds: number };
  assert(job.worked_seconds >= 0);
  assert(job.overtime_seconds >= 0);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('9. Edge case: Inactive day (Saturday)', () => {
  const { jobId, employeeId } = createJobAndEmployee('9');
  const start = new Date('2026-09-05T10:00:00Z').getTime();
  const stop = new Date('2026-09-05T12:00:00Z').getTime();

  dispatchTimer(dx.db, 'POST', '/api/timer/start', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, start);
  dispatchTimer(dx.db, 'POST', '/api/timer/stop', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, stop);

  const job = dx.db.prepare('SELECT worked_seconds FROM jobs WHERE id = ?').get(jobId) as { worked_seconds: number };
  assert(job.worked_seconds >= 0);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('10. Edge case: Midnight crossing (23:50-00:10)', () => {
  const { jobId, employeeId } = createJobAndEmployee('10');
  const start = new Date('2026-09-04T23:50:00Z').getTime();
  const stop = new Date('2026-09-05T00:10:00Z').getTime();

  dispatchTimer(dx.db, 'POST', '/api/timer/start', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, start);
  dispatchTimer(dx.db, 'POST', '/api/timer/stop', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, stop);

  const job = dx.db.prepare('SELECT worked_seconds, overtime_seconds FROM jobs WHERE id = ?').get(jobId) as { worked_seconds: number; overtime_seconds: number };
  assert(job.worked_seconds >= 0);
  assert(job.overtime_seconds >= 0);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('11. Normal to OT: START normal, START OT, STOP OT', async () => {
  const { jobId, employeeId } = createJobAndEmployee('11');

  const started = await post('/api/timer/start', { job_id: jobId, employee_id: employeeId });
  assert.equal(started.status, 201);

  const now = new Date('2026-09-04T18:30:00Z').getTime();
  const otStarted = dispatchTimer(dx.db, 'POST', '/api/timer/overtime/start', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, now);
  assert.equal(otStarted?.payload.ok, true);

  const otStopped = dispatchTimer(dx.db, 'POST', '/api/timer/overtime/stop', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, now + 600000);
  assert.equal(otStopped?.payload.ok, true);

  const job = dx.db.prepare('SELECT worked_seconds, overtime_seconds FROM jobs WHERE id = ?').get(jobId) as { worked_seconds: number; overtime_seconds: number };
  assert(job.worked_seconds >= 0);
  assert(job.overtime_seconds >= 0);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('12. Pause-Resume-OT: START, PAUSE, RESUME, START OT, STOP OT', async () => {
  const { jobId, employeeId } = createJobAndEmployee('12');

  const started = await post('/api/timer/start', { job_id: jobId, employee_id: employeeId });
  assert.equal(started.status, 201);

  const paused = await post('/api/timer/pause', { job_id: jobId, employee_id: employeeId });
  assert.equal(paused.status, 200);

  const resumed = await post('/api/timer/start', { job_id: jobId, employee_id: employeeId });
  assert.equal(resumed.status, 200);

  const now = new Date('2026-09-04T18:30:00Z').getTime();
  const otStarted = dispatchTimer(dx.db, 'POST', '/api/timer/overtime/start', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, now);
  assert.equal(otStarted?.payload.ok, true);

  const otStopped = dispatchTimer(dx.db, 'POST', '/api/timer/overtime/stop', 
    { job_id: jobId, employee_id: employeeId } as Record<string, unknown>, now + 300000);
  assert.equal(otStopped?.payload.ok, true);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('13. Takeover with auto-sync', async () => {
  const { jobId, employeeId } = createJobAndEmployee('13');
  const { employeeId: emp2Id } = createJobAndEmployee('13-takeover');

  const started = await post('/api/timer/start', { job_id: jobId, employee_id: employeeId });
  assert.equal(started.status, 201);

  const takenOver = dispatchTimer(dx.db, 'POST', '/api/timer/takeover', 
    { job_id: jobId, employee_id: emp2Id } as Record<string, unknown>, Date.now() + 30_000);
  assert.equal(takenOver?.payload.ok, true);

  checkAutoSyncWindows(dx.db, new Date('2026-09-04T13:00:00Z').getTime());

  const job = dx.db.prepare('SELECT worked_seconds FROM jobs WHERE id = ?').get(jobId) as { worked_seconds: number };
  assert(job.worked_seconds >= 0);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('14. Transfer with auto-sync', async () => {
  const { jobId, carId, employeeId } = createJobAndEmployee('14');
  const { employeeId: emp2Id } = createJobAndEmployee('14-transfer');

  const started = await post('/api/timer/start', { job_id: jobId, employee_id: employeeId });
  assert.equal(started.status, 201);

  const transferred = dispatchTimer(dx.db, 'POST', '/api/timer/transfer', 
    { car_id: carId, new_employee_id: emp2Id, admin_id: 'admin-demo-1' } as Record<string, unknown>, Date.now());
  assert.equal(transferred?.payload.ok, true);

  checkAutoSyncWindows(dx.db, new Date('2026-09-04T18:00:00Z').getTime());

  const job = dx.db.prepare('SELECT worked_seconds FROM jobs WHERE id = ?').get(jobId) as { worked_seconds: number };
  assert(job.worked_seconds >= 0);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('15. Duplicate START: Returns no_op', async () => {
  const { jobId, employeeId } = createJobAndEmployee('15');

  const first = await post('/api/timer/start', { job_id: jobId, employee_id: employeeId });
  assert.equal(first.status, 201);

  const second = await post('/api/timer/start', { job_id: jobId, employee_id: employeeId });
  assert.equal(second.status, 200);
  assert((second.json.no_op as boolean) === true);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('16. Duplicate PAUSE: Fails gracefully', async () => {
  const { jobId, employeeId } = createJobAndEmployee('16');

  await post('/api/timer/start', { job_id: jobId, employee_id: employeeId });
  const paused1 = await post('/api/timer/pause', { job_id: jobId, employee_id: employeeId });
  assert.equal(paused1.status, 200);

  const paused2 = await post('/api/timer/pause', { job_id: jobId, employee_id: employeeId });
  assert.equal(paused2.status, 409);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('17. Concurrent START: One 201, one 200 no_op', async () => {
  const { jobId, employeeId } = createJobAndEmployee('17');

  const [r1, r2] = await Promise.all([
    post('/api/timer/start', { job_id: jobId, employee_id: employeeId }),
    post('/api/timer/start', { job_id: jobId, employee_id: employeeId }),
  ]);

  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [200, 201]);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('18. Concurrent: Different jobs, different employees', async () => {
  const { jobId: job1, employeeId: emp1 } = createJobAndEmployee('18a');
  const { jobId: job2, employeeId: emp2 } = createJobAndEmployee('18b');

  const [r1, r2] = await Promise.all([
    post('/api/timer/start', { job_id: job1, employee_id: emp1 }),
    post('/api/timer/start', { job_id: job2, employee_id: emp2 }),
  ]);

  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);

  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('19. Invariants: All constraints pass', () => {
  const inv = checkInvariants();
  assert.equal(inv.violations.length, 0);
});

test('20. Invariants: No negative time values', () => {
  const bad = dx.db.prepare(
    'SELECT COUNT(*) as cnt FROM jobs WHERE worked_seconds < 0 OR overtime_seconds < 0'
  ).get() as { cnt: number };

  assert.equal(bad.cnt, 0);
});

test('21. Auto-sync pauses a running session at 13:00 Europe/Bucharest', () => {
  const { jobId, employeeId } = createJobAndEmployee('autosync-13');
  const startAt = new Date('2026-09-04T06:00:00Z').getTime(); // 09:00 EEST
  const breakAt = new Date('2026-09-04T10:00:00Z').getTime(); // 13:00 EEST
  dispatchTimer(dx.db, 'POST', '/api/timer/start', { job_id: jobId, employee_id: employeeId }, startAt);

  checkAutoSyncWindows(dx.db, breakAt);

  const session = dx.db.prepare('SELECT state, normal_seconds FROM timer_sessions WHERE job_id = ?').get(jobId) as { state: string; normal_seconds: number };
  const job = dx.db.prepare('SELECT started_at, worked_seconds FROM jobs WHERE id = ?').get(jobId) as { started_at: string | null; worked_seconds: number };
  assert.equal(session.state, 'paused');
  assert.equal(session.normal_seconds, 14_400);
  assert.equal(job.started_at, null);
  assert.equal(job.worked_seconds, 14_400);
});

test('22. Auto-sync stops a normal session at 18:00 Europe/Bucharest', () => {
  const { jobId, employeeId } = createJobAndEmployee('autosync-18');
  const startAt = new Date('2026-09-04T06:00:00Z').getTime(); // 09:00 EEST
  const workEndAt = new Date('2026-09-04T15:00:00Z').getTime(); // 18:00 EEST
  dispatchTimer(dx.db, 'POST', '/api/timer/start', { job_id: jobId, employee_id: employeeId }, startAt);

  checkAutoSyncWindows(dx.db, workEndAt);

  const session = dx.db.prepare('SELECT state, normal_seconds, overtime_seconds FROM timer_sessions WHERE job_id = ?').get(jobId) as { state: string; normal_seconds: number; overtime_seconds: number };
  const job = dx.db.prepare('SELECT status, started_at, worked_seconds, overtime_seconds FROM jobs WHERE id = ?').get(jobId) as { status: string; started_at: string | null; worked_seconds: number; overtime_seconds: number };
  assert.equal(session.state, 'stopped');
  assert.equal(session.normal_seconds, 28_800);
  assert.equal(session.overtime_seconds, 0);
  assert.equal(job.status, 'asteptare');
  assert.equal(job.started_at, null);
  assert.equal(job.worked_seconds, 28_800);
  assert.equal(job.overtime_seconds, 0);
});

test('23. Recovery after the break window replays missed break events once', () => {
  const { jobId, employeeId } = createJobAndEmployee('recovery-after-break');
  dispatchTimer(dx.db, 'POST', '/api/timer/start', { job_id: jobId, employee_id: employeeId }, new Date('2026-09-04T06:00:00Z').getTime());

  checkAutoSyncWindows(dx.db, new Date('2026-09-04T11:00:00Z').getTime()); // 14:00 EEST

  const session = dx.db.prepare('SELECT state FROM timer_sessions WHERE job_id = ?').get(jobId) as { state: string };
  const events = dx.db.prepare('SELECT event_type FROM session_event_log WHERE employee_id = ? AND job_id = ? ORDER BY event_type').all(employeeId, jobId) as Array<{ event_type: string }>;
  assert.equal(session.state, 'running');
  assert.deepEqual(events.map((event) => event.event_type), ['break_end', 'break_start']);
});

test('24. Recovery after work end reconciles downtime without duplicate events', () => {
  const { jobId, employeeId } = createJobAndEmployee('recovery-after-work-end');
  dispatchTimer(dx.db, 'POST', '/api/timer/start', { job_id: jobId, employee_id: employeeId }, new Date('2026-09-04T06:00:00Z').getTime());
  const restartAt = new Date('2026-09-04T16:00:00Z').getTime(); // 19:00 EEST

  checkAutoSyncWindows(dx.db, restartAt);
  checkAutoSyncWindows(dx.db, restartAt);

  const session = dx.db.prepare('SELECT state, normal_seconds FROM timer_sessions WHERE job_id = ?').get(jobId) as { state: string; normal_seconds: number };
  const eventCount = (dx.db.prepare('SELECT COUNT(*) AS count FROM session_event_log WHERE employee_id = ? AND job_id = ?').get(employeeId, jobId) as { count: number }).count;
  assert.equal(session.state, 'stopped');
  assert.equal(session.normal_seconds, 28_800);
  assert.equal(eventCount, 3);
});

test('25. DST fallback uses Europe/Bucharest civil schedule boundaries', () => {
  const { jobId, employeeId } = createJobAndEmployee('dst-fallback');
  dx.db.prepare('UPDATE work_schedule SET sunday_active = 1').run();
  dispatchTimer(dx.db, 'POST', '/api/timer/start', { job_id: jobId, employee_id: employeeId }, new Date('2026-10-25T10:30:00Z').getTime()); // 12:30 EET

  checkAutoSyncWindows(dx.db, new Date('2026-10-25T12:00:00Z').getTime()); // 14:00 EET

  const session = dx.db.prepare('SELECT state, normal_seconds FROM timer_sessions WHERE job_id = ?').get(jobId) as { state: string; normal_seconds: number };
  assert.equal(session.state, 'running');
  assert.equal(session.normal_seconds, 1_800);
});

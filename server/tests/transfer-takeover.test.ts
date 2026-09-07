import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase } from '../src/db.ts';
import { dispatchTimer } from '../src/timer.ts';

function setup() {
  const db = createDatabase(join(mkdtempSync(join(tmpdir(), 'servix-transfer-')), 'timer.db'), { seed: true });
  db.db.prepare("INSERT INTO employees (id, name, role, created_at) VALUES ('emp-b', 'Employee B', 'employee', '2026-09-04T00:00:00.000Z'), ('emp-c', 'Employee C', 'employee', '2026-09-04T00:00:00.000Z'), ('admin-1', 'Admin', 'admin', '2026-09-04T00:00:00.000Z')").run();
  return db;
}

function fixture(db: ReturnType<typeof setup>, suffix: string, employeeId = 'emp-demo-1') {
  const carId = `car-${suffix}`;
  const jobId = `job-${suffix}`;
  db.db.prepare('INSERT INTO cars (id, license_plate, client_name, assigned_employee_id, created_at) VALUES (?, ?, ?, ?, ?)').run(carId, `TR-${suffix}`, 'Transfer client', employeeId, '2026-09-04T00:00:00.000Z');
  db.db.prepare('INSERT INTO jobs (id, car_id, title, created_at) VALUES (?, ?, ?, ?)').run(jobId, carId, 'Transfer job', '2026-09-04T00:00:00.000Z');
  return { carId, jobId };
}

test('takeover sub 60 secunde păstrează timpul A și pornește intervalul B', () => {
  const db = setup();
  try {
    const { jobId } = fixture(db, 'under');
    const start = dispatchTimer(db.db, 'POST', '/api/timer/start', { job_id: jobId, employee_id: 'emp-demo-1' }, Date.parse('2026-09-04T10:00:00.000Z'))!;
    assert.equal(start.status, 201);
    const takeover = dispatchTimer(db.db, 'POST', '/api/timer/takeover', { job_id: jobId, employee_id: 'emp-b' }, Date.parse('2026-09-04T10:00:59.000Z'))!;
    assert.equal(takeover.status, 200);
    const job = db.db.prepare('SELECT worked_seconds, overtime_seconds, started_at, status FROM jobs WHERE id = ?').get(jobId) as { worked_seconds: number; overtime_seconds: number; started_at: string | null; status: string };
    assert.equal(job.worked_seconds, 59);
    assert.equal(job.overtime_seconds, 0);
    assert.equal(job.status, 'in_lucru');
    const intervals = db.db.prepare('SELECT ti.employee_id, ti.ended_at FROM timer_intervals ti JOIN timer_sessions ts ON ts.id = ti.session_id WHERE ts.job_id = ? ORDER BY ti.started_at').all(jobId) as Array<{ employee_id: string; ended_at: string | null }>;
    assert.equal(intervals[0].employee_id, 'emp-demo-1');
    assert.ok(intervals[0].ended_at);
    assert.equal(intervals[1].employee_id, 'emp-b');
    assert.equal((db.db.prepare("SELECT assigned_employee_id FROM cars WHERE id = ?").get(`car-under`) as { assigned_employee_id: string }).assigned_employee_id, 'emp-b');
    assert.ok((db.db.prepare("SELECT COUNT(*) AS count FROM activity_log WHERE job_id = ? AND action = 'takeover'").get(jobId) as { count: number }).count === 1);
  } finally { db.close(); }
});

test('takeover la exact 60 secunde este respins', () => {
  const db = setup();
  try {
    const { jobId } = fixture(db, 'exact');
    dispatchTimer(db.db, 'POST', '/api/timer/start', { job_id: jobId, employee_id: 'emp-demo-1' }, Date.parse('2026-09-04T08:00:00.000Z'));
    const result = dispatchTimer(db.db, 'POST', '/api/timer/takeover', { job_id: jobId, employee_id: 'emp-b' }, Date.parse('2026-09-04T10:01:00.000Z'))!;
    assert.equal(result.status, 409);
    assert.equal((result.payload as { error: string }).error, 'TAKEOVER_WINDOW_EXPIRED');
  } finally { db.close(); }
});

test('admin transfer activ reconciliază A și B poate continua', () => {
  const db = setup();
  try {
    const { carId, jobId } = fixture(db, 'admin');
    dispatchTimer(db.db, 'POST', '/api/timer/start', { job_id: jobId, employee_id: 'emp-demo-1' }, Date.parse('2026-09-04T08:00:00.000Z'));
    const transfer = dispatchTimer(db.db, 'POST', '/api/timer/transfer', { car_id: carId, new_employee_id: 'emp-b', admin_id: 'admin-1' }, Date.parse('2026-09-04T08:02:00.000Z'))!;
    assert.equal(transfer.status, 200);
    const frozen = db.db.prepare('SELECT status, worked_seconds, started_at FROM jobs WHERE id = ?').get(jobId) as { status: string; worked_seconds: number; started_at: string | null };
    assert.equal(frozen.status, 'asteptare');
    assert.equal(frozen.worked_seconds, 120);
    assert.equal(frozen.started_at, null);
    const resumed = dispatchTimer(db.db, 'POST', '/api/timer/start', { job_id: jobId, employee_id: 'emp-b' }, Date.parse('2026-09-04T10:05:00.000Z'))!;
    assert.equal(resumed.status, 201);
    const events = db.db.prepare("SELECT action FROM activity_log WHERE job_id = ? ORDER BY created_at").all(jobId) as Array<{ action: string }>;
    assert.ok(events.some((event) => event.action === 'transfer'));
    assert.ok(events.some((event) => event.action === 'transfer_stop'));
    const owner = db.db.prepare('SELECT assigned_employee_id FROM cars WHERE id = ?').get(carId) as { assigned_employee_id: string };
    assert.equal(owner.assigned_employee_id, 'emp-b');
  } finally { db.close(); }
});

test('admin transfer fără rol admin și conflict activ sunt respinse atomic', () => {
  const db = setup();
  try {
    const first = fixture(db, 'conflict-a');
    const second = fixture(db, 'conflict-b', 'emp-b');
    dispatchTimer(db.db, 'POST', '/api/timer/start', { job_id: first.jobId, employee_id: 'emp-demo-1' }, Date.parse('2026-09-04T10:00:00.000Z'));
    const noAdmin = dispatchTimer(db.db, 'POST', '/api/timer/transfer', { car_id: first.carId, new_employee_id: 'emp-b', admin_id: 'emp-b' })!;
    assert.equal(noAdmin.status, 403);
    const targetBusy = dispatchTimer(db.db, 'POST', '/api/timer/start', { job_id: second.jobId, employee_id: 'emp-b' }, Date.parse('2026-09-04T10:00:00.000Z'))!;
    assert.equal(targetBusy.status, 201);
    const conflict = dispatchTimer(db.db, 'POST', '/api/timer/transfer', { car_id: first.carId, new_employee_id: 'emp-b', admin_id: 'admin-1' })!;
    assert.equal(conflict.status, 409);
    assert.equal((conflict.payload as { error: string }).error, 'EMPLOYEE_ALREADY_HAS_ACTIVE_JOB');
    assert.equal((db.db.prepare('SELECT assigned_employee_id FROM cars WHERE id = ?').get(first.carId) as { assigned_employee_id: string }).assigned_employee_id, 'emp-demo-1');
  } finally { db.close(); }
});

test('takeover în overtime păstrează overtime-ul și modul OT pentru B', () => {
  const db = setup();
  try {
    const { jobId } = fixture(db, 'ot-takeover');
    dispatchTimer(db.db, 'POST', '/api/timer/start', { job_id: jobId, employee_id: 'emp-demo-1' }, Date.parse('2026-09-04T14:00:00.000Z'));
    const ot = dispatchTimer(db.db, 'POST', '/api/timer/overtime/start', { job_id: jobId, employee_id: 'emp-demo-1' }, Date.parse('2026-09-04T16:00:00.000Z'))!;
    assert.equal(ot.status, 200);
    const takeover = dispatchTimer(db.db, 'POST', '/api/timer/takeover', { job_id: jobId, employee_id: 'emp-b' }, Date.parse('2026-09-04T16:00:30.000Z'))!;
    assert.equal(takeover.status, 200);
    const job = db.db.prepare('SELECT worked_seconds, overtime_seconds, is_overtime FROM jobs WHERE id = ?').get(jobId) as { worked_seconds: number; overtime_seconds: number; is_overtime: number };
    assert.equal(job.overtime_seconds, 30);
    assert.equal(job.worked_seconds, 3600);
    assert.equal(job.is_overtime, 1);
    const session = db.db.prepare("SELECT employee_id, is_overtime FROM timer_sessions WHERE job_id = ? AND state = 'running'").get(jobId) as { employee_id: string; is_overtime: number };
    assert.equal(session.employee_id, 'emp-b');
    assert.equal(session.is_overtime, 1);
  } finally { db.close(); }
});

test('admin transfer în overtime închide OT fără dublare și permite continuarea', () => {
  const db = setup();
  try {
    const { carId, jobId } = fixture(db, 'ot-transfer');
    dispatchTimer(db.db, 'POST', '/api/timer/start', { job_id: jobId, employee_id: 'emp-demo-1' }, Date.parse('2026-09-04T14:00:00.000Z'));
    const ot = dispatchTimer(db.db, 'POST', '/api/timer/overtime/start', { job_id: jobId, employee_id: 'emp-demo-1' }, Date.parse('2026-09-04T16:00:00.000Z'))!;
    assert.equal(ot.status, 200);
    const transfer = dispatchTimer(db.db, 'POST', '/api/timer/transfer', { car_id: carId, new_employee_id: 'emp-b', admin_id: 'admin-1' }, Date.parse('2026-09-04T16:02:00.000Z'))!;
    assert.equal(transfer.status, 200);
    const job = db.db.prepare('SELECT worked_seconds, overtime_seconds, started_at, is_overtime FROM jobs WHERE id = ?').get(jobId) as { worked_seconds: number; overtime_seconds: number; started_at: string | null; is_overtime: number };
    assert.equal(job.worked_seconds, 3600);
    assert.equal(job.overtime_seconds, 120);
    assert.equal(job.started_at, null);
    assert.equal(job.is_overtime, 0);
    const resumed = dispatchTimer(db.db, 'POST', '/api/timer/start', { job_id: jobId, employee_id: 'emp-b' }, Date.parse('2026-09-04T16:03:00.000Z'))!;
    assert.equal(resumed.status, 201);
    const counts = db.db.prepare("SELECT COUNT(*) AS count FROM timer_intervals ti JOIN timer_sessions ts ON ts.id = ti.session_id WHERE ts.job_id = ? AND ti.kind = 'overtime'").get(jobId) as { count: number };
    assert.equal(counts.count, 1);
  } finally { db.close(); }
});

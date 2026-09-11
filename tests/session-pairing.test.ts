/**
 * Teste — reconstruirea sesiunilor PORNIRE/OPRIRE din activity_log
 * (src/lib/sessionPairing.ts), folosite atât de PDF „Cronologie lucrare”
 * cât și de EmployeeReportsTab (via src/lib/employeeReportAggregation.ts).
 */
import assert from 'node:assert/strict';
import { deriveTimeSessionsFromActivityLog, type ActivityLogEventForPairing } from '../src/lib/sessionPairing';

let passed = 0; let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('  PASS - ' + name); }
  catch (e) { failed++; console.error('  FAIL - ' + name); console.error(e); }
}

const ev = (partial: Partial<ActivityLogEventForPairing> & { action: string; created_at: string }): ActivityLogEventForPairing => ({
  employee_id: 'emp-1', job_id: 'job-1', car_id: 'car-1', ...partial,
});

console.log('SESSION PAIRING — PORNIRE/OPRIRE din activity_log');

test('pornire + pauza -> o sesiune inchisa', () => {
  const sessions = deriveTimeSessionsFromActivityLog([
    ev({ action: 'in_lucru', created_at: '2026-09-01T08:12:00.000Z' }),
    ev({ action: 'asteptare', created_at: '2026-09-01T10:30:00.000Z' }),
  ]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].start_time, '2026-09-01T08:12:00.000Z');
  assert.equal(sessions[0].end_time, '2026-09-01T10:30:00.000Z');
  assert.equal(sessions[0].duration_seconds, 2 * 3600 + 18 * 60);
  assert.equal(sessions[0].is_overtime, false);
});

test('reluare + pauza -> a doua sesiune separata', () => {
  const sessions = deriveTimeSessionsFromActivityLog([
    ev({ action: 'in_lucru', created_at: '2026-09-01T08:12:00.000Z' }),
    ev({ action: 'asteptare', created_at: '2026-09-01T10:30:00.000Z' }),
    ev({ action: 'in_lucru', created_at: '2026-09-01T11:05:00.000Z' }),
    ev({ action: 'asteptare', created_at: '2026-09-01T12:00:00.000Z' }),
  ]);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[1].start_time, '2026-09-01T11:05:00.000Z');
  assert.equal(sessions[1].end_time, '2026-09-01T12:00:00.000Z');
});

test('reluare + finalizare -> sesiune inchisa la finalizat', () => {
  const sessions = deriveTimeSessionsFromActivityLog([
    ev({ action: 'in_lucru', created_at: '2026-09-01T14:00:00.000Z' }),
    ev({ action: 'finalizat', created_at: '2026-09-01T16:20:00.000Z' }),
  ]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].end_time, '2026-09-01T16:20:00.000Z');
});

test('sesiune fara oprire -> end_time/duration null (lucrare activa)', () => {
  const sessions = deriveTimeSessionsFromActivityLog([
    ev({ action: 'in_lucru', created_at: '2026-09-01T08:00:00.000Z' }),
  ]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].end_time, null);
  assert.equal(sessions[0].duration_seconds, null);
});

test('overtime: overtime_start/overtime_stop -> sesiune marcata is_overtime', () => {
  const sessions = deriveTimeSessionsFromActivityLog([
    ev({ action: 'overtime_start', created_at: '2026-09-01T18:30:00.000Z' }),
    ev({ action: 'overtime_stop', created_at: '2026-09-01T19:30:00.000Z' }),
  ]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].is_overtime, true);
  assert.equal(sessions[0].duration_seconds, 3600);
});

test('transfer intre angajati (takeover local): pastreaza atribuirea corecta', () => {
  const sessions = deriveTimeSessionsFromActivityLog([
    ev({ action: 'in_lucru', employee_id: 'emp-A', created_at: '2026-09-01T08:00:00.000Z' }),
    ev({ action: 'takeover_stop', employee_id: 'emp-A', created_at: '2026-09-01T08:00:40.000Z' }),
    ev({ action: 'takeover', employee_id: 'emp-B', created_at: '2026-09-01T08:00:40.000Z' }),
    ev({ action: 'finalizat', employee_id: 'emp-B', created_at: '2026-09-01T09:00:00.000Z' }),
  ]);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].employee_id, 'emp-A');
  assert.equal(sessions[0].end_time, '2026-09-01T08:00:40.000Z');
  assert.equal(sessions[1].employee_id, 'emp-B');
  assert.equal(sessions[1].start_time, '2026-09-01T08:00:40.000Z');
  assert.equal(sessions[1].end_time, '2026-09-01T09:00:00.000Z');
});

test('transfer admin (Web) pe lucrare activa fara job_id -> inchide sesiunea la timpul real', () => {
  const sessions = deriveTimeSessionsFromActivityLog([
    ev({ action: 'in_lucru', employee_id: 'emp-A', created_at: '2026-09-01T08:00:00.000Z' }),
    ev({ action: 'transfer', employee_id: null, job_id: null, car_id: 'car-1', created_at: '2026-09-01T08:45:00.000Z' }),
  ]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].employee_id, 'emp-A');
  assert.equal(sessions[0].end_time, '2026-09-01T08:45:00.000Z');
});

test('diacritice: numele angajatului nu este alterat de reconstructie (Ghi\u021b\u0103)', () => {
  const sessions = deriveTimeSessionsFromActivityLog([
    ev({ action: 'in_lucru', employee_id: 'emp-Ghi\u021b\u0103', created_at: '2026-09-01T08:00:00.000Z' }),
    ev({ action: 'finalizat', employee_id: 'emp-Ghi\u021b\u0103', created_at: '2026-09-01T09:00:00.000Z' }),
  ]);
  assert.equal(sessions[0].employee_id, 'emp-Ghi\u021b\u0103');
});

test('mai multe sesiuni in aceeasi zi -> toate reconstruite in ordine cronologica', () => {
  const sessions = deriveTimeSessionsFromActivityLog([
    ev({ action: 'in_lucru', created_at: '2026-09-01T08:12:00.000Z' }),
    ev({ action: 'asteptare', created_at: '2026-09-01T10:30:00.000Z' }),
    ev({ action: 'in_lucru', created_at: '2026-09-01T11:05:00.000Z' }),
    ev({ action: 'asteptare', created_at: '2026-09-01T12:00:00.000Z' }),
    ev({ action: 'in_lucru', created_at: '2026-09-01T14:00:00.000Z' }),
    ev({ action: 'finalizat', created_at: '2026-09-01T16:20:00.000Z' }),
  ]);
  assert.equal(sessions.length, 3);
  assert.deepEqual(sessions.map((s) => [s.start_time, s.end_time]), [
    ['2026-09-01T08:12:00.000Z', '2026-09-01T10:30:00.000Z'],
    ['2026-09-01T11:05:00.000Z', '2026-09-01T12:00:00.000Z'],
    ['2026-09-01T14:00:00.000Z', '2026-09-01T16:20:00.000Z'],
  ]);
});

test('evenimente pe joburi diferite nu se amesteca', () => {
  const sessions = deriveTimeSessionsFromActivityLog([
    ev({ action: 'in_lucru', job_id: 'job-A', created_at: '2026-09-01T08:00:00.000Z' }),
    ev({ action: 'in_lucru', job_id: 'job-B', created_at: '2026-09-01T08:05:00.000Z' }),
    ev({ action: 'finalizat', job_id: 'job-A', created_at: '2026-09-01T09:00:00.000Z' }),
    ev({ action: 'finalizat', job_id: 'job-B', created_at: '2026-09-01T09:30:00.000Z' }),
  ]);
  assert.equal(sessions.length, 2);
  const jobA = sessions.find((s) => s.job_id === 'job-A');
  const jobB = sessions.find((s) => s.job_id === 'job-B');
  assert.equal(jobA?.end_time, '2026-09-01T09:00:00.000Z');
  assert.equal(jobB?.end_time, '2026-09-01T09:30:00.000Z');
});

console.log('SESSION PAIRING: ' + passed + ' pass, ' + failed + ' fail');
if (failed > 0) process.exit(1);

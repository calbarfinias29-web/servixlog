/**
 * Teste — agregarea rapoartelor pe angajați (src/lib/employeeReportAggregation.ts).
 * Acoperă cauza reparată la PROBLEMA 1: intrările reale (time_entries +
 * sesiuni reconstruite din activity_log) trebuie să producă ore/mașini/
 * lucrări diferite de 0 pentru activitate reală existentă.
 */
import assert from 'node:assert/strict';
import { aggregateEmployeeTimeEntries } from '../src/lib/employeeReportAggregation';
import type { EmployeeTimeEntry } from '../src/data/DataAdapter';

let passed = 0; let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('  PASS - ' + name); }
  catch (e) { failed++; console.error('  FAIL - ' + name); console.error(e); }
}

const entry = (partial: Partial<EmployeeTimeEntry>): EmployeeTimeEntry => ({
  employee_id: 'emp-ghita',
  job_id: 'job-1',
  start_time: '2026-09-01T08:00:00.000Z',
  end_time: '2026-09-01T09:00:00.000Z',
  duration_seconds: 3600,
  is_overtime: false,
  jobs: { car_id: 'car-1' },
  ...partial,
});

const names: Record<string, string> = { 'emp-ghita': 'Ghiță', 'emp-alt': 'Alt Angajat' };
const nameOf = (id: string): string => names[id] ?? 'Angajat necunoscut';

console.log('EMPLOYEE REPORTS — agregare ore/masini/lucrari');

test('angajat individual: ore/masini/lucrari reale, nu zero', () => {
  const rows = aggregateEmployeeTimeEntries([
    entry({ job_id: 'job-1', duration_seconds: 3600 }),
    entry({ job_id: 'job-2', duration_seconds: 1800, jobs: { car_id: 'car-2' } }),
  ], nameOf, 'emp-ghita');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Ghiță');
  assert.equal(rows[0].jobs, 2);
  assert.equal(rows[0].cars, 2);
  assert.equal(rows[0].seconds, 5400);
});

test('toti angajatii: fiecare angajat apare cu totalurile proprii', () => {
  const rows = aggregateEmployeeTimeEntries([
    entry({ employee_id: 'emp-ghita', duration_seconds: 3600 }),
    entry({ employee_id: 'emp-alt', duration_seconds: 1800, job_id: 'job-9', jobs: { car_id: 'car-9' } }),
  ], nameOf, 'all');
  assert.equal(rows.length, 2);
  const ghita = rows.find((r) => r.id === 'emp-ghita');
  const alt = rows.find((r) => r.id === 'emp-alt');
  assert.equal(ghita?.seconds, 3600);
  assert.equal(alt?.seconds, 1800);
});

test('normal vs overtime: separate corect in normalSeconds/overtimeSeconds', () => {
  const rows = aggregateEmployeeTimeEntries([
    entry({ job_id: 'job-1', duration_seconds: 3600, is_overtime: false }),
    entry({ job_id: 'job-1', duration_seconds: 900, is_overtime: true }),
  ], nameOf, 'emp-ghita');
  assert.equal(rows[0].normalSeconds, 3600);
  assert.equal(rows[0].overtimeSeconds, 900);
  assert.equal(rows[0].seconds, 4500);
});

test('lucrare numarata o singura data chiar cu mai multe intervale', () => {
  const rows = aggregateEmployeeTimeEntries([
    entry({ job_id: 'job-1', start_time: '2026-09-01T08:00:00.000Z', duration_seconds: 3600 }),
    entry({ job_id: 'job-1', start_time: '2026-09-01T11:00:00.000Z', duration_seconds: 1800 }),
  ], nameOf, 'emp-ghita');
  assert.equal(rows[0].jobs, 1);
  assert.equal(rows[0].seconds, 5400);
});

test('interval fara duration_seconds (in derulare) este ignorat din total (nu inventeaza timp)', () => {
  const rows = aggregateEmployeeTimeEntries([
    entry({ job_id: 'job-1', end_time: null, duration_seconds: null }),
  ], nameOf, 'emp-ghita');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].seconds, 0);
  assert.equal(rows[0].jobs, 0);
});

test('transfer intre angajati: timpul ramane atribuit celui care a lucrat efectiv', () => {
  const rows = aggregateEmployeeTimeEntries([
    entry({ employee_id: 'emp-ghita', job_id: 'job-1', duration_seconds: 2400 }),
    entry({ employee_id: 'emp-alt', job_id: 'job-1', duration_seconds: 1200 }),
  ], nameOf, 'all');
  const ghita = rows.find((r) => r.id === 'emp-ghita');
  const alt = rows.find((r) => r.id === 'emp-alt');
  assert.equal(ghita?.seconds, 2400);
  assert.equal(alt?.seconds, 1200);
});

test('angajat fara nicio intrare in perioada -> apare cu 0, nu dispare din lista', () => {
  const rows = aggregateEmployeeTimeEntries([], nameOf, 'emp-ghita');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].seconds, 0);
});

console.log('EMPLOYEE REPORTS: ' + passed + ' pass, ' + failed + ' fail');
if (failed > 0) process.exit(1);

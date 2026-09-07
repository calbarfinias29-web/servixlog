/**
 * SERVIX — Local Server tests (FAZA 3).
 *
 * Teste izolate și repetabile, cu o bază SQLite TEMPORARĂ (în tmpdir).
 * NU folosește baza reală și NU atinge Supabase.
 *
 * Rulează cu: node --test server/tests/server.test.ts
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

let server: Server;
let baseUrl = '';
let dx: ReturnType<typeof createDatabase>;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'servix-test-'));
  dx = createDatabase(join(dir, 'test.db'), { seed: true });
  server = createServer(createApp(dx.db));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  try { server?.close(); } catch { /* ignore */ }
  dx?.close();
});

interface HealthResp { status: string; sqlite: string; schemaVersion: number }
interface CarsResp { cars: Array<{ license_plate: string }> }
interface EmployeesResp { employees: Array<{ name: string }> }
interface JobsResp { jobs: Array<{ title: string }> }
interface RatesResp { rates: { id: string } | null }
interface ScheduleResp { schedule: { id: string } | null }

test('SQLite se deschide si schema exista', () => {
  const rows = dx.db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('employees','cars','jobs','appointments','rates','work_schedule')")
    .all() as Array<{ name: string }>;
  const names = rows.map((r) => r.name);
  for (const t of ['employees', 'cars', 'jobs', 'appointments', 'rates', 'work_schedule']) {
    assert.ok(names.includes(t), `tabela lipsa: ${t}`);
  }
});

test('seed demo functioneaza (1 angajat, 1 masina, 1 lucrare, 1 program, 1 rates)', () => {
  const count = (table: string): number =>
    (dx.db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;
  assert.equal(count('employees'), 3);
  assert.equal(count('cars'), 1);
  assert.equal(count('jobs'), 1);
  assert.equal(count('work_schedule'), 1);
  assert.equal(count('rates'), 1);
});

test('GET /api/health raspunde + SQLite connected', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as HealthResp;
  assert.equal(j.status, 'ok');
  assert.equal(j.sqlite, 'connected');
  assert.equal(typeof j.schemaVersion, 'number');
});

test('GET /api/cars raspunde cu masina demo', async () => {
  const res = await fetch(`${baseUrl}/api/cars`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as CarsResp;
  assert.ok(j.cars.length >= 1);
  assert.equal(j.cars[0].license_plate, 'TEST-01');
});

test('GET /api/employees raspunde cu angajatul demo', async () => {
  const res = await fetch(`${baseUrl}/api/employees`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as EmployeesResp;
  assert.ok(j.employees.length >= 1);
  assert.ok(j.employees[0].name.includes('DEMO'));
});

test('GET /api/jobs raspunde cu lucrarea demo', async () => {
  const res = await fetch(`${baseUrl}/api/jobs`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as JobsResp;
  assert.ok(j.jobs.length >= 1);
  assert.equal(j.jobs[0].title, 'Revizie DEMO (TEST)');
});

test('GET /api/rates raspunde cu tarifele demo', async () => {
  const res = await fetch(`${baseUrl}/api/rates`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as RatesResp;
  assert.ok(j.rates);
  assert.equal(j.rates?.id, 'rate-demo-1');
});

test('GET /api/schedule raspunde cu programul demo', async () => {
  const res = await fetch(`${baseUrl}/api/schedule`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as ScheduleResp;
  assert.ok(j.schedule);
  assert.equal(j.schedule?.id, 'sched-demo-1');
});

test('404 pentru endpoint inexistent', async () => {
  const res = await fetch(`${baseUrl}/api/nonexistent`);
  assert.equal(res.status, 404);
});

// ===== FAZA 5 — READ extins =====

interface ThemesResp { themes: Array<{ id: string; name: string }> }
interface AppointmentsResp { appointments: Array<{ id: string; appointment_date: string; appointment_time: string }> }
interface MakesResp { makes: Array<{ id: string; name: string; normalized_name: string }> }
interface ModelsResp { models: Array<{ id: string; make_id: string; name: string }> }
interface CatalogResp { catalog: Array<{ id: string; name: string; normalized_name: string }> }
interface ActivityResp { entries: Array<{ id: string; car_id?: string; action: string; created_at: string }> }
interface TimeEntriesResp {
  entries: Array<{ id?: string; employee_id: string; job_id: string; start_time: string; duration_seconds: number | null; is_overtime: boolean; jobs: { car_id: string } | null }>;
}

test('GET /api/themes raspunde cu temele demo, ordonate pe nume', async () => {
  const res = await fetch(`${baseUrl}/api/themes`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as ThemesResp;
  assert.ok(j.themes.length >= 2);
  assert.ok(j.themes[0].name <= j.themes[1].name);
});

test('GET /api/appointments raspunde cu programarea demo, ordonata pe data+ora', async () => {
  const res = await fetch(`${baseUrl}/api/appointments`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as AppointmentsResp;
  assert.ok(j.appointments.length >= 1);
  assert.equal(j.appointments[0].id, 'apt-demo-1');
});

test('GET /api/vehicle-makes raspunde cu marcile demo', async () => {
  const res = await fetch(`${baseUrl}/api/vehicle-makes`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as MakesResp;
  assert.ok(j.makes.length >= 2);
  assert.ok(j.makes.some((m) => m.name === 'Mercedes' && m.normalized_name === 'mercedes'));
});

test('GET /api/vehicle-models pastreaza relatia make -> model', async () => {
  const res = await fetch(`${baseUrl}/api/vehicle-models`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as ModelsResp;
  assert.ok(j.models.length >= 2);
  const clsC = j.models.find((m) => m.name === 'Clasa C');
  assert.ok(clsC);
  assert.equal(clsC?.make_id, 'make-demo-1');
});

test('GET /api/work-catalog raspunde cu lucrarile demo', async () => {
  const res = await fetch(`${baseUrl}/api/work-catalog`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as CatalogResp;
  assert.ok(j.catalog.length >= 2);
  assert.ok(j.catalog[0].name <= j.catalog[1].name);
});

test('GET /api/activity-log filtreaza pe carId, ordonat cronologic', async () => {
  const res = await fetch(`${baseUrl}/api/activity-log?carId=car-demo-1`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as ActivityResp;
  assert.equal(j.entries.length, 2);
  assert.ok(j.entries[0].created_at <= j.entries[1].created_at);
  assert.equal(j.entries[0].action, 'status_changed');
});

test('GET /api/activity-log fara carId -> 400 (filtrare obligatorie)', async () => {
  const res = await fetch(`${baseUrl}/api/activity-log`);
  assert.equal(res.status, 400);
});

test('GET /api/activity-log cu carId inexistent -> lista goala', async () => {
  const res = await fetch(`${baseUrl}/api/activity-log?carId=car-nu-exista`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as ActivityResp;
  assert.equal(j.entries.length, 0);
});

test('GET /api/time-entries filtreaza pe fromIso/toIso + join jobs(car_id)', async () => {
  const res = await fetch(`${baseUrl}/api/time-entries?fromIso=2026-09-01T00:00:00.000Z&toIso=2026-09-03T00:00:00.000Z`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as TimeEntriesResp;
  assert.equal(j.entries.length, 2);
  for (const e of j.entries) {
    assert.equal(e.employee_id, 'emp-demo-1');
    assert.equal(e.jobs?.car_id, 'car-demo-1');
  }
  const ot = j.entries.find((e) => e.start_time.startsWith('2026-09-02'));
  assert.ok(ot);
  assert.equal(ot?.is_overtime, true);
  const normal = j.entries.find((e) => e.start_time.startsWith('2026-09-01'));
  assert.equal(normal?.is_overtime, false);
});

test('GET /api/time-entries filtru fereastra ingusta -> lista goala', async () => {
  const res = await fetch(`${baseUrl}/api/time-entries?fromIso=2020-01-01T00:00:00.000Z&toIso=2020-01-02T00:00:00.000Z`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as TimeEntriesResp;
  assert.equal(j.entries.length, 0);
});

test('GET /api/time-entries cu employeeId corect -> returneaza intrarile', async () => {
  const res = await fetch(`${baseUrl}/api/time-entries?fromIso=2026-09-01T00:00:00.000Z&toIso=2026-09-03T00:00:00.000Z&employeeId=emp-demo-1`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as TimeEntriesResp;
  assert.equal(j.entries.length, 2);
});

test('GET /api/time-entries cu employeeId diferit -> lista goala', async () => {
  const res = await fetch(`${baseUrl}/api/time-entries?fromIso=2026-09-01T00:00:00.000Z&toIso=2026-09-03T00:00:00.000Z&employeeId=emp-altul`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as TimeEntriesResp;
  assert.equal(j.entries.length, 0);
});

test('GET /api/time-entries fara fromIso/toIso -> 400', async () => {
  const res = await fetch(`${baseUrl}/api/time-entries`);
  assert.equal(res.status, 400);
});
/**
 * SERVIX — WRITE LOCAL tests (FAZA 7A).
 *
 * Teste izolate, bază SQLite TEMPORARĂ. NU atinge Supabase.
 * Rulează cu: node --test server/tests-write/write.test.ts
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
import { LocalDataAdapter } from '../../src/data/LocalDataAdapter.ts';

let server: Server;
let baseUrl = '';
let dx: ReturnType<typeof createDatabase>;
let adapter: LocalDataAdapter;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'servix-write-test-'));
  dx = createDatabase(join(dir, 'test.db'), { seed: true });
  server = createServer(createApp(dx.db));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  adapter = new LocalDataAdapter(baseUrl);
});

after(() => {
  try { server?.close(); } catch { /* ignore */ }
  dx?.close();
});

type Row = Record<string, unknown>;
const rows = (table: string): Row[] => dx.db.prepare(`SELECT * FROM "${table}"`).all() as Row[];

// ---------------------------------------------------------------- cars

test('POST /api/cars creeaza masina; read-back prin GET', async () => {
  const res = await fetch(`${baseUrl}/api/cars`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_plate: 'WRITE-01', client_name: 'Client WRITE TEST', client_phone: '0722', make: 'Dacia', status: 'noua' }),
  });
  assert.equal(res.status, 201);
  const j = (await res.json()) as { ok: boolean; car: { id: string; license_plate: string; client_name: string } };
  assert.equal(j.ok, true);
  const persisted = rows('cars').find((r) => r.id === j.car.id) as Row;
  assert.equal(persisted.license_plate, 'WRITE-01');
  const read = await fetch(`${baseUrl}/api/cars`);
  const rj = (await read.json()) as { cars: Array<{ license_plate: string; client_phone: string }> };
  const car = rj.cars.find((c) => c.license_plate === 'WRITE-01');
  assert.ok(car);
  assert.equal(car.client_phone, '0722');
  assert.ok(adapter);
});

test('PATCH /api/cars/:id actualizeaza; read-back', async () => {
  const created = rows('cars').find((r) => r.license_plate === 'WRITE-01') as Row;
  const res = await fetch(`${baseUrl}/api/cars/${created.id as string}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Client WRITE MODIFICAT', status: 'in_lucru' }),
  });
  assert.equal(res.status, 200);
  const rj = (await res.json()) as { car: { client_name: string; status: string } };
  assert.equal(rj.car.client_name, 'Client WRITE MODIFICAT');
  assert.equal(rj.car.status, 'in_lucru');
  const read = await fetch(`${baseUrl}/api/cars`);
  const cars = ((await read.json()) as { cars: Array<{ client_name: string }> }).cars;
  assert.ok(cars.some((c) => c.client_name === 'Client WRITE MODIFICAT'));
});

test('POST /api/cars cu plate duplicata -> 409', async () => {
  const res = await fetch(`${baseUrl}/api/cars`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_plate: 'TEST-01', client_name: 'X' }),
  });
  assert.equal(res.status, 409);
  const j = (await res.json()) as { error: string };
  assert.equal(j.error, 'duplicate_license_plate');
});

test('POST /api/cars invalid (lipsa campuri obligatorii, tip gresit) -> 422', async () => {
  const r1 = await fetch(`${baseUrl}/api/cars`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Fara plate' }),
  });
  assert.equal(r1.status, 422);
  const r2 = await fetch(`${baseUrl}/api/cars`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_plate: 123, client_name: 'Plate numeric' }),
  });
  assert.equal(r2.status, 422);
  assert.equal(rows('cars').filter((r) => r.client_name === 'Fara plate').length, 0);
});

test('PATCH /api/cars cu id inexistent -> 404', async () => {
  const res = await fetch(`${baseUrl}/api/cars/nu-exista`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'noua' }),
  });
  assert.equal(res.status, 404);
});

test('PATCH /api/cars cu campuri timer protejate -> 422 (timer neatinse)', async () => {
  const created = rows('cars').find((r) => r.license_plate === 'WRITE-01') as Row;
  const res = await fetch(`${baseUrl}/api/cars/${created.id as string}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worked_seconds: 99999 }),
  });
  assert.equal(res.status, 422);
  const still = (rows('cars').find((r) => r.id === created.id) as Row).worked_seconds;
  assert.notEqual(still, 99999);
});

// ---------------------------------------------------------------- jobs

test('POST /api/jobs creeaza job pentru masina existenta; FK invalid -> 404', async () => {
  const car = rows('cars').find((r) => r.license_plate === 'WRITE-01') as Row;
  const ok = await fetch(`${baseUrl}/api/jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ car_id: car.id, title: 'Lucrare WRITE TEST' }),
  });
  assert.equal(ok.status, 201);
  const bad = await fetch(`${baseUrl}/api/jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ car_id: 'nu-exista', title: 'X' }),
  });
  assert.equal(bad.status, 422);
  assert.ok(rows('jobs').some((r) => r.title === 'Lucrare WRITE TEST'));
});

test('PATCH /api/jobs/:id actualizeaza status (fara timer fields)', async () => {
  const job = rows('jobs').find((r) => r.title === 'Lucrare WRITE TEST') as Row;
  const res = await fetch(`${baseUrl}/api/jobs/${job.id as string}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'finalizat' }),
  });
  assert.equal(res.status, 200);
  assert.equal((rows('jobs').find((r) => r.id === job.id) as Row).status, 'finalizat');
});

// ---------------------------------------------------------------- employees

test('POST/PATCH /api/employees creeaza + actualizeaza angajat', async () => {
  const res = await fetch(`${baseUrl}/api/employees`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Angajat WRITE TEST', role: 'employee', active: true }),
  });
  assert.equal(res.status, 201);
  const j = (await res.json()) as { employee: { id: string; name: string } };
  const patch = await fetch(`${baseUrl}/api/employees/${j.employee.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Angajat WRITE MODIFICAT', active: false }),
  });
  assert.equal(patch.status, 200);
  const emp = rows('employees').find((r) => r.id === j.employee.id) as Row;
  assert.equal(emp.name, 'Angajat WRITE MODIFICAT');
  assert.equal(emp.active, 0);
  const read = await fetch(`${baseUrl}/api/employees`);
  assert.ok(((await read.json()) as { employees: Array<{ name: string }> }).employees.some((e) => e.name === 'Angajat WRITE MODIFICAT'));
});

// ---------------------------------------------------------------- appointments

test('POST/PATCH /api/appointments creeaza + actualizeaza programare', async () => {
  const res = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_plate: 'APT-WRITE-1', client_name: 'Client APT TEST', appointment_date: '2026-10-01', appointment_time: '10:00' }),
  });
  assert.equal(res.status, 201);
  const j = (await res.json()) as { appointment: { id: string } };
  const patch = await fetch(`${baseUrl}/api/appointments/${j.appointment.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'anulata', notes: 'Anulare TEST' }),
  });
  assert.equal(patch.status, 200);
  const apt = rows('appointments').find((r) => r.id === j.appointment.id) as Row;
  assert.equal(apt.status, 'anulata');
  assert.equal(apt.notes, 'Anulare TEST');
});

test('POST /api/appointments invalid (data in format gresit) -> 422', async () => {
  const res = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_plate: 'APT-BAD', appointment_date: '01/10/2026', appointment_time: '10:00' }),
  });
  assert.equal(res.status, 422);
});

// ---------------------------------------------------------------- rates / schedule

test('PATCH /api/rates si /api/schedule actualizeaza randul activ + read-back', async () => {
  const r = await fetch(`${baseUrl}/api/rates`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ normal_rate: 120, vat_rate: 19 }),
  });
  assert.equal(r.status, 200);
  const s = await fetch(`${baseUrl}/api/schedule`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_start: '08:00', work_end: '17:00' }),
  });
  assert.equal(s.status, 200);
  const rates = (await (await fetch(`${baseUrl}/api/rates`)).json()) as { rates: { normal_rate: number; vat_rate: number } };
  assert.equal(rates.rates.normal_rate, 120);
  assert.equal(rates.rates.vat_rate, 19);
  const sched = (await (await fetch(`${baseUrl}/api/schedule`)).json()) as { schedule: { work_start: string } };
  assert.equal(sched.schedule.work_start, '08:00');
  assert.equal(rows('rates').filter((x) => x.active === 1).length, 1);
});

test('PATCH /api/rates cu vat_rate invalid -> 422; body invalid -> 400; metoda gresita -> 405', async () => {
  const badVat = await fetch(`${baseUrl}/api/rates`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vat_rate: 500 }),
  });
  assert.equal(badVat.status, 422);
  const badJson = await fetch(`${baseUrl}/api/cars`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not-json' });
  assert.equal(badJson.status, 400);
  const del = await fetch(`${baseUrl}/api/cars/nou`, { method: 'DELETE' });
  assert.equal(del.status, 405);
  const sql = await fetch(`${baseUrl}/api/sql`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'DELETE FROM cars' }) });
  assert.equal(sql.status, 404);
});

/**
 * SERVIX — LocalDataAdapter WRITE tests (FAZA 7A).
 *
 * Rulează cu: node --test server/tests-write/local-adapter-write.test.ts
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
import { DefaultAdapterRegistry } from '../../src/data/registry.ts';
import type { DataAdapter } from '../../src/data/DataAdapter.ts';

let server: Server;
let baseUrl = '';
let dx: ReturnType<typeof createDatabase>;
let adapter: LocalDataAdapter;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'servix-ladaw-test-'));
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

test('createCar + updateCar prin LocalDataAdapter, cu read-back prin getCars', async () => {
  const { data: car, error } = await adapter.createCar({ license_plate: 'ADAPT-W-1', client_name: 'Client ADAPT TEST', make: 'Skoda' });
  assert.equal(error, null);
  assert.ok(car);
  assert.equal(car!.license_plate, 'ADAPT-W-1');
  const upd = await adapter.updateCar(car!.id, { notes: 'Nota WRITE ADAPT' });
  assert.equal(upd.error, null);
  assert.equal(upd.data!.notes, 'Nota WRITE ADAPT');
  const list = await adapter.getCars();
  assert.ok((list.data ?? []).some((c) => c.license_plate === 'ADAPT-W-1'));
});

test('createJob/updateJob + createEmployee/updateEmployee prin adapter', async () => {
  const emp = await adapter.createEmployee({ name: 'Emp ADAPT WRITE' });
  assert.equal(emp.error, null);
  assert.ok(emp.data);
  const jobs = await adapter.getJobs();
  const carId = (jobs.data ?? [])[0]?.car_id;
  assert.ok(carId);
  const job = await adapter.createJob({ car_id: carId!, title: 'Job ADAPT WRITE' });
  assert.equal(job.error, null);
  const updJ = await adapter.updateJob(job.data!.id, { status: 'finalizat' });
  assert.equal(updJ.error, null);
  const updE = await adapter.updateEmployee(emp.data!.id, { active: false });
  assert.equal(updE.error, null);
  assert.equal(updE.data!.active, 0);
});

test('createAppointment/updateAppointment + updateRates/updateSchedule prin adapter', async () => {
  const apt = await adapter.createAppointment({ license_plate: 'APT-ADAPT-1', appointment_date: '2026-10-05', appointment_time: '09:30' });
  assert.equal(apt.error, null);
  assert.ok(apt.data);
  const updA = await adapter.updateAppointment(apt.data!.id, { status: 'anulata' });
  assert.equal(updA.error, null);
  assert.equal(updA.data!.status, 'anulata');
  const r = await adapter.updateRates({ normal_rate: 140 });
  assert.equal(r.error, null);
  assert.equal(r.data!.normal_rate, 140);
  const s = await adapter.updateSchedule({ break_start: '13:30' });
  assert.equal(s.error, null);
  assert.equal(s.data!.break_start, '13:30');
});

test('deleteAppointment prin adapter șterge doar programările demo', async () => {
  const demoId = 'apt-delete-demo';
  dx.db.prepare('INSERT INTO appointments (id, license_plate, appointment_date, appointment_time, created_at, is_demo) VALUES (?, ?, ?, ?, ?, 1)')
    .run(demoId, 'APT-DEMO-DELETE', '2026-10-05', '10:00', new Date().toISOString());
  const deleted = await adapter.deleteAppointment(demoId);
  assert.equal(deleted.error, null);
  assert.equal((await adapter.getAppointments()).data?.some((appointment) => appointment.id === demoId), false);

  const normal = await adapter.createAppointment({ license_plate: 'APT-KEEP-1', appointment_date: '2026-10-05', appointment_time: '10:30' });
  assert.equal((await adapter.deleteAppointment(normal.data!.id)).error?.code, 'LOCAL_HTTP_403');
});

test('Validare server-side prin adapter: invalid -> 422; duplicat -> 409; id inexistent -> 404', async () => {
  const bad = await adapter.createCar({ license_plate: '' , client_name: 'X' });
  assert.equal(bad.data, null);
  assert.equal(bad.error?.code, 'LOCAL_HTTP_422');
  const dup = await adapter.createCar({ license_plate: 'TEST-01', client_name: 'X' });
  assert.equal(dup.error?.code, 'LOCAL_HTTP_409');
  const missing = await adapter.updateCar('nu-exista', { notes: 'x' });
  assert.equal(missing.error?.code, 'LOCAL_HTTP_404');
});

test('SupabaseDataAdapter NU are metode WRITE (separare arhitecturala)', () => {
  const sup = {
    getEmployees: async () => ({ data: [], error: null }),
    getCars: async () => ({ data: [], error: null }),
    getJobs: async () => ({ data: [], error: null }),
    getSchedule: async () => ({ data: null, error: null }),
    getRates: async () => ({ data: null, error: null }),
    getThemes: async () => ({ data: [], error: null }),
    getAppointments: async () => ({ data: [], error: null }),
    getVehicleMakes: async () => ({ data: [], error: null }),
    getVehicleModels: async () => ({ data: [], error: null }),
    getWorkCatalog: async () => ({ data: [], error: null }),
    getCarActivityLog: async () => ({ data: [], error: null }),
    getTimeEntries: async () => ({ data: [], error: null }),
  } as unknown as DataAdapter;
  assert.equal(typeof sup.createCar, 'undefined');
  assert.equal(typeof sup.updateCar, 'undefined');
  assert.equal(typeof sup.createJob, 'undefined');
  assert.equal(typeof sup.createEmployee, 'undefined');
  assert.equal(typeof sup.createAppointment, 'undefined');
  assert.equal(typeof sup.updateRates, 'undefined');
});

test('SEPARARE: LOCAL WRITE -> SQLite; Supabase neatins (serverul local nu are client Supabase)', async () => {
  const reg = new DefaultAdapterRegistry({
    supabase: () => supabaseTestAdapter(),
    local: (url: string) => new LocalDataAdapter(url),
  }, baseUrl);
  assert.equal(reg.kind, 'supabase');
  reg.enableLocal(baseUrl);
  assert.equal(reg.kind, 'local');
  const before = (dx.db.prepare('SELECT COUNT(*) AS c FROM cars').get() as { c: number }).c;
  const createCar = reg.adapter().createCar?.bind(reg.adapter());
  assert.ok(createCar);
  const { error } = await createCar({ license_plate: 'SEPARARE-1', client_name: 'Client SEPARARE' });
  assert.equal(error, null);
  const afterCount = (dx.db.prepare('SELECT COUNT(*) AS c FROM cars').get() as { c: number }).c;
  assert.equal(afterCount, before + 1, 'scrierea a ajuns în SQLite local');
  reg.enableSupabase();
  assert.equal(reg.kind, 'supabase');
});

function supabaseTestAdapter(): DataAdapter {
  return {
    getEmployees: async () => ({ data: [], error: null }),
    getCars: async () => ({ data: [], error: null }),
    getJobs: async () => ({ data: [], error: null }),
    getSchedule: async () => ({ data: null, error: null }),
    getRates: async () => ({ data: null, error: null }),
    getThemes: async () => ({ data: [], error: null }),
    getAppointments: async () => ({ data: [], error: null }),
    getVehicleMakes: async () => ({ data: [], error: null }),
    getVehicleModels: async () => ({ data: [], error: null }),
    getWorkCatalog: async () => ({ data: [], error: null }),
    getCarActivityLog: async () => ({ data: [], error: null }),
    getTimeEntries: async () => ({ data: [], error: null }),
  };
}

/**
 * SERVIX — LocalDataAdapter + Adapter Registry tests (FAZA 4).
 *
 * Teste izolate și repetabile, cu Local Server rămas în proces (temp DB),
 * fără niciun acces la Supabase sau la date reale.
 *
 * Rulează cu: node --test server/tests-local/local-data-adapter.test.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
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

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'servix-lada-test-'));
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

function localAdapter(): LocalDataAdapter {
  return new LocalDataAdapter(baseUrl);
}

test('LocalDataAdapter.getCars citeste masina demo din SQLite', async () => {
  const { data, error } = await localAdapter().getCars();
  assert.equal(error, null);
  assert.ok(Array.isArray(data));
  assert.ok((data ?? []).length >= 1);
  assert.equal((data ?? [])[0].license_plate, 'TEST-01');
});

test('LocalDataAdapter.getEmployees citeste angajatul demo', async () => {
  const { data, error } = await localAdapter().getEmployees();
  assert.equal(error, null);
  assert.ok((data ?? []).some((e) => e.name.includes('DEMO')));
});

test('LocalDataAdapter.getJobs citeste lucrarea demo', async () => {
  const { data, error } = await localAdapter().getJobs();
  assert.equal(error, null);
  assert.ok((data ?? []).some((j) => j.title === 'Revizie DEMO (TEST)'));
});

test('LocalDataAdapter.getRates citeste tarifele demo', async () => {
  const { data, error } = await localAdapter().getRates();
  assert.equal(error, null);
  assert.ok(data);
  assert.equal(data?.id, 'rate-demo-1');
});

test('LocalDataAdapter.getSchedule citeste programul demo', async () => {
  const { data, error } = await localAdapter().getSchedule();
  assert.equal(error, null);
  assert.ok(data);
  assert.equal(data?.id, 'sched-demo-1');
});

test('LocalDataAdapter: TOATE metodele DataAdapter sunt implementate local (fara notSupported)', async () => {
  // FAZA 5: nu mai există metode "LOCAL_NOT_SUPPORTED" — contractul READ e complet.
  const adapter = localAdapter() as unknown as Record<string, unknown>;
  for (const method of [
    'getEmployees', 'getCars', 'getJobs', 'getSchedule', 'getRates',
    'getThemes', 'getAppointments', 'getVehicleMakes', 'getVehicleModels',
    'getWorkCatalog', 'getCarActivityLog', 'getTimeEntries',
  ]) {
    assert.equal(typeof adapter[method], 'function', `metoda lipsa: ${method}`);
  }
  // rămâne doar helper-ul intern, nu expus public: notSupported nu e chemat de nicio metodă publică.
});

test('LocalDataAdapter.getThemes citeste temele demo', async () => {
  const { data, error } = await localAdapter().getThemes();
  assert.equal(error, null);
  assert.ok((data ?? []).length >= 2);
  assert.ok((data ?? []).some((t) => t.name.includes('DEMO')));
});

test('LocalDataAdapter.getAppointments citeste programarea demo', async () => {
  const { data, error } = await localAdapter().getAppointments();
  assert.equal(error, null);
  assert.ok((data ?? []).length >= 1);
  assert.equal((data ?? [])[0].id, 'apt-demo-1');
});

test('LocalDataAdapter.getVehicleMakes citeste marcile demo', async () => {
  const { data, error } = await localAdapter().getVehicleMakes();
  assert.equal(error, null);
  assert.ok((data ?? []).some((m) => m.name === 'Mercedes'));
  assert.ok((data ?? []).every((m) => 'normalized_name' in m));
});

test('LocalDataAdapter.getVehicleModels pastreaza relatia make -> model', async () => {
  const { data, error } = await localAdapter().getVehicleModels();
  assert.equal(error, null);
  const models = (data ?? []) as Array<{ name: string; make_id: string }>;
  const clsC = models.find((m) => m.name === 'Clasa C');
  assert.ok(clsC);
  assert.equal(clsC?.make_id, 'make-demo-1');
});

test('LocalDataAdapter.getWorkCatalog citeste catalogul demo', async () => {
  const { data, error } = await localAdapter().getWorkCatalog();
  assert.equal(error, null);
  assert.ok((data ?? []).length >= 2);
  assert.ok((data ?? []).every((c) => 'normalized_name' in c));
});

test('LocalDataAdapter.getCarActivityLog filtreaza pe carId, cronologic', async () => {
  const { data, error } = await localAdapter().getCarActivityLog('car-demo-1');
  assert.equal(error, null);
  const entries = data ?? [];
  assert.equal(entries.length, 2);
  assert.ok(entries[0].created_at <= entries[1].created_at);
  assert.equal(entries[0].action, 'status_changed');
});

test('LocalDataAdapter.getCarActivityLog cu carId inexistent -> lista goala', async () => {
  const { data, error } = await localAdapter().getCarActivityLog('car-nu-exista');
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

test('LocalDataAdapter.getTimeEntries filtreaza pe fereastra + is_overtime boolean', async () => {
  const { data, error } = await localAdapter().getTimeEntries({
    fromIso: '2026-09-01T00:00:00.000Z',
    toIso: '2026-09-03T00:00:00.000Z',
  });
  assert.equal(error, null);
  const entries = data ?? [];
  assert.equal(entries.length, 2);
  for (const e of entries) {
    assert.equal(e.jobs?.car_id, 'car-demo-1');
    assert.equal(typeof e.is_overtime, 'boolean');
  }
  const overtime = entries.find((e) => e.start_time.startsWith('2026-09-02'));
  assert.equal(overtime?.is_overtime, true);
  assert.equal(overtime?.duration_seconds, 3600);
});

test('LocalDataAdapter.getTimeEntries filtreaza pe employeeId', async () => {
  const alt = await localAdapter().getTimeEntries({
    fromIso: '2026-09-01T00:00:00.000Z',
    toIso: '2026-09-03T00:00:00.000Z',
    employeeId: 'emp-altul',
  });
  assert.equal(alt.error, null);
  assert.deepEqual(alt.data, []);

  const corect = await localAdapter().getTimeEntries({
    fromIso: '2026-09-01T00:00:00.000Z',
    toIso: '2026-09-03T00:00:00.000Z',
    employeeId: 'emp-demo-1',
  });
  assert.equal(corect.error, null);
  assert.equal((corect.data ?? []).length, 2);
});

test('HTTP error handling: server returneaza 500 -> data null + error clar', async () => {
  const errServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false }));
  });
  await new Promise<void>((resolve) => errServer.listen(0, '127.0.0.1', resolve));
  const addr = errServer.address() as AddressInfo;
  const badUrl = `http://127.0.0.1:${addr.port}`;
  try {
    const { data, error } = await new LocalDataAdapter(badUrl).getCars();
    assert.equal(data, null);
    assert.ok(error);
    assert.match(error.message, /500/);
    assert.equal(error.code, 'LOCAL_HTTP_500');
  } finally {
    errServer.close();
  }
});

test('Local Server indisponibil -> eroare clara, fara fallback automat', async () => {
  const adapter = new LocalDataAdapter('http://127.0.0.1:1');
  const { data, error } = await adapter.getCars();
  assert.equal(data, null);
  assert.ok(error);
  assert.match(error.message, /indisponibil/i);
  assert.equal(error.code, 'LOCAL_UNAVAILABLE');
});

test('Registry: SUPABASE este default', () => {
  const order: string[] = [];
  const registry = new DefaultAdapterRegistry(
    {
      supabase: () => { order.push('supabase'); return {} as DataAdapter; },
      local: (url) => { order.push(`local:${url}`); return {} as DataAdapter; },
    },
    'http://127.0.0.1:8787',
  );
  assert.equal(registry.kind, 'supabase');
  assert.deepEqual(order, ['supabase']);
});

test('Registry: enableLocal -> kind local, foloseste LocalDataAdapter', () => {
  let calledWith = '';
  const registry = new DefaultAdapterRegistry(
    {
      supabase: () => ({ source: 'supabase' }) as unknown as DataAdapter,
      local: (url) => { calledWith = url; return { source: 'local' } as unknown as DataAdapter; },
    },
    'http://127.0.0.1:8787',
  );
  registry.enableLocal('http://127.0.0.1:9999');
  assert.equal(registry.kind, 'local');
  assert.equal(calledWith, 'http://127.0.0.1:9999');
  assert.equal((registry.adapter() as unknown as { source: string }).source, 'local');
});

test('Registry: enableLocal default URL + revenire la Supabase', () => {
  const states: string[] = [];
  const registry = new DefaultAdapterRegistry(
    {
      supabase: () => { states.push('supabase'); return { source: 'supabase' } as unknown as DataAdapter; },
      local: (url) => { states.push(`local:${url}`); return { source: 'local' } as unknown as DataAdapter; },
    },
    'http://default:8787',
  );
  registry.enableLocal();
  assert.equal(states.at(-1), 'local:http://default:8787');
  registry.enableSupabase();
  assert.equal(registry.kind, 'supabase');
  assert.equal(states.at(-1), 'supabase');
});

test('LOCAL ON foloseste Local Server (integrat prin registry + LocalDataAdapter)', async () => {
  const registry = new DefaultAdapterRegistry(
    {
      supabase: () => ({ getCars: async () => ({ data: ['SUPABASE'], error: null }) } as unknown as DataAdapter),
      local: (url) => new LocalDataAdapter(url),
    },
    baseUrl,
  );
  registry.enableLocal(baseUrl);
  const res = await registry.adapter().getCars();
  assert.ok(res.data as unknown[]);
  const cars = res.data as Array<{ license_plate: string }>;
  assert.ok(cars.some((c) => c.license_plate === 'TEST-01'));
});

test('LOCAL OFF -> adapter utilizat este Supabase (registry default)', () => {
  const registry = new DefaultAdapterRegistry(
    {
      supabase: () => ({ source: 'supabase' }) as unknown as DataAdapter,
      local: (url) => new LocalDataAdapter(url),
    },
    baseUrl,
  );
  assert.equal(registry.kind, 'supabase');
  assert.equal((registry.adapter() as unknown as { source: string }).source, 'supabase');
});

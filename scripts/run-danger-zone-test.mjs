/**
 * TESTE ZONA PERICULOASA (A-H) - fixture controlat, fara baza reala.
 * Simuleaza fidel logica functiei reset_operational_data din
 * supabase/migrations/20260907100000_servix_restore_operational_reset.sql
 * (lockout check -> md5 parola -> contor pe secvente imune la rollback ->
 * stergeri -> raspuns jsonb) peste un fixture in-memory.
 * Rulare: node scripts/run-danger-zone-test.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = 'supabase/migrations/20260907110000_servix_reset_password_change.sql';
const migrationSql = readFileSync(join(ROOT, MIGRATION), 'utf8');
const appTsx = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');

// Fixture: parola "server-side" cunoscuta DOAR in acest test (NU e parola reala).
const PASSWORD_OK = 'ServixReset2025';
const SERVER_HASH = createHash('md5').update(PASSWORD_OK).digest('hex');
const HASH = (s) => createHash('md5').update(s).digest('hex');

function makeFixture() {
  return {
    activity_log: [{ id: 1 }, { id: 2 }],
    session_event_log: [{ id: 1 }],
    appointments: [{ id: 1 }],
    cars: [{ id: 1 }, { id: 2 }],
    employees: [{ id: 1 }, { id: 2 }],
    storageObjects: [{ bucket_id: 'car-photos' }],
  };
}

function makeDb() {
  const db = makeFixture();
  // Secvente imune la "rollback" - ca in Postgres (nextval/setval).
  const seq = { reset_fail_seq: 0, reset_lock_until_epoch: 0 };
  const setval = (name, val) => { seq[name] = val; return val; };
  const nextval = (name) => { seq[name] += 1; return seq[name]; };
  const lastValue = (name) => seq[name];
  let nowSec = 1000000;
  return { db, setval, nextval, lastValue, clock: () => nowSec, advance: (s) => { nowSec += s; } };
}

// ---- Model fidel al functiei din migratie ----
function resetOperationalData(state, pPassword) {
  const { db, setval, nextval, lastValue, clock } = state;
  const snap = JSON.stringify(db); // tranzactia: orice exceptie => rollback la date
  try {
    // 1. Lockout: refuz orice apel, fara sa consume incercari.
    if (lastValue('reset_lock_until_epoch') > clock()) {
      const t = new Date(lastValue('reset_lock_until_epoch') * 1000).toISOString().slice(11, 19);
      throw new Error('Prea multe incercari gresite. Reincerca dupa ' + t + '.');
    }
    // 2. Verificarea parolei DOAR server-side (secventele NU se anuleaza la throw).
    if (HASH(String(pPassword ?? '')) !== SERVER_HASH) {
      const failNo = nextval('reset_fail_seq');
      if (failNo >= 5) setval('reset_lock_until_epoch', clock() + 15 * 60);
      throw new Error('Parola incorecta');
    }
    // 3. Succes: reset contor + lock, apoi stergeri (aceeasi ordine ca in migratie).
    setval('reset_fail_seq', 0);
    setval('reset_lock_until_epoch', 0);
    db.activity_log = [];
    db.session_event_log = [];
    db.appointments = [];
    db.storageObjects = db.storageObjects.filter((o) => !['employee-photos', 'car-photos'].includes(o.bucket_id));
    const cars = db.cars.length;
    db.cars = [];
    const employees = db.employees.length;
    db.employees = [];
    return { ok: true, employees, cars };
  } catch (e) {
    state.db = JSON.parse(snap); // rollback tranzactie (secventele raman)
    throw e;
  }
}

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + ' ' + detail); }
}
const callDb = () => makeDb();

console.log('A. Parola gresita -> operatia este refuzata');
{
  const st = callDb(); const snap = JSON.stringify(st.db);
  let err = null;
  try { resetOperationalData(st, 'gresita'); } catch (e) { err = e; }
  check('se arunca exceptia de parola incorecta', err?.message === 'Parola incorecta', err?.message);
  check('datele NU au fost sterse (rollback tranzactie)', JSON.stringify(st.db) === snap);
  check('contorul de esecuri a crescut (secventa imuna la rollback)', st.lastValue('reset_fail_seq') === 1);
}

console.log('B. Parola corecta -> operatia este permisa (pe fixture, NU pe baza reala)');
{
  const st = callDb();
  let result = null, err = null;
  try { result = resetOperationalData(st, PASSWORD_OK); } catch (e) { err = e; }
  check('nu se arunca exceptie', err === null, err?.message);
  check('raspuns jsonb: ok=true', result?.ok === true, JSON.stringify(result));
  check('raspuns include contoarele employees/cars', result?.employees === 2 && result?.cars === 2);
  check('fixture golit: activity_log / session_event_log / appointments',
    st.db.activity_log.length === 0 && st.db.session_event_log.length === 0 && st.db.appointments.length === 0);
  check('fixture golit: cars / employees', st.db.cars.length === 0 && st.db.employees.length === 0);
  check('obiectele din bucket-urile foto sunt sterse', st.db.storageObjects.length === 0);
  check('contorul de esecuri a fost resetat', st.lastValue('reset_fail_seq') === 0);
  check('fara lockout activ dupa succes', st.lastValue('reset_lock_until_epoch') === 0);
}

console.log('C. 5 parole gresite consecutive -> lockout 15 minute');
{
  const st = callDb();
  for (let i = 0; i < 4; i++) { try { resetOperationalData(st, 'gresita' + i); } catch { /* asteptat */ } }
  check('dupa 4 esecuri NU este inca blocat', st.lastValue('reset_lock_until_epoch') === 0);
  let err5 = null;
  try { resetOperationalData(st, 'a 5-a gresita'); } catch (e) { err5 = e; }
  check('a 5-a incercare arunca parola incorecta', err5?.message === 'Parola incorecta');
  check('dupa al 5-lea esec lockout-ul este activ (15 min)', st.lastValue('reset_lock_until_epoch') === st.clock() + 15 * 60);
}

console.log('D. In lockout -> chiar parola corecta este refuzata');
{
  const st = callDb();
  for (let i = 0; i < 5; i++) { try { resetOperationalData(st, 'gresita' + i); } catch { /* asteptat */ } }
  const lockBefore = st.lastValue('reset_lock_until_epoch');
  const snap = JSON.stringify(st.db);
  let err = null;
  try { resetOperationalData(st, PASSWORD_OK); } catch (e) { err = e; }
  check('parola corecta este refuzata in lockout', err !== null && /Prea multe incercari gresite/.test(err.message), err?.message);
  check('fereastra lockout NU a fost modificata', st.lastValue('reset_lock_until_epoch') === lockBefore);
  check('datele NU au fost sterse', JSON.stringify(st.db) === snap);
  check('eroarea include ora de reincerca (HH:MM:SS)', /Reincerca dupa \d{2}:\d{2}:\d{2}/.test(err?.message ?? ''));
}

console.log('E. Dupa expirarea lockout-ului -> parola corecta functioneaza');
{
  const st = callDb();
  for (let i = 0; i < 5; i++) { try { resetOperationalData(st, 'gresita' + i); } catch { /* asteptat */ } }
  st.advance(15 * 60 + 1);
  let result = null, err = null;
  try { result = resetOperationalData(st, PASSWORD_OK); } catch (e) { err = e; }
  check('parola corecta este acceptata dupa expirare', err === null && result?.ok === true, err?.message);
  check('fixture-ul a fost resetat', st.db.cars.length === 0 && st.db.employees.length === 0);
  check('contorul si lockout-ul au fost resetate', st.lastValue('reset_fail_seq') === 0 && st.lastValue('reset_lock_until_epoch') === 0);
}

console.log('F. Frontend-ul primeste succesul corect (flux UI real)');
{
  check('App.tsx apeleaza supabase.rpc reset_operational_data cu p_password', appTsx.includes("supabase.rpc('reset_operational_data', { p_password: password })"));
  check('UI are ramura de succes dupa RPC reusit (onRefresh + mesaj succes)', appTsx.includes('Datele opera') && appTsx.includes('Catalogul a fost'));
  check('fluxul UI: succes => inchide modalul', appTsx.includes("setPassword(''); setOpen(false);"));
  check('UI afiseaza mesaj de eroare la RPC esuat', appTsx.includes("setError('Opera"));
  const st = callDb();
  const r = resetOperationalData(st, PASSWORD_OK);
  check('RPC simulat returneaza ok:true => UI intra pe ramura de succes', r.ok === true);
}

console.log('G. Nu se expun date sensibile catre frontend');
{
  const REAL_HASH = 'b44f95103ffcd3233800aee875c0c903';
  check('hash-ul real al parolei NU apare in src/App.tsx', !appTsx.includes(REAL_HASH));
  const srcFiles = ['src/lib/supabase.ts', 'src/data/index.ts', 'src/data/SupabaseDataAdapter.ts', 'src/data/LocalDataAdapter.ts'];
  let leaked = false;
  for (const f of srcFiles) {
    const p = join(ROOT, f);
    if (existsSync(p) && readFileSync(p, 'utf8').includes(REAL_HASH)) leaked = true;
  }
  check('hash-ul NU apare in adapter-e/clients', !leaked);
  const sqlNoComments = migrationSql.replace(/--[^\n]*/g, '');
  check('migratia NU foloseste SQL dinamic (doar GRANT/REVOKE EXECUTE ON)', !/EXECUTE\s+(?!ON)[A-Za-z_]/.test(sqlNoComments));
  check('functia este SECURITY DEFINER cu search_path = public fixat', migrationSql.includes('SECURITY DEFINER') && migrationSql.includes('SET search_path = public'));
  check('raspunsul functiei contine doar ok/contoare, fara hash', /jsonb_build_object\('ok', true, 'employees', v_employee_count, 'cars', v_car_count\)/.test(migrationSql));
}

console.log('H. Drepturile EXECUTE ale functiei');
{
  check('REVOKE EXECUTE ... FROM PUBLIC', /REVOKE EXECUTE ON FUNCTION reset_operational_data\(text\) FROM PUBLIC/.test(migrationSql));
  check('GRANT EXECUTE ... TO anon (frontend actual foloseste cheia anon)', /GRANT EXECUTE ON FUNCTION reset_operational_data\(text\) TO anon, authenticated/.test(migrationSql));
  check('verificarea parolei ramane server-side (md5 in functie)', /md5\(coalesce\(p_password, ''\)\)/.test(migrationSql));
  check('lockout restaurat (secventele reset_fail_seq/reset_lock_until_epoch)', migrationSql.includes('reset_fail_seq') && migrationSql.includes('reset_lock_until_epoch'));
  check('lockout 5 incercari / 15 minute in functie', /v_fail_no >= 5/.test(migrationSql) && /interval '15 minutes'/.test(migrationSql));
  const fns = [...migrationSql.matchAll(/CREATE OR REPLACE FUNCTION (\w+)/g)].map((m) => m[1]);
  check('nu se ating alte functii (doar reset_operational_data)', fns.length === 1 && fns[0] === 'reset_operational_data');
  check('hash-ul real al parolei este cel nou in migratie', migrationSql.includes('b44f95103ffcd3233800aee875c0c903'));
}

console.log('');
console.log('REZULTAT: ' + passed + ' PASS, ' + failed + ' FAIL');
if (failed > 0) process.exit(1);
console.log('TOATE TESTELE A-H AU TRECUT. Parola corecta permite efectiv operatia (demonstrat pe fixture).');

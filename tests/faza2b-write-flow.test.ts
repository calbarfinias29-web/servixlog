/**
 * FAZA 2B ETAPA 1 — teste write flow (fara acces la baza de date reala).
 * Testam: parsing intentie, validare, allowlist, pending replacement,
 * si faptul ca confirmarea singura nu executa nimic.
 * Executia live (Supabase) NU este testata aici — nu exista mecanism demo.
 */
import assert from 'node:assert/strict';
import { parseConfirmation, evaluatePendingConfirmation, createPendingOperation, WRITE_ARMED, isWriteActionAllowed } from '../src/agent/agent-security';
import { parseWriteIntent, validateRateValue, validateVatValue, validateTimeHHMM } from '../src/agent/agent-write-flow';

let passed = 0; let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('  PASS - ' + name); }
  catch (e) { failed++; console.error('  FAIL - ' + name); console.error(e); }
}

console.log('FAZA 2B — write flow');

test('Allowlist ETAPA 2: tarife/program + masini/clienti permise', () => {
  for (const a of ['update_rates', 'update_schedule', 'create_car', 'update_car', 'update_client']) {
    assert.equal(isWriteActionAllowed(a), true, a);
  }
  for (const a of ['create_client','create_employee','update_employee','create_job','update_job','update_job_status','transfer_job','create_appointment','update_appointment','delete_car','delete_client','update_password']) {
    assert.equal(isWriteActionAllowed(a), false, a);
  }
});

test('WRITE este ARMED dar restrictionat', () => {
  assert.equal(WRITE_ARMED, true);
});

test('Parse: tariful normal 120 lei -> update_rates', () => {
  const r = parseWriteIntent('Schimbă tariful normal la 120 lei.') as any;
  assert.equal(r.action, 'update_rates');
  assert.deepEqual(r.changes, { normal_rate: 120 });
});

test('Parse: TVA 19% -> vat_rate', () => {
  const r = parseWriteIntent('Schimbă TVA la 19%.') as any;
  assert.deepEqual(r.changes, { vat_rate: 19 });
});

test('Parse: sambata 08:00-14:00 -> update_schedule', () => {
  const r = parseWriteIntent('Sâmbătă să fie activă de la 08:00 la 14:00.') as any;
  assert.equal(r.action, 'update_schedule');
  assert.deepEqual(r.changes, { saturday_active: true, saturday_start: '08:00', saturday_end: '14:00' });
});

test('Parse: garantie si overtime', () => {
  const g = parseWriteIntent('Modifică tariful garanție la 50 lei.') as any;
  assert.deepEqual(g.changes, { warranty_rate: 50 });
  const o = parseWriteIntent('Schimbă tariful overtime la 200 lei/ora.') as any;
  assert.deepEqual(o.changes, { overtime_rate: 200 });
});

test('Parse: mesaje fara verbe de scriere -> null', () => {
  assert.equal(parseWriteIntent('Care este tariful normal?'), null);
  assert.equal(parseWriteIntent('Ce program avem azi?'), null);
});

test('Validare: rate negative/NaN/invalide respinse', () => {
  assert.equal(validateRateValue(-5).ok, false);
  assert.equal(validateRateValue('abc').ok, false);
  assert.equal(validateRateValue(NaN).ok, false);
  assert.equal(validateRateValue('120,5').ok, true);
});

test('Validare: TVA 0..100', () => {
  assert.equal(validateVatValue(-1).ok, false);
  assert.equal(validateVatValue(150).ok, false);
  assert.equal(validateVatValue(19.5).ok, true);
});

test('Validare: HH:MM si start < end', () => {
  assert.equal(validateTimeHHMM('25:00').ok, false);
  assert.equal(validateTimeHHMM('abc').ok, false);
  assert.equal(validateTimeHHMM('08:00').ok, true);
  const bad = parseWriteIntent('Schimbă sambata de la 14:00 la 08:00') as any;
  assert.ok(bad.error);
});

test('SECURITY: "Da" / "Confirm" fara pending -> NU executa', () => {
  const a = evaluatePendingConfirmation(null, parseConfirmation('Da'));
  assert.equal(a.canExecute, false);
  const b = evaluatePendingConfirmation(null, parseConfirmation('Confirm'));
  assert.equal(b.canExecute, false);
});

test('SECURITY: "Nu confirm" / "Nu modifica" / "ok" -> NU executa', () => {
  const pending = createPendingOperation('update_rates', { id: 'r1' }, { normal_rate: 120 });
  assert.equal(evaluatePendingConfirmation(pending, parseConfirmation('Nu confirm')).canExecute, false);
  assert.equal(evaluatePendingConfirmation(pending, parseConfirmation('Nu modifica')).canExecute, false);
  assert.equal(evaluatePendingConfirmation(pending, parseConfirmation('ok')).canExecute, false);
});

test('SECURITY: actiune ne-permisa (create_employee) nu poate fi executata nici cu "Da"', () => {
  const pending = createPendingOperation('create_employee', { name: 'Test' }, { name: 'Test' });
  const approval = evaluatePendingConfirmation(pending, parseConfirmation('Da'));
  assert.equal(approval.canExecute, false);
});

test('SECURITY: DELETE si PROTECTED raman blocate', () => {
  const d = createPendingOperation('delete_car', { car_id: 'x' }, {});
  assert.equal(evaluatePendingConfirmation(d, parseConfirmation('Da')).canExecute, false);
  const p = createPendingOperation('reset_operational_data', {}, {});
  assert.equal(evaluatePendingConfirmation(p, parseConfirmation('Da')).canExecute, false);
});

console.log('FAZA 2B: ' + passed + ' pass, ' + failed + ' fail');
if (failed > 0) process.exit(1);
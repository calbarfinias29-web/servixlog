/**
 * FAZA 2 — FINAL: teste natural language, numere romanesti, masini/clienti,
 * ambiguitate, confirmare/cancel, operationId, pending.
 * NU executa WRITE live (nu exista mecanism de izolare a datelor reale).
 */
import assert from 'node:assert/strict';
import {
  parseWriteIntent, parseCarWriteIntent, validateRateValue, validateTimeHHMM,
  fillScheduleFromCurrent, convertRomanianNumberWords, parseRomanianNumberPhrase,
  type ParsedWriteIntent,
} from '../src/agent/agent-write-flow';
import {
  parseConfirmation, evaluatePendingConfirmation, createPendingOperation,
  isWriteActionAllowed, WRITE_ARMED, ALLOWED_WRITE_ACTIONS,
} from '../src/agent/agent-security';

let passed = 0; let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('  PASS - ' + name); }
  catch (e) { failed++; console.error('  FAIL - ' + name); console.error(e); }
}

console.log('FAZA 2 FINAL — natural language tarife');

// --- (19) Exemplele obligatorii: toate -> update_rates normal_rate = 101 ---
const rateExamples = [
  'schimbă tariful normal la 101',
  'Schimbăm tariful normal la 101 lei',
  'SCHIMBA TARIFUL NORMAL LA 101',
  'schimbă tariful normal de la 100 la 101',
  'aș vrea să pun tariful normal 101',
];
for (const ex of rateExamples) {
  test('NL rates: "' + ex + '" -> update_rates normal_rate=101', () => {
    const r = parseWriteIntent(ex) as any;
    assert.ok(r && !('error' in r), JSON.stringify(r));
    assert.equal(r.action, 'update_rates');
    assert.deepEqual(r.changes, { normal_rate: 101 });
  });
}

test('Numere romanesti: "de la o suta la o suta unu" -> 101', () => {
  const r = parseWriteIntent('Schimbăm tariful normal de la o sută la o sută unu') as any;
  assert.ok(r && !('error' in r), JSON.stringify(r));
  assert.deepEqual(r.changes, { normal_rate: 101 });
});
test('Numere romanesti: convertRomanianNumberWords', () => {
  assert.equal(convertRomanianNumberWords('la o suta unu'), 'la 101');
  assert.equal(convertRomanianNumberWords('doua sute cincizeci'), '250');
  assert.equal(convertRomanianNumberWords('douazeci si cinci'), '25');
  assert.equal(parseRomanianNumberPhrase(['o', 'suta', 'unu']), 101);
  assert.equal(parseRomanianNumberPhrase(['unu']), 1);
});
test('Valoare incerta in cuvinte NU este ghicita', () => {
  const r = parseWriteIntent('schimbă tariful normal la o') as any;
  assert.ok(!r || 'error' in r || r.action !== 'update_rates');
});

// --- (9) Program de lucru ---
test('Schedule: "schimbă programul de luni la 8" -> start 08:00 + fillFromCurrent', () => {
  const r = parseWriteIntent('schimbă programul de luni la 8') as any;
  assert.ok(r && !('error' in r), JSON.stringify(r));
  assert.equal(r.action, 'update_schedule');
  assert.equal(r.changes.monday_start, '08:00');
  assert.equal(r.fillFromCurrent, 'monday');
  const err = fillScheduleFromCurrent(r as ParsedWriteIntent, { monday_start: '09:00', monday_end: '18:00' });
  assert.equal(err, null);
  assert.deepEqual(r.changes, { monday_active: true, monday_start: '08:00', monday_end: '18:00' });
});
test('Schedule: "luni să începem la 8" -> aceeasi intentie', () => {
  const r = parseWriteIntent('luni să începem la 8') as any;
  assert.ok(r && !('error' in r), JSON.stringify(r));
  assert.equal(r.changes.monday_start, '08:00');
});
test('Schedule: "schimbă sâmbăta să fie activă" -> active, ore din curent', () => {
  const r = parseWriteIntent('schimbă sâmbăta să fie activă') as any;
  assert.ok(r && !('error' in r), JSON.stringify(r));
  assert.equal(r.changes.saturday_active, true);
  const err = fillScheduleFromCurrent(r as ParsedWriteIntent, { saturday_start: '09:00', saturday_end: '13:00' });
  assert.equal(err, null);
  assert.deepEqual(r.changes, { saturday_active: true, saturday_start: '09:00', saturday_end: '13:00' });
});
test('Schedule: activare fara ore salvate -> cere interval (nu ghiceste)', () => {
  const r = parseWriteIntent('schimbă sâmbăta să fie activă') as any;
  const err = fillScheduleFromCurrent(r as ParsedWriteIntent, {});
  assert.ok(err && err.length > 0);
});
test('Schedule: interval complet inca functioneaza', () => {
  const r = parseWriteIntent('programul de luni să fie 08:00 - 17:00') as any;
  assert.ok(r && !('error' in r), JSON.stringify(r));
  assert.deepEqual(r.changes, { monday_active: true, monday_start: '08:00', monday_end: '17:00' });
});

// --- (20) Masini + clienti ---
test('Car: "adaugă o mașină" -> cere informatiile lipsa (nu inventeaza)', () => {
  const r = parseCarWriteIntent('adaugă o mașină') as any;
  assert.ok(r && 'error' in r && /numărul|numarul/i.test(r.error));
});
test('Car: "Adaugă mașina B123ABC" -> cere client + kilometraj', () => {
  const r = parseCarWriteIntent('Adaugă mașina B123ABC') as any;
  assert.ok(r && 'error' in r);
  assert.match(r.error, /clientului/);
  assert.match(r.error, /kilometrajul/);
});
test('Car: "ADĂUGĂ MAȘINA B123ABC" (uppercase/diacritice) -> acelasi comportament', () => {
  const r = parseCarWriteIntent('ADĂUGĂ MAȘINA B123ABC') as any;
  assert.ok(r && 'error' in r);
});
test('Car: "schimbă kilometrajul la B123ABC la 125000" -> update_car mileage', () => {
  const r = parseCarWriteIntent('schimbă kilometrajul la B123ABC la 125000') as any;
  assert.ok(r && !('error' in r), JSON.stringify(r));
  assert.equal(r.action, 'update_car');
  assert.deepEqual(r.changes, { mileage: 125000 });
  assert.equal(r.plate, 'B123ABC');
});
test('Car: "Schimba kilometrajul masinii B123ABC la 125000" -> acelasi intent', () => {
  const r = parseCarWriteIntent('Schimba kilometrajul masinii B123ABC la 125000') as any;
  assert.ok(r && !('error' in r), JSON.stringify(r));
  assert.deepEqual(r.changes, { mileage: 125000 });
});
test('Client: "schimbă telefonul clientului de la B123ABC la 0712345678"', () => {
  const r = parseCarWriteIntent('schimbă telefonul clientului de la B123ABC la 0712345678') as any;
  assert.ok(r && !('error' in r), JSON.stringify(r));
  assert.equal(r.action, 'update_client');
  assert.deepEqual(r.changes, { client_phone: '0712345678' });
});
test('Client: "Schimba telefonul clientului B123ABC cu 0712345678" (cu)', () => {
  const r = parseCarWriteIntent('Schimba telefonul clientului B123ABC cu 0712345678') as any;
  assert.ok(r && !('error' in r), JSON.stringify(r));
  assert.deepEqual(r.changes, { client_phone: '0712345678' });
});


// --- (21) Ambiguitate: NU se executa nimic ---
test('Ambiguu: "schimbă mașina" -> nu produce WRITE', () => {
  const r = parseCarWriteIntent('schimbă mașina') as any;
  assert.ok(r === null || ('error' in r));
});
test('Ambiguu: "modifică" -> nu produce WRITE', () => {
  assert.equal(parseWriteIntent('modifică'), null);
  const c = parseCarWriteIntent('modifică') as any;
  assert.ok(c === null || 'error' in c);
});
test('Ambiguu: "schimbă tariful" (fără valoare) -> cere clarificare', () => {
  const r = parseWriteIntent('schimbă tariful') as any;
  assert.ok(r === null || ('error' in r && r.action !== 'update_rates'));
});
test('Ambiguu: "actualizează clientul" -> cere clarificare, nu WRITE', () => {
  const r = parseCarWriteIntent('actualizează clientul') as any;
  assert.ok(r === null || ('error' in r && r.action !== 'update_client'));
});
test('Ambiguu: "pune 101" -> nu produce WRITE', () => {
  assert.equal(parseWriteIntent('pune 101'), null);
  const c = parseCarWriteIntent('pune 101') as any;
  assert.ok(c === null || 'error' in c);
});
test('Valori invalide: kilometraj negativ / telefon scurt respinse', () => {
  const r1 = parseCarWriteIntent('schimbă kilometrajul la B123ABC la -5') as any;
  assert.ok(r1 && 'error' in r1);
  const r2 = parseCarWriteIntent('schimbă telefonul clientului B123ABC la 123') as any;
  assert.ok(r2 && 'error' in r2);
});

// --- (12/13/14) Confirmation security ---
console.log('FAZA 2 FINAL — confirmation security');
test('Confirmarea aproba DOAR pending-ul exact (operationId unic)', () => {
  const p = createPendingOperation('update_rates', { id: 1 }, { normal_rate: 101 });
  const a = evaluatePendingConfirmation(p, parseConfirmation('da'));
  assert.equal(a.canExecute, true);
  const other = createPendingOperation('update_rates', { id: 1 }, { normal_rate: 101 });
  assert.notEqual(p.operationId, other.operationId);
});
test('Cancel: "Anulează" -> pending inchis, nimic executat', () => {
  const p = createPendingOperation('update_rates', { id: 1 }, { normal_rate: 101 });
  const a = evaluatePendingConfirmation(p, parseConfirmation('Anulează'));
  assert.equal(a.canExecute, false);
  assert.equal(a.state, 'cancelled');
});
test('Refuz: "Nu confirm" nu este aprobare', () => {
  const p = createPendingOperation('update_rates', { id: 1 }, { normal_rate: 101 });
  const a = evaluatePendingConfirmation(p, parseConfirmation('Nu confirm'));
  assert.equal(a.canExecute, false);
  assert.equal(a.state, 'cancelled');
});
test('Ambiguu: "ok" -> pending ramane in asteptare, NU executa', () => {
  const p = createPendingOperation('update_rates', { id: 1 }, { normal_rate: 101 });
  const a = evaluatePendingConfirmation(p, parseConfirmation('ok'));
  assert.equal(a.canExecute, false);
  assert.equal(a.state, 'awaiting_confirmation');
});
test('Fără pending: "Da" nu execută nimic', () => {
  const a = evaluatePendingConfirmation(null, parseConfirmation('da'));
  assert.equal(a.canExecute, false);
  assert.equal(a.reason, 'no-pending-operation');
});
test('Allowlist strict: exact cele 5 operatii WRITE', () => {
  assert.deepEqual([...ALLOWED_WRITE_ACTIONS].sort(), ['create_car', 'update_car', 'update_client', 'update_rates', 'update_schedule']);
  assert.equal(WRITE_ARMED, true);
  for (const blocked of ['delete_car','delete_job','create_client','create_employee','update_employee','delete_employee','create_job','update_job','delete_job','create_appointment','update_appointment','delete_appointment','transfer_employee','change_assignment','change_job_status','reset_operational_data']) {
    assert.equal(isWriteActionAllowed(blocked), false, blocked);
  }
});
test('Pending ne-permis nu poate fi executat nici cu "Da"', () => {
  const p = createPendingOperation('delete_car', { id: 'x' }, {});
  const a = evaluatePendingConfirmation(p, parseConfirmation('da'));
  assert.equal(a.canExecute, false);
});
test('Validare: valori incorecte nu produc WRITE plan', () => {
  assert.equal(validateRateValue(-1).ok, false);
  assert.equal(validateRateValue('abc').ok, false);
  assert.equal(validateTimeHHMM('25:00').ok, false);
});

console.log('FAZA 2 FINAL: ' + passed + ' pass, ' + failed + ' fail');
if (failed > 0) process.exit(1);



console.log('\n=== FAZA 5: CONFIRMATION (8 exemple) ===');
test('CONFIRM: Da -> approved', () => { assert.equal(parseConfirmation('Da').status, 'approved'); pass('CONFIRM: Da'); });
test('CONFIRM: Nu -> rejected', () => { assert.equal(parseConfirmation('Nu').status, 'rejected'); pass('CONFIRM: Nu'); });
test('CONFIRM: Anuleaza -> rejected', () => { assert.equal(parseConfirmation('Anuleaza').status, 'rejected'); pass('CONFIRM: Anuleaza'); });
test('CONFIRM: Nu confirm -> rejected', () => { assert.equal(parseConfirmation('Nu confirm').status, 'rejected'); pass('CONFIRM: Nu confirm -> rejected'); });
test('CONFIRM: ok -> ambiguous', () => { assert.equal(parseConfirmation('ok').status, 'ambiguous'); pass('CONFIRM: ok -> ambiguous'); });
test('CONFIRM: bine -> ambiguous', () => { assert.equal(parseConfirmation('bine').status, 'ambiguous'); pass('CONFIRM: bine -> ambiguous'); });
test('CONFIRM: pending ne-permis + Da = blocat', () => {
  const pending = createPendingOperation('delete_car', { id: 'x' }, {});
  assert.equal(evaluatePendingConfirmation(pending, parseConfirmation('Da')).canExecute, false);
  pass('CONFIRM: pending ne-permis blocat');
});
test('CONFIRM: fara pending, Da nu executa', () => {
  const a = evaluatePendingConfirmation(null, parseConfirmation('Da'));
  assert.equal(a.canExecute, false); assert.equal(a.reason, 'no-pending-operation');
  pass('CONFIRM: fara pending, Da nu executa');
});
test('CONFIRM: action-not-allowed', () => {
  const pending = createPendingOperation('create_employee', { name: 'Test' }, { name: 'Test' });
  const a = evaluatePendingConfirmation(pending, parseConfirmation('Da'));
  assert.equal(a.canExecute, false); assert.match(a.reason, /action-not-enabled/);
  pass('CONFIRM: action-not-allowed');
});
test('CONFIRM: operationId unic', () => {
  const p1 = createPendingOperation('update_rates', { id: 1 }, { normal_rate: 100 });
  const p2 = createPendingOperation('update_rates', { id: 1 }, { normal_rate: 100 });
  assert.notEqual(p1.operationId, p2.operationId);
  pass('CONFIRM: operationId unic');
});

console.log('\n=== FAZA 5: AMBIGUITY (5 exemple) ===');
test('AMBIGUITY: "Modifica masina." -> null/error', () => {
  const p = parseCarWriteIntent('Modifica masina.');
  assert.ok(p === null || ('error' in p));
  pass('AMBIGUITY: Modifica masina -> null/error');
});
test('AMBIGUITY: "Schimba angajatul." -> cere exact', () => {
  const p = parsePhase3Intent('Schimba angajatul.');
  assert.ok(p && 'error' in p); assert.match(p.error, /Spune exact/);
  pass('AMBIGUITY: Schimba angajatul -> cere exact');
});
test('AMBIGUITY: "sterge programarea" -> cere exact', () => {
  const p = parsePhase3Intent('Sterge programarea');
  assert.ok(p && 'error' in p); assert.match(p.error, /Spune exact/);
  pass('AMBIGUITY: Sterge programarea -> cere exact');
});
test('AMBIGUITY: "transfera masina la Maria" -> cere numar', () => {
  const p = parsePhase3Intent('Transfera masina la Maria');
  assert.ok(p && 'error' in p); assert.match(p.error, /numarul exact/);
  pass('AMBIGUITY: transfer fara numar -> cere numar');
});
test('AMBIGUITY: "adauga programare" -> cere data si ora', () => {
  const p = parsePhase3Intent('Adauga programare');
  assert.ok(p && 'error' in p); assert.match(p.error, /data si ora/);
  pass('AMBIGUITY: programare fara data -> cere data si ora');
});
test('AMBIGUITY: "pune 101" -> niciun WRITE', () => {
  assert.equal(parseWriteIntent('pune 101'), null);
  const c = parseCarWriteIntent('pune 101'); assert.ok(c === null || ('error' in c));
  pass('AMBIGUITY: pune 101 -> niciun WRITE');
});

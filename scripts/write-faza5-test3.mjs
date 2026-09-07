import fs from 'node:fs';

const part3 = `
console.log('\\n=== FAZA 5: PHASE3 (5 exemple) ===');
test('PHASE3: create_employee', () => {
  const p = parsePhase3Intent('Creeaza angajat nou Ion Popescu');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'create_employee');
  pass('PHASE3: create_employee recunoscut');
});
test('PHASE3: deactivate_employee', () => {
  const p = parsePhase3Intent('Dezactiveaza angajatul Ion Popescu');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'deactivate_employee');
  pass('PHASE3: deactivate_employee recunoscut');
});
test('PHASE3: transfer_car', () => {
  const p = parsePhase3Intent('Transfera masina B123ABC la Maria');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'transfer_car');
  assert.ok(p.preview.some(l => l.includes('RISC: HIGH'))); assert.ok(p.preview.some(l => l.includes('NU SE RESETEAZA')));
  pass('PHASE3: transfer_car cu preview corect');
});
test('PHASE3: preview contine confirmare', () => {
  const p = parsePhase3Intent('Creeaza programare pe 10.09.2026 la 14:00');
  assert.ok(p && !('error' in p)); assert.ok(p.preview.some(l => l.includes('CONFIRMARE: DA / NU')));
  pass('PHASE3: preview contine confirmare');
});
test('PHASE3: gate dezactivat', () => {
  assert.equal(ADMIN_WRITE_EXECUTION_ENABLED, false);
  pass('PHASE3: ADMIN_WRITE_EXECUTION_ENABLED=false');
});
test('PHASE3: delete_employee blocat', () => {
  const p = parsePhase3Intent('Sterge angajatul Ion Popescu');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'delete_employee');
  assert.equal(ADMIN_WRITE_EXECUTION_ENABLED, false);
  pass('PHASE3: delete_employee recunoscut dar BLOCAT');
});

console.log('\\n=== FAZA 5: DELETE (3 exemple) ===');
test('DELETE: delete_employee risc HIGH', () => {
  const p = parsePhase3Intent('Sterge angajatul Ion Popescu');
  assert.ok(p && !('error' in p)); assert.equal(p.risk, 'HIGH'); assert.ok(p.preview.some(l => l.includes('DESTRUCTIVA')));
  pass('DELETE: delete_employee risc HIGH');
});
test('DELETE: delete_job risc HIGH', () => {
  const p = parsePhase3Intent('Sterge lucrarea B123ABC');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'delete_job'); assert.equal(p.risk, 'HIGH');
  pass('DELETE: delete_job risc HIGH');
});
test('DELETE: delete_appointment risc HIGH', () => {
  const p = parsePhase3Intent('Sterge programarea B123ABC');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'delete_appointment'); assert.equal(p.risk, 'HIGH');
  pass('DELETE: delete_appointment risc HIGH');
});
test('DELETE: nu in allowlist', () => {
  assert.equal(isWriteActionAllowed('delete_employee'), false);
  assert.equal(isWriteActionAllowed('delete_job'), false);
  assert.equal(isWriteActionAllowed('delete_appointment'), false);
  pass('DELETE: nicio DELETE in allowlist');
});
`;

fs.writeFileSync('.tmp-tests/faza5-part3.ts', part3);
console.log('Part 3 written');

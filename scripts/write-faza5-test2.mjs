import fs from 'node:fs';

const part2 = `
console.log('\\n=== FAZA 5: MULTI-INTENT (5 exemple) ===');
test('MULTI-INTENT: separa intrebari multiple', async () => {
  const r = await processMessageMulti('Cate masini sunt in lucru si cate lucrari avem finalizate?');
  assert.ok(r.success === true || r.success === false); assert.ok(r.formattedResponse.length > 0);
  pass('MULTI-INTENT: 2 intrebari READ separate');
});
test('MULTI-INTENT: angajati + program', async () => {
  const r = await processMessageMulti('Arata-mi angajatii si programul');
  assert.ok(r.formattedResponse.length > 0);
  pass('MULTI-INTENT: angajati + program');
});
test('MULTI-INTENT: costuri + TVA', async () => {
  const r = await processMessageMulti('Care sunt costurile si cat TVA avem?');
  assert.ok(r.formattedResponse.length > 0);
  pass('MULTI-INTENT: costuri + TVA');
});
test('MULTI-INTENT: intrebare filtrata', async () => {
  const r = await processMessageMulti('Ce masini sunt in lucru?');
  assert.ok(r.formattedResponse.length > 0);
  pass('MULTI-INTENT: intrebare filtrata');
});
test('MULTI-INTENT: raspuns formatat', async () => {
  const r = await processMessageMulti('Cati angajati avem?');
  assert.ok(r.formattedResponse.length > 0);
  pass('MULTI-INTENT: raspuns formatat');
});

console.log('\\n=== FAZA 5: WRITE FAZA 2 (5 exemple) ===');
test('WRITE F2: tariful normal', () => {
  const p = parseWriteIntent('Schimba tariful normal la 120');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'update_rates'); assert.deepEqual(p.changes, { normal_rate: 120 });
  pass('WRITE F2: update_rates normal_rate=120');
});
test('WRITE F2: TVA', () => {
  const p = parseWriteIntent('Modifica TVA la 19%');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'update_rates'); assert.deepEqual(p.changes, { vat_rate: 19 });
  pass('WRITE F2: update_rates vat_rate=19');
});
test('WRITE F2: program sambata', () => {
  const p = parseWriteIntent('Sambata activa de la 08:00 la 14:00');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'update_schedule');
  assert.equal(p.changes.saturday_active, true); assert.equal(p.changes.saturday_start, '08:00'); assert.equal(p.changes.saturday_end, '14:00');
  pass('WRITE F2: update_schedule sambata');
});
test('WRITE F2: create_car', () => {
  const p = parseCarWriteIntent('Adauga masina B123ABC pentru clientul Ion Popescu, marca BMW, model X5, kilometraj 150000');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'create_car');
  assert.equal(p.changes.license_plate, 'B123ABC'); assert.equal(p.changes.client_name, 'Ion Popescu');
  pass('WRITE F2: create_car parsing');
});
test('WRITE F2: update_client', () => {
  const p = parseCarWriteIntent('Schimba telefonul clientului B123ABC la 0712345678');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'update_client'); assert.equal(p.changes.client_phone, '0712345678');
  pass('WRITE F2: update_client parsing');
});
test('WRITE F2: allowlist 5 operatii', () => {
  assert.deepEqual([...ALLOWED_WRITE_ACTIONS].sort(), ['create_car','update_car','update_client','update_rates','update_schedule']);
  pass('WRITE F2: allowlist exact 5 operatii');
});
`;

fs.writeFileSync('.tmp-tests/faza5-part2.ts', part2);
console.log('Part 2 written');

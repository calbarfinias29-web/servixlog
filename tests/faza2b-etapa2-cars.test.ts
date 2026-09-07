/**
 * FAZA 2B ETAPA 2 — teste parsare masini/clienti (fara acces la baza de date reala).
 * Executia live (Supabase) NU este testata aici.
 */
import assert from 'node:assert/strict';
import { parseCarWriteIntent } from '../src/agent/agent-write-flow';
import { isWriteActionAllowed } from '../src/agent/agent-security';

let passed = 0; let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('  PASS - ' + name); }
  catch (e) { failed++; console.error('  FAIL - ' + name); console.error(e); }
}

console.log('FAZA 2B ETAPA 2 — masini + clienti');

test('Parse: create_car cu date complete', () => {
  const r = parseCarWriteIntent('Adaugă mașina B123ABC pentru clientul Ion Popescu, marca BMW, model X5, kilometraj 150000, telefon 0712345678') as any;
  assert.equal(r.action, 'create_car');
  assert.equal(r.changes.license_plate, 'B123ABC');
  assert.equal(r.changes.client_name, 'Ion Popescu');
  assert.equal(r.changes.make, 'BMW');
  assert.equal(r.changes.model, 'X5');
  assert.equal(r.changes.mileage, 150000);
  assert.equal(r.changes.client_phone, '0712345678');
});

test('Parse: create_car cu numar cu spatii (TM 27 FXC)', () => {
  const r = parseCarWriteIntent('Adaugă mașina TM 27 FXC pentru clientul Andrei Pop, kilometraj 80000') as any;
  assert.equal(r.action, 'create_car');
  assert.equal(r.changes.license_plate, 'TM27FXC');
});

test('Parse: create_car accepta TM 10 TEST si pastreaza toate campurile', () => {
  const r = parseCarWriteIntent('Adaugă mașina TM 10 TEST pentru clientul Client Test, marca Dacia, model Logan, kilometraj 100000, telefon 0712345678') as any;
  assert.equal(r.action, 'create_car');
  assert.equal(r.changes.license_plate, 'TM10TEST');
  assert.equal(r.changes.client_name, 'Client Test');
  assert.equal(r.changes.make, 'Dacia');
  assert.equal(r.changes.model, 'Logan');
  assert.equal(r.changes.mileage, 100000);
  assert.equal(r.changes.client_phone, '0712345678');
});

test('Parse: create_car accepta placi compacte si standard', () => {
  for (const plate of ['TM10TEST', 'B123ABC', 'IS05RTG']) {
    const r = parseCarWriteIntent(`Adaugă mașina ${plate} pentru clientul Client Test, marca Dacia, model Logan, kilometraj 100000, telefon 0712345678`) as any;
    assert.equal(r.action, 'create_car');
    assert.equal(r.changes.license_plate, plate);
  }
});

test('Parse: cererea explicită pentru 3 mașini este CREATE și extrage toate mașinile', () => {
  const r = parseCarWriteIntent(`Creează 3 mașini noi în baza Locală.
1.
Număr: TM 10 TEST
Marcă: BMW
Model: Seria 3
Client: Client Test 1
Telefon: 0722000001
2.
Număr: TM 20 TEST
Marcă: Audi
Model: A4
Client: Client Test 2
Telefon: 0722000002
3.
Număr: TM 30 TEST
Marcă: Dacia
Model: Duster
Client: Client Test 3
Telefon: 0722000003`) as any;
  assert.equal(r.action, 'create_car');
  assert.equal(r.cars.length, 3);
  assert.deepEqual(r.cars.map((car: { license_plate: string }) => car.license_plate), ['TM10TEST', 'TM20TEST', 'TM30TEST']);
  assert.equal(r.cars[1].client_name, 'Client Test 2');
  assert.equal(r.cars[1].make, 'Audi');
  assert.equal(r.cars[1].model, 'A4');
});

test('CREATE: campuri obligatorii lipsa -> intreaba, nu inventeaza', () => {
  const r = parseCarWriteIntent('Adaugă clientul Ion Popescu.') as any;
  assert.ok(r.error);
  assert.ok(String(r.error).includes('înmatriculare'));
  assert.ok(String(r.error).includes('kilometraj'));
});

test('CREATE: kilometraj lipsa -> intreaba', () => {
  const r = parseCarWriteIntent('Adaugă mașina B123ABC pentru clientul Ion Popescu, marca BMW') as any;
  assert.ok(r.error);
  assert.ok(String(r.error).includes('kilometraj'));
});

test('Parse: update_car — schimba modelul', () => {
  const r = parseCarWriteIntent('Schimbă modelul mașinii B123ABC în X3.') as any;
  assert.equal(r.action, 'update_car');
  assert.equal(r.plate, 'B123ABC');
  assert.deepEqual(r.changes, { model: 'X3' });
});

test('Parse: update_client — telefonul lui Ion Popescu', () => {
  const r = parseCarWriteIntent('Schimbă telefonul lui Ion Popescu la 0712345678.') as any;
  assert.equal(r.action, 'update_client');
  assert.equal(r.clientName, 'Ion Popescu');
  assert.deepEqual(r.changes, { client_phone: '0712345678' });
});

test('Parse: muta masina la client', () => {
  const r = parseCarWriteIntent('Mută mașina B123ABC la Ion Popescu.') as any;
  assert.equal(r.action, 'update_client');
  assert.equal(r.plate, 'B123ABC');
  assert.deepEqual(r.changes, { client_name: 'Ion Popescu' });
});

test('UPDATE: telefon invalid respins', () => {
  const r = parseCarWriteIntent('Schimbă telefonul lui Ion Popescu la abc.') as any;
  assert.ok(r.error);
});

test('UPDATE: an invalid respins', () => {
  const r = parseCarWriteIntent('Schimbă anul mașinii B123ABC la 1800.') as any;
  assert.ok(r.error);
});

test('UPDATE: fara identificator -> cere clarificare', () => {
  const r = parseCarWriteIntent('Schimbă modelul în X3.') as any;
  assert.ok(r.error);
});

test('READ: intrebarile nu sunt intentii WRITE masina', () => {
  assert.equal(parseCarWriteIntent('Câte mașini avem?'), null);
  assert.equal(parseCarWriteIntent('Care sunt tarifele?'), null);
  assert.equal(parseCarWriteIntent('Ce program avem azi?'), null);
});

test('Allowlist: create_client independent BLOCAT (limitare arhitectura)', () => {
  assert.equal(isWriteActionAllowed('create_client'), false);
  assert.equal(isWriteActionAllowed('update_client'), true);
});

console.log('FAZA 2B ETAPA 2: ' + passed + ' pass, ' + failed + ' fail');
if (failed > 0) process.exit(1);
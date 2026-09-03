/**
 * Teste normalizare căutare (src/lib/search.ts) — helperul comun folosit
 * de Admin și de noul Istoric din Panou Angajat.
 */
import assert from 'node:assert/strict';
import { normalizeSearch, searchIncludes } from '../src/lib/search';

let passed = 0; let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log('  PASS - ' + name); }
  catch (e) { failed++; console.error('  FAIL - ' + name); console.error(e); }
}

console.log('SEARCH — normalizare comuna');
test('case-insensitive: "b123abc" gaseste "B123ABC"', () => {
  assert.equal(searchIncludes('B123ABC', 'b123abc'), true);
  assert.equal(searchIncludes('B123ABC', 'B123ABC'), true);
});
test('diacritice: "schimb ulei" gaseste "Schimb ulei"', () => {
  assert.equal(searchIncludes('Schimb ulei', 'schimb ulei'), true);
});
test('diacritice inverse: căutarea cu diacritice gaseste textul fără', () => {
  assert.equal(searchIncludes('Schimbă ulei', 'schimba ulei'), true);
  assert.equal(searchIncludes('SCHIMBĂ ULEI', 'schimbă ulei'), true);
  assert.equal(searchIncludes('Șaibă', 'saiba'), true);
  assert.equal(searchIncludes('șaibă', 'Saibă'), true);
});
test('spații inutile sunt ignorate', () => {
  assert.equal(searchIncludes('B 123 ABC', 'b123abc'), true);
  assert.equal(searchIncludes('Schimb   ulei', 'schimb ulei'), true);
});
test('marcă / model / telefon / client / vin', () => {
  assert.equal(searchIncludes('BMW', 'bmw'), true);
  assert.equal(searchIncludes('X3', 'x3'), true);
  assert.equal(searchIncludes('0712345678', '712345678'), true);
  assert.equal(searchIncludes('Ion Popescu', 'popescu'), true);
  assert.equal(searchIncludes('WVWZZZ1KZAW123456', '123456'), true);
});
test('nu există fals pozitiv', () => {
  assert.equal(searchIncludes('B123ABC', 'B999XYZ'), false);
  assert.equal(searchIncludes(null, 'b123abc'), false);
  assert.equal(searchIncludes('B123ABC', ''), true); // query gol = totul
});

console.log('SEARCH: ' + passed + ' pass, ' + failed + ' fail');
if (failed > 0) process.exit(1);

// tests/search-normalize.test.ts
import assert from "node:assert/strict";

// src/lib/search.ts
function normalizeSearch(value) {
  return (value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ş/g, "s").replace(/ţ/g, "t").replace(/ș/g, "s").replace(/ț/g, "t").replace(/\s/g, "");
}
function searchIncludes(value, query) {
  return normalizeSearch(value).includes(normalizeSearch(query));
}

// tests/search-normalize.test.ts
var passed = 0;
var failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  PASS - " + name);
  } catch (e) {
    failed++;
    console.error("  FAIL - " + name);
    console.error(e);
  }
}
console.log("SEARCH \u2014 normalizare comuna");
test('case-insensitive: "b123abc" gaseste "B123ABC"', () => {
  assert.equal(searchIncludes("B123ABC", "b123abc"), true);
  assert.equal(searchIncludes("B123ABC", "B123ABC"), true);
});
test('diacritice: "schimb ulei" gaseste "Schimb ulei"', () => {
  assert.equal(searchIncludes("Schimb ulei", "schimb ulei"), true);
});
test("diacritice inverse: c\u0103utarea cu diacritice gaseste textul f\u0103r\u0103", () => {
  assert.equal(searchIncludes("Schimb\u0103 ulei", "schimba ulei"), true);
  assert.equal(searchIncludes("SCHIMB\u0102 ULEI", "schimb\u0103 ulei"), true);
  assert.equal(searchIncludes("\u0218aib\u0103", "saiba"), true);
  assert.equal(searchIncludes("\u0219aib\u0103", "Saib\u0103"), true);
});
test("spa\u021Bii inutile sunt ignorate", () => {
  assert.equal(searchIncludes("B 123 ABC", "b123abc"), true);
  assert.equal(searchIncludes("Schimb   ulei", "schimb ulei"), true);
});
test("marc\u0103 / model / telefon / client / vin", () => {
  assert.equal(searchIncludes("BMW", "bmw"), true);
  assert.equal(searchIncludes("X3", "x3"), true);
  assert.equal(searchIncludes("0712345678", "712345678"), true);
  assert.equal(searchIncludes("Ion Popescu", "popescu"), true);
  assert.equal(searchIncludes("WVWZZZ1KZAW123456", "123456"), true);
});
test("nu exist\u0103 fals pozitiv", () => {
  assert.equal(searchIncludes("B123ABC", "B999XYZ"), false);
  assert.equal(searchIncludes(null, "b123abc"), false);
  assert.equal(searchIncludes("B123ABC", ""), true);
});
console.log("SEARCH: " + passed + " pass, " + failed + " fail");
if (failed > 0) process.exit(1);

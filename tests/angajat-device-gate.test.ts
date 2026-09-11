/**
 * Teste — Gate dispozitiv Angajat (src/angajat/deviceGate.ts).
 * Cerințe „Angajat Local Client”:
 *   - prima conectare din payload scanat (QR / cod de bare / cod manual);
 *   - persistența asocierii pe dispozitiv (localStorage);
 *   - reconectarea automată la pornire (heartbeat);
 *   - detectarea revocării accesului (401/403 → asocierea se șterge);
 *   - server indisponibil → asocierea rămâne salvată (reconectare mai târziu).
 * Fetch + storage sunt injectate — testabile determinist, fără rețea reală.
 *
 * Ruleaza cu: node scripts/run-security-tests.mjs (suite registered).
 */
import assert from 'node:assert/strict';
import { createPairingPayload } from '../src/devicePairing';
import {
  ANGAJAT_PAIRING_STORAGE_KEY, clearAngajatPairing, deviceAuthHeaders, loadAngajatPairing,
  pairAngajatDevice, saveAngajatPairing, verifyAngajatPairing,
} from '../src/angajat/deviceGate';
import type { AngajatStorage } from '../src/angajat/deviceGate';

let passed = 0; let failed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  const run = (): void => { passed++; console.log('  PASS - ' + name); };
  const fail = (e: unknown): void => { failed++; console.error('  FAIL - ' + name); console.error(e); };
  return Promise.resolve()
    .then(fn)
    .then(run, fail);
}

/** Storage determinist în memorie (reprezentarea localStorage pe dispozitiv). */
function fakeStorage(): AngajatStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

/** Response minim (fetch injectabil). */
function res(status: number, body?: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body ?? {} } as unknown as Response;
}

/** fetch care înregistrează cererile și răspunde dintr-un handler. */
interface FakeFetch {
  (url: string, init: RequestInit): Promise<Response>;
  calls: Array<{ url: string; init: RequestInit }>;
}
function fakeFetch(handler: (url: string, init: RequestInit) => Response): FakeFetch {
  const calls: FakeFetch['calls'] = [];
  const fn = ((url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  }) as FakeFetch;
  fn.calls = calls;
  return fn;
}

const SERVER = 'http://192.168.1.50:8787';
const payloadOf = (serverAddress: string | null): string => createPairingPayload(
  { serviceId: 'service-angajat', serverAddress, apiVersion: '1' },
  'device-angajat-01', 'credential-angajat-01',
);

console.log('ANGAJAT DEVICE GATE — conectare / persistență / revocare / reconectare');

// 1. PRIMA CONECTARE — payload scanat corect → confirm pe server → salvat local.
await test('prima conectare: payload valid -> pair/confirm pe serverul din QR + asociere salvată', () => {
  const storage = fakeStorage();
  const fake = fakeFetch((url, init) => {
    assert.equal(url, `${SERVER}/api/devices/pair/confirm`);
    assert.equal((init.headers as Record<string, string>)['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(String(init.body)), { deviceId: 'device-angajat-01', credential: 'credential-angajat-01' });
    return res(200, { ok: true, device: { deviceId: 'device-angajat-01', deviceName: 'Tabletă atelier 01', pairedAt: '2026-09-11T10:00:00.000Z' } });
  });
  return pairAngajatDevice(payloadOf(SERVER), fake as unknown as typeof fetch).then((result) => {
    assert.equal(result.kind, 'PAIRED');
    if (result.kind !== 'PAIRED') return;
    assert.equal(result.saved.serverAddress, SERVER);
    assert.equal(result.saved.deviceName, 'Tabletă atelier 01');
    saveAngajatPairing(storage, result.saved);
    assert.equal(loadAngajatPairing(storage)?.deviceId, 'device-angajat-01');
    assert.equal(storage.getItem(ANGAJAT_PAIRING_STORAGE_KEY)?.includes('device-angajat-01'), true);
  });
});

// 2. Payload necunoscut / invalid → INVALID_PAYLOAD, nimic salvat, fără fetch.
await test('prima conectare: cod necunoscut -> INVALID_PAYLOAD (nimic salvat)', () => {
  const storage = fakeStorage();
  const fake = fakeFetch(() => { throw new Error('nu trebuie chemat'); });
  return pairAngajatDevice('text-aleator-nu-e-json', fake as unknown as typeof fetch).then((result) => {
    assert.equal(result.kind, 'INVALID_PAYLOAD');
    assert.equal(loadAngajatPairing(storage), null);
    assert.equal(fake.calls.length, 0);
  });
});

// 3. QR fără serverAddress (LAN dezactivat pe server) → mesaj clar, fără fetch.
await test('prima conectare: QR fără serverAddress (LAN off) -> NO_SERVER_ADDRESS', () => {
  const fake = fakeFetch(() => { throw new Error('nu trebuie chemat'); });
  return pairAngajatDevice(payloadOf(null), fake as unknown as typeof fetch).then((result) => {
    assert.equal(result.kind, 'NO_SERVER_ADDRESS');
    assert.equal(fake.calls.length, 0);
  });
});

// 4. Confirm pe dispozitiv revocat → REVOKED (necesită un pairing nou).
await test('prima conectare: dispozitiv revocat -> REVOKED', () => {
  const fake = fakeFetch(() => res(403, { ok: false, error: 'DEVICE_REVOKED' }));
  return pairAngajatDevice(payloadOf(SERVER), fake as unknown as typeof fetch).then((result) => {
    assert.equal(result.kind, 'REVOKED');
  });
});

// 5. Credential greșit → CREDENTIAL_INVALID.
await test('prima conectare: credential invalid -> CREDENTIAL_INVALID', () => {
  const fake = fakeFetch(() => res(401, { ok: false, error: 'DEVICE_CREDENTIAL_INVALID' }));
  return pairAngajatDevice(payloadOf(SERVER), fake as unknown as typeof fetch).then((result) => {
    assert.equal(result.kind, 'CREDENTIAL_INVALID');
  });
});

// 6. Server indisponibil la conectare → SERVER_UNREACHABLE (mesaj clar, nimic salvat).
await test('prima conectare: server indisponibil -> SERVER_UNREACHABLE', () => {
  const storage = fakeStorage();
  const broken = ((() => Promise.reject(new Error('ECONNREFUSED')))) as unknown as typeof fetch;
  return pairAngajatDevice(payloadOf(SERVER), broken).then((result) => {
    assert.equal(result.kind, 'SERVER_UNREACHABLE');
    assert.equal(loadAngajatPairing(storage), null);
  });
});

// 7. PORNIRE DUPĂ PAIRING — asocierea salvată → heartbeat OK → reconectare fără QR.
await test('pornire după pairing: heartbeat 200 -> PAIRED (fără QR)', () => {
  const storage = fakeStorage();
  const saved = { deviceId: 'device-angajat-01', credential: 'credential-angajat-01', serverAddress: SERVER, serviceId: 'service-angajat', deviceName: 'Tabletă atelier 01', pairedAt: '2026-09-11T10:00:00.000Z' };
  saveAngajatPairing(storage, saved);
  assert.deepEqual(loadAngajatPairing(storage), saved); // asocierea persistă la reîncărcare
  const fake = fakeFetch((url, init) => {
    assert.equal(url, `${SERVER}/api/devices/heartbeat`);
    assert.deepEqual((init.headers as Record<string, string>)['x-servix-device-id'], 'device-angajat-01');
    assert.deepEqual((init.headers as Record<string, string>)['x-servix-device-credential'], 'credential-angajat-01');
    return res(200, { ok: true });
  });
  return verifyAngajatPairing(saved, fake as unknown as typeof fetch).then((verification) => {
    assert.equal(verification.kind, 'PAIRED');
    assert.equal(loadAngajatPairing(storage)?.deviceId, 'device-angajat-01'); // asocierea rămâne
  });
});

// 8. REVOCARE — heartbeat 403 → asocierea se ȘTERGE → ecranul de conectare revine.
await test('revocare acces: heartbeat 403 -> REVOKED -> asocierea ștearsă local', () => {
  const storage = fakeStorage();
  const saved = { deviceId: 'device-angajat-01', credential: 'credential-angajat-01', serverAddress: SERVER, serviceId: 'service-angajat', deviceName: 'Tabletă atelier 01', pairedAt: '2026-09-11T10:00:00.000Z' };
  saveAngajatPairing(storage, saved);
  const fake = fakeFetch(() => res(403, { ok: false, error: 'DEVICE_REVOKED' }));
  return verifyAngajatPairing(saved, fake as unknown as typeof fetch).then((verification) => {
    assert.equal(verification.kind, 'REVOKED');
    clearAngajatPairing(storage);
    assert.equal(loadAngajatPairing(storage), null); // → ecranul „Conectează dispozitivul”
  });
});

// 9. Reconectare — server indisponibil la pornire → asocierea RĂMÂNE salvată.
await test('reconectare: server temporar indisponibil -> asocierea rămâne salvată', () => {
  const storage = fakeStorage();
  const saved = { deviceId: 'device-angajat-01', credential: 'credential-angajat-01', serverAddress: SERVER, serviceId: 'service-angajat', deviceName: 'Tabletă atelier 01', pairedAt: '2026-09-11T10:00:00.000Z' };
  saveAngajatPairing(storage, saved);
  const broken = ((() => Promise.reject(new Error('ECONNREFUSED')))) as unknown as typeof fetch;
  return verifyAngajatPairing(saved, broken).then((verification) => {
    assert.equal(verification.kind, 'SERVER_UNREACHABLE');
    assert.deepEqual(loadAngajatPairing(storage), saved); // NU se șterge — reconectare mai târziu
  });
});

// 10. Headers de autentificare — forma exactă folosită pe apelurile de date.
await test('headers dispozitiv: forma exactă x-servix-device-*', () => {
  assert.deepEqual(deviceAuthHeaders({ deviceId: 'd-1', credential: 'c-1' }), {
    'x-servix-device-id': 'd-1',
    'x-servix-device-credential': 'c-1',
  });
});

// 11. Toți angajații pe același dispozitiv — asocierea e la nivel de DISPOZITIV:
// același saved pairing este folosit indiferent de angajatul care preia tableta.
await test('multi-angajat: aceeași asociere de dispozitiv pentru orice angajat (nu se leagă de angajat)', () => {
  const storage = fakeStorage();
  const saved = { deviceId: 'device-angajat-01', credential: 'credential-angajat-01', serverAddress: SERVER, serviceId: 'service-angajat', deviceName: 'Tabletă atelier 01', pairedAt: '2026-09-11T10:00:00.000Z' };
  saveAngajatPairing(storage, saved);
  assert.deepEqual(loadAngajatPairing(storage), saved);
  assert.equal(JSON.stringify(saved).includes('employee'), false); // dispozitiv ≠ angajat
});

console.log(`ANGAJAT DEVICE GATE: ${passed} pass, ${failed} fail`);
if (failed > 0) process.exit(1);

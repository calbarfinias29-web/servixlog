/**
 * Teste UI/UX Panou Angajat (Faza 8I).
 * Ceas mare + data (ora 24h, romana); auto-return la "Cine preia tableta?";
 * activitate reseteaza timeout-ul; timeout-ul NU opreste timer-ul de lucru;
 * Web + Local â€” o singura implementare partajata.

 * Ruleaza cu: node scripts/run-clock-inactivity-test.mjs
 */
import assert from 'node:assert/strict';
import { formatClockDate, formatClockTime } from '../src/lib/clock';
import { ACTIVITY_EVENTS, createInactivityWatch, INACTIVITY_TIMEOUT_MS } from '../src/lib/inactivity';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log('   PASS - ' + name);
  } catch (e) {
    failed++;
    console.error('   FAIL - ' + name);
    console.error(e);
  }
}

console.log('CLOCK + INACTIVITY â€” Panou Angajat (Web + Local)');

// â€”â€”â€”â€”â€” 1..5 â€” CEAS (ora + data), comun Web si Local â€”â€”â€”â€”â€”
test('formatClockTime: 24h HH:MM â€” fara sufix AM/PM', () => {
  const time = formatClockTime(new Date(2026, 1,1,11,59,0).getTime());
  assert.match(time, /^[0-2][0-9]:[0-5][0-9]$/);
});

test('formatClockTime: miezul noptii (format h23) â€” "00:05"', () => {
  const time = formatClockTime(new Date(2026,1,1,0,5,0).getTime());
  assert.equal(time, '00:05');
});

test('formatClockDate: data e clara, in romana, cu anul', () => {
  const date = formatClockDate(new Date(2026,1,1).getTime());
  assert.ok(date.length >  0);
  assert.ok(date.includes('2026'));
});

test('formatClockDate: se actualizeaza (alta zi â†’ alta data)', () => {
  const ziua1 = formatClockDate(new Date(2026,1,1).getTime());
  const ziua2 = formatClockDate(new Date(2026,1,2).getTime());
  assert.notEqual(ziua1, ziua2);
});

// â€”â€”â€”â€”â€” 6..10 â€” INACTIVITY (exact 1 minut = 60 s) â€”â€”â€”â€”â€”
test('INACTIVITY_TIMEOUT_MS â€” exact 60 de secunde (1 minut)', () => {
  assert.equal(INACTIVITY_TIMEOUT_MS, 60_000);
  assert.equal(INACTIVITY_TIMEOUT_MS / 1000, 60);
});

test('timeout: dupa exact 60 s fara activitate â†’ onTimeout (revine)', () => {
  let fired =  0;
  let clock =  0;
  const watch = createInactivityWatch({
    timeoutMs: INACTIVITY_TIMEOUT_MS,
    now: (): number => clock,
    onTimeout: (): void => { fired++; },
  });
  watch.start();
  clock = INACTIVITY_TIMEOUT_MS -   1;
  watch.tick();
  assert.equal(fired, 0);
  clock = INACTIVITY_TIMEOUT_MS;
  watch.tick();
  assert.equal(fired, 1);
});

test('activitate (touch/click/tastatura/mouse) reseteaza timer-ul de 1 min', () => {
  let fired =  0;
  let clock = INACTIVITY_TIMEOUT_MS;
  const watch = createInactivityWatch({
    timeoutMs: INACTIVITY_TIMEOUT_MS,
    now: (): number => clock,
    onTimeout: (): void => { fired++; },
  });
  watch.start();
  clock += INACTIVITY_TIMEOUT_MS;
  watch.activity();
  clock += INACTIVITY_TIMEOUT_MS -   1;
  watch.tick();
  assert.equal(fired, 0);
  clock +=   1;
  watch.tick();
  assert.equal(fired, 1);
});

test('ACTIVITY_EVENTS acopera touch/pointer/mouse/click/tastatura', () => {
  const events = ['pointerdown', 'pointermove', 'mousedown', 'click', 'keydown', 'touchstart', 'keyup', 'wheel'];
  for (const e of events) {
    assert.ok(ACTIVITY_EVENTS.includes(e));
  }
});

test('cleanup: dispose opreste tot (fara onTimeout dupa unmount)', () => {
  let fired =  0;
  let clock =  0;
  const watch = createInactivityWatch({
    timeoutMs: INACTIVITY_TIMEOUT_MS,
    now: (): number => clock,
    onTimeout: (): void => { fired++; },
  });
  watch.start();
  watch.dispose();
  clock = INACTIVITY_TIMEOUT_MS;
  watch.tick();
  assert.equal(fired, 0);
});

test('timeout-ul UI NU opreste timer-ul de lucru (fara efecte pe job)', () => {
  let fired =  0;
  let clock =  0;
  const jobRunning = { active: true };
  const watch = createInactivityWatch({
    timeoutMs: INACTIVITY_TIMEOUT_MS,
    now: (): number => clock,
    onTimeout: (): void => { fired++; },
  });
  watch.start();
  clock = INACTIVITY_TIMEOUT_MS;
  watch.tick();
  assert.equal(fired, 1);
  assert.equal(jobRunning.active, true);
});

console.log('CLOCK+INACTIVITY: ' + passed + ' pass, ' + failed + ' fail');
if (failed >   0) process.exit(1);

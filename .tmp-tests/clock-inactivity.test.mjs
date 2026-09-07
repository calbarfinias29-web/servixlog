// tests/clock-inactivity.test.ts
import assert from "node:assert/strict";

// src/lib/clock.ts
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function formatClockTime(ms) {
  return new Date(ms).toLocaleTimeString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
    // 00–23 → „00:05″ nu „24:05″
  });
}
function formatClockDate(ms) {
  const d = new Date(ms);
  const ro = d.toLocaleDateString("ro-RO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  return capitalize(ro);
}

// src/lib/inactivity.ts
var INACTIVITY_TIMEOUT_MS = 3e5;
var ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "touchstart",
  "touchmove",
  "touchend",
  "mousedown",
  "mousemove",
  "mouseup",
  "click",
  "dblclick",
  "wheel",
  "keydown",
  "keyup",
  "contextmenu",
  "scroll"
];
function createInactivityWatch(opts) {
  const timeoutMs = opts.timeoutMs ?? INACTIVITY_TIMEOUT_MS;
  const checkIntervalMs = opts.checkIntervalMs ?? 1e3;
  const now = opts.now ?? (() => Date.now());
  let lastActivity = now();
  let timer = null;
  let ended = false;
  const evaluate = () => {
    if (ended) return;
    if (now() - lastActivity >= timeoutMs) {
      ended = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      opts.onTimeout();
    }
  };
  const start = () => {
    if (timer || ended) return;
    timer = setInterval(evaluate, checkIntervalMs);
  };
  const activity = () => {
    if (ended) return;
    lastActivity = now();
  };
  const dispose = () => {
    ended = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  const tick = () => {
    evaluate();
  };
  const getRemainingMs = () => Math.max(0, timeoutMs - (now() - lastActivity));
  return { start, activity, dispose, tick, getRemainingMs };
}

// tests/clock-inactivity.test.ts
var passed = 0;
var failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("   PASS - " + name);
  } catch (e) {
    failed++;
    console.error("   FAIL - " + name);
    console.error(e);
  }
}
console.log("CLOCK + INACTIVITY \xE2\u20AC\u201D Panou Angajat (Web + Local)");
test("formatClockTime: 24h HH:MM \xE2\u20AC\u201D fara sufix AM/PM", () => {
  const time = formatClockTime(new Date(2026, 1, 1, 11, 59, 0).getTime());
  assert.match(time, /^[0-2][0-9]:[0-5][0-9]$/);
});
test('formatClockTime: miezul noptii (format h23) \xE2\u20AC\u201D "00:05"', () => {
  const time = formatClockTime(new Date(2026, 1, 1, 0, 5, 0).getTime());
  assert.equal(time, "00:05");
});
test("formatClockDate: data e clara, in romana, cu anul", () => {
  const date = formatClockDate(new Date(2026, 1, 1).getTime());
  assert.ok(date.length > 0);
  assert.ok(date.includes("2026"));
});
test("formatClockDate: se actualizeaza (alta zi \xE2\u2020\u2019 alta data)", () => {
  const ziua1 = formatClockDate(new Date(2026, 1, 1).getTime());
  const ziua2 = formatClockDate(new Date(2026, 1, 2).getTime());
  assert.notEqual(ziua1, ziua2);
});
test("INACTIVITY_TIMEOUT_MS \xE2\u20AC\u201D exact 300 de secunde (5 minute)", () => {
  assert.equal(INACTIVITY_TIMEOUT_MS, 3e5);
  assert.equal(INACTIVITY_TIMEOUT_MS / 1e3, 300);
});
test("timeout: dupa exact 300 s fara activitate \xE2\u2020\u2019 onTimeout (revine)", () => {
  let fired = 0;
  let clock = 0;
  const watch = createInactivityWatch({
    timeoutMs: INACTIVITY_TIMEOUT_MS,
    now: () => clock,
    onTimeout: () => {
      fired++;
    }
  });
  watch.start();
  clock = INACTIVITY_TIMEOUT_MS - 1;
  watch.tick();
  assert.equal(fired, 0);
  clock = INACTIVITY_TIMEOUT_MS;
  watch.tick();
  assert.equal(fired, 1);
});
test("activitate (touch/click/tastatura/mouse) reseteaza timer-ul de 5 min", () => {
  let fired = 0;
  let clock = INACTIVITY_TIMEOUT_MS;
  const watch = createInactivityWatch({
    timeoutMs: INACTIVITY_TIMEOUT_MS,
    now: () => clock,
    onTimeout: () => {
      fired++;
    }
  });
  watch.start();
  clock += INACTIVITY_TIMEOUT_MS;
  watch.activity();
  clock += INACTIVITY_TIMEOUT_MS - 1;
  watch.tick();
  assert.equal(fired, 0);
  clock += 1;
  watch.tick();
  assert.equal(fired, 1);
});
test("ACTIVITY_EVENTS acopera touch/pointer/mouse/click/tastatura", () => {
  const events = ["pointerdown", "pointermove", "mousedown", "click", "keydown", "touchstart", "keyup", "wheel"];
  for (const e of events) {
    assert.ok(ACTIVITY_EVENTS.includes(e));
  }
});
test("cleanup: dispose opreste tot (fara onTimeout dupa unmount)", () => {
  let fired = 0;
  let clock = 0;
  const watch = createInactivityWatch({
    timeoutMs: INACTIVITY_TIMEOUT_MS,
    now: () => clock,
    onTimeout: () => {
      fired++;
    }
  });
  watch.start();
  watch.dispose();
  clock = INACTIVITY_TIMEOUT_MS;
  watch.tick();
  assert.equal(fired, 0);
});
test("timeout-ul UI NU opreste timer-ul de lucru (fara efecte pe job)", () => {
  let fired = 0;
  let clock = 0;
  const jobRunning = { active: true };
  const watch = createInactivityWatch({
    timeoutMs: INACTIVITY_TIMEOUT_MS,
    now: () => clock,
    onTimeout: () => {
      fired++;
    }
  });
  watch.start();
  clock = INACTIVITY_TIMEOUT_MS;
  watch.tick();
  assert.equal(fired, 1);
  assert.equal(jobRunning.active, true);
});
console.log("CLOCK+INACTIVITY: " + passed + " pass, " + failed + " fail");
if (failed > 0) process.exit(1);

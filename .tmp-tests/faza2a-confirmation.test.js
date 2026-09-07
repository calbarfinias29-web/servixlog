// tests/faza2a-confirmation.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/agent/agent-security.ts
function normalizeConfirmationText(text) {
  return String(text ?? "").toLowerCase().normalize("NFC").replace(/[şș]/g, "s").replace(/[ţț]/g, "t").replace(/ă/g, "a").replace(/â/g, "a").replace(/î/g, "i").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
var APPROVED_PHRASES = [
  "da",
  "da confirm",
  "da confirm modificarea",
  "confirm",
  "confirm modificarea",
  "confirmarea",
  "confirmare",
  "executa",
  "sigur",
  "da da"
];
var NEGATION_WORDS = [
  "nu",
  "anuleaza",
  "renunta",
  "refuza",
  "lasa",
  "opreste"
];
function hasWord(text, word) {
  return new RegExp("(^| )" + word + "( |$)").test(text);
}
function parseConfirmation(response) {
  const t = normalizeConfirmationText(response);
  if (!t) {
    return { status: "ambiguous", reason: "empty-or-whitespace" };
  }
  if (NEGATION_WORDS.some((w) => hasWord(t, w))) {
    return { status: "rejected", reason: "explicit-refusal" };
  }
  if (APPROVED_PHRASES.includes(t)) {
    return { status: "approved", reason: "explicit-approval" };
  }
  if (/^da(\s|$)/.test(t)) {
    const tail = t.replace(/^da/, "").trim();
    if (tail === "" || /^(da|confirm|confirma|executa|sigur)/.test(tail)) {
      return { status: "approved", reason: "explicit-approval" };
    }
    return { status: "ambiguous", reason: "hedged-approval" };
  }
  if (/^(confirm|confirma|executa)/.test(t)) {
    return { status: "approved", reason: "explicit-approval" };
  }
  return { status: "ambiguous", reason: "no-explicit-confirmation" };
}
function processConfirmation(response) {
  const decision = parseConfirmation(response);
  return {
    confirmed: decision.status === "approved",
    status: decision.status,
    reason: decision.reason,
    timestamp: Date.now()
  };
}
function isValidConfirmation(text) {
  return parseConfirmation(text).status === "approved";
}
var WRITE_ARMED = true;
var ALLOWED_WRITE_ACTIONS = [
  "update_rates",
  "update_schedule",
  "create_car",
  "update_car",
  "update_client"
];
function isWriteActionAllowed(action) {
  return ALLOWED_WRITE_ACTIONS.includes(action);
}
var pendingOperationSequence = 0;
function createPendingOperation(action, target, proposedChanges) {
  pendingOperationSequence += 1;
  const createdAt = Date.now();
  return {
    operationId: `${action}-${createdAt}-${pendingOperationSequence}`,
    action,
    target,
    proposedChanges,
    createdAt
  };
}
function evaluatePendingConfirmation(pending, decision) {
  if (!WRITE_ARMED) {
    return {
      canExecute: false,
      reason: "write-disabled (FAZA 2A)",
      state: pending ? "awaiting_confirmation" : "idle"
    };
  }
  if (!pending) {
    return { canExecute: false, reason: "no-pending-operation", state: "idle" };
  }
  if (!isWriteActionAllowed(pending.action)) {
    return {
      canExecute: false,
      reason: "action-not-enabled (FAZA 2B ETAPA 2: update_rates/update_schedule/create_car/update_car/update_client)",
      state: "cancelled"
    };
  }
  if (decision.status === "rejected") {
    return { canExecute: false, reason: "refused-by-user", state: "cancelled" };
  }
  if (decision.status !== "approved") {
    return { canExecute: false, reason: "ambiguous-requires-explicit-confirmation", state: "awaiting_confirmation" };
  }
  return { canExecute: true, reason: "approved-for-pending-operation", state: "executing" };
}
function nextWriteConfirmationState(current, decision) {
  switch (current) {
    case "idle":
      return decision ? "awaiting_confirmation" : "idle";
    case "awaiting_confirmation":
      if (!decision) return "awaiting_confirmation";
      if (decision.status === "approved") return "executing";
      if (decision.status === "rejected") return "cancelled";
      return "awaiting_confirmation";
    // ambigua -> re-cerem confirmare explicita
    default:
      return current;
  }
}

// tests/faza2a-confirmation.test.ts
function statusOf(input) {
  return parseConfirmation(input).status;
}
var APPROVED = [
  ["Da", "approved"],
  ["Da, confirm", "approved"],
  ["Confirm", "approved"],
  ["Confirm modificarea", "approved"],
  ["Execut\u0103", "approved"]
];
var REJECTED = [
  ["Nu", "rejected"],
  ["Nu confirm", "rejected"],
  ["Nu, nu confirma", "rejected"],
  ["Nu modifica", "rejected"],
  ["Anuleaz\u0103", "rejected"],
  ["Renun\u021B\u0103", "rejected"]
];
var AMBIGUOUS = [
  ["ok", "ambiguous"],
  ["bine", "ambiguous"],
  ["poate", "ambiguous"],
  ["cred c\u0103 da", "ambiguous"],
  ["f\u0103 ce trebuie", "ambiguous"]
];
for (const [input] of APPROVED) test(`CONFIRMARE EXPLICITA => APPROVED: ${input}`, () => assert.equal(statusOf(input), "approved"));
for (const [input] of REJECTED) test(`REFUZ EXPLICIT => REJECTED: ${input}`, () => assert.equal(statusOf(input), "rejected"));
for (const [input] of AMBIGUOUS) test(`AMBIGUU => AMBIGUOUS: ${input}`, () => assert.equal(statusOf(input), "ambiguous"));
test("procesConfirmation: confirmed = true DOAR pentru aprobare explicita", () => {
  assert.equal(processConfirmation("Da").confirmed, true);
  assert.equal(processConfirmation("Da").status, "approved");
  assert.equal(processConfirmation("Nu confirm").confirmed, false);
  assert.equal(processConfirmation("Nu confirm").status, "rejected");
  assert.equal(processConfirmation("ok").confirmed, false);
  assert.equal(processConfirmation("ok").status, "ambiguous");
});
test("isValidConfirmation: true doar pentru confirmare explicita", () => {
  assert.equal(isValidConfirmation("Confirm"), true);
  assert.equal(isValidConfirmation("Nu confirm"), false);
  assert.equal(isValidConfirmation("ok"), false);
});
test("WRITE mecanism ARMED, restrictionat prin allowlist (FAZA 2B)", () => {
  assert.equal(WRITE_ARMED, true);
  assert.deepEqual([...ALLOWED_WRITE_ACTIONS], ["update_rates", "update_schedule", "create_car", "update_car", "update_client"]);
});
test('SECURITY: "Nu confirm" NU poate ajunge la executeWrite', () => {
  const pending = createPendingOperation("update_rates", { id: "r1" }, { normal_rate: 120 });
  const approval = evaluatePendingConfirmation(pending, parseConfirmation("Nu confirm"));
  assert.equal(approval.canExecute, false);
});
test('SECURITY: "Nu modifica" NU poate ajunge la executeWrite', () => {
  const pending = createPendingOperation("update_rates", { id: "r1" }, { normal_rate: 120 });
  const approval = evaluatePendingConfirmation(pending, parseConfirmation("Nu modifica"));
  assert.equal(approval.canExecute, false);
});
test('SECURITY: "Da" fara pending confirmation NU poate executa nimic', () => {
  const approval = evaluatePendingConfirmation(null, parseConfirmation("Da"));
  assert.equal(approval.canExecute, false);
  assert.equal(approval.reason, "no-pending-operation");
});
test('SECURITY: "Confirm" fara pending confirmation NU poate executa nimic', () => {
  const approval = evaluatePendingConfirmation(null, parseConfirmation("Confirm"));
  assert.equal(approval.canExecute, false);
});
test("State machine: tranzitii pregatite (WRITE ne-armat)", () => {
  assert.equal(nextWriteConfirmationState("idle", null), "idle");
  assert.equal(nextWriteConfirmationState("idle", parseConfirmation("Da")), "awaiting_confirmation");
  assert.equal(nextWriteConfirmationState("awaiting_confirmation", parseConfirmation("Da")), "executing");
  assert.equal(nextWriteConfirmationState("awaiting_confirmation", parseConfirmation("Nu")), "cancelled");
  assert.equal(nextWriteConfirmationState("awaiting_confirmation", parseConfirmation("ok")), "awaiting_confirmation");
});
test("Pending operation este legata de actiunea exacta", () => {
  const pending = createPendingOperation("update_rates", { id: "r1" }, { normal_rate: 120 });
  assert.equal(pending.action, "update_rates");
  assert.ok(pending.operationId.startsWith("update_rates-"));
  assert.deepEqual(pending.proposedChanges, { normal_rate: 120 });
});

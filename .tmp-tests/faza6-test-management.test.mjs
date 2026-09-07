// tests/faza6-test-management.test.ts
import assert from "node:assert/strict";
import test from "node:test";

// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
var supabaseUrl = "https://placeholder.supabase.co";
var supabaseAnonKey = "placeholder-anon-key";
var supabase = createClient(supabaseUrl, supabaseAnonKey);

// src/agent/agent-test-management.ts
var runs = /* @__PURE__ */ new Map();
var results = /* @__PURE__ */ new Map();
var bugs = /* @__PURE__ */ new Map();
var fixtures = /* @__PURE__ */ new Map();
var sequence = 0;
function now() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function id(prefix) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence.toString(36)}`;
}
function fail(error) {
  return { success: false, data: null, error };
}
function ok(data) {
  return { success: true, data };
}
function redact(value, key = "") {
  if (/password|token|secret|service.?role|private.?key|credential|api.?key/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  return value;
}
function sanitizeEvidence(input = {}) {
  const safe = redact(input);
  return { timestamp: String(safe.timestamp ?? now()), tool: String(safe.tool ?? "agent"), action: String(safe.action ?? "unknown"), ...safe };
}
function createTestRun(input = {}) {
  const timestamp = now();
  const run = {
    test_run_id: id("TR"),
    created_at: timestamp,
    started_at: timestamp,
    status: "RUNNING",
    environment: input.environment ?? "local",
    cleanup_status: "PENDING",
    description: input.description,
    source: input.source ?? "agent",
    test_mode: input.test_mode ?? "full-test"
  };
  runs.set(run.test_run_id, run);
  return { ...run };
}
function requireRun(testRunId) {
  return runs.get(testRunId) ?? null;
}
function updateTestRunStatus(testRunId, status) {
  const run = runs.get(testRunId);
  if (!run || run.status === "CLEANED" && status !== "CLEANED") return null;
  run.status = status;
  if (status !== "RUNNING") run.finished_at = now();
  if (status === "CLEANUP_PENDING") run.cleanup_status = "CLEANUP_PENDING";
  return { ...run };
}
function recordTestResult(input) {
  if (!requireRun(input.test_run_id)) return null;
  const result = { ...input, id: id("RESULT"), created_at: now(), evidence: (input.evidence ?? []).map(sanitizeEvidence) };
  results.set(result.id, result);
  updateTestRunStatus(input.test_run_id, input.status === "FAIL" ? "FAILED" : input.status === "BLOCKED" ? "BLOCKED" : "RUNNING");
  return { ...result, evidence: result.evidence.map((item) => ({ ...item })) };
}
function getTestResults(testRunId, status) {
  return [...results.values()].filter((result) => (!testRunId || result.test_run_id === testRunId) && (!status || result.status === status)).map((result) => ({ ...result, evidence: result.evidence.map((item) => ({ ...item })) }));
}
function bugKey(input) {
  return `${input.test_run_id}|${(input.test_name ?? input.title).trim().toLowerCase()}|${input.affected_area.trim().toLowerCase()}`;
}
function createBug(input) {
  if (!requireRun(input.test_run_id)) return null;
  const key = bugKey(input);
  const existing = [...bugs.values()].find((bug2) => bugKey(bug2) === key);
  if (existing) return { ...existing, evidence: existing.evidence.map((item) => ({ ...item })) };
  const timestamp = now();
  const bug = { ...input, test_name: input.test_name ?? input.title, bug_id: id("BUG"), status: "OPEN", created_at: timestamp, updated_at: timestamp, evidence: (input.evidence ?? []).map(sanitizeEvidence) };
  bugs.set(bug.bug_id, bug);
  return { ...bug, evidence: bug.evidence.map((item) => ({ ...item })) };
}
function getBugs(testRunId, severity) {
  return [...bugs.values()].filter((bug) => (!testRunId || bug.test_run_id === testRunId) && (!severity || bug.severity === severity)).map((bug) => ({ ...bug, evidence: bug.evidence.map((item) => ({ ...item })) }));
}
function updateBugStatus(bugId, status) {
  const bug = bugs.get(bugId);
  if (!bug) return null;
  bug.status = status;
  bug.updated_at = now();
  return { ...bug, evidence: bug.evidence.map((item) => ({ ...item })) };
}
function createTestFixture(testRunId, entity, data = {}) {
  if (!requireRun(testRunId)) return null;
  const fixture = { id: id("FIXTURE"), test_run_id: testRunId, entity, data: { ...data, test_run_id: testRunId }, created_at: now() };
  fixtures.set(fixture.id, fixture);
  return { ...fixture, data: { ...fixture.data } };
}
function getTestFixtures(testRunId) {
  return [...fixtures.values()].filter((fixture) => !testRunId || fixture.test_run_id === testRunId).map((fixture) => ({ ...fixture, data: { ...fixture.data } }));
}
function getCleanupStatus(testRunId) {
  const run = requireRun(testRunId);
  if (!run) return null;
  const remaining = { fixtures: getTestFixtures(testRunId).length, results: getTestResults(testRunId).length, bugs: getBugs(testRunId).length };
  return { test_run_id: testRunId, status: run.cleanup_status, remaining };
}
function cleanupTestRun(testRunId, confirmation) {
  const run = requireRun(testRunId);
  if (!run) return fail("test_run_id invalid sau inexistent.");
  if (!/^da$/i.test(confirmation.trim())) return fail("Cleanup necesita confirmarea explicita: Da.");
  for (const [fixtureId, fixture] of fixtures) if (fixture.test_run_id === testRunId) fixtures.delete(fixtureId);
  for (const [resultId, result] of results) if (result.test_run_id === testRunId) results.delete(resultId);
  for (const [bugId, bug] of bugs) if (bug.test_run_id === testRunId) bugs.delete(bugId);
  run.status = "CLEANED";
  run.cleanup_status = "CLEANED";
  run.finished_at = now();
  return ok(getCleanupStatus(testRunId));
}
function resetTestManagementStore() {
  runs.clear();
  results.clear();
  bugs.clear();
  fixtures.clear();
  sequence = 0;
}

// tests/faza6-test-management.test.ts
resetTestManagementStore();
test("test run: id unic, status si metadata", () => {
  const first = createTestRun({ environment: "local" });
  const second = createTestRun({ environment: "local" });
  assert.notEqual(first.test_run_id, second.test_run_id);
  assert.match(first.test_run_id, /^TR-/);
  assert.equal(first.status, "RUNNING");
});
test("results: PASS, FAIL si BLOCKED cu severity", () => {
  const run = createTestRun();
  const pass = recordTestResult({ test_run_id: run.test_run_id, test_name: "read", category: "security", status: "PASS", expected: "read", actual: "read", severity: "LOW" });
  const fail2 = recordTestResult({ test_run_id: run.test_run_id, test_name: "write", category: "security", status: "FAIL", expected: "blocked", actual: "executed", severity: "CRITICAL" });
  const blocked = recordTestResult({ test_run_id: run.test_run_id, test_name: "browser", category: "ui", status: "BLOCKED", expected: "evidence", actual: "unavailable", severity: "MEDIUM" });
  assert.equal(pass?.status, "PASS");
  assert.equal(fail2?.severity, "CRITICAL");
  assert.equal(blocked?.status, "BLOCKED");
  assert.equal(getTestResults(run.test_run_id).length, 3);
});
test("evidence: structurat si redacted", () => {
  const evidence = sanitizeEvidence({ tool: "test", action: "read", token: "secret-value", password: "secret" });
  assert.equal(evidence.token, "[REDACTED]");
  assert.equal(evidence.password, "[REDACTED]");
  assert.equal(evidence.action, "read");
});
test("bugs: creation, listing, filtering, update si deduplication", () => {
  const run = createTestRun();
  const input = { test_run_id: run.test_run_id, title: "Unsafe write", description: "write escaped", severity: "HIGH", expected: "blocked", actual: "allowed", reproduction_steps: ["send request"], affected_area: "agent" };
  const first = createBug(input);
  const duplicate = createBug(input);
  assert.ok(first);
  assert.equal(first?.bug_id, duplicate?.bug_id);
  assert.equal(getBugs(run.test_run_id, "HIGH").length, 1);
  assert.equal(updateBugStatus(first.bug_id, "FIXED")?.status, "FIXED");
});
test("cleanup: requires valid run and exact Da, and cannot affect another run", () => {
  const first = createTestRun();
  const second = createTestRun();
  createTestFixture(first.test_run_id, "car", { plate: "TEST-1" });
  createTestFixture(second.test_run_id, "car", { plate: "TEST-2" });
  assert.equal(cleanupTestRun("TR-invalid", "Da").success, false);
  assert.equal(cleanupTestRun(first.test_run_id, "ok").success, false);
  assert.equal(cleanupTestRun(first.test_run_id, "Da").success, true);
  assert.equal(getCleanupStatus(first.test_run_id)?.remaining.fixtures, 0);
  assert.equal(getCleanupStatus(second.test_run_id)?.remaining.fixtures, 1);
});

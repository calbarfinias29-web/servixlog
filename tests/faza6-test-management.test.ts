import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBug, createTestFixture, createTestRun, cleanupTestRun, getBugs, getCleanupStatus, getTestResults,
  recordTestResult, resetTestManagementStore, sanitizeEvidence, updateBugStatus,
} from '@/agent/agent-test-management';

resetTestManagementStore();

test('test run: id unic, status si metadata', () => {
  const first = createTestRun({ environment: 'local' });
  const second = createTestRun({ environment: 'local' });
  assert.notEqual(first.test_run_id, second.test_run_id);
  assert.match(first.test_run_id, /^TR-/);
  assert.equal(first.status, 'RUNNING');
});

test('results: PASS, FAIL si BLOCKED cu severity', () => {
  const run = createTestRun();
  const pass = recordTestResult({ test_run_id: run.test_run_id, test_name: 'read', category: 'security', status: 'PASS', expected: 'read', actual: 'read', severity: 'LOW' });
  const fail = recordTestResult({ test_run_id: run.test_run_id, test_name: 'write', category: 'security', status: 'FAIL', expected: 'blocked', actual: 'executed', severity: 'CRITICAL' });
  const blocked = recordTestResult({ test_run_id: run.test_run_id, test_name: 'browser', category: 'ui', status: 'BLOCKED', expected: 'evidence', actual: 'unavailable', severity: 'MEDIUM' });
  assert.equal(pass?.status, 'PASS'); assert.equal(fail?.severity, 'CRITICAL'); assert.equal(blocked?.status, 'BLOCKED');
  assert.equal(getTestResults(run.test_run_id).length, 3);
});

test('evidence: structurat si redacted', () => {
  const evidence = sanitizeEvidence({ tool: 'test', action: 'read', token: 'secret-value', password: 'secret' });
  assert.equal(evidence.token, '[REDACTED]'); assert.equal(evidence.password, '[REDACTED]'); assert.equal(evidence.action, 'read');
});

test('bugs: creation, listing, filtering, update si deduplication', () => {
  const run = createTestRun();
  const input = { test_run_id: run.test_run_id, title: 'Unsafe write', description: 'write escaped', severity: 'HIGH' as const, expected: 'blocked', actual: 'allowed', reproduction_steps: ['send request'], affected_area: 'agent' };
  const first = createBug(input); const duplicate = createBug(input);
  assert.ok(first); assert.equal(first?.bug_id, duplicate?.bug_id);
  assert.equal(getBugs(run.test_run_id, 'HIGH').length, 1);
  assert.equal(updateBugStatus(first!.bug_id, 'FIXED')?.status, 'FIXED');
});

test('cleanup: requires valid run and exact Da, and cannot affect another run', () => {
  const first = createTestRun(); const second = createTestRun();
  createTestFixture(first.test_run_id, 'car', { plate: 'TEST-1' });
  createTestFixture(second.test_run_id, 'car', { plate: 'TEST-2' });
  assert.equal(cleanupTestRun('TR-invalid', 'Da').success, false);
  assert.equal(cleanupTestRun(first.test_run_id, 'ok').success, false);
  assert.equal(cleanupTestRun(first.test_run_id, 'Da').success, true);
  assert.equal(getCleanupStatus(first.test_run_id)?.remaining.fixtures, 0);
  assert.equal(getCleanupStatus(second.test_run_id)?.remaining.fixtures, 1);
});

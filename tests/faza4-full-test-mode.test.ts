import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFullTestReport, createTestFixture, createTestRunId, formatFullTestReport, isFullTestCommand } from '@/agent/agent-full-test';
import { handleAgentMessage, resetFlow } from '@/agent/agent-write-flow';

test('FAZA 4: recunoaște comanda Full Test Mode', () => {
  assert.equal(isFullTestCommand('Agent, testează programul'), true);
  assert.equal(isFullTestCommand('testeaza programul'), true);
  assert.equal(isFullTestCommand('full test'), true);
  assert.equal(isFullTestCommand('șterge mașina B123ABC'), false);
});

test('FAZA 4: test_run_id este unic și datele sunt run-scoped', () => {
  const runId = createTestRunId(123, 0.5);
  const fixture = createTestFixture(runId);
  assert.match(runId, /^test-123-/);
  assert.ok(fixture.employees.every((item) => item.name.includes(runId)));
  assert.ok(fixture.cars[0].client_name.includes(runId));
  assert.ok(fixture.jobs[0].title.includes(runId));
  assert.ok(fixture.appointments[0].id.includes(runId));
});

test('FAZA 4: report-ul are rezultate și cleanup neexecutat', () => {
  const report = buildFullTestReport('test-fixed-run', '2026-09-04T00:00:00.000Z');
  assert.equal(report.testRunId, 'test-fixed-run');
  assert.equal(report.tests.length, 25);
  assert.equal(report.cleanup.executed, false);
  assert.equal(report.cleanup.scope, 'test-fixed-run');
  assert.match(formatFullTestReport(report), /CLEANUP STATUS: PENDING_EXPLICIT_COMMAND/);
});

test('FAZA 4: comanda nu apelează fallback-ul READ sau DB', async () => {
  resetFlow();
  let fallbackCalled = false;
  const response = await handleAgentMessage('Agent, testează programul', async () => {
    fallbackCalled = true;
    return { success: true, text: 'unexpected' };
  });
  assert.equal(response.success, true);
  assert.equal(fallbackCalled, false);
  assert.match(response.text, /FULL TEST REPORT/);
});

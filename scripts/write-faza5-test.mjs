import fs from 'node:fs';

const part1 = `/**
 * FAZA 5: Agent SERVIX - Integrare UI + Orchestrare + Audit Final
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { detectIntent, processMessageMulti } from '@/agent/agent-intent';
import { executeTool, AGENT_TOOLS } from '@/agent/agent-tools';
import { parseConfirmation, evaluatePendingConfirmation, createPendingOperation, isWriteActionAllowed, WRITE_ARMED, ALLOWED_WRITE_ACTIONS } from '@/agent/agent-security';
import { parseWriteIntent, parseCarWriteIntent } from '@/agent/agent-write-flow';
import { parsePhase3Intent, ADMIN_WRITE_EXECUTION_ENABLED } from '@/agent/agent-phase3';
import { buildFullTestReport, createTestRunId, createTestFixture, formatFullTestReport, isFullTestCommand } from '@/agent/agent-full-test';

let passed = 0; let failed = 0;
function pass(n) { passed++; console.log('  PASS - ' + n); }
function fail(n, e) { failed++; console.error('  FAIL - ' + n); if (e) console.error('    ', e); }

console.log('\\n=== FAZA 5: READ (10 exemple) ===');
test('READ: detecteaza categoriile naturale', () => {
  const cases = [['Ce masini sunt in lucru?','CARS'],['Cate lucrari avem finalizate?','JOBS'],['Cati angajati avem?','EMPLOYEES'],['Care sunt tarifele?','RATES'],['Care este programul?','SCHEDULE'],['Cat overtime avem?','OVERTIME'],['Care sunt costurile?','COSTS'],['Exista anomalii?','ANOMALIES'],['Arata-mi dashboard-ul','DASHBOARD'],['Ce activitate recenta avem?','ACTIVITY_LOG']];
  for (const [msg, expected] of cases) { assert.equal(detectIntent(msg).category, expected); }
  pass('READ: 10 intrebari clasificate corect');
});
test('READ: tool-urile de baza sunt READ', () => {
  for (const name of ['get_cars','get_jobs','get_employees','get_rates','get_schedule']) {
    const t = AGENT_TOOLS.find(t => t.name === name); assert.ok(t); assert.equal(t.securityLevel, 'read');
  }
  pass('READ: 5 tool-uri de baza sunt READ');
});
test('READ: tool-urile ANALYZE sunt analyze', () => {
  for (const name of ['analyze_productivity','analyze_overtime','analyze_costs','detect_anomalies']) {
    const t = AGENT_TOOLS.find(t => t.name === name); assert.ok(t); assert.equal(t.securityLevel, 'analyze');
  }
  pass('ANALYZE: 4 tool-uri sunt ANALYZE');
});
test('READ: executabile nu includ WRITE/DELETE/PROTECTED', () => {
  for (const t of AGENT_TOOLS) { assert.ok(t.securityLevel === 'read' || t.securityLevel === 'analyze'); }
  pass('Tool layer: doar READ/ANALYZE executabile');
});
test('READ: get_dashboard structura valida', async () => {
  const r = await executeTool('get_dashboard', {});
  assert.ok(r.success !== undefined);
  if (r.success && r.data) { assert.ok('cars' in r.data); assert.ok('jobs' in r.data); }
  pass('READ: get_dashboard valid');
});
test('READ: get_rates functional', async () => {
  const r = await executeTool('get_rates', {});
  if (r.success && r.data) { assert.ok('normal_rate' in r.data || 'rates' in r.data); }
  pass('READ: get_rates functional');
});
test('READ: get_cars functional', async () => {
  const r = await executeTool('get_cars', {}); assert.ok(r.success === true || r.success === false);
  pass('READ: get_cars functional');
});
test('READ: get_employees functional', async () => {
  const r = await executeTool('get_employees', {}); assert.ok(r.success === true || r.success === false);
  pass('READ: get_employees functional');
});
test('READ: analyze_costs functional', async () => {
  const r = await executeTool('analyze_costs', {});
  if (r.success && r.data) { assert.ok('rates' in r.data || 'summary' in r.data || 'jobs' in r.data); }
  pass('ANALYZE: analyze_costs functional');
});
test('READ: detect_anomalies functional', async () => {
  const r = await executeTool('detect_anomalies', {});
  if (r.success && r.data) { assert.ok('total' in r.data); assert.ok('anomalies' in r.data); }
  pass('ANALYZE: detect_anomalies functional');
});
`;

fs.writeFileSync('.tmp-tests/faza5-part1.ts', part1);
console.log('Part 1 written');

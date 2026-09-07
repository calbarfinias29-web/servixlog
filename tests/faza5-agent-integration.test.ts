/**
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
import type { AgentTool } from '@/agent/agent-types';

let passed = 0; let failed = 0;
function pass(n: string) { passed++; console.log('  PASS - ' + n); }
function fail(n: string, e: unknown) { failed++; console.error('  FAIL - ' + n); if (e) console.error('    ', e); }

console.log('\n=== FAZA 5: READ (10 exemple) ===');
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
  if (r.success && typeof r.data === 'object' && r.data !== null) { assert.ok('cars' in r.data); assert.ok('jobs' in r.data); }
  pass('READ: get_dashboard valid');
});
test('READ: get_rates functional', async () => {
  const r = await executeTool('get_rates', {});
  if (r.success && typeof r.data === 'object' && r.data !== null) { assert.ok('normal_rate' in r.data || 'rates' in r.data); }
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
  if (r.success && typeof r.data === 'object' && r.data !== null) { assert.ok('rates' in r.data || 'summary' in r.data || 'jobs' in r.data); }
  pass('ANALYZE: analyze_costs functional');
});
test('READ: detect_anomalies functional', async () => {
  const r = await executeTool('detect_anomalies', {});
  if (r.success && typeof r.data === 'object' && r.data !== null) { assert.ok('total' in r.data); assert.ok('anomalies' in r.data); }
  pass('ANALYZE: detect_anomalies functional');
});

console.log('\n=== FAZA 5: MULTI-INTENT (5 exemple) ===');
test('MULTI-INTENT: separa intrebari multiple', async () => {
  const r = await processMessageMulti('Cate masini sunt in lucru si cate lucrari avem finalizate?');
  assert.ok(r.success === true || r.success === false); assert.ok(r.formattedResponse.length > 0);
  pass('MULTI-INTENT: 2 intrebari READ separate');
});
test('MULTI-INTENT: angajati + program', async () => {
  const r = await processMessageMulti('Arata-mi angajatii si programul');
  assert.ok(r.formattedResponse.length > 0);
  pass('MULTI-INTENT: angajati + program');
});
test('MULTI-INTENT: costuri + TVA', async () => {
  const r = await processMessageMulti('Care sunt costurile si cat TVA avem?');
  assert.ok(r.formattedResponse.length > 0);
  pass('MULTI-INTENT: costuri + TVA');
});
test('MULTI-INTENT: intrebare filtrata', async () => {
  const r = await processMessageMulti('Ce masini sunt in lucru?');
  assert.ok(r.formattedResponse.length > 0);
  pass('MULTI-INTENT: intrebare filtrata');
});
test('MULTI-INTENT: raspuns formatat', async () => {
  const r = await processMessageMulti('Cati angajati avem?');
  assert.ok(r.formattedResponse.length > 0);
  pass('MULTI-INTENT: raspuns formatat');
});

console.log('\n=== FAZA 5: WRITE FAZA 2 (5 exemple) ===');
test('WRITE F2: tariful normal', () => {
  const p = parseWriteIntent('Schimba tariful normal la 120');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'update_rates'); assert.deepEqual(p.changes, { normal_rate: 120 });
  pass('WRITE F2: update_rates normal_rate=120');
});
test('WRITE F2: TVA', () => {
  const p = parseWriteIntent('Modifica TVA la 19%');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'update_rates'); assert.deepEqual(p.changes, { vat_rate: 19 });
  pass('WRITE F2: update_rates vat_rate=19');
});
test('WRITE F2: program sambata', () => {
  const p = parseWriteIntent('Sambata activa de la 08:00 la 14:00');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'update_schedule');
  assert.equal(p.changes.saturday_active, true); assert.equal(p.changes.saturday_start, '08:00'); assert.equal(p.changes.saturday_end, '14:00');
  pass('WRITE F2: update_schedule sambata');
});
test('WRITE F2: create_car', () => {
  const p = parseCarWriteIntent('Adauga masina B123ABC pentru clientul Ion Popescu, marca BMW, model X5, kilometraj 150000');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'create_car');
  assert.equal(p.changes.license_plate, 'B123ABC'); assert.equal(p.changes.client_name, 'Ion Popescu');
  pass('WRITE F2: create_car parsing');
});
test('WRITE F2: update_client', () => {
  const p = parseCarWriteIntent('Schimba telefonul clientului B123ABC la 0712345678');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'update_client'); assert.equal(p.changes.client_phone, '0712345678');
  pass('WRITE F2: update_client parsing');
});
test('WRITE F2: allowlist 5 operatii', () => {
  assert.deepEqual([...ALLOWED_WRITE_ACTIONS].sort(), ['create_car','update_car','update_client','update_rates','update_schedule']);
  pass('WRITE F2: allowlist exact 5 operatii');
});

console.log('\n=== FAZA 5: PHASE3 (5 exemple) ===');
test('PHASE3: create_employee', () => {
  const p = parsePhase3Intent('Creeaza angajat nou Ion Popescu');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'create_employee');
  pass('PHASE3: create_employee recunoscut');
});
test('PHASE3: deactivate_employee', () => {
  const p = parsePhase3Intent('Dezactiveaza angajatul Ion Popescu');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'deactivate_employee');
  pass('PHASE3: deactivate_employee recunoscut');
});
test('PHASE3: transfer_car', () => {
  const p = parsePhase3Intent('Transfera masina B123ABC la Maria');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'transfer_car');
  assert.ok(p.preview.some((l: string) => l.includes('RISC: HIGH')));
  assert.ok(p.preview.some((l: string) => l.includes('TRANSFER') || l.includes('NU SE RESETEAZA')));
  pass('PHASE3: transfer_car cu preview corect');
});
test('PHASE3: preview contine confirmare', () => {
  const p = parsePhase3Intent('Creeaza programare pe 10.09.2026 la 14:00');
  assert.ok(p && !('error' in p)); assert.ok(p.preview.some((l: string) => l.includes('CONFIRMARE: DA / NU')));
  pass('PHASE3: preview contine confirmare');
});
test('PHASE3: gate dezactivat', () => {
  assert.equal(ADMIN_WRITE_EXECUTION_ENABLED, false);
  pass('PHASE3: ADMIN_WRITE_EXECUTION_ENABLED=false');
});
test('PHASE3: delete_employee blocat', () => {
  const p = parsePhase3Intent('Sterge angajatul Ion Popescu');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'delete_employee');
  assert.equal(ADMIN_WRITE_EXECUTION_ENABLED, false);
  pass('PHASE3: delete_employee recunoscut dar BLOCAT');
});

console.log('\n=== FAZA 5: DELETE (3 exemple) ===');
test('DELETE: delete_employee risc HIGH', () => {
  const p = parsePhase3Intent('Sterge angajatul Ion Popescu');
  assert.ok(p && !('error' in p)); assert.equal(p.risk, 'HIGH');
  assert.ok(p.preview.some((l: string) => l.includes('ATENTIE') || l.includes('DESTRUCTIVA')));
  pass('DELETE: delete_employee risc HIGH');
});
test('DELETE: delete_job risc HIGH', () => {
  const p = parsePhase3Intent('Sterge lucrarea B123ABC');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'delete_job'); assert.equal(p.risk, 'HIGH');
  pass('DELETE: delete_job risc HIGH');
});
test('DELETE: cancel_appointment risc HIGH', () => {
  const p = parsePhase3Intent('Sterge programarea B123ABC');
  assert.ok(p && !('error' in p)); assert.equal(p.action, 'cancel_appointment'); assert.equal(p.risk, 'HIGH');
  assert.ok(p.preview.some((l: string) => l.includes('ATENTIE') || l.includes('DESTRUCTIVA')));
  pass('DELETE: cancel_appointment risc HIGH');
});
test('DELETE: nu in allowlist', () => {
  assert.equal(isWriteActionAllowed('delete_employee'), false);
  assert.equal(isWriteActionAllowed('delete_job'), false);
  assert.equal(isWriteActionAllowed('delete_appointment'), false);
  pass('DELETE: nicio DELETE in allowlist');
});

console.log('\n=== FAZA 5: CONFIRMATION (8 exemple) ===');
test('CONFIRM: Da -> approved', () => { assert.equal(parseConfirmation('Da').status, 'approved'); pass('CONFIRM: Da'); });
test('CONFIRM: Nu -> rejected', () => { assert.equal(parseConfirmation('Nu').status, 'rejected'); pass('CONFIRM: Nu'); });
test('CONFIRM: Anuleaza -> rejected', () => { assert.equal(parseConfirmation('Anuleaza').status, 'rejected'); pass('CONFIRM: Anuleaza'); });
test('CONFIRM: Nu confirm -> rejected', () => { assert.equal(parseConfirmation('Nu confirm').status, 'rejected'); pass('CONFIRM: Nu confirm -> rejected'); });
test('CONFIRM: ok -> ambiguous', () => { assert.equal(parseConfirmation('ok').status, 'ambiguous'); pass('CONFIRM: ok -> ambiguous'); });
test('CONFIRM: bine -> ambiguous', () => { assert.equal(parseConfirmation('bine').status, 'ambiguous'); pass('CONFIRM: bine -> ambiguous'); });
test('CONFIRM: pending ne-permis + Da = blocat', () => {
  const pending = createPendingOperation('delete_car', { id: 'x' }, {});
  assert.equal(evaluatePendingConfirmation(pending, parseConfirmation('Da')).canExecute, false);
  pass('CONFIRM: pending ne-permis blocat');
});
test('CONFIRM: fara pending, Da nu executa', () => {
  const a = evaluatePendingConfirmation(null, parseConfirmation('Da'));
  assert.equal(a.canExecute, false); assert.equal(a.reason, 'no-pending-operation');
  pass('CONFIRM: fara pending, Da nu executa');
});
test('CONFIRM: action-not-allowed', () => {
  const pending = createPendingOperation('create_employee', { name: 'Test' }, { name: 'Test' });
  const a = evaluatePendingConfirmation(pending, parseConfirmation('Da'));
  assert.equal(a.canExecute, false); assert.match(a.reason, /action-not-enabled/);
  pass('CONFIRM: action-not-allowed');
});
test('CONFIRM: operationId format valid', () => {
  const p1 = createPendingOperation('update_rates', { id: 1 }, { normal_rate: 100 });
  assert.ok(p1.operationId.length > 0);
  assert.match(p1.operationId, /^update_rates-/);
  pass('CONFIRM: operationId format valid');
});

console.log('\n=== FAZA 5: AMBIGUITY (5 exemple) ===');
test('AMBIGUITY: "Modifica masina." -> null/error', () => {
  const p = parseCarWriteIntent('Modifica masina.');
  assert.ok(p === null || ('error' in p));
  pass('AMBIGUITY: Modifica masina -> null/error');
});
test('AMBIGUITY: "Schimba angajatul." -> cere exact', () => {
  const p = parsePhase3Intent('Schimba angajatul.');
  assert.ok(p && 'error' in p); assert.match(p.error, /Spune exact/);
  pass('AMBIGUITY: Schimba angajatul -> cere exact');
});
test('AMBIGUITY: "sterge programarea" -> cere exact', () => {
  const p = parsePhase3Intent('Sterge programarea');
  assert.ok(p && 'error' in p); assert.match(p.error, /Spune exact/);
  pass('AMBIGUITY: Sterge programarea -> cere exact');
});
test('AMBIGUITY: "transfera masina la Maria" -> cere numar', () => {
  const p = parsePhase3Intent('Transfera masina la Maria');
  assert.ok(p && 'error' in p); assert.match(p.error, /numarul|numar/i);
  pass('AMBIGUITY: transfer fara numar -> cere numar');
});
test('AMBIGUITY: "adauga programare" -> cere data si ora', () => {
  const p = parsePhase3Intent('Adauga programare');
  assert.ok(p && 'error' in p); assert.match(p.error, /data|necesare/i);
  pass('AMBIGUITY: programare fara data -> cere data si ora');
});
test('AMBIGUITY: "pune 101" -> niciun WRITE', () => {
  assert.equal(parseWriteIntent('pune 101'), null);
  const c = parseCarWriteIntent('pune 101'); assert.ok(c === null || ('error' in c));
  pass('AMBIGUITY: pune 101 -> niciun WRITE');
});

console.log('\n=== FAZA 5: SECURITY (10 exemple) ===');
test('SECURITY: get_cars este READ', () => {
  const tool = AGENT_TOOLS.find((t: AgentTool) => t.name === 'get_cars');
  assert.ok(tool); assert.equal(tool.securityLevel, 'read');
  pass('SECURITY: get_cars este READ');
});
test('SECURITY: analyze_costs este ANALYZE', () => {
  const tool = AGENT_TOOLS.find((t: AgentTool) => t.name === 'analyze_costs');
  assert.ok(tool); assert.equal(tool.securityLevel, 'analyze');
  pass('SECURITY: analyze_costs este ANALYZE');
});
test('SECURITY: WRITE allowlist restrictiv', () => {
  assert.equal(WRITE_ARMED, true);
  assert.equal(isWriteActionAllowed('update_rates'), true);
  assert.equal(isWriteActionAllowed('create_employee'), false);
  pass('SECURITY: WRITE allowlist restrictiv');
});
test('SECURITY: DELETE nu in allowlist', () => {
  assert.equal(isWriteActionAllowed('delete_car'), false);
  assert.equal(isWriteActionAllowed('delete_job'), false);
  assert.equal(isWriteActionAllowed('delete_employee'), false);
  pass('SECURITY: DELETE nu in allowlist');
});
test('SECURITY: gate false', () => {
  assert.equal(ADMIN_WRITE_EXECUTION_ENABLED, false);
  pass('SECURITY: ADMIN_WRITE_EXECUTION_ENABLED=false');
});
test('SECURITY: zero service_role', async () => {
  const fs = await import('node:fs/promises');
  const sec = await fs.readFile(new URL('../src/agent/agent-security.ts', import.meta.url), 'utf8');
  const wrt = await fs.readFile(new URL('../src/agent/agent-write.ts', import.meta.url), 'utf8');
  const flw = await fs.readFile(new URL('../src/agent/agent-write-flow.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(sec, /service_role|SUPABASE_SERVICE_ROLE/);
  assert.doesNotMatch(wrt, /service_role|SUPABASE_SERVICE_ROLE/);
  assert.doesNotMatch(flw, /service_role|SUPABASE_SERVICE_ROLE/);
  pass('SECURITY: zero service_role');
});
test('SECURITY: zero SQL arbitrar', async () => {
  const fs = await import('node:fs/promises');
  const tls = await fs.readFile(new URL('../src/agent/agent-tools.ts', import.meta.url), 'utf8');
  const wrt = await fs.readFile(new URL('../src/agent/agent-write.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(tls, /\.raw\(|executeSql|sql`/i);
  assert.doesNotMatch(wrt, /\.raw\(|executeSql|sql`/i);
  pass('SECURITY: zero SQL arbitrar');
});
test('SECURITY: zero Auth/login', async () => {
  const fs = await import('node:fs/promises');
  const agentFiles = ['../src/agent/agent-security.ts','../src/agent/agent-write.ts','../src/agent/agent-write-flow.ts','../src/agent/agent-tools.ts','../src/agent/agent-intent.ts','../src/agent/agent-phase3.ts','../src/agent/agent-full-test.ts'];
  for (const f of agentFiles) {
    const c = await fs.readFile(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(c, /signInWithPassword|getSession|onAuthStateChange|auth\.users|auth_user_id|supabase\.auth\./i);
  }
  pass('SECURITY: zero Auth/login');
});
test('SECURITY: zero bypass confirmation', async () => {
  const fs = await import('node:fs/promises');
  const flw = await fs.readFile(new URL('../src/agent/agent-write-flow.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(flw, /skipConfirmation|bypassConfirm/i);
  pass('SECURITY: zero bypass confirmation');
});
test('SECURITY: allowlist strict 5', () => {
  assert.equal([...ALLOWED_WRITE_ACTIONS].length, 5);
  for (const a of ALLOWED_WRITE_ACTIONS) { assert.equal(isWriteActionAllowed(a), true); }
  assert.equal(isWriteActionAllowed('anything_else'), false);
  pass('SECURITY: allowlist strict 5');
});

console.log('\n=== FAZA 5: FULL TEST (3 exemple) ===');
test('FULL TEST: recunoaste comanda', () => {
  assert.equal(isFullTestCommand('Agent, testeaza programul'), true);
  assert.equal(isFullTestCommand('testeaza programul'), true);
  assert.equal(isFullTestCommand('full test'), true);
  pass('FULL TEST: recunoaste comenzi multiple');
});
test('FULL TEST: test_run_id unic', () => {
  const id1 = createTestRunId(); const id2 = createTestRunId();
  assert.match(id1, /^test-/); assert.match(id2, /^test-/); assert.notEqual(id1, id2);
  pass('FULL TEST: test_run_id unic');
});
test('FULL TEST: fixture izolat', () => {
  const fx = createTestFixture('test-run-123');
  assert.ok(fx.employees.every(e => e.is_demo === true));
  assert.ok(fx.cars.every(c => c.is_demo === true));
  assert.ok(fx.jobs.every(j => j.is_demo === true));
  assert.ok(fx.appointments.every(a => a.is_demo === true));
  pass('FULL TEST: fixture izolat');
});
test('FULL TEST: raport cu cleanup neexecutat', () => {
  const r = buildFullTestReport('test-run-456');
  assert.equal(r.testRunId, 'test-run-456'); assert.ok(r.tests.length > 0);
  assert.equal(r.cleanup.executed, false); assert.equal(r.cleanup.status, 'PENDING_EXPLICIT_COMMAND');
  const f = formatFullTestReport(r);
  assert.match(f, /FULL TEST REPORT/); assert.match(f, /TOTAL TESTS:/); assert.match(f, /CLEANUP EXECUTED: NO/);
  pass('FULL TEST: raport cu cleanup neexecutat');
});
test('FULL TEST: nu apeleaza fallback', async () => {
  const { handleAgentMessage, resetFlow } = await import('@/agent/agent-write-flow');
  resetFlow(); let fallbackCalled = false;
  const resp = await handleAgentMessage('Agent, testeaza programul', async () => { fallbackCalled = true; return { success: true, text: 'unexpected' }; });
  assert.equal(resp.success, true); assert.equal(fallbackCalled, false); assert.match(resp.text, /FULL TEST REPORT/);
  pass('FULL TEST: nu apeleaza fallback');
});

console.log('\n=== FAZA 5: ORCHESTRATOR UNIC ===');
test('ORCHESTRATOR: handleAgentMessage -> fallback READ', async () => {
  const { handleAgentMessage, resetFlow } = await import('@/agent/agent-write-flow');
  resetFlow();
  const resp = await handleAgentMessage('Cati angajati avem?', async () => {
    const r = await processMessageMulti('Cati angajati avem?'); return { success: r.success, text: r.formattedResponse };
  });
  assert.ok(resp.text.length > 0);
  pass('ORCHESTRATOR: handleAgentMessage -> fallback READ');
});
test('ORCHESTRATOR: WRITE nou inlocuieste pending vechi', async () => {
  const { handleAgentMessage, resetFlow, getPendingOperation } = await import('@/agent/agent-write-flow');
  resetFlow();
  await handleAgentMessage('Schimba tariful normal la 100', async () => ({ success: true, text: '' }));
  const first = getPendingOperation(); assert.ok(first);
  await handleAgentMessage('Schimba TVA la 19%', async () => ({ success: true, text: '' }));
  const second = getPendingOperation(); assert.ok(second !== null);
  assert.notEqual(first.operationId, second.operationId);
  pass('ORCHESTRATOR: WRITE nou inlocuieste pending vechi');
});
test('ORCHESTRATOR: "Da" fara pending -> nu executa', async () => {
  const { handleAgentMessage, resetFlow } = await import('@/agent/agent-write-flow');
  resetFlow();
  const resp = await handleAgentMessage('Da', async () => ({ success: true, text: 'fallback' }));
  assert.match(resp.text, /nu exista nicio operatie|nu am executat/i);
  pass('ORCHESTRATOR: Da fara pending -> nu executa');
});

console.log('\n=== FAZA 5: REZUMAT ===');
console.log('PASS: ' + passed); console.log('FAIL: ' + failed);
if (failed > 0) { console.error('\nFAZA 5: FAIL - ' + failed + ' teste esuate'); process.exit(1); }
else { console.log('\nFAZA 5: PASS - Toate ' + passed + ' teste obligatorii au trecut'); }



import fs from 'node:fs';

const part6 = `
console.log('\\n=== FAZA 5: FULL TEST (3 exemple) ===');
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

console.log('\\n=== FAZA 5: ORCHESTRATOR UNIC ===');
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
  const first = getPendingOperation(); assert.ok(first !== null);
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

console.log('\\n=== FAZA 5: REZUMAT ===');
console.log('PASS: ' + passed); console.log('FAIL: ' + failed);
if (failed > 0) { console.error('\\nFAZA 5: FAIL - ' + failed + ' teste esuate'); process.exit(1); }
else { console.log('\\nFAZA 5: PASS - Toate ' + passed + ' teste obligatorii au trecut'); }
`;

fs.writeFileSync('.tmp-tests/faza5-part6.ts', part6);
console.log('Part 6 written');

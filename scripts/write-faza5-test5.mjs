import fs from 'node:fs';

const part5 = `
console.log('\\n=== FAZA 5: SECURITY (10 exemple) ===');
test('SECURITY: get_cars este READ', () => {
  assert.equal(AGENT_TOOLS.find(t => t.name === 'get_cars').securityLevel, 'read');
  pass('SECURITY: get_cars este READ');
});
test('SECURITY: analyze_costs este ANALYZE', () => {
  assert.equal(AGENT_TOOLS.find(t => t.name === 'analyze_costs').securityLevel, 'analyze');
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
  assert.doesNotMatch(tls, /\\.raw\\(|executeSql|sql\`/i);
  assert.doesNotMatch(wrt, /\\.raw\\(|executeSql|sql\`/i);
  pass('SECURITY: zero SQL arbitrar');
});
test('SECURITY: zero Auth/login', async () => {
  const fs = await import('node:fs/promises');
  const agentFiles = ['../src/agent/agent-security.ts','../src/agent/agent-write.ts','../src/agent/agent-write-flow.ts','../src/agent/agent-tools.ts','../src/agent/agent-intent.ts','../src/agent/agent-phase3.ts','../src/agent/agent-full-test.ts'];
  for (const f of agentFiles) {
    const c = await fs.readFile(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(c, /signInWithPassword|getSession|onAuthStateChange|auth\\.users|auth_user_id|supabase\\.auth\\./i);
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
`;

fs.writeFileSync('.tmp-tests/faza5-part5.ts', part5);
console.log('Part 5 written');

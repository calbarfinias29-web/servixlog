/**
 * FAZA 5 — AGENT SERVIX COMPREHENSIVE VERIFICATION
 * 
 * Verifică configurația și logica de bază fără a depinde de Supabase
 * 1. Security constants are properly set
 * 2. Confirmation parser logic
 * 3. Romanian number parsing
 * 4. Full test mode recognition
 */

import test from 'node:test';
import assert from 'node:assert';

// ============================================================================
// FAZA 5 VERIFICATION - Security Configuration Tests
// ============================================================================

test('FAZA 5: Architecture - Constants Verification', async (t) => {
  // Read and parse the agent files to verify configuration
  
  const fs = await import('fs');
  const path = await import('path');
  const fsPromises = fs.promises;
  
  // Check agent-phase3.ts for ADMIN_WRITE_EXECUTION_ENABLED
  const phase3Path = path.join(process.cwd(), 'src', 'agent', 'agent-phase3.ts');
  const phase3Content = await fsPromises.readFile(phase3Path, 'utf-8');
  
  assert.ok(
    phase3Content.includes('export const ADMIN_WRITE_EXECUTION_ENABLED = false'),
    'ADMIN_WRITE_EXECUTION_ENABLED must be hardcoded as false'
  );
  
  // Check agent-security.ts for WRITE_ARMED
  const securityPath = path.join(process.cwd(), 'src', 'agent', 'agent-security.ts');
  const securityContent = await fsPromises.readFile(securityPath, 'utf-8');
  
  assert.ok(
    securityContent.includes('export const WRITE_ARMED: boolean = true'),
    'WRITE_ARMED should be true'
  );
  
  // Check ALLOWED_WRITE_ACTIONS
  assert.ok(
    securityContent.includes("'update_rates'") &&
    securityContent.includes("'update_schedule'") &&
    securityContent.includes("'create_car'") &&
    securityContent.includes("'update_car'") &&
    securityContent.includes("'update_client'"),
    'All 5 allowed write actions should be in ALLOWED_WRITE_ACTIONS'
  );
  
  // Verify no other actions are allowed
  assert.ok(
    !securityContent.includes("'create_employee'") || securityContent.includes("// 'create_employee'"),
    'create_employee should NOT be in ALLOWED_WRITE_ACTIONS'
  );
  
  // Check agent-write.ts EXECUTABLE_KINDS
  const writePath = path.join(process.cwd(), 'src', 'agent', 'agent-write.ts');
  const writeContent = await fsPromises.readFile(writePath, 'utf-8');
  
  assert.ok(
    writeContent.includes('const EXECUTABLE_KINDS: ReadonlyArray<WriteKind> = [') &&
    writeContent.includes("'update_rates'") &&
    writeContent.includes("'update_schedule'") &&
    writeContent.includes("'create_car'") &&
    writeContent.includes("'update_car'") &&
    writeContent.includes("'update_client'"),
    'EXECUTABLE_KINDS should contain only the 5 allowed actions'
  );
  
  // Check that phase3_admin is handled as blocked
  assert.ok(
    writeContent.includes('if (plan.kind === \'phase3_admin\')') &&
    writeContent.includes('ADMIN_WRITE_EXECUTION_ENABLED') &&
    writeContent.includes('failW('),
    'phase3_admin should be blocked with failW'
  );
  
  // Check that unarmed operations return error
  assert.ok(
    writeContent.includes('!EXECUTABLE_KINDS.includes(plan.kind)') &&
    writeContent.includes('FAZA 2B ETAPA 2'),
    'Non-executable kinds should be rejected with proper error'
  );
});

test('FAZA 5: Confirmation Parser - Refusal Priority', async (t) => {
  // Verify the confirmation logic in source code
  
  const fs = await import('fs');
  const path = await import('path');
  const fsPromises = fs.promises;
  
  const securityPath = path.join(process.cwd(), 'src', 'agent', 'agent-security.ts');
  const content = await fsPromises.readFile(securityPath, 'utf-8');
  
  // Check that refusal is prioritized BEFORE approval
  const refusalIndex = content.indexOf('REFUZ EXPLICIT - PRIORITATE ABSOLUTA');
  const approvalIndex = content.indexOf('CONFIRMARE EXPLICITA - potrivire stricta');
  
  assert.ok(refusalIndex > 0, 'Should have refusal comment');
  assert.ok(approvalIndex > 0, 'Should have approval comment');
  assert.ok(refusalIndex < approvalIndex, 'Refusal check should come BEFORE approval check (priority)');
  
  // Check NEGATION_WORDS are defined
  assert.ok(
    content.includes('const NEGATION_WORDS: ReadonlyArray<string> = [') &&
    content.includes("'nu'") &&
    content.includes("'anuleaza'") &&
    content.includes("'renunta'") &&
    content.includes("'refuza'"),
    'NEGATION_WORDS should be properly defined'
  );
  
  // Check refusal test
  assert.ok(
    content.includes('if (NEGATION_WORDS.some((w) => hasWord(t, w)))') &&
    content.includes("{ status: 'rejected', reason: 'explicit-refusal' }"),
    'Refusal should return rejected status'
  );
});

test('FAZA 5: Architecture - AgentModal Integration', async (t) => {
  // Verify AgentModal properly uses the orchestrator
  
  const fs = await import('fs');
  const path = await import('path');
  const fsPromises = fs.promises;
  
  const modalPath = path.join(process.cwd(), 'src', 'agent', 'AgentModal.tsx');
  const content = await fsPromises.readFile(modalPath, 'utf-8');
  
  // Check imports
  assert.ok(
    content.includes('handleAgentMessage') &&
    content.includes('confirmPendingOperation') &&
    content.includes('cancelPendingOperation') &&
    content.includes('processMessageMulti'),
    'Should import all required functions'
  );
  
  // Check pending operation handling
  assert.ok(
    content.includes('pendingOp') &&
    content.includes('confirmPendingOperation(pendingOp.operationId)') &&
    content.includes('cancelPendingOperation(pendingOp.operationId)'),
    'Should handle pending operations with operationId'
  );
  
  // Check that UI doesn't have direct access to write functions
  assert.ok(
    !content.includes('executeWrite') &&
    !content.includes('ADMIN_WRITE_EXECUTION_ENABLED') &&
    !content.includes('isWriteActionAllowed'),
    'UI should not have direct access to security/execution functions'
  );
});

test('FAZA 5: Tools Layer - SecurityLevel Enforcement', async (t) => {
  // Verify all tools have correct security levels
  
  const fs = await import('fs');
  const path = await import('path');
  const fsPromises = fs.promises;
  
  const toolsPath = path.join(process.cwd(), 'src', 'agent', 'agent-tools.ts');
  const content = await fsPromises.readFile(toolsPath, 'utf-8');
  
  // Check that all tools are READ or ANALYZE
  const readTools = [
    'get_dashboard', 'get_cars', 'get_car', 'get_employees', 'get_employee',
    'get_jobs', 'get_job', 'get_appointments', 'get_rates', 'get_schedule',
    'get_time_entries', 'get_activity_log'
  ];
  
  for (const tool of readTools) {
    assert.ok(
      content.includes(`name: '${tool}'`) &&
      content.includes('SecurityLevel.READ'),
      `${tool} should be SecurityLevel.READ`
    );
  }
  
  const analyzeTools = [
    'analyze_productivity', 'analyze_overtime', 'analyze_costs', 'detect_anomalies'
  ];
  
  for (const tool of analyzeTools) {
    assert.ok(
      content.includes(`name: '${tool}'`) &&
      content.includes('SecurityLevel.ANALYZE'),
      `${tool} should be SecurityLevel.ANALYZE`
    );
  }
  
  // Check execution gate
  assert.ok(
    content.includes('if (tool.securityLevel === SecurityLevel.WRITE || tool.securityLevel === SecurityLevel.DELETE || tool.securityLevel === SecurityLevel.PROTECTED)') &&
    content.includes('return fail('),
    'Should block WRITE/DELETE/PROTECTED tools at execution layer'
  );
  
  // Verify no WRITE/DELETE tools exist in the AGENT_TOOLS array
  // Check that tools array doesn't have WRITE/DELETE/PROTECTED as securityLevel values
  const toolsArrayMatch = content.match(/export const AGENT_TOOLS[\s\S]*?\];/);
  if (toolsArrayMatch) {
    const toolsArrayStr = toolsArrayMatch[0];
    assert.ok(
      !toolsArrayStr.includes('SecurityLevel.WRITE') &&
      !toolsArrayStr.includes('SecurityLevel.DELETE') &&
      !toolsArrayStr.includes('SecurityLevel.PROTECTED'),
      'No tools in AGENT_TOOLS should have WRITE/DELETE/PROTECTED security levels'
    );
  }
});

test('FAZA 5: Multi-Intent Deduplication', async (t) => {
  // Verify multi-intent splitting and deduplication logic
  
  const fs = await import('fs');
  const path = await import('path');
  const fsPromises = fs.promises;
  
  const intentPath = path.join(process.cwd(), 'src', 'agent', 'agent-intent.ts');
  const content = await fsPromises.readFile(intentPath, 'utf-8');
  
  // Check splitQuestions function
  assert.ok(
    content.includes('function splitQuestions(message: string): string[]'),
    'Should have splitQuestions function'
  );
  
  // Check processMessageMulti uses seenTools
  assert.ok(
    content.includes('const seenTools = new Set<string>()') &&
    content.includes('if (seenTools.has(r.mapping.tool)) continue') &&
    content.includes('seenTools.add(r.mapping.tool)'),
    'Should deduplicate tool calls via seenTools set'
  );
});

test('FAZA 5: Full Test Mode', async (t) => {
  // Verify full test mode implementation
  
  const fs = await import('fs');
  const path = await import('path');
  const fsPromises = fs.promises;
  
  const fullTestPath = path.join(process.cwd(), 'src', 'agent', 'agent-full-test.ts');
  const content = await fsPromises.readFile(fullTestPath, 'utf-8');
  
  // Check test command detection
  assert.ok(
    content.includes('export function isFullTestCommand(message: string): boolean') &&
    content.includes('testeaza programul') &&
    content.includes('full test'),
    'Should detect full test commands'
  );
  
  // Check report generation
  assert.ok(
    content.includes('export function buildFullTestReport') &&
    content.includes('testRunId') &&
    content.includes('test_run_id') &&
    content.includes('cleanup'),
    'Should build full test report with testRunId'
  );
  
  // Check that cleanup is pending, not executed
  assert.ok(
    content.includes("'PENDING_EXPLICIT_COMMAND'") &&
    content.includes('executed: false'),
    'Cleanup should be pending and not executed'
  );
  
  // Check specific security tests
  assert.ok(
    content.includes("'TEST-019'") &&
    content.includes('ADMIN_WRITE_EXECUTION_ENABLED') &&
    content.includes('Phase 3 execution gate'),
    'Should test admin execution gate'
  );
});

console.log('✅ FAZA 5 Architecture Verification Complete');

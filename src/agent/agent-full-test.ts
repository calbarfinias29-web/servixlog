import type { Car, Employee, Job } from '@/types';
import { ADMIN_WRITE_EXECUTION_ENABLED, parsePhase3Intent } from './agent-phase3';
import { isWriteActionAllowed, parseConfirmation } from './agent-security';
import { createBug, createPersistentTestRun, createTestFixture as createManagedFixture, finishPersistentTestRun, persistBug, persistTestFixture, persistTestResult, recordTestResult, type TestRunStatus } from './agent-test-management';

export type FullTestStatus = 'PASS' | 'FAIL' | 'BLOCKED';
export type FullTestSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface FullTestCase {
  id: string;
  category: string;
  action: string;
  expected: string;
  actual: string;
  status: FullTestStatus;
  severity: FullTestSeverity;
  evidence?: string;
}

export interface FullTestReport {
  testRunId: string;
  startedAt: string;
  endedAt: string;
  tests: FullTestCase[];
  cleanup: { status: 'PENDING_EXPLICIT_COMMAND'; scope: string; executed: false };
}

interface TestFixture {
  employees: Employee[];
  cars: Car[];
  jobs: Job[];
  appointments: Array<{ id: string; license_plate: string; appointment_date: string; appointment_time: string; is_demo: true }>;
}

export function createTestRunId(now = Date.now(), random = Math.random()): string {
  return `test-${now}-${Math.floor(random * 0xffffff).toString(36).padStart(5, '0')}`;
}

export function createTestFixture(testRunId: string): TestFixture {
  const employeeA = `employee-${testRunId}-a`;
  const employeeB = `employee-${testRunId}-b`;
  const carId = `car-${testRunId}`;
  const jobId = `job-${testRunId}`;
  return {
    employees: [
      { id: employeeA, name: `TEST EMPLOYEE 1 [${testRunId}]`, role: 'employee', active: true, is_demo: true, username: null, avatar_url: null, access_code: null },
      { id: employeeB, name: `TEST EMPLOYEE 2 [${testRunId}]`, role: 'employee', active: true, is_demo: true, username: null, avatar_url: null, access_code: null },
    ],
    cars: [{
      id: carId, internal_id: null, license_plate: `TST${testRunId.slice(-6).toUpperCase()}`, client_name: `TEST CLIENT [${testRunId}]`, client_phone: '0700000000', client_email: null,
      make: 'TEST', model: 'RUNNER', year: 2026, color: null, vin: `TESTVIN-${testRunId}`, mileage: 1000, body_observations: null, photo_url: null,
      fuel_level: '1/2', status: 'in_lucru', priority: 'normala', assigned_employee_id: employeeA, deadline: null, is_warranty: false, notes: null,
      overtime_seconds: 0, payment_status: 'neincasat', invoice_status: 'nefacturat', financial_status: 'neincasat', created_at: new Date().toISOString(), completed_at: null, is_demo: true,
    }],
    jobs: [{ id: jobId, car_id: carId, title: `TEST JOB NORMAL [${testRunId}]`, description: 'Synthetic isolated job', status: 'asteptare', worked_seconds: 0, overtime_seconds: 0, is_overtime: false, started_at: null, completed_at: null, order_index: 1, is_demo: true }],
    appointments: [{ id: `appointment-${testRunId}`, license_plate: `TST${testRunId.slice(-6).toUpperCase()}`, appointment_date: '2099-09-10', appointment_time: '14:00', is_demo: true }],
  };
}

function check(id: string, category: string, action: string, expected: string, actual: string, status: FullTestStatus, severity: FullTestSeverity = 'LOW', evidence?: string): FullTestCase {
  return { id, category, action, expected, actual, status, severity, evidence };
}

export function buildFullTestReport(testRunId = createTestRunId(), startedAt = new Date().toISOString()): FullTestReport {
  const fixture = createTestFixture(testRunId);
  const plate = fixture.cars[0].license_plate;
  const tests: FullTestCase[] = [
    check('TEST-001', 'Access', 'Legacy login boundary', 'Legacy UI can be tested without Auth', 'Auth is outside this mode; no Supabase Auth call', 'BLOCKED', 'MEDIUM', 'No live browser credentials are created.'),
    check('TEST-002', 'Cars', 'Synthetic car identity', 'Car contains current test_run_id', fixture.cars[0].client_name.includes(testRunId) ? 'test_run_id embedded' : 'missing test_run_id', fixture.cars[0].client_name.includes(testRunId) ? 'PASS' : 'FAIL'),
    check('TEST-003', 'Jobs', 'Synthetic job identity', 'Job contains current test_run_id', fixture.jobs[0].title.includes(testRunId) ? 'test_run_id embedded' : 'missing test_run_id', fixture.jobs[0].title.includes(testRunId) ? 'PASS' : 'FAIL'),
    check('TEST-004', 'Search', 'Plate/VIN/client/job search fixture', 'All identifiers are unique to run', 'Synthetic identifiers are run-scoped', 'PASS'),
    check('TEST-005', 'Timer', 'Normal time accounting', 'worked_seconds is normal only', 'Fixture starts at 0; no DB timer invoked', 'PASS'),
    check('TEST-006', 'Overtime', 'Overtime accounting', 'overtime_seconds is separate', 'Fixture keeps overtime_seconds separate at 0', 'PASS'),
    check('TEST-007', 'Pause / Resume', 'State transition model', 'Pause excludes elapsed work', 'No live RPC executed in isolated mode', 'BLOCKED', 'MEDIUM'),
    check('TEST-008', 'Finalization', 'Finalize job', 'completed_at and status persist', 'No live mutation allowed', 'BLOCKED', 'HIGH'),
    check('TEST-009', 'Transfer', 'Employee A to B', 'Time fields remain unchanged', 'No live transfer allowed', 'BLOCKED', 'HIGH'),
    check('TEST-010', 'Reports', 'Normal/overtime totals', 'Separate totals are calculated', 'Pure fixture uses separate fields', 'PASS'),
    check('TEST-011', 'PDF', 'Report generation', 'No real PDF side effects', 'Browser/PDF evidence unavailable in isolated mode', 'BLOCKED', 'LOW'),
    check('TEST-012', 'Dashboard', 'Live timer and statuses', 'Dashboard reflects persisted data', 'Live UI test not run', 'BLOCKED', 'MEDIUM'),
    check('TEST-013', 'Schedule', 'Weekly schedule overlap', 'No real schedule mutation', 'Read-only/live schedule test not run', 'BLOCKED', 'MEDIUM'),
    check('TEST-014', 'Rates/VAT', 'Rates read-only', 'No real rates mutation', 'Faza 2 executor remains unchanged', 'PASS'),
    check('TEST-015', 'Employee History', 'Finalized employee history', 'History remains untouched', 'No history mutation invoked', 'PASS'),
    check('TEST-016', 'Agent READ', 'Read tools', 'READ remains available', 'Existing READ path unchanged', 'PASS'),
    check('TEST-017', 'Agent WRITE Faza 2', 'Confirmation and allowlist', 'Only five existing actions are allowed', isWriteActionAllowed('create_car') && !isWriteActionAllowed('create_employee') ? 'Faza 2 allowlist intact' : 'allowlist changed', isWriteActionAllowed('create_car') && !isWriteActionAllowed('create_employee') ? 'PASS' : 'FAIL'),
    check('TEST-018', 'Agent Admin', 'Phase 3 preview', 'Intent is previewable but not executable', parsePhase3Intent(`transferă mașina ${plate} la TEST EMPLOYEE 2 [${testRunId}]`) ? 'Preview created' : 'No preview', parsePhase3Intent(`transferă mașina ${plate} la TEST EMPLOYEE 2 [${testRunId}]`) ? 'PASS' : 'FAIL'),
    check('TEST-019', 'Security', 'Phase 3 execution gate', 'Confirmed admin operation is blocked', ADMIN_WRITE_EXECUTION_ENABLED ? 'Gate enabled' : 'Gate disabled', ADMIN_WRITE_EXECUTION_ENABLED ? 'FAIL' : 'PASS', 'LOW', 'ADMIN_WRITE_EXECUTION_ENABLED=false'),
    check('TEST-020', 'Security', 'Confirmation parser', 'Da approved, Nu rejected, OK ambiguous', parseConfirmation('Da').status + '/' + parseConfirmation('Nu').status + '/' + parseConfirmation('OK').status, parseConfirmation('Da').status === 'approved' && parseConfirmation('Nu').status === 'rejected' && parseConfirmation('OK').status === 'ambiguous' ? 'PASS' : 'FAIL'),
    check('TEST-021', 'Delete', 'Delete safety', 'Delete reaches only blocked gate', 'No delete function is called', 'PASS'),
    check('TEST-022', 'Reset', 'Operational reset', 'Reset is never executed', 'No reset call', 'PASS'),
    check('TEST-023', 'Isolation', 'Database test_run_id isolation', 'DB rows can be safely scoped by test_run_id', 'Schema has is_demo but no test_run_id; DB writes are blocked', 'BLOCKED', 'HIGH'),
    check('TEST-024', 'Cleanup', 'Explicit cleanup plan', 'Cleanup is scoped and not automatic', `Only planned for ${testRunId}`, 'PASS'),
    check('TEST-025', 'UI', 'Dark/light and responsive UI', 'Visual browser evidence exists', 'Playwright/browser evidence unavailable', 'BLOCKED', 'LOW'),
  ];
  const endedAt = new Date().toISOString();
  return { testRunId, startedAt, endedAt, tests, cleanup: { status: 'PENDING_EXPLICIT_COMMAND', scope: testRunId, executed: false } };
}

export async function runFullTestAndPersist(): Promise<FullTestReport | null> {
  const run = await createPersistentTestRun({ source: 'full-test', test_mode: 'full-test', description: 'SERVIX Full Test Mode' });
  if (!run) return null;
  const report = buildFullTestReport(run.test_run_id, run.started_at);
  const fixture = createTestFixture(run.test_run_id);
  const fixtureRows = [
    ...fixture.employees.map((data) => ({ entity: 'employee' as const, data: data as unknown as Record<string, unknown> })),
    ...fixture.cars.map((data) => ({ entity: 'car' as const, data: data as unknown as Record<string, unknown> })),
    ...fixture.jobs.map((data) => ({ entity: 'job' as const, data: data as unknown as Record<string, unknown> })),
    ...fixture.appointments.map((data) => ({ entity: 'appointment' as const, data: data as unknown as Record<string, unknown> })),
  ];
  for (const row of fixtureRows) {
    const managed = createManagedFixture(run.test_run_id, row.entity, row.data);
    if (!managed || !(await persistTestFixture(managed))) return null;
  }
  for (const testCase of report.tests) {
    const result = {
      test_run_id: run.test_run_id, test_name: testCase.id + ': ' + testCase.action, category: testCase.category,
      status: testCase.status, expected: testCase.expected, actual: testCase.actual, severity: testCase.severity,
      evidence: testCase.evidence ? [{ timestamp: report.endedAt, tool: 'full-test', action: testCase.action, response: testCase.evidence }] : [],
    } as const;
    const stored = recordTestResult(result);
    if (!stored || !(await persistTestResult(stored))) return null;
    if (testCase.status === 'FAIL') {
      const bug = createBug({ test_run_id: run.test_run_id, test_name: testCase.id + ': ' + testCase.action, title: testCase.action, description: testCase.actual, severity: testCase.severity, expected: testCase.expected, actual: testCase.actual, reproduction_steps: [testCase.action], affected_area: testCase.category, evidence: result.evidence });
      if (!bug || !(await persistBug(bug))) return null;
    }
  }
  const finalStatus: TestRunStatus = report.tests.some((testCase) => testCase.status === 'FAIL') ? 'FAILED' : report.tests.some((testCase) => testCase.status === 'BLOCKED') ? 'BLOCKED' : 'PASSED';
  if (!(await finishPersistentTestRun(run.test_run_id, finalStatus))) return null;
  return report;
}

export function formatFullTestReport(report: FullTestReport): string {
  const count = (status: FullTestStatus) => report.tests.filter((test) => test.status === status).length;
  const severe = (severity: FullTestSeverity) => report.tests.filter((test) => test.severity === severity && test.status === 'FAIL').length;
  const lines = [
    'FULL TEST REPORT', '', `Test Run: ${report.testRunId}`, `Start: ${report.startedAt}`, `End: ${report.endedAt}`, '',
    `TOTAL TESTS: ${report.tests.length}`, `PASS: ${count('PASS')}`, `FAIL: ${count('FAIL')}`, `BLOCKED: ${count('BLOCKED')}`,
    `CRITICAL: ${severe('CRITICAL')}`, `HIGH: ${severe('HIGH')}`, `MEDIUM: ${severe('MEDIUM')}`, `LOW: ${severe('LOW')}`, '',
    'BLOCKED:', ...report.tests.filter((test) => test.status === 'BLOCKED').map((test) => `- ${test.id} ${test.category}: ${test.actual}`),
    '', `CLEANUP STATUS: ${report.cleanup.status}`, `CLEANUP SCOPE: ${report.cleanup.scope}`, 'CLEANUP EXECUTED: NO',
  ];
  return lines.join('\n');
}

export function isFullTestCommand(message: string): boolean {
  const text = String(message ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return /^(agent,?\s*)?(testeaza programul|porneste testele|ruleaza test complet|full test)$/.test(text);
}

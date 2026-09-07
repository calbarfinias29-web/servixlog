import type { AgentToolResult } from './agent-types';
import { supabase } from '@/lib/supabase';

export type TestRunStatus = 'RUNNING' | 'PASSED' | 'FAILED' | 'BLOCKED' | 'CLEANUP_PENDING' | 'CLEANED';
export type CleanupStatus = 'PENDING' | 'CLEANUP_PENDING' | 'CLEANED';
export type TestResultStatus = 'PASS' | 'FAIL' | 'BLOCKED';
export type TestSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type BugStatus = 'OPEN' | 'IN_PROGRESS' | 'FIXED' | 'VERIFIED' | 'WONT_FIX';

export interface EvidenceItem {
  timestamp: string;
  tool: string;
  action: string;
  expected?: string;
  actual?: string;
  agentMessage?: string;
  response?: string;
  screenshotPath?: string;
  [key: string]: unknown;
}

export interface TestRun {
  test_run_id: string;
  created_at: string;
  started_at: string;
  finished_at?: string;
  status: TestRunStatus;
  environment: string;
  cleanup_status: CleanupStatus;
  description?: string;
  source?: string;
  test_mode?: string;
}

export interface TestResult {
  id: string;
  test_run_id: string;
  test_name: string;
  category: string;
  status: TestResultStatus;
  expected: string;
  actual: string;
  severity: TestSeverity;
  evidence: EvidenceItem[];
  created_at: string;
}

export interface Bug {
  bug_id: string;
  test_run_id: string;
  test_name?: string;
  title: string;
  description: string;
  severity: TestSeverity;
  expected: string;
  actual: string;
  reproduction_steps: string[];
  evidence: EvidenceItem[];
  affected_area: string;
  status: BugStatus;
  created_at: string;
  updated_at: string;
}

export interface TestFixture {
  id: string;
  test_run_id: string;
  entity: 'client' | 'car' | 'job' | 'appointment' | 'time' | 'employee';
  data: Record<string, unknown>;
  created_at: string;
}

const runs = new Map<string, TestRun>();
const results = new Map<string, TestResult>();
const bugs = new Map<string, Bug>();
const fixtures = new Map<string, TestFixture>();
let sequence = 0;

function now(): string { return new Date().toISOString(); }
function id(prefix: string): string { sequence += 1; return `${prefix}-${Date.now()}-${sequence.toString(36)}`; }
function fail(error: string): AgentToolResult { return { success: false, data: null, error }; }
function ok(data: unknown): AgentToolResult { return { success: true, data }; }

function redact(value: unknown, key = ''): unknown {
  if (/password|token|secret|service.?role|private.?key|credential|api.?key/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  return value;
}

export function sanitizeEvidence(input: Partial<EvidenceItem> = {}): EvidenceItem {
  const safe = redact(input) as Record<string, unknown>;
  return { timestamp: String(safe.timestamp ?? now()), tool: String(safe.tool ?? 'agent'), action: String(safe.action ?? 'unknown'), ...safe } as EvidenceItem;
}

export function createTestRun(input: Partial<Pick<TestRun, 'environment' | 'description' | 'source' | 'test_mode'>> = {}): TestRun {
  const timestamp = now();
  const run: TestRun = {
    test_run_id: id('TR'), created_at: timestamp, started_at: timestamp, status: 'RUNNING',
    environment: input.environment ?? 'local', cleanup_status: 'PENDING',
    description: input.description, source: input.source ?? 'agent', test_mode: input.test_mode ?? 'full-test',
  };
  runs.set(run.test_run_id, run);
  return { ...run };
}

export function getTestRuns(): TestRun[] { return [...runs.values()].map((run) => ({ ...run })); }
export function getTestRun(testRunId: string): TestRun | null { const run = runs.get(testRunId); return run ? { ...run } : null; }

function requireRun(testRunId: string): TestRun | null { return runs.get(testRunId) ?? null; }

export function updateTestRunStatus(testRunId: string, status: TestRunStatus): TestRun | null {
  const run = runs.get(testRunId);
  if (!run || (run.status === 'CLEANED' && status !== 'CLEANED')) return null;
  run.status = status;
  if (status !== 'RUNNING') run.finished_at = now();
  if (status === 'CLEANUP_PENDING') run.cleanup_status = 'CLEANUP_PENDING';
  return { ...run };
}

export function recordTestResult(input: Omit<TestResult, 'id' | 'created_at' | 'evidence'> & { evidence?: Partial<EvidenceItem>[] }): TestResult | null {
  if (!requireRun(input.test_run_id)) return null;
  const result: TestResult = { ...input, id: id('RESULT'), created_at: now(), evidence: (input.evidence ?? []).map(sanitizeEvidence) };
  results.set(result.id, result);
  updateTestRunStatus(input.test_run_id, input.status === 'FAIL' ? 'FAILED' : input.status === 'BLOCKED' ? 'BLOCKED' : 'RUNNING');
  return { ...result, evidence: result.evidence.map((item) => ({ ...item })) };
}

export function getTestResults(testRunId?: string, status?: TestResultStatus): TestResult[] {
  return [...results.values()].filter((result) => (!testRunId || result.test_run_id === testRunId) && (!status || result.status === status)).map((result) => ({ ...result, evidence: result.evidence.map((item) => ({ ...item })) }));
}

function bugKey(input: Pick<Bug, 'test_run_id' | 'test_name' | 'title' | 'affected_area'>): string {
  return `${input.test_run_id}|${(input.test_name ?? input.title).trim().toLowerCase()}|${input.affected_area.trim().toLowerCase()}`;
}

export function createBug(input: Omit<Bug, 'bug_id' | 'created_at' | 'updated_at' | 'status' | 'evidence'> & { evidence?: Partial<EvidenceItem>[] }): Bug | null {
  if (!requireRun(input.test_run_id)) return null;
  const key = bugKey(input);
  const existing = [...bugs.values()].find((bug) => bugKey(bug) === key);
  if (existing) return { ...existing, evidence: existing.evidence.map((item) => ({ ...item })) };
  const timestamp = now();
  const bug: Bug = { ...input, test_name: input.test_name ?? input.title, bug_id: id('BUG'), status: 'OPEN', created_at: timestamp, updated_at: timestamp, evidence: (input.evidence ?? []).map(sanitizeEvidence) };
  bugs.set(bug.bug_id, bug);
  return { ...bug, evidence: bug.evidence.map((item) => ({ ...item })) };
}

export function getBugs(testRunId?: string, severity?: TestSeverity): Bug[] {
  return [...bugs.values()].filter((bug) => (!testRunId || bug.test_run_id === testRunId) && (!severity || bug.severity === severity)).map((bug) => ({ ...bug, evidence: bug.evidence.map((item) => ({ ...item })) }));
}
export function getBug(bugId: string): Bug | null { const bug = bugs.get(bugId); return bug ? { ...bug, evidence: bug.evidence.map((item) => ({ ...item })) } : null; }

export function updateBugStatus(bugId: string, status: BugStatus): Bug | null {
  const bug = bugs.get(bugId);
  if (!bug) return null;
  bug.status = status; bug.updated_at = now();
  return { ...bug, evidence: bug.evidence.map((item) => ({ ...item })) };
}

export function createTestFixture(testRunId: string, entity: TestFixture['entity'], data: Record<string, unknown> = {}): TestFixture | null {
  if (!requireRun(testRunId)) return null;
  const fixture: TestFixture = { id: id('FIXTURE'), test_run_id: testRunId, entity, data: { ...data, test_run_id: testRunId }, created_at: now() };
  fixtures.set(fixture.id, fixture);
  return { ...fixture, data: { ...fixture.data } };
}

export function getTestFixtures(testRunId?: string): TestFixture[] {
  return [...fixtures.values()].filter((fixture) => !testRunId || fixture.test_run_id === testRunId).map((fixture) => ({ ...fixture, data: { ...fixture.data } }));
}

export function getCleanupStatus(testRunId: string): { test_run_id: string; status: CleanupStatus; remaining: Record<string, number>; reason?: string } | null {
  const run = requireRun(testRunId); if (!run) return null;
  const remaining = { fixtures: getTestFixtures(testRunId).length, results: getTestResults(testRunId).length, bugs: getBugs(testRunId).length };
  return { test_run_id: testRunId, status: run.cleanup_status, remaining };
}

export function cleanupTestRun(testRunId: string, confirmation: string): AgentToolResult {
  const run = requireRun(testRunId);
  if (!run) return fail('test_run_id invalid sau inexistent.');
  if (!/^da$/i.test(confirmation.trim())) return fail('Cleanup necesita confirmarea explicita: Da.');
  for (const [fixtureId, fixture] of fixtures) if (fixture.test_run_id === testRunId) fixtures.delete(fixtureId);
  for (const [resultId, result] of results) if (result.test_run_id === testRunId) results.delete(resultId);
  for (const [bugId, bug] of bugs) if (bug.test_run_id === testRunId) bugs.delete(bugId);
  run.status = 'CLEANED'; run.cleanup_status = 'CLEANED'; run.finished_at = now();
  return ok(getCleanupStatus(testRunId));
}

export type TestManagementTool = 'get_test_runs' | 'get_test_run' | 'get_test_results' | 'get_bugs' | 'get_bug' | 'get_cleanup_status' | 'create_test_run' | 'record_test_result' | 'create_bug' | 'update_bug_status' | 'cleanup_test_run';
export const TEST_MANAGEMENT_TOOLS: ReadonlyArray<{ name: TestManagementTool; destructive?: boolean }> = [
  { name: 'get_test_runs' }, { name: 'get_test_run' }, { name: 'get_test_results' }, { name: 'get_bugs' }, { name: 'get_bug' }, { name: 'get_cleanup_status' },
  { name: 'create_test_run' }, { name: 'record_test_result' }, { name: 'create_bug' }, { name: 'update_bug_status' }, { name: 'cleanup_test_run', destructive: true },
];

export function executeTestManagementTool(tool: TestManagementTool, params: Record<string, unknown> = {}): AgentToolResult {
  switch (tool) {
    case 'get_test_runs': return ok(getTestRuns());
    case 'get_test_run': return ok(getTestRun(String(params.test_run_id ?? '')));
    case 'get_test_results': return ok(getTestResults(params.test_run_id ? String(params.test_run_id) : undefined, params.status as TestResultStatus | undefined));
    case 'get_bugs': return ok(getBugs(params.test_run_id ? String(params.test_run_id) : undefined, params.severity as TestSeverity | undefined));
    case 'get_bug': return ok(getBug(String(params.bug_id ?? '')));
    case 'get_cleanup_status': return ok(getCleanupStatus(String(params.test_run_id ?? '')));
    case 'create_test_run': return ok(createTestRun(params as Partial<Pick<TestRun, 'environment' | 'description' | 'source' | 'test_mode'>>));
    case 'record_test_result': {
      const result = recordTestResult(params as unknown as Parameters<typeof recordTestResult>[0]);
      return result ? ok(result) : fail('test_run_id invalid sau inexistent.');
    }
    case 'create_bug': {
      const bug = createBug(params as unknown as Parameters<typeof createBug>[0]);
      return bug ? ok(bug) : fail('test_run_id invalid sau inexistent.');
    }
    case 'update_bug_status': {
      const bug = updateBugStatus(String(params.bug_id ?? ''), params.status as BugStatus);
      return bug ? ok(bug) : fail('bug_id invalid sau inexistent.');
    }
    case 'cleanup_test_run': return cleanupTestRun(String(params.test_run_id ?? ''), String(params.confirmation ?? ''));
    default: return fail(`Tool Faza 6 necunoscut: ${tool}`);
  }
}

export function resetTestManagementStore(): void { runs.clear(); results.clear(); bugs.clear(); fixtures.clear(); sequence = 0; }

export async function createPersistentTestRun(input: Partial<Pick<TestRun, 'environment' | 'description' | 'source' | 'test_mode'>> = {}): Promise<TestRun | null> {
  const run = createTestRun(input);
  const { data, error } = await supabase.from('test_runs').insert(run).select().single();
  if (error || !data) { runs.delete(run.test_run_id); return null; }
  return data as TestRun;
}

export async function persistTestFixture(fixture: TestFixture): Promise<boolean> {
  const { error } = await supabase.from('test_fixtures').insert({ id: fixture.id, test_run_id: fixture.test_run_id, entity_type: fixture.entity, data: fixture.data, created_at: fixture.created_at });
  return !error;
}

export async function persistTestResult(result: TestResult): Promise<boolean> {
  const { error } = await supabase.from('test_results').insert({ id: result.id, test_run_id: result.test_run_id, test_name: result.test_name, category: result.category, status: result.status, expected: result.expected, actual: result.actual, severity: result.severity, evidence: result.evidence, created_at: result.created_at });
  return !error;
}

export async function persistBug(bug: Bug): Promise<boolean> {
  const { error } = await supabase.from('agent_bugs').insert({ bug_id: bug.bug_id, test_run_id: bug.test_run_id, test_name: bug.test_name ?? bug.title, title: bug.title, description: bug.description, severity: bug.severity, expected: bug.expected, actual: bug.actual, reproduction_steps: bug.reproduction_steps, evidence: bug.evidence, affected_area: bug.affected_area, status: bug.status, created_at: bug.created_at, updated_at: bug.updated_at });
  return !error;
}

export async function finishPersistentTestRun(testRunId: string, status: TestRunStatus): Promise<boolean> {
  const { error } = await supabase.from('test_runs').update({ status, finished_at: now() }).eq('test_run_id', testRunId);
  return !error;
}

export async function getPersistentTestRuns(): Promise<TestRun[]> {
  const { data } = await supabase.from('test_runs').select('*').order('created_at', { ascending: false });
  return (data ?? []) as TestRun[];
}

export async function getPersistentTestResults(testRunId?: string): Promise<TestResult[]> {
  let query = supabase.from('test_results').select('*').order('created_at', { ascending: true });
  if (testRunId) query = query.eq('test_run_id', testRunId);
  const { data } = await query;
  return (data ?? []) as TestResult[];
}

export async function getPersistentBugs(testRunId?: string, severity?: TestSeverity): Promise<Bug[]> {
  let query = supabase.from('agent_bugs').select('*').order('created_at', { ascending: false });
  if (testRunId) query = query.eq('test_run_id', testRunId);
  if (severity) query = query.eq('severity', severity);
  const { data } = await query;
  return (data ?? []) as Bug[];
}

export async function getPersistentBug(bugId: string): Promise<Bug | null> {
  const { data } = await supabase.from('agent_bugs').select('*').eq('bug_id', bugId).maybeSingle();
  return (data as Bug | null) ?? null;
}

export async function updatePersistentBugStatus(bugId: string, status: BugStatus): Promise<Bug | null> {
  const { data, error } = await supabase.from('agent_bugs').update({ status, updated_at: now() }).eq('bug_id', bugId).select().single();
  return error || !data ? null : data as Bug;
}

export async function cleanupPersistentTestRun(testRunId: string, confirmation: string): Promise<AgentToolResult> {
  if (!/^da$/i.test(confirmation.trim())) return fail('Cleanup necesita confirmarea explicita: Da.');
  const { data, error } = await supabase.rpc('cleanup_test_run', { p_test_run_id: testRunId, p_confirmation: 'Da' });
  if (error) return fail(error.message);
  return ok(data);
}

let pendingPersistentCleanup: string | null = null;

export async function handlePersistentTestManagementMessage(message: string): Promise<AgentToolResult | null> {
  const text = String(message ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (pendingPersistentCleanup && /^da$/.test(text)) {
    const runId = pendingPersistentCleanup; pendingPersistentCleanup = null;
    return cleanupPersistentTestRun(runId, 'Da');
  }
  if (pendingPersistentCleanup && /^(nu|anuleaza)$/.test(text)) { pendingPersistentCleanup = null; return ok('Cleanup anulat.'); }
  if (/^(porneste|creeaza) un test run$/.test(text)) return ok(await createPersistentTestRun({ source: 'agent', test_mode: 'full-test' }));
  if (/arat(a|a-mi) (ultimul )?test run/.test(text)) return ok((await getPersistentTestRuns()).slice(0, 1));
  if (/arat(a|a-mi) bug-urile/.test(text)) return ok(await getPersistentBugs(undefined, /critice/.test(text) ? 'CRITICAL' : /high/.test(text) ? 'HIGH' : undefined));
  if (/ce teste au esuat|arat(a|a-mi) rezultatul testului/.test(text)) {
    const runId = /\bTR-[\w-]+/.exec(text)?.[0];
    return ok((await getPersistentTestResults(runId)).filter((result) => !/ce teste au esuat/.test(text) || result.status === 'FAIL'));
  }
  const cleanup = /curata test run-ul\s+(TR-[\w-]+)/.exec(text);
  if (cleanup) { pendingPersistentCleanup = cleanup[1].toUpperCase(); return ok(`Voi șterge DOAR datele asociate test_run_id ${pendingPersistentCleanup}. Datele reale nu vor fi modificate. Confirmi?`); }
  if (/status(ul)? cleanup/.test(text)) return fail('Spune test_run_id pentru statusul cleanup.');
  return null;
}

export function handleTestManagementMessage(message: string): AgentToolResult | null {
  const text = String(message ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (/^(porneste|creeaza) un test run$/.test(text)) return executeTestManagementTool('create_test_run');
  if (/arat(a|a-mi) bug-urile/.test(text)) return executeTestManagementTool('get_bugs');
  return null;
}

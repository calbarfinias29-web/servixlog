/**
 * Agent SERVIZ — Tipuri FAZA 1 (READ-ONLY)
 */

// ==================== SECURITY LEVELS ====================
export enum SecurityLevel {
  READ = 'read',         // Fără confirmare
  ANALYZE = 'analyze',   // Fără confirmare
  WRITE = 'write',       // Confirmare explicită
  DELETE = 'delete',     // Confirmare + detalii
  PROTECTED = 'protected' // Parolă server-side
}

// ==================== AGENT MESSAGES ====================
export type MessageRole = 'user' | 'agent' | 'system';

export interface AgentMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCall?: AgentToolCall;
  error?: boolean;
}

// ==================== TOOL LAYER ====================
export interface AgentToolCall {
  tool: string;
  params: Record<string, unknown>;
  result?: AgentToolResult;
}

export interface AgentToolResult {
  success: boolean;
  data: unknown;
  error?: string;
}

export type AgentToolFunction = (params: Record<string, unknown>) => Promise<AgentToolResult>;

export interface AgentTool {
  name: string;
  description: string;
  securityLevel: SecurityLevel;
  execute: AgentToolFunction;
}

// ==================== AGENT CONTEXT ====================
export interface AgentContext {
  userRole: 'admin' | 'employee';
  userId: string;
}

// ==================== CONFIRMATION (pentru FAZA 2+) ====================
export interface ConfirmationRequest {
  action: string;
  description: string;
  affectedItems: number;
  details: string;
  isIrreversible: boolean;
  /** Operația exactă pending căreia i se referă această confirmare. */
  pending?: PendingOperation;
}

export type ConfirmationStatus = 'approved' | 'rejected' | 'ambiguous';

export interface ConfirmationResult {
  /** `true` DOAR pentru confirmare explicită. */
  confirmed: boolean;
  status: ConfirmationStatus;
  reason: string;
  timestamp: number;
}

/**
 * Operația exactă care așteaptă confirmare.
 * Confirmarea autorizează DOAR această operație, nu alta.
 */
export interface PendingOperation {
  operationId: string;
  action: string;
  target?: unknown;
  proposedChanges?: Record<string, unknown>;
  createdAt: number;
}

/**
 * State machine pregătit pentru WRITE. NU este încă legat de executeWrite.
 */
export type WriteConfirmationState =
  | 'idle'
  | 'awaiting_confirmation'
  | 'executing'
  | 'success'
  | 'error'
  | 'cancelled';

// ==================== TEST MODE (pentru FAZA 3+) ====================
export interface TestRun {
  test_run_id: string;
  started_at: string;
  status: 'running' | 'completed' | 'failed';
  tests: TestCase[];
  bugs: BugReport[];
}

export interface TestCase {
  id: string;
  name: string;
  module: 'admin' | 'employee' | 'timer' | 'overtime' | 'cost';
  steps: string[];
  expected: string;
  actual: string;
  status: 'pass' | 'fail' | 'skip';
}

export interface BugReport {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  steps: string[];
  expected: string;
  actual: string;
  test_run_id: string;
  module: string;
}

// ==================== AUDIT LOG ====================
export interface AuditEntry {
  id: string;
  timestamp: number;
  userId: string;
  action: string;
  tool: string;
  params: Record<string, unknown>;
  result: 'success' | 'failure';
  error?: string;
}

/**
 * Agent SERVIX - Security Layer FAZA 1
 * Defineste nivelurile de securitate si arhitectura pentru confirmari.
 * In FAZA 1 implementam efectiv DOAR READ si ANALYZE.
 * FAZA 2A: confirmation flow securizat (parser cu prioritate pentru refuz).
 * FAZA 2B ETAPA 1: WRITE restrictionat prin allowlist la update_rates / update_schedule.
 */

import { SecurityLevel } from './agent-types';
import type {
  ConfirmationRequest,
  ConfirmationResult,
  ConfirmationStatus,
  AgentContext,
  PendingOperation,
  WriteConfirmationState,
} from './agent-types';

/**
 * Verifica daca o actiune este permisa in FAZA 1 (READ-ONLY)
 */
export function isActionAllowed(securityLevel: SecurityLevel): boolean {
  return securityLevel === SecurityLevel.READ || securityLevel === SecurityLevel.ANALYZE;
}

/**
 * Creeaza o cerere de confirmare (pentru FAZA 2+)
 */
export function createConfirmationRequest(
  action: string,
  description: string,
  affectedItems: number,
  isIrreversible: boolean
): ConfirmationRequest {
  return {
    action,
    description,
    affectedItems,
    details: `${action}: ${description} (${affectedItems} elemente afectate)`,
    isIrreversible,
  };
}

/**
 * =====================================================================
 * FAZA 2A - CONFIRMATION FLOW SECURIZAT
 * ---------------------------------------------------------------------
 * PROBLEMA REZOLVATA:
 *   Vechea logica folosea includes("confirm"), ceea ce producea un
 *   FALSE POSITIVE periculos: "Nu confirm." (REFUZ) era tratat ca
 *   aprobare, deoarece textul contine cuvantul "confirm".
 *
 * NOUA LOGICA:
 *   1. REFUZUL EXPLICIT are PRIORITATE ABSOLUTA - niciun text cu o
 *      negatie nu poate fi interpretat ca APPROVED.
 *   2. Aprobarea necesita o formulare EXPLICITA (confirm / execut).
 *   3. ORICE ALTCEVA (ok, bine, poate, cred ca da...) este AMBIGUU si
 *      NU autorizeaza WRITE.
 *
 * Normalizarea PASTREAZA suportul pentru diacriticele romanesti
 *   (ă â î ș ț) si formele legacy (ş ţ).
 * WRITE ramane DEZACTIVAT: WRITE_ARMED === false.
 * =====================================================================
 */

export interface ConfirmationDecision {
  status: ConfirmationStatus;
  reason: string;
}

/**
 * Normalizeaza textul pastrand suportul pentru diacriticele romanesti.
 * Converteste formele legacy (ş/ţ) si scoate punctuia.
 */
export function normalizeConfirmationText(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[şș]/g, 's')
    .replace(/[ţț]/g, 't')
    .replace(/ă/g, 'a')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const APPROVED_PHRASES: ReadonlyArray<string> = [
  'da',
  'da confirm',
  'da confirm modificarea',
  'confirm',
  'confirm modificarea',
  'confirmarea',
  'confirmare',
  'executa',
  'sigur',
  'da da',
];

const NEGATION_WORDS: ReadonlyArray<string> = [
  'nu',
  'anuleaza',
  'renunta',
  'refuza',
  'lasa',
  'opreste',
];

function hasWord(text: string, word: string): boolean {
  return new RegExp("(^| )" + word + "( |$)").test(text);
}

/**
 * Clasifica raspunsul utilizatorului:
 *  - approved  -> confirmare explicita;
 *  - rejected  -> refuz explicit (prioritate absoluta);
 *  - ambiguous -> nu autorizeaza in niciun caz WRITE.
 */
export function parseConfirmation(response: string): ConfirmationDecision {
  const t = normalizeConfirmationText(response);
  if (!t) {
    return { status: 'ambiguous', reason: 'empty-or-whitespace' };
  }

  // 1) REFUZ EXPLICIT - PRIORITATE ABSOLUTA.
  //    Orice negatie blocheaza definitiv WRITE pentru aceasta operatie,
  //    chiar daca textul mai contine si cuvinte pozitive.
  if (NEGATION_WORDS.some((w) => hasWord(t, w))) {
    return { status: 'rejected', reason: 'explicit-refusal' };
  }

  // 2) CONFIRMARE EXPLICITA - potrivire stricta, NU includes.
  if (APPROVED_PHRASES.includes(t)) {
    return { status: 'approved', reason: 'explicit-approval' };
  }

  // Aprobari incepute cu "da", fara ezitare.
  if (/^da(\s|$)/.test(t)) {
    const tail = t.replace(/^da/, '').trim();
    if (tail === '' || /^(da|confirm|confirma|executa|sigur)/.test(tail)) {
      return { status: 'approved', reason: 'explicit-approval' };
    }
    return { status: 'ambiguous', reason: 'hedged-approval' };
  }

  // Aprobari incepute cu verbul de comanda "confirma" / "executa".
  if (/^(confirm|confirma|executa)/.test(t)) {
    return { status: 'approved', reason: 'explicit-approval' };
  }

  // 3) ORICE ALTCEVA -> AMBIGUU. WRITE ramane BLOCAT.
  return { status: 'ambiguous', reason: 'no-explicit-confirmation' };
}

/**
 * Wrapper retro-compatibil care returneaza ConfirmationResult.
 * `confirmed` ramane `true` DOAR pentru status `approved`.
 */
export function processConfirmation(response: string): ConfirmationResult {
  const decision = parseConfirmation(response);
  return {
    confirmed: decision.status === 'approved',
    status: decision.status,
    reason: decision.reason,
    timestamp: Date.now(),
  };
}

/**
 * Valideaza ca textul contine o confirmare EXPLICITA.
 */
export function isValidConfirmation(text: string): boolean {
  return parseConfirmation(text).status === 'approved';
}

/**
 * Verifica contextul utilizatorului (admin/employee)
 */
export function checkContext(context: AgentContext, requiredRole: 'admin' | 'employee'): boolean {
  if (requiredRole === 'admin') return context.userRole === 'admin';
  return true; // Employee poate accesa tot ce poate accesa adminul in mod read
}

/**
 * =====================================================================
 * GUARD - leaga confirmarea de operatia PENDING exacta.
 * FAZA 2B ETAPA 1: mecanismul WRITE este ARMED, dar RESTRICTIONAT
 * printr-o allowlist: DOAR update_rates (tarife + TVA) si
 * update_schedule (program de lucru) pot fi executate.
 * Toate celelalte actiuni (create/update car, client, employee, job,
 * appointment, transfer, status) raman BLOCATE. DELETE si PROTECTED
 * raman BLOCATE.
 * =====================================================================
 */
export const WRITE_ARMED: boolean = true;

/**
 * FAZA 2B ETAPA 2: allowlist extins DOAR cu:
 *  - create_car / update_car (schema existenta `cars`, ca in AddCarModal)
 *  - update_client (DOAR campurile client de pe `cars`: client_name / client_phone / client_email)
 * NOTA: in aceasta aplicatie NU exista tabela `clients`. Clientul este stocat
 * pe masina. `create_client` ca entitate independenta ramane BLOCAT (limitare
 * de arhitectura, nu se creeaza tabel nou).
 * Totul celalalt (angajati, lucrari, status, transfer, programari) ramane BLOCAT.
 * DELETE si PROTECTED raman BLOCATE.
 */
export const ALLOWED_WRITE_ACTIONS: ReadonlyArray<string> = [
  'update_rates',
  'update_schedule',
  'create_car',
  'update_car',
  'update_client',
];

export function isWriteActionAllowed(action: string): boolean {
  return ALLOWED_WRITE_ACTIONS.includes(action);
}

export function isReadOnlyAuditIntent(message: string): boolean {
  const text = String(message ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /\b(audit|analizeaz|verifica|verific|raport|read only|doar cit|doar analize|nu face|fara modific|fara sa modific|nu modific|nu schimb|nu sterg|nu crea|nu executa)\b/.test(text) ||
    /\b(s-ar modifica|s-ar schimba|ce trebuie reparat|ce lipseste)\b/.test(text);
}

export function hasExplicitWriteDirective(message: string): boolean {
  const text = String(message ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/\b(?:s-ar modifica|s-ar schimba|daca ar fi|dacă ar fi)\b/.test(text)) return false;
  if (/\bnu face\s*[:\n]/.test(text)) return false;
  if (/\bnu\s+(?:modific|schimb|sterg|creez|actualizez|readuc|restabilesc)/.test(text)) return false;
  return /\b(?:vreau sa\s+)?(?:modific|modifica|schimb|schimba|setez|seteaza|pun|pune|actualizez|actualizeaza|readuc|readuce|revin|revina|restabilest\w*|trebuie sa fie din nou)\b/.test(text);
}

let pendingOperationSequence = 0;

export interface WriteApproval {
  canExecute: boolean;
  reason: string;
  state: WriteConfirmationState;
}

export function createPendingOperation(
  action: string,
  target?: unknown,
  proposedChanges?: Record<string, unknown>
): PendingOperation {
  pendingOperationSequence += 1;
  const createdAt = Date.now();
  return {
    operationId: `${action}-${createdAt}-${pendingOperationSequence}`,
    action,
    target,
    proposedChanges,
    createdAt,
  };
}

export function evaluatePendingConfirmation(
  pending: PendingOperation | null,
  decision: ConfirmationDecision
): WriteApproval {
  if (!WRITE_ARMED) {
    return {
      canExecute: false,
      reason: 'write-disabled (FAZA 2A)',
      state: pending ? 'awaiting_confirmation' : 'idle',
    };
  }
  if (!pending) {
    return { canExecute: false, reason: 'no-pending-operation', state: 'idle' };
  }
  if (!isWriteActionAllowed(pending.action)) {
    return {
      canExecute: false,
      reason: 'action-not-enabled (FAZA 2B ETAPA 2: update_rates/update_schedule/create_car/update_car/update_client)',
      state: 'cancelled',
    };
  }
  if (decision.status === 'rejected') {
    return { canExecute: false, reason: 'refused-by-user', state: 'cancelled' };
  }
  if (decision.status !== 'approved') {
    return { canExecute: false, reason: 'ambiguous-requires-explicit-confirmation', state: 'awaiting_confirmation' };
  }
  return { canExecute: true, reason: 'approved-for-pending-operation', state: 'executing' };
}

/**
 * Tranzitia explicita a state machine-ului de confirmare WRITE.
 * Pregatita pentru FAZA 2B - NU este inca legata de executeWrite.
 */
export function nextWriteConfirmationState(
  current: WriteConfirmationState,
  decision: ConfirmationDecision | null
): WriteConfirmationState {
  switch (current) {
    case 'idle':
      return decision ? 'awaiting_confirmation' : 'idle';
    case 'awaiting_confirmation':
      if (!decision) return 'awaiting_confirmation';
      if (decision.status === 'approved') return 'executing';
      if (decision.status === 'rejected') return 'cancelled';
      return 'awaiting_confirmation'; // ambigua -> re-cerem confirmare explicita
    default:
      return current; // executing / success / error / cancelled sunt terminale
  }
}

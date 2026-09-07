import type { PendingOperation } from './agent-types';

export const ADMIN_WRITE_EXECUTION_ENABLED = false;

export type Phase3Action =
  | 'create_employee' | 'update_employee' | 'deactivate_employee'
  | 'create_job' | 'update_job' | 'change_job_status'
  | 'create_appointment' | 'update_appointment' | 'cancel_appointment'
  | 'transfer_car' | 'change_job_assignment'
  | 'delete_employee' | 'delete_job' | 'delete_appointment';

export interface Phase3Plan {
  action: Phase3Action;
  target: string;
  changes: Record<string, string>;
  preview: string[];
  risk: 'normal' | 'HIGH';
}
export interface Phase3ParseError { error: string; action?: undefined; }

function normalize(text: string): string {
  return String(text ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[șş]/g, 's').replace(/[țţ]/g, 't').replace(/\s+/g, ' ').trim();
}

function valueAfter(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]?.trim()) return match[1].trim().replace(/[.,;!?]+$/, '');
  }
  return undefined;
}

function preview(action: Phase3Action, target: string, changes: Record<string, string>, risk: 'normal' | 'HIGH'): string[] {
  const lines = [
    action.startsWith('delete_') || action === 'cancel_appointment' ? 'ATENTIE - OPERATIE DESTRUCTIVA' : action === 'transfer_car' || action === 'change_job_assignment' ? 'TRANSFER' : 'ACTIUNE: ' + action.toUpperCase(),
    'ȚINTĂ: ' + target,
  ];
  if (action === 'transfer_car' || action === 'change_job_assignment') {
    lines.push('De la: ' + (changes.current_employee ?? 'necunoscut'), 'La: ' + (changes.new_employee ?? 'necunoscut'), 'Timpul deja lucrat: NU SE RESETEAZĂ');
  } else if (Object.keys(changes).length > 0) {
    lines.push('MODIFICĂRI:');
    for (const [key, value] of Object.entries(changes)) lines.push('- ' + key + ': ' + value);
  }
  lines.push('RISC: ' + risk, 'CONFIRMARE: DA / NU');
  return lines;
}

function plan(action: Phase3Action, target: string, changes: Record<string, string> = {}, risk: 'normal' | 'HIGH' = 'normal'): Phase3Plan {
  return { action, target, changes, risk, preview: preview(action, target, changes, risk) };
}

export function parsePhase3Intent(message: string): Phase3Plan | Phase3ParseError | null {
  const original = String(message ?? '').trim();
  const text = normalize(original);
  if (!text) return null;

  const employeeTarget = valueAfter(original, [/(?:angajatul?|numele angajatului)\s+(.+)$/i]);
  const jobTarget = valueAfter(original, [/(?:lucrarea?|jobul?)\s+(.+)$/i, /(?:pentru|la)\s+([A-Z]{1,2}\s?\d{2,3}\s?[A-Z]{1,3})/i]);
  const appointmentTarget = valueAfter(original, [/(?:programarea?|programare)\s+(.+)$/i]);
  const plate = valueAfter(original, [/(?:masina|mașina|autoturismul?)\s+([A-Z]{1,2}\s?\d{2,3}\s?[A-Z]{1,3})/i, /\b([A-Z]{1,2}\s?\d{2,3}\s?[A-Z]{1,3})\b/i]);

  if (/(?:creeaza|adauga|fa)\b.*\bangajat/.test(text)) {
    const name = employeeTarget ?? valueAfter(original, [/(?:angajat nou|angajat)\s+(.+)$/i]);
    if (!name) return { error: 'Spune numele angajatului care trebuie creat.' };
    return plan('create_employee', name, { name }, 'HIGH');
  }
  if (/(?:dezactiveaza|dezactiva|inactiveaza)\b.*\bangajat/.test(text)) {
    if (!employeeTarget) return { error: 'Spune exact ce angajat trebuie dezactivat.' };
    return plan('deactivate_employee', employeeTarget, { active: 'true -> false' }, 'HIGH');
  }
  if (/(?:sterge|elimina)\b.*\bangajat/.test(text)) {
    if (!employeeTarget) return { error: 'Spune exact ce angajat trebuie sters.' };
    return plan('delete_employee', employeeTarget, {}, 'HIGH');
  }
  if (/(?:modifica|schimba)\b.*\bangajat/.test(text)) {
    if (!employeeTarget) return { error: 'Spune exact ce angajat trebuie modificat.' };
    const name = valueAfter(original, [/(?:numele|numelui)\s+(?:in|în|la|cu)\s+(.+)$/i]);
    return plan('update_employee', employeeTarget, name ? { name } : {}, 'HIGH');
  }

  if (/(?:creeaza|adauga|fa)\b.*\b(lucrare|job)/.test(text)) {
    const title = valueAfter(original, [/(?:lucrare|job)\s+(?:nou(?:a|ă)?|numit[aă]?|cu titlul)\s+(.+)$/i]);
    if (!title) return { error: 'Spune titlul lucrării și mașina asociată.' };
    return plan('create_job', title, { title }, 'normal');
  }
  if (/(?:sterge|elimina)\b.*\b(lucrare|job)/.test(text)) {
    if (!jobTarget && !plate) return { error: 'Spune exact lucrarea sau numărul mașinii.' };
    return plan('delete_job', jobTarget ?? plate ?? '', {}, 'HIGH');
  }
  if (/(?:schimba|modifica|actualizeaza)\b.*\bstatus/.test(text) || /\b(inchide|redeschide)\b.*\b(lucrare|job)/.test(text)) {
    if (!jobTarget && !plate) return { error: 'Spune exact lucrarea sau numărul mașinii.' };
    const status = text.includes('finalizat') || text.includes('inchide') ? 'finalizat' : text.includes('redeschide') ? 'asteptare' : valueAfter(original, [/\b(?:in|în)\s+(asteptare(?:_piese)?|in lucru|finalizat)/i]);
    if (!status) return { error: 'Status invalid. Folosește: așteptare, în lucru, așteptare piese sau finalizat.' };
    return plan('change_job_status', jobTarget ?? plate ?? '', { status }, 'HIGH');
  }
  if (/(?:modifica|schimba|actualizeaza)\b.*\b(lucrare|job)/.test(text)) {
    if (!jobTarget && !plate) return { error: 'Spune exact lucrarea sau numărul mașinii.' };
    return plan('update_job', jobTarget ?? plate ?? '', {}, 'normal');
  }

  if (/(?:creeaza|adauga)\b.*\bprogramar/.test(text)) {
    const date = valueAfter(original, [/(?:pe|pentru|in|în)\s+(\d{1,2}[./]\d{1,2}[./]\d{2,4})/i]);
    const time = valueAfter(original, [/(?:la|ora)\s+(\d{1,2}:\d{2})/i]);
    if (!date || !time) return { error: 'Pentru programare sunt necesare data și ora.' };
    return plan('create_appointment', date + ' ' + time, { date, time }, 'normal');
  }
  if (/(?:sterge|elimina)\b.*\bprogramar/.test(text)) {
    if (!appointmentTarget && !plate) return { error: 'Spune exact programarea sau numărul mașinii.' };
    return plan('cancel_appointment', appointmentTarget ?? plate ?? '', {}, 'HIGH');
  }
  if (/anuleaza\b.*\bprogramar/.test(text)) {
    if (!appointmentTarget && !plate) return { error: 'Spune exact programarea sau numărul mașinii.' };
    return plan('cancel_appointment', appointmentTarget ?? plate ?? '', {}, 'HIGH');
  }
  if (/(?:modifica|schimba|actualizeaza)\b.*\bprogramar/.test(text)) {
    if (!appointmentTarget && !plate) return { error: 'Spune exact programarea sau numărul mașinii.' };
    return plan('update_appointment', appointmentTarget ?? plate ?? '', {}, 'normal');
  }

  if (/(?:muta|transfera|schimba)\b.*\b(?:masina|mașina|lucrarea|angajatul)/.test(text)) {
    if (!plate) return { error: 'Spune numărul exact al mașinii pentru transfer. (numarul exact al masinii)' };
    const newEmployee = valueAfter(original, [/(?:la|catre|către)\s+(.+)$/i]);
    if (!newEmployee) return { error: 'Spune angajatul nou pentru transfer.' };
    return plan(text.includes('lucrarea') ? 'change_job_assignment' : 'transfer_car', plate, { current_employee: 'de verificat', new_employee: newEmployee }, 'HIGH');
  }

  return null;
}

export function pendingPhase3(planData: Phase3Plan, operationId: string): PendingOperation {
  return { operationId, action: planData.action, target: planData.target, proposedChanges: planData.changes, createdAt: Date.now() };
}

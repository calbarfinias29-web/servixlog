import type { AgentToolResult } from './agent-types';
import { executeTool } from './agent-tools';

export type IntentCategory =
  | 'CARS' | 'JOBS' | 'EMPLOYEES' | 'APPOINTMENTS' | 'TIME_ENTRIES'
  | 'RATES' | 'SCHEDULE' | 'ACTIVITY_LOG' | 'DASHBOARD'
  | 'PRODUCTIVITY' | 'OVERTIME' | 'COSTS' | 'ANOMALIES' | 'UNKNOWN';

export type IntentOperation = 'COUNT' | 'LIST' | 'DETAILS' | 'SUMMARY';
export interface IntentFilter { status?: string; employee?: string; date?: string; }

export interface AgentIntent {
  category: IntentCategory;
  operation: IntentOperation;
  filters: IntentFilter;
  originalMessage: string;
  confidence: number;
}

export interface IntentResult {
  success: boolean;
  intent: AgentIntent;
  toolResult: AgentToolResult;
  formattedResponse: string;
}

function normalizeText(text: string): string {
  return text.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0218\u0219]/g, 's').replace(/[\u021a\u021b]/g, 't')
    .replace(/[\u0102\u0103]/g, 'a').replace(/[\u00ce\u00ee]/g, 'i');
}

function detectOperation(text: string): IntentOperation {
  const t = normalizeText(text);
  if (t.match(/^(cate|canti|cati|numara|cifra)/)) return 'COUNT';
  if (t.match(/^(arata|lista|vezi|afiseza)/)) return 'LIST';
  if (t.match(/^(ce|care)/)) return 'LIST';
  return 'LIST';
}

function detectStatusFilter(text: string, category: IntentCategory): string | undefined {
  const t = normalizeText(text);
  if (t.match(/(in lucru|activ)/)) return 'in_lucru';
  if (t.match(/(finalizat|terminat|gata|completat)/)) return category === 'CARS' ? 'finalizata' : 'finalizat';
  if (t.match(/(asteptare|asteapta|pendent)/)) return 'asteptare';
  if (t.match(/(asteptare piese|piese)/)) return 'asteptare_piese';
  if (t.match(/(nou|noi|noua)/)) return 'noua';
  return undefined;
}

function detectCategory(text: string): IntentCategory {
  const t = normalizeText(text);
  if (t.match(/(dashboard|rezumat|situatia generala)/)) return 'DASHBOARD';
  if (t.match(/(anomalii|probleme|negative|bug|erori)/)) return 'ANOMALIES';
  if (t.match(/(cost|pret|factura|tva|bani|suma|valoare)/)) return 'COSTS';
  if (t.match(/(overtime|suplimentar|peste program)/)) return 'OVERTIME';
  if (t.match(/(productivitate|performanta|cel mai mult|cel mai putin)/)) return 'PRODUCTIVITY';
  if (t.match(/(programul|orar|schedule|la ce ora|cand)/)) return 'SCHEDULE';
  if (t.match(/\btarif\w*\b|\brate\b|lei ora/)) return 'RATES';
  if (t.match(/(programar|programare|calendar|sedinta)/)) return 'APPOINTMENTS';
  if (t.match(/(time entries|intrari timp|ore lucrate)/)) return 'TIME_ENTRIES';
  if (t.match(/(activitate|istoric|log|jurnal)/)) return 'ACTIVITY_LOG';
  if (t.match(/(angajat|angajati|echipa|personal|muncitor)/)) return 'EMPLOYEES';
  if (t.match(/(lucrar|lucrare|task|sarcina|serviciu|comanda)/)) return 'JOBS';
  if (t.match(/(masin|masina|vehicul|automobil|auto)/)) return 'CARS';
  return 'UNKNOWN';
}

export function detectIntent(message: string): AgentIntent {
  const category = detectCategory(message);
  const operation = detectOperation(message);
  const filters: IntentFilter = { status: detectStatusFilter(message, category) };
  return { category, operation, filters, originalMessage: message, confidence: category === 'UNKNOWN' ? 0 : 1 };
}

function mapIntentToTool(intent: AgentIntent): { tool: string; params: Record<string, unknown> } | null {
  switch (intent.category) {
    case 'DASHBOARD': return { tool: 'get_dashboard', params: {} };
    case 'CARS': return { tool: 'get_cars', params: intent.filters.status ? { status: intent.filters.status } : {} };
    case 'JOBS': return { tool: 'get_jobs', params: intent.filters.status ? { status: intent.filters.status } : {} };
    case 'EMPLOYEES': return { tool: 'get_employees', params: {} };
    case 'APPOINTMENTS': return { tool: 'get_appointments', params: {} };
    case 'RATES': return { tool: 'get_rates', params: {} };
    case 'SCHEDULE': return { tool: 'get_schedule', params: {} };
    case 'TIME_ENTRIES': return { tool: 'get_time_entries', params: {} };
    case 'ACTIVITY_LOG': return { tool: 'get_activity_log', params: {} };
    case 'PRODUCTIVITY': return { tool: 'analyze_productivity', params: {} };
    case 'OVERTIME': return { tool: 'analyze_overtime', params: {} };
    case 'COSTS': return { tool: 'analyze_costs', params: {} };
    case 'ANOMALIES': return { tool: 'detect_anomalies', params: {} };
    default: return null;
  }
}
function formatIntentResponse(intent: AgentIntent, toolResult: AgentToolResult): string {
  if (!toolResult.success) return 'Eroare: ' + (toolResult.error || 'Nu am putut accesa datele.');
  const data = toolResult.data;
  if (!data) return 'Nu exista date pentru criteriul solicitat.';

  switch (intent.category) {
    case 'DASHBOARD': {
      const d = data as { cars: { total: number; in_lucru: number; finalizata: number }; jobs: { total: number; in_lucru: number; finalizat: number }; employees: { total: number; active: number }; appointments: { total: number; programata: number } };
      return 'Rezumat SERVIX:\n\nMasini: ' + d.cars.total + ' total (' + d.cars.in_lucru + ' in lucru, ' + d.cars.finalizata + ' finalizate)\nLucrari: ' + d.jobs.total + ' total (' + d.jobs.in_lucru + ' in lucru, ' + d.jobs.finalizat + ' finalizate)\nAngajati: ' + d.employees.total + ' total (' + d.employees.active + ' activi)\nProgramari: ' + d.appointments.total + ' total (' + d.appointments.programata + ' programate)';
    }
    case 'CARS': {
      const cars = data as Array<{ license_plate: string; client_name: string; make?: string; model?: string }>;
      if (cars.length === 0) {
        const statusText = intent.filters.status ? ' ' + intent.filters.status.replace(/_/g, ' ') : '';
        return 'In acest moment nu exista masini' + statusText + '.';
      }
      if (intent.operation === 'COUNT') return 'Sunt ' + cars.length + ' masin' + (cars.length === 1 ? 'a' : 'i') + (intent.filters.status ? ' ' + intent.filters.status.replace(/_/g, ' ') : '') + '.';
      const list = cars.slice(0, 10).map((c, i) => (i + 1) + '. ' + c.license_plate + ' - ' + c.client_name).join('\n');
      return 'Masini' + (intent.filters.status ? ' ' + intent.filters.status.replace(/_/g, ' ') : '') + ' (' + cars.length + '):\n\n' + list + (cars.length > 10 ? '\n...' : '');
    }
    case 'JOBS': {
      const jobs = data as Array<{ title: string; status: string }>;
      if (jobs.length === 0) {
        const statusText = intent.filters.status ? ' ' + intent.filters.status : '';
        return 'In acest moment nu exista lucrari' + statusText + '.';
      }
      if (intent.operation === 'COUNT') return 'Sunt ' + jobs.length + ' lucr' + (jobs.length === 1 ? 'are' : 'ari') + (intent.filters.status ? ' ' + intent.filters.status : '') + '.';
      const list = jobs.slice(0, 10).map((j, i) => (i + 1) + '. ' + j.title + ' (' + j.status + ')').join('\n');
      return 'Lucrari' + (intent.filters.status ? ' ' + intent.filters.status : '') + ' (' + jobs.length + '):\n\n' + list + (jobs.length > 10 ? '\n...' : '');
    }
    case 'EMPLOYEES': {
      const emps = data as Array<{ name: string; active: boolean }>;
      if (emps.length === 0) return 'In acest moment nu exista angajati inregistrati.';
      if (intent.operation === 'COUNT') return 'Sunt ' + emps.length + ' angajat' + (emps.length === 1 ? '' : 'i') + '.';
      const list = emps.map((e, i) => (i + 1) + '. ' + e.name + ' ' + (e.active ? '(activ)' : '(inactiv)')).join('\n');
      return 'Angajati (' + emps.length + '):\n\n' + list;
    }
    case 'APPOINTMENTS': {
      const appts = data as Array<{ client_name: string; appointment_date: string; status: string }>;
      if (appts.length === 0) return 'In acest moment nu exista programari.';
      if (intent.operation === 'COUNT') return 'Sunt ' + appts.length + ' program' + (appts.length === 1 ? 'are' : 'ari') + '.';
      const list = appts.slice(0, 10).map((a, i) => (i + 1) + '. ' + a.client_name + ' - ' + a.appointment_date).join('\n');
      return 'Programari (' + appts.length + '):\n\n' + list;
    }
    case 'RATES': {
      const r = data as { normal_rate: number; overtime_rate: number; warranty_rate: number; vat_rate: number } | null;
      if (!r) return 'Nu exista tarife configurate.';
      return 'Tarife:\n\nTarif normal: ' + r.normal_rate + ' lei/ora\nTarif overtime: ' + r.overtime_rate + ' lei/ora\nTarif garantie: ' + r.warranty_rate + ' lei/ora\nTVA: ' + r.vat_rate + '%';
    }
    case 'SCHEDULE': {
      const s = data as { work_start: string; work_end: string; break_start: string; break_end: string } | null;
      if (!s) return 'Nu exista program de lucru configurat.';
      return 'Program de lucru:\n\nInceput: ' + s.work_start + '\nPauza: ' + s.break_start + ' - ' + s.break_end + '\nSfarsit: ' + s.work_end;
    }
    case 'PRODUCTIVITY': {
      const list = data as Array<{ name: string; normal_hours: number; overtime_hours: number; total_hours: number }>;
      if (list.length === 0) return 'In acest moment nu exista date de productivitate.';
      const sorted = [...list].sort((a, b) => b.total_hours - a.total_hours);
      const top = sorted.slice(0, 5).map((e, i) => (i + 1) + '. ' + e.name + ': ' + e.total_hours + 'h (' + e.normal_hours + 'h norm, ' + e.overtime_hours + 'h OT)').join('\n');
      return 'Productivitate angajati:\n\n' + top;
    }
    case 'OVERTIME': {
      const d = data as { total_jobs: number; jobs_with_overtime: number; total_normal_hours: number; total_overtime_hours: number };
      return 'Analiza overtime:\n\nTotal lucrari: ' + d.total_jobs + '\nCu overtime: ' + d.jobs_with_overtime + '\nOre normale: ' + d.total_normal_hours + 'h\nOre overtime: ' + d.total_overtime_hours + 'h';
    }
    case 'COSTS': {
      const d = data as { summary: { subtotal: number; vat_amount: number; total_with_vat: number } };
      return 'Analiza costuri:\n\nSubtotal (fara TVA): ' + d.summary.subtotal.toFixed(2) + ' lei\nTVA: ' + d.summary.vat_amount.toFixed(2) + ' lei\nTOTAL CU TVA: ' + d.summary.total_with_vat.toFixed(2) + ' lei';
    }
    case 'ANOMALIES': {
      const d = data as { total: number; anomalies: Array<{ type: string; title: string; value: number }> };
      if (d.total === 0) return 'Nu am detectat anomalii.';
      const list = d.anomalies.map(a => '- ' + a.title + ': ' + a.type + ' (' + a.value + 's)').join('\n');
      return 'Am detectat ' + d.total + ' anomalii:\n\n' + list;
    }
    default:
      return JSON.stringify(data, null, 2);
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  CARS: 'Masini',
  JOBS: 'Lucrari',
  EMPLOYEES: 'Angajati',
  APPOINTMENTS: 'Programari',
  TIME_ENTRIES: 'Ore lucrate',
  RATES: 'Tarife',
  SCHEDULE: 'Program de lucru',
  ACTIVITY_LOG: 'Activitate',
  DASHBOARD: 'Rezumat',
  PRODUCTIVITY: 'Productivitate',
  OVERTIME: 'Overtime',
  COSTS: 'Costuri',
  ANOMALIES: 'Anomalii',
  UNKNOWN: 'Informatii'
};

function splitQuestions(message: string): string[] {
  let t = ' ' + message.trim().replace(/\s+/g, ' ');
  t = t.replace(/(?:\s|^)\d+[.)]\s+/g, ' | ');
  t = t.replace(/\s+(?:și|si)\s+/g, ' | ');
  t = t.replace(/([?.!])\s+/g, '$1 |');
  return t.split('|').map(s => s.trim()).filter(Boolean);
}
function requestKey(mapping: { tool: string; params: Record<string, unknown> }): string {
  return mapping.tool + '|' + JSON.stringify(Object.keys(mapping.params).sort().map((key) => [key, mapping.params[key]]));
}
export async function processMessage(message: string): Promise<IntentResult> {
  const intent = detectIntent(message);
  const toolMapping = mapIntentToTool(intent);
  if (!toolMapping) {
    return {
      success: false, intent,
      toolResult: { success: false, data: null, error: 'Nu am putut identifica intentia.' },
      formattedResponse: 'Nu am inteles intrebarea. Poti sa intrebi despre: masini, lucrari, angajati, programari, tarife, productivitate, overtime, costuri, anomalii.',
    };
  }
  const toolResult = await executeTool(toolMapping.tool, toolMapping.params);
  const formattedResponse = formatIntentResponse(intent, toolResult);
  return { success: toolResult.success, intent, toolResult, formattedResponse };
}
export async function processMessageMulti(message: string): Promise<IntentResult> {
  const parts = splitQuestions(message);
  const resolved: { intent: AgentIntent; mapping: { tool: string; params: Record<string, unknown> }; key: string }[] = [];
  const seenRequests = new Set<string>();
  let prevCategory: IntentCategory | undefined;
  for (const part of parts) {
    let intent = detectIntent(part);
    if (intent.category === 'UNKNOWN' && prevCategory) {
      intent.category = prevCategory;
    }
    const mapping = mapIntentToTool(intent);
    if (mapping) {
      const key = requestKey(mapping);
      if (seenRequests.has(key)) continue;
      seenRequests.add(key);
      resolved.push({ intent, mapping, key });
      if (intent.category !== 'UNKNOWN') prevCategory = intent.category;

    }
  }
  if (resolved.length === 0) {
    const intent = detectIntent(message);
    return {
      success: false,intent,
      toolResult: { success: false, data: null, error: 'Nu am putut identifica intentia.' },
      formattedResponse: 'Nu am inteles intrebarea. Poti sa intrebi despre: masini, lucrari, angajati, programari, tarife, productivitate, overtime, costuri, anomalii.',

    };
  }
  const resultsByRequest = new Map<string, AgentToolResult>();
  for (const r of resolved) {
    try {
      resultsByRequest.set(r.key, await executeTool(r.mapping.tool, r.mapping.params));
    } catch (err) {
      resultsByRequest.set(r.key, { success: false, data: null, error: String(err) } );

    }
  }
  const successAll = resolved.every(r => resultsByRequest.get(r.key)?.success === true);
  const lines = resolved.map((rl, i) => {
    const result = resultsByRequest.get(rl.key)!;
    const formatted = formatIntentResponse(rl.intent, result);
    return resolved.length > 1
      ? `${i + 1}. ${CATEGORY_LABELS[rl.intent.category] ?? rl.intent.category}: ${formatted}`
      : formatted;

  });
  return {
    success: successAll,

    intent: resolved[0].intent,
    toolResult: { success: successAll, data: resolved.map(rl => rl.intent.category), error: successAll ? undefined : 'A aparut o eroare.' },
    formattedResponse: lines.join('\n\n'),

  };
}

/**
 * Agent SERVIX — WRITE FLOW (FAZA 2B ETAPA 1)
 * ---------------------------------------------------------------------
 * Flux obligatoriu:
 *   USER REQUEST -> parseaza intentia WRITE -> citeste valorile actuale
 *   -> valideaza noua valoare -> creeaza WritePlan + PendingOperation
 *   -> afiseaza preview (AWAITING_CONFIRMATION) -> confirmare explicita
 *   -> reverifica pending operation -> executeWrite -> READ-BACK
 *   -> SUCCESS doar daca read-back corespunde.
 *
 * DOAR update_rates (tarife + TVA) si update_schedule (program) sunt
 * permise. Orice alta operatie este respinsa la parsare.
 * Executia live NU este declansata fara confirmare explicita.
 */

import { supabase } from '@/lib/supabase';
import { dataAdapter, registry } from '@/data';
import type { PendingOperation } from './agent-types';
import {
  createPendingOperation,
  evaluatePendingConfirmation,
  hasExplicitWriteDirective,
  isReadOnlyAuditIntent,
  isWriteActionAllowed,
  parseConfirmation,
} from './agent-security';
import { executeWrite, type WritePlan } from './agent-write';
import { parsePhase3Intent, ADMIN_WRITE_EXECUTION_ENABLED } from './agent-phase3';
import { buildFullTestReport, formatFullTestReport, isFullTestCommand, runFullTestAndPersist } from './agent-full-test';
import { handlePersistentTestManagementMessage, handleTestManagementMessage } from './agent-test-management';

export interface AgentFlowResponse {
  success: boolean;
  text: string;
  /** Operatia pending care asteapta confirmare (pentru UI). */
  pending?: {
    operationId: string;
    action: string;
    lines: string[];
  };
}

// ---------------------------------------------------------------------
// STATE MACHINE (in-memory, per sesiune agent)
// ---------------------------------------------------------------------
type FlowState = 'idle' | 'awaiting_confirmation' | 'executing' | 'success' | 'error' | 'cancelled';

let flowState: FlowState = 'idle';
let pending: PendingOperation | null = null;
let pendingPlan: WritePlan | null = null;
let pendingPreviewLines: string[] = [];

export function getFlowState(): FlowState { return flowState; }
export function getPendingOperation(): PendingOperation | null { return pending; }
export function resetFlow(): void {
  flowState = 'idle'; pending = null; pendingPlan = null; pendingPreviewLines = [];
}

// ---------------------------------------------------------------------
// NORMALIZARE
// ---------------------------------------------------------------------
function norm(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/ş/g, 's').replace(/ţ/g, 't')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------
// NUMERE ÎN LIMBA ROMÂNĂ (pregătit pentru voice input)
// "o sută unu" -> 101. Doar secvențe neambigue (≥ 2 cuvinte) sunt
// convertite; valorile incerte NU sunt ghicite.
// ---------------------------------------------------------------------
const RO_UNITS: Record<string, number> = {
  zero: 0, unu: 1, una: 1, o: 1, doi: 2, doua: 2, trei: 3, patru: 4, cinci: 5,
  sase: 6, sapte: 7, opt: 8, noua: 9, zece: 10, unsprezece: 11, doisprezece: 12,
  treisprezece: 13, paisprezece: 14, cincisprezece: 15, saisprezece: 16,
  saptesprezece: 17, optsprezece: 18, nouasprezece: 19,
};
const RO_TENS: Record<string, number> = {
  douazeci: 20, treizeci: 30, patruzeci: 40, cincizeci: 50,
  saizeci: 60, saptezeci: 70, optzeci: 80, nouazeci: 90,
};

export function parseRomanianNumberPhrase(tokens: string[]): number | null {
  let total = 0, current = 0, any = false;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk === 'si') {
      // "și" este valid doar între un tens și o unitate (ex: "douăzeci și cinci")
      const prev = tokens[i - 1], next = tokens[i + 1];
      if (!(prev && prev in RO_TENS && next && (next in RO_UNITS || next in RO_TENS))) return null;
      continue;
    }
    if (tk in RO_UNITS) { current += RO_UNITS[tk]; any = true; }
    else if (tk in RO_TENS) { current += RO_TENS[tk]; any = true; }
    else if (tk === 'suta' || tk === 'sute') { current = (current || 1) * 100; total += current; current = 0; }
    else if (tk === 'mie' || tk === 'mii') { current = (current || 1) * 1000; total += current; current = 0; }
    else return null;
  }
  if (!any) return null;
  const value = total + current;
  return Number.isFinite(value) ? value : null;
}

const RO_NUMBER_WORD = new RegExp(
  '^(' + Object.keys(RO_UNITS).join('|') + '|' + Object.keys(RO_TENS).join('|') + '|suta|sute|mie|mii|si)$'
);

/** Converteste secventele de cuvinte-numar neambigue in cifre. */
export function convertRomanianNumberWords(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const v = parseRomanianNumberPhrase(run);
      if (v !== null) { out.push(String(v)); run = []; return; }
    }
    out.push(...run);
    run = [];
  };
  for (const w of words) {
    if (RO_NUMBER_WORD.test(w)) { run.push(w); }
    else { flush(); out.push(w); }
  }
  flush();
  return out.join(' ');
}

const RATE_FIELDS = {
  normal: { key: 'normal_rate', label: 'Tariful normal', unit: 'lei/oră' },
  normal_rate: { key: 'normal_rate', label: 'Tariful normal', unit: 'lei/oră' },
  urgent: { key: 'urgent_rate', label: 'Tariful urgent', unit: 'lei/oră' },
  urgenta: { key: 'urgent_rate', label: 'Tariful urgent', unit: 'lei/oră' },
  overtime: { key: 'overtime_rate', label: 'Tariful overtime', unit: 'lei/oră' },
  suplimentar: { key: 'overtime_rate', label: 'Tariful overtime', unit: 'lei/oră' },
  garantie: { key: 'warranty_rate', label: 'Tariful garanție', unit: 'lei/oră' },
} as const;
type RateKey = 'normal_rate' | 'urgent_rate' | 'overtime_rate' | 'warranty_rate';

const DAYS: Record<string, string> = {
  luni: 'monday', marti: 'tuesday', miercuri: 'wednesday', joi: 'thursday',
  vineri: 'friday', sambata: 'saturday', duminica: 'sunday',
};
const DAY_LABELS: Record<string, string> = {
  monday: 'Luni', tuesday: 'Marți', wednesday: 'Miercuri', thursday: 'Joi',
  friday: 'Vineri', saturday: 'Sâmbătă', sunday: 'Duminică',
};


// ---------------------------------------------------------------------
// VALIDARE (rate >= 0, TVA 0..100, HH:MM, start < end)
// ---------------------------------------------------------------------
export function validateRateValue(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return { ok: false, error: 'Valoarea nu este un numar valid.' };
  if (n < 0) return { ok: false, error: 'Valoarea nu poate fi negativa.' };
  if (n > 100000) return { ok: false, error: 'Valoarea este implausibil de mare.' };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function validateVatValue(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return { ok: false, error: 'Valoarea TVA nu este un numar valid.' };
  if (n < 0) return { ok: false, error: 'TVA nu poate fi negativ.' };
  if (n > 100) return { ok: false, error: 'TVA nu poate depasi 100%.' };
  return { ok: true, value: Math.round(n * 10) / 10 };
}

export function validateTimeHHMM(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? '').trim());
  if (!m) return { ok: false, error: 'Formatul orei trebuie sa fie HH:MM.' };
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return { ok: false, error: 'Ora este invalida (HH:MM, 00:00-23:59).' };
  return { ok: true, value: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` };
}

// ---------------------------------------------------------------------
// PARSING INTENTIE WRITE
// ---------------------------------------------------------------------
export interface ParsedWriteIntent {
  action: 'update_rates' | 'update_schedule';
  changes: Record<string, unknown>;
  summary: string;
  /** Ziua pentru care lipsesc ore — se completeaza din programul curent inainte de preview. */
  fillFromCurrent?: string;
}

const WRITE_VERB = /(^| )(schimb|schimba|schimbam|modific|modifica|setez|seteaz|pune|pun|actualizez|actualizeaza|readuc|readuce|revin|revina|restabil|inapoi|vreau sa pun|as vrea sa pun|trebuie sa fie din nou)/;
const NUMBER = /(\d+(?:[.,]\d+)?)/;

export function parseWriteIntent(message: string): ParsedWriteIntent | { error: string } | null {
  const t = norm(convertRomanianNumberWords(norm(message)));
  // Programul poate fi exprimat si fara verb explicit: "Sambata sa fie activa de la 08:00 la 14:00"
  const isSchedulePhrase = Object.keys(DAYS).some((d) => new RegExp('(^| )' + d + '( |$)').test(t)) && /sa fie|sa incepem|sa terminam|sa pornim|de la \d|la \d|schimb|modific|setez|actualizez|pune|pun/.test(t);
  if (!WRITE_VERB.test(t) && !isSchedulePhrase) return null;

  // --- PROGRAM DE LUCRU ---
  const dayMatch = Object.keys(DAYS).find((d) => new RegExp('(^| )' + d + '( |$)').test(t));
  if (dayMatch) {
    const day = DAYS[dayMatch];
    const timeMatch = /de la (\d{1,2}[:.]\d{2}) la (\d{1,2}[:.]\d{2})|de la (\d{1,2}[:.]\d{2})|(?:\b|^)(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})/.exec(t);
    const singleHour = /(?:la|ora|de la)\s+(\d{1,2})(?:[:.](\d{2}))?( |$)/.exec(t);
    const activeOff = /(inactiva|inactive|neactiva|inchis)/.test(t);
    const activeOn = /(activa|active|activ)( |$)/.test(t) && !activeOff;
    const changes: Record<string, unknown> = {};
    let startOnly = false;
    if (timeMatch) {
      const s = validateTimeHHMM(timeMatch[1] ?? timeMatch[3] ?? timeMatch[4]);
      const e = timeMatch[2] !== undefined || timeMatch[5] !== undefined ? validateTimeHHMM(timeMatch[2] ?? timeMatch[5]) : null;
      if (!s.ok) return { error: s.error };
      if (e && !e.ok) return { error: e.error };
      if (e && s.value >= e.value) return { error: 'Ora de inceput trebuie sa fie inainte de ora de sfarsit.' };
      changes[day + '_active'] = true;
      changes[day + '_start'] = s.value;
      if (e) changes[day + '_end'] = e.value;
      else startOnly = true;
    } else if (activeOff) {
      changes[day + '_active'] = false;
    } else if (activeOn) {
      // "schimba sambata sa fie activa" — se pastreaza orele existente (completate in handler)
      changes[day + '_active'] = true;
      startOnly = true;
    } else if (singleHour) {
      // "schimba programul de luni la 8" — ora de start; finalul se pastreaza din programul curent
      const s = validateTimeHHMM(singleHour[1] + ':' + (singleHour[2] ?? '00'));
      if (!s.ok) return { error: s.error };
      changes[day + '_active'] = true;
      changes[day + '_start'] = s.value;
      startOnly = true;
    } else {
      return { error: 'Nu am inteles noul program. Exemplu: "Sambata sa fie activa de la 08:00 la 14:00" sau "schimba programul de luni la 8".' };
    }
    return {
      action: 'update_schedule',
      changes,
      summary: DAY_LABELS[day] + ': ' + (changes[day + '_active'] === false ? 'inactiva' : 'activa ' + (changes[day + '_start'] ?? '(ore neschimbate)') + (changes[day + '_end'] ? '-' + changes[day + '_end'] : '')),
      ...(startOnly ? { fillFromCurrent: day } : {}),
    };
  }

  // --- TVA ---
  if (/(^| )tva( |$)|cota tva/.test(t)) {
    const m = NUMBER.exec(t);
    if (!m) return { error: 'Nu am inteles noua cota TVA. Exemplu: "Schimba TVA la 19%".' };
    const v = validateVatValue(m[1]);
    if (!v.ok) return { error: v.error };
    return { action: 'update_rates', changes: { vat_rate: v.value }, summary: 'TVA: ' + v.value + '%' };
  }

  // --- TARIFE ---
  const rateEntry = Object.entries(RATE_FIELDS).find(([k]) => new RegExp('(^| )' + k + '( |$)').test(t));
  if (rateEntry) {
    // "de la 100 la 101" -> valoarea NOUA este a doua (101), nu prima (100)
    const rangeM = /de la (\d+(?:[.,]\d+)?)\s*(?:lei\s*(?:\/\s*)?ora)?\s+la\s+(\d+(?:[.,]\d+)?)/.exec(t);
    const m = rangeM ? rangeM[2] : NUMBER.exec(t)?.[1];
    if (!m) return { error: 'Nu am inteles noua valoare. Exemplu: "Schimba tariful normal la 120 lei".' };
    const v = validateRateValue(m);
    if (!v.ok) return { error: v.error };
    const f = rateEntry[1] as { key: RateKey; label: string; unit: string };
    return { action: 'update_rates', changes: { [f.key]: v.value }, summary: f.label + ': ' + v.value + ' ' + f.unit };
  }

  return null; // nu este o intentie WRITE cunoscuta
}

// ---------------------------------------------------------------------
// COMPLETARE ORE LIPSA DIN PROGRAMUL CURENT (ex: "luni sa incepem la 8")
// Returneaza un mesaj de eroare daca nu se poate completa in siguranta,
// sau null daca changes este complet.
// ---------------------------------------------------------------------
export function fillScheduleFromCurrent(
  parsed: ParsedWriteIntent,
  current: Record<string, unknown>
): string | null {
  const day = parsed.fillFromCurrent;
  if (!day) return null;
  const curStart = current[day + '_start'];
  const curEnd = current[day + '_end'];
  if (parsed.changes[day + '_active'] === true && !parsed.changes[day + '_start']) {
    if (!curStart || !curEnd) {
      return 'Nu am ore salvate pentru ' + DAY_LABELS[day] + '. Spune-mi intervalul complet, de exemplu: "08:00 - 17:00".';
    }
    parsed.changes[day + '_start'] = curStart;
    parsed.changes[day + '_end'] = curEnd;
    parsed.summary = DAY_LABELS[day] + ': activa ' + curStart + '-' + curEnd + ' (ore neschimbate)';
  } else if (parsed.changes[day + '_start'] && !parsed.changes[day + '_end']) {
    if (!curEnd) {
      return 'Nu am ora de sfarsit pentru ' + DAY_LABELS[day] + '. Spune-mi intervalul complet, de exemplu: "de la 08:00 la 17:00".';
    }
    parsed.changes[day + '_end'] = curEnd;
    parsed.summary = DAY_LABELS[day] + ': activa ' + parsed.changes[day + '_start'] + '-' + curEnd;
  }
  return null;
}

// ---------------------------------------------------------------------
// CITIRE VALORI ACTUALE (read inainte de write)
// ---------------------------------------------------------------------
async function readCurrentRates(): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from('rates').select('*').order('id').limit(1);
  if (error) return {};
  if (!data?.[0]) return {};
  return data[0] as Record<string, unknown>;
}

async function readCurrentSchedule(): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from('work_schedule').select('*').eq('active', true).order('id').limit(1);
  if (error || !data?.[0]) return null;
  return data[0] as Record<string, unknown>;
}

// ---------------------------------------------------------------------
// PREVIEW
// ---------------------------------------------------------------------
function buildRatesPreview(changes: Record<string, unknown>, current: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const units: Record<string, string> = {
    normal_rate: 'lei/oră', urgent_rate: 'lei/oră', overtime_rate: 'lei/oră',
    warranty_rate: 'lei/oră', vat_rate: '%',
  };
  const labels: Record<string, string> = {
    normal_rate: 'Tariful normal', urgent_rate: 'Tariful urgent',
    overtime_rate: 'Tariful overtime', warranty_rate: 'Tariful garanție', vat_rate: 'TVA',
  };
  for (const [k, v] of Object.entries(changes)) {
    lines.push(labels[k] + ' actual: ' + (current[k] ?? 'necunoscut') + ' ' + units[k] + '.');
    lines.push(labels[k] + ' nou: ' + v + ' ' + units[k] + '.');
  }
  lines.push('', 'Confirmi modificarea?');
  return lines;
}

function buildSchedulePreview(changes: Record<string, unknown>, current: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const day = Object.keys(changes)[0].replace(/_(active|start|end)$/, '');
  const curActive = current[day + '_active'] ?? false;
  lines.push(DAY_LABELS[day] + ' este momentan ' + (curActive ? 'activă (' + current[day + '_start'] + '-' + current[day + '_end'] + ')' : 'inactivă') + '.');
  if (changes[day + '_active'] === false) {
    lines.push('Program nou: inactivă.');
  } else {
    lines.push('Noul program:');
    lines.push('Activă: Da');
    lines.push('Început: ' + changes[day + '_start']);
    lines.push('Sfârșit: ' + changes[day + '_end']);
  }
  lines.push('', 'Confirmi modificarea?');
  return lines;
}

// ---------------------------------------------------------------------
// FAZA 2B ETAPA 2 — MAȘINI + CLIENȚI (pe `cars`)
// În această aplicație clientul NU este o entitate separată: datele client
// sunt câmpuri pe tabela `cars` (client_name, client_phone, client_email).
// create_client independent rămâne BLOCAT (limitare de arhitectură).
// ---------------------------------------------------------------------

export interface ParsedCarIntent {
  action: 'create_car' | 'update_car' | 'update_client';
  changes: Record<string, unknown>;
  cars?: Record<string, unknown>[];
  plate?: string;
  clientName?: string;
  summary: string;
}

interface CarFieldDef {
  field: string;
  keys: string[];
  label: string;
  kind: 'car' | 'client';
  numeric?: boolean;
  min?: number;
  max?: number;
}

const CAR_UPDATE_FIELDS: CarFieldDef[] = [
  { field: 'model', keys: ['modelul', 'model'], label: 'Model', kind: 'car' },
  { field: 'make', keys: ['marca', 'marka', 'make'], label: 'Marcă', kind: 'car' },
  { field: 'color', keys: ['culoarea', 'culoare'], label: 'Culoare', kind: 'car' },
  { field: 'year', keys: ['anul'], label: 'An', kind: 'car', numeric: true, min: 1950, max: 2100 },
  { field: 'vin', keys: ['vin', 'sasiu', 'serie sasiu'], label: 'VIN', kind: 'car' },
  { field: 'mileage', keys: ['kilometrajul', 'kilometraj', 'kilometru'], label: 'Kilometraj', kind: 'car', numeric: true, min: 0, max: 3000000 },
  { field: 'client_phone', keys: ['telefonul', 'telefon'], label: 'Telefon', kind: 'client' },
  { field: 'client_email', keys: ['email', 'mail'], label: 'Email', kind: 'client' },
  { field: 'client_name', keys: ['numele clientului', 'proprietarul', 'clientul'], label: 'Client', kind: 'client' },
];

const PLATE_STOPWORDS = new Set(['km', 'lei', 'ani', 'vin', 'la', 'in', 'cu', 'si']);

function wordAt(t: string, word: string): boolean {
  return new RegExp('(^| )' + word + '( |$)').test(t);
}

/** Extrage numarul de inmatriculare din textul original (suporta "B123ABC" si "TM 27 FXC"). */
function scanPlate(message: string): string | undefined {
  const tokens = message.toUpperCase().replace(/[,.;:!?]/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/^[A-Z]{1,2}\d{2,3}[A-Z]{1,4}$/.test(tok)) return tok;
    if (
      /^[A-Z]{1,2}\d{2,3}$/.test(tok) && tokens[i + 1] &&
      /^[A-Z]{1,4}$/.test(tokens[i + 1]) && !PLATE_STOPWORDS.has(tokens[i + 1].toLowerCase()) &&
      !PLATE_STOPWORDS.has(tok.toLowerCase())
    ) return tok + tokens[i + 1];
    if (
      /^[A-Z]{1,2}$/.test(tok) && !PLATE_STOPWORDS.has(tok.toLowerCase()) && tokens[i + 1] &&
      /^\d{2,3}$/.test(tokens[i + 1]) && tokens[i + 2] &&
      /^[A-Z]{1,4}$/.test(tokens[i + 2]) && !PLATE_STOPWORDS.has(tokens[i + 2].toLowerCase())
    ) return tok + tokens[i + 1] + tokens[i + 2];
  }
  return undefined;
}

/** Valoarea noua = textul de dupa ULTIMA aparitie a lui "in/la/cu/în" (pastreaza diacriticele). */
function extractNewValue(message: string): string | undefined {
  const re = /\s(?:în|in|la|cu)\s/gi;
  let last: RegExpExecArray | null = null;
  let m2: RegExpExecArray | null;
  while ((m2 = re.exec(message)) !== null) last = m2;
  if (!last) return undefined;
  return message.slice(last.index + last[0].length).trim().replace(/[.,;!?]+$/, '').trim() || undefined;
}

function extractOwnerName(message: string): string | undefined {
  const m = /(?:\blui\b|\bclientului\b|\bproprietarului\b)\s+([A-Za-zĂÂÎȘȚăâîșț.\- ]+?)(?=\s+(?:la|in|în)\b|[.,;!?]|$)/i.exec(message);
  const name = m?.[1]?.trim();
  return name || undefined;
}

function extractPhone(message: string): string | undefined {
  const explicit = /(?:telefon(?:ul)?|tel\.?)\s*(?:este|e|:)?\s*([0-9][0-9 .()\-\u00a0]{5,})/i.exec(message);
  if (explicit) return explicit[1].replace(/\D/g, '') || undefined;
  const bare = /(^|[\s,])(0\d{9}|\+?4\s?0\s?7\d{8})(?=$|[\s,.])/i.exec(message);
  if (bare) return bare[2].replace(/\D/g, '');
  return undefined;
}

function extractNameAfter(message: string, keywords: string[]): string | undefined {
  const re = new RegExp('(?:' + keywords.join('|') + ')\\s*:?\\s*([A-Za-zĂÂÎȘȚăâîșț0-9.\\- ]+?)(?=\\s+(?:cu|pentru|client(?:ul)?|telefon|marca|marcă|model|vin|serie|kilometraj|km|la|in|în|an)\\b|[.,;!?]|$)', 'i');
  const m = re.exec(message);
  const v = m?.[1]?.trim().replace(/\s+/g, ' ');
  return v || undefined;
}

export function parseCarWriteIntent(message: string, allowMissingMileage = false): ParsedCarIntent | { error: string } | null {
  const t = norm(message);
  const hasCarWord = wordAt(t, 'masina') || wordAt(t, 'masini') || wordAt(t, 'masinile') || wordAt(t, 'masinii') || wordAt(t, 'auto') || wordAt(t, 'vehicul') || wordAt(t, 'client') || wordAt(t, 'clientul');
  const isCreate = /(adaug|creeaz|inregistreaz|masina noua|noua masina|client nou)/.test(t);

  if (isCreate && hasCarWord) {
    const numberedBlocks = message.split(/(?:^|\s)\d+\.\s*(?=(?:număr|numar)\s*:)/i).filter((block) => /(?:număr|numar|client|marc[ăa]|model|telefon)\s*:/i.test(block));
    if (numberedBlocks.length > 1) {
      const cars = numberedBlocks.map((block) => parseCarWriteIntent(`Creează o mașină ${block}`, true)).filter((parsed): parsed is ParsedCarIntent => Boolean(parsed && !('error' in parsed) && parsed.action === 'create_car')).map((parsed) => parsed.changes);
      if (cars.length !== numberedBlocks.length) return { error: 'Nu am putut extrage toate mașinile. Verifică numărul, clientul, marca și modelul pentru fiecare.' };
      return { action: 'create_car', changes: cars[0], cars, summary: `Creare ${cars.length} mașini noi` };
    }
    const plate = scanPlate(message);
    const phone = extractPhone(message);
    const clientName = extractNameAfter(message, ['clientul', 'client', 'pentru clientul']);
    const make = extractNameAfter(message, ['marca', 'marcă']);
    const model = extractNameAfter(message, ['modelul', 'model']);
    let mileage: number | undefined;
    const mM = /(?:kilometraj(?:ul)?\s*(?:este|e|:)?\s*(\d{2,7})|(\d{2,7})\s*(?:km|kilometri))/i.exec(message);
    if (mM) mileage = Number(mM[1] ?? mM[2]) || undefined;
    const vinM = /(?:vin|serie\s+sasiu|sasiu)\s*[: ]\s*([A-HJ-NPR-Z0-9]{6,17})/i.exec(message);
    const vin = vinM?.[1]?.toUpperCase();

    const missing: string[] = [];
    if (!plate) missing.push('numărul de înmatriculare al mașinii');
    if (!clientName) missing.push('numele clientului');
    if (mileage === undefined && !allowMissingMileage) missing.push('kilometrajul');
    if (missing.length > 0) {
      return {
        error: 'Pentru a exista un client în sistem, acesta este asociat unei mașini. ' +
          'Mai am nevoie de: ' + missing.join(', ') + '. ' +
          'Exemplu: "Adaugă mașina B123ABC pentru clientul Ion Popescu, marca BMW, model X5, kilometraj 150000, telefon 0712345678".',
      };
    }
    if (phone && (phone.length < 6 || phone.length > 15)) {
      return { error: 'Numărul de telefon nu pare valid.' };
    }
    const changes: Record<string, unknown> = {
      license_plate: plate, client_name: clientName, mileage,
      client_phone: phone ?? null, client_email: null,
      make: make ?? null, model: model ?? null, vin: vin ?? null,
    };
    return { action: 'create_car', changes, summary: 'Mașină nouă ' + plate + ' pentru ' + clientName };
  }


  // "Mută mașina B123ABC la Ion Popescu" -> schimbare client (permisă ca update_client)
  if (wordAt(t, 'muta') && (wordAt(t, 'masina') || wordAt(t, 'masinii') || wordAt(t, 'auto'))) {
    const plate = scanPlate(message);
    const val = extractNewValue(message);
    if (!plate || !val) {
      return { error: 'Nu am înțeles mutarea. Exemplu: "Mută mașina B123ABC la Ion Popescu".' };
    }
    return { action: 'update_client', changes: { client_name: val }, plate, summary: 'Mutare mașina ' + plate + ' la ' + val };
  }

  // Update camp masina / client
  if (/(schimba|modific|setez|actualizez|pune)/.test(t)) {
    const def = CAR_UPDATE_FIELDS.find((d) => d.keys.some((k) => (k.includes(' ') ? t.includes(' ' + k) : wordAt(t, k))));
    if (def) {
      const val = extractNewValue(message);
      if (!val) {
        return { error: 'Nu am înțeles noua valoare. Exemplu: "Schimbă modelul mașinii B123ABC în X3".' };
      }
      let value: string | number = val;
      if (def.field === 'client_phone') {
        const digits = val.replace(/\D/g, '');
        if (digits.length < 6 || digits.length > 15) return { error: 'Numărul de telefon nu pare valid.' };
        value = digits;
      }
      if (def.numeric) {
        if (/^\s*-\d/.test(val)) return { error: def.label + ' nu poate fi negativ.' };
        const n = Number(val.replace(/[^\d.]/g, ''));
        if (!Number.isFinite(n) || (def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) {
          return { error: def.label + ' nu este o valoare validă.' };
        }
        value = Math.round(n);
      }
      const plate = scanPlate(message);
      const clientName = extractOwnerName(message);
      if (!plate && !clientName) {
        return { error: 'Spune-mi ce mașină modificăm (număr de înmatriculare) sau al cui client schimbăm datele. Exemplu: "Schimbă telefonul lui Ion Popescu la 0712345678".' };
      }
      const action: 'update_car' | 'update_client' = def.kind === 'client' ? 'update_client' : 'update_car';
      return { action, changes: { [def.field]: value }, plate, clientName, summary: def.label + ': ' + value };
    }
  }

  return null;
}

// ---------------------------------------------------------------------
// CITIRE / IDENTIFICARE MAȘINI
// ---------------------------------------------------------------------

function normPlate(p: unknown): string {
  return String(p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normName(n: unknown): string {
  return norm(String(n ?? ''));
}

type CarRow = Record<string, unknown>;

async function loadNonDemoCars(): Promise<CarRow[] | null> {
  if (registry.kind === 'local') {
    const { data, error } = await dataAdapter.getCars();
    return error ? null : (data ?? []) as unknown as CarRow[];
  }
  const { data, error } = await supabase
    .from('cars')
    .select('id, license_plate, internal_id, client_name, client_phone, client_email, make, model, year, vin, mileage')
    .eq('is_demo', false);
  if (error) return null;
  return (data ?? []) as CarRow[];
}

async function readCarById(id: string): Promise<CarRow | null> {
  if (registry.kind === 'local') {
    const { data, error } = await dataAdapter.getCars();
    return error ? null : ((data ?? []).find((car) => car.id === id) as unknown as CarRow | undefined) ?? null;
  }
  const { data, error } = await supabase.from('cars').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as CarRow;
}

function carLabel(car: CarRow): string {
  return [car.license_plate, [car.make, car.model].filter(Boolean).join(' ')].filter(Boolean).join(' — ');
}

function valuesMatch(field: string, actual: unknown, proposed: unknown): boolean {
  if (field === 'mileage' || field === 'year') return Number(actual) === Number(proposed);
  return String(actual ?? '').trim() === String(proposed ?? '').trim();
}

// ---------------------------------------------------------------------
// PREVIEW MAȘINI / CLIENTI
// ---------------------------------------------------------------------

function buildCarCreatePreview(changes: Record<string, unknown>): string[] {
  const lines: string[] = ['Mașină nouă:'];
  lines.push('Număr: ' + changes.license_plate);
  lines.push('Client: ' + changes.client_name);
  if (changes.client_phone) lines.push('Telefon: ' + changes.client_phone);
  if (changes.make || changes.model) lines.push('Marcă / Model: ' + [changes.make, changes.model].filter(Boolean).join(' '));
  if (changes.vin) lines.push('VIN: ' + changes.vin);
  if (changes.mileage !== undefined && changes.mileage !== null) lines.push('Kilometraj: ' + changes.mileage + ' km');
  lines.push('', 'Confirmi crearea?');
  return lines;
}

function buildCarBatchCreatePreview(cars: Record<string, unknown>[], existingPlates: string[] = []): string[] {
  const lines = ['PREVIEW — CREARE MAȘINI', ''];
  if (existingPlates.length > 0) {
    lines.push(`Deja existente, nu vor fi create: ${existingPlates.join(', ')}`);
    lines.push('');
  }
  for (const [index, car] of cars.entries()) {
    lines.push(`${index + 1}. ${car.license_plate} — ${[car.make, car.model].filter(Boolean).join(' ') || 'fără marcă/model'}`);
    lines.push(`   Client: ${car.client_name}`);
    if (car.client_phone) lines.push(`   Telefon: ${car.client_phone}`);
    lines.push('');
  }
  lines.push('Confirmi crearea?');
  return lines;
}

function buildCarUpdatePreview(car: CarRow, changes: Record<string, unknown>): string[] {
  const labels: Record<string, string> = {
    model: 'Model', make: 'Marcă', color: 'Culoare', year: 'An', vin: 'VIN', mileage: 'Kilometraj',
    client_name: 'Client', client_phone: 'Telefon', client_email: 'Email',
  };
  const lines: string[] = ['Mașină: ' + carLabel(car)];
  if (changes.client_name || changes.client_phone || changes.client_email) {
    lines.push('Client actual: ' + (car.client_name ?? '—'));
  }
  for (const [k, v] of Object.entries(changes)) {
    lines.push(labels[k] + ' actual: ' + (car[k] ?? '—'));
    lines.push(labels[k] + ' nou: ' + v);
  }
  lines.push('', 'Confirmi modificarea?');
  return lines;
}


// ---------------------------------------------------------------------
// PREGATIRE OPERATIE MASINA / CLIENT (identificare exacta -> pending)
// ---------------------------------------------------------------------

const CLIENT_ONLY_FIELDS = ['client_name', 'client_phone', 'client_email'];

async function prepareCarOperation(parsed: ParsedCarIntent): Promise<AgentFlowResponse> {
  const cars = await loadNonDemoCars();
  if (!cars) return { success: false, text: 'Nu am putut citi mașinile pentru verificare.' };

  if (parsed.action === 'create_car') {
    const creates = parsed.cars ?? [parsed.changes];
    const duplicatePlates = creates.filter((create) => cars.some((car) => normPlate(car.license_plate) === normPlate(create.license_plate))).map((create) => String(create.license_plate));
    const repeatedPlates = creates.map((create) => normPlate(create.license_plate)).filter((plate, index, all) => all.indexOf(plate) !== index);
    if (repeatedPlates.length > 0) {
      const plates = [...new Set(repeatedPlates)].join(', ');
      return {
        success: false,
        text: 'Cererea conține numere duplicate: ' + plates + '. Corectează cererea înainte de confirmare.',
      };
    }
    const newCars = creates.filter((create) => !duplicatePlates.includes(String(create.license_plate)));
    if (newCars.length === 0) return { success: false, text: `Toate mașinile există deja: ${duplicatePlates.join(', ')}. Nimic nu a fost creat.` };
    const params = newCars.length === 1 ? newCars[0] : { cars: newCars };
    pending = createPendingOperation('create_car', { license_plate: newCars.map((car) => car.license_plate).join(', ') }, params);
    pendingPlan = { kind: 'create_car', description: parsed.summary, params };
    pendingPreviewLines = creates.length === 1 ? buildCarCreatePreview(newCars[0]) : buildCarBatchCreatePreview(newCars, duplicatePlates);
    flowState = 'awaiting_confirmation';
    return {
      success: true,
      text: pendingPreviewLines.join('\n'),
      pending: { operationId: pending.operationId, action: pending.action, lines: pendingPreviewLines },
    };
  }

  // UPDATE: identificare exacta -> numar de inmatriculare, apoi VIN, apoi nume client
  let candidates: CarRow[] = [];
  if (parsed.plate) {
    const plate = normPlate(parsed.plate);
    candidates = cars.filter((c) => normPlate(c.license_plate) === plate);
    if (candidates.length === 0) {
      candidates = cars.filter((c) => normPlate(c.vin) === plate);
    }
  } else if (parsed.clientName) {
    const name = normName(parsed.clientName);
    candidates = cars.filter((c) => normName(c.client_name) === name);
  }
  if (candidates.length === 0) {
    return { success: false, text: 'Nu am găsit mașina căutată. Verifică numărul de înmatriculare.' };
  }
  if (candidates.length > 1) {
    const list = candidates.slice(0, 10).map((c, i) =>
      (i + 1) + '. ' + carLabel(c) + ' — client: ' + (c.client_name ?? '—') + (c.internal_id ? ' (' + c.internal_id + ')' : '')
    ).join('\n');
    return {
      success: false,
      text: 'Am găsit mai multe mașini care se potrivesc. Precizează exact care (număr de înmatriculare sau ID intern):\n\n' + list,
    };
  }

  const car = candidates[0];
  const action: 'update_car' | 'update_client' =
    parsed.action === 'update_client' && Object.keys(parsed.changes).every((k) => CLIENT_ONLY_FIELDS.includes(k))
      ? 'update_client'
      : 'update_car';

  // Daca valorile propuse sunt identice cu cele existente -> nicio scriere.
  if (Object.entries(parsed.changes).every(([k, v]) => valuesMatch(k, car[k], v))) {
    return { success: false, text: 'Valoarea este deja aceasta. Nimic nu a fost modificat.' };
  }

  pending = createPendingOperation(action, { car_id: car.id }, parsed.changes);
  pendingPlan = { kind: action, description: parsed.summary, params: { ...parsed.changes, car_id: car.id } };
  pendingPreviewLines = buildCarUpdatePreview(car, parsed.changes);
  flowState = 'awaiting_confirmation';
  return {
    success: true,
    text: pendingPreviewLines.join('\n'),
    pending: { operationId: pending.operationId, action: pending.action, lines: pendingPreviewLines },
  };
}


// ---------------------------------------------------------------------
// EXECUTIE + READ-BACK
// ---------------------------------------------------------------------
async function executeWithReadBack(plan: WritePlan, changes: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  const result = await executeWrite(plan);
  if (!result.success) {
    // Mesajul din UI ramane prietenos; cauza reala se loghineaza pentru diagnostic.
    if (result.debugError) console.error(`[agent-write-flow] ${plan.kind} failed:`, result.debugError);
    flowState = 'error';
    return { ok: false, message: result.message };
  }
  // READ-BACK: nu presupunem ca operatia a reusit — recitim din baza de date.
  const changedKeys = Object.keys(changes);
  const NOT_CONFIRMED = 'Operația a fost trimisă, dar nu am putut confirma rezultatul.';
  if (plan.kind === 'update_rates') {
    const fresh = await readCurrentRates();
    if (!fresh || changedKeys.some((k) => Number(fresh[k]) !== Number(changes[k]))) {
      flowState = 'error';
      return { ok: false, message: 'Modificarea nu a putut fi confirmată.' };
    }
  } else if (plan.kind === 'update_schedule') {
    const fresh = await readCurrentSchedule();
    if (!fresh || changedKeys.some((k) => fresh[k] !== changes[k])) {
      flowState = 'error';
      return { ok: false, message: 'Modificarea nu a putut fi confirmată.' };
    }
  } else if (plan.kind === 'create_car') {
    const creates = Array.isArray(plan.params.cars) ? plan.params.cars as Record<string, unknown>[] : [changes];
    const ids = result.ids ?? (result.id ? [result.id] : []);
    const readBackKeys = ['license_plate', 'client_name', 'client_phone', 'make', 'model', 'year', 'vin', 'mileage'];
    const verified = await Promise.all(ids.map(async (id, index) => {
      const fresh = await readCarById(id);
      const create = creates[index] ?? {};
      return Boolean(fresh) && !readBackKeys.some((key) => create[key] !== undefined && !valuesMatch(key, fresh![key], create[key]));
    }));
    if (ids.length !== creates.length || verified.some((value) => !value)) {
      flowState = 'error';
      return { ok: false, message: NOT_CONFIRMED };
    }
    const created = ids.map((id, index) => `${creates[index].license_plate} (ID: ${id})`).join('\n');
    flowState = 'success';
    return { ok: true, message: `Mașini create și confirmate:\n${created}` };
  } else if (plan.kind === 'update_car' || plan.kind === 'update_client') {
    const id = String(plan.params.car_id ?? '');
    const fresh = id ? await readCarById(id) : null;
    if (!fresh || changedKeys.some((k) => !valuesMatch(k, fresh[k], changes[k]))) {
      flowState = 'error';
      return { ok: false, message: NOT_CONFIRMED };
    }
  }
  flowState = 'success';
  return { ok: true, message: result.message };
}

// ---------------------------------------------------------------------
// CONFIRM / CANCEL — actioneaza DOAR pe pending operation exact
// ---------------------------------------------------------------------
export async function confirmPendingOperation(operationId: string): Promise<AgentFlowResponse> {
  if (!pending || !pendingPlan || pending.operationId !== operationId) {
    return { success: false, text: 'Nu există nicio operație în așteptarea confirmării.' };
  }
  const decision = parseConfirmation('da');
  if (!isWriteActionAllowed(pending.action) && !ADMIN_WRITE_EXECUTION_ENABLED) {
    pending = null; pendingPlan = null; pendingPreviewLines = [];
    flowState = 'cancelled';
    return { success: false, text: 'Operația a fost confirmată, dar execuția operațiilor administrative ale Agentului este momentan dezactivată.' };
  }
  const approval = evaluatePendingConfirmation(pending, decision);
  if (!approval.canExecute) {
    const msg = 'Operația nu poate fi executată: ' + approval.reason;
    flowState = 'cancelled'; pending = null; pendingPlan = null; pendingPreviewLines = [];
    return { success: false, text: msg };
  }
  const op = pending;
  flowState = 'executing';
  const res = await executeWithReadBack(pendingPlan, op.proposedChanges ?? {});
  pending = null; pendingPlan = null; pendingPreviewLines = [];
  return { success: res.ok, text: res.message };
}

export async function cancelPendingOperation(operationId: string): Promise<AgentFlowResponse> {
  if (!pending || pending.operationId !== operationId) {
    return { success: false, text: 'Nu există nicio operație în așteptarea confirmării.' };
  }
  pending = null; pendingPlan = null; pendingPreviewLines = [];
  flowState = 'cancelled';
  return { success: true, text: 'Modificarea a fost anulată. Nimic nu a fost schimbat.' };
}


// ---------------------------------------------------------------------
// HANDLER PRINCIPAL
// ---------------------------------------------------------------------

/** Mesajul pare o intrebare READ noua (nu un raspuns de confirmare). */
function looksLikeNewQuestion(message: string): boolean {
  const t = norm(message);
  return /^(cate|cati|cata|cat|care|ce|arata|afiseaza|lista|vezi|exista|cum|de ce|cand|unde|tarifele|programul)\b/.test(t) ||
    /\?\s*$/.test(message);
}

export async function handleAgentMessage(
  message: string,
  fallback: () => Promise<AgentFlowResponse>
): Promise<AgentFlowResponse> {
  const persistentManagement = await handlePersistentTestManagementMessage(message);
  if (persistentManagement) {
    return { success: persistentManagement.success, text: persistentManagement.success ? JSON.stringify(persistentManagement.data, null, 2) : (persistentManagement.error ?? 'Operația Faza 6 nu a reușit.') };
  }
  const testManagement = handleTestManagementMessage(message);
  if (testManagement) {
    return { success: testManagement.success, text: testManagement.success ? JSON.stringify(testManagement.data, null, 2) : (testManagement.error ?? 'Operația Faza 6 nu a reușit.') };
  }
  if (isFullTestCommand(message)) {
    const report = await runFullTestAndPersist();
    return { success: true, text: formatFullTestReport(report ?? buildFullTestReport()) };
  }
  if (isReadOnlyAuditIntent(message) && !hasExplicitWriteDirective(message)) return fallback();
  // 1) Daca exista pending, mesajul este tratat ca raspuns de confirmare.
  if (pending && pendingPlan && parseConfirmation(message).status !== 'ambiguous') {
    const decision = parseConfirmation(message);
    if (!isWriteActionAllowed(pending.action) && !ADMIN_WRITE_EXECUTION_ENABLED && decision.status === 'approved') {
      pending = null; pendingPlan = null; pendingPreviewLines = [];
      flowState = 'cancelled';
      return { success: false, text: 'Operația a fost confirmată, dar execuția operațiilor administrative ale Agentului este momentan dezactivată.' };
    }
    const approval = evaluatePendingConfirmation(pending, decision);
    if (decision.status === 'rejected') {
      pending = null; pendingPlan = null; pendingPreviewLines = [];
      flowState = 'cancelled';
      return { success: true, text: 'Am înțeles. Nu am efectuat nicio modificare.' };
    }
    if (approval.canExecute) {
      const op = pending;
      flowState = 'executing';
      const res = await executeWithReadBack(pendingPlan, op.proposedChanges ?? {});
      pending = null; pendingPlan = null; pendingPreviewLines = [];
      return { success: res.ok, text: res.message };
    }
    // Ambiguu + intrebare READ noua: pending-ul vechi NU se executa;
    // intrebarea este procesata normal, pending-ul ramane afisat.
    if (decision.status === 'ambiguous' && looksLikeNewQuestion(message)) {
      return fallback();
    }
    // Ambiguu -> re-cerem confirmare explicita (pending ramane activ)
    return {
      success: false,
      text: 'Răspunsul este ambiguu. Te rog confirmă explicit („Da, confirm") sau anulează („Nu").',
      pending: { operationId: pending.operationId, action: pending.action, lines: pendingPreviewLines },
    };
  }

  // 2) Intentie WRITE noua (tarife / program)?
  const parsed = parseWriteIntent(message);
  if (parsed) {
    if ('error' in parsed) {
      return { success: false, text: parsed.error };
    }
    if (!isWriteActionAllowed(parsed.action)) {
      return { success: false, text: 'Această operație de scriere nu este activată.' };
    }
    // Identificam datele actuale INAINTE de orice scriere.
    if (parsed.action === 'update_rates') {
      const current = await readCurrentRates();
      if (!current) return { success: false, text: 'Nu am putut citi tarifele actuale.' };
      pending = createPendingOperation('update_rates', { id: current.id }, parsed.changes);
      pendingPlan = { kind: 'update_rates', description: parsed.summary, params: parsed.changes };
      pendingPreviewLines = buildRatesPreview(parsed.changes, current);
    } else {
      const current = await readCurrentSchedule();
      if (!current) return { success: false, text: 'Nu am putut citi programul de lucru actual.' };
      const fillErr = fillScheduleFromCurrent(parsed, current);
      if (fillErr) return { success: false, text: fillErr };
      pending = createPendingOperation('update_schedule', { id: current.id }, parsed.changes);
      pendingPlan = { kind: 'update_schedule', description: parsed.summary, params: parsed.changes };
      pendingPreviewLines = buildSchedulePreview(parsed.changes, current);
    }
    flowState = 'awaiting_confirmation';
    // O noua solicitare inlocuieste orice pending anterior (A nu mai poate fi confirmat).
    return {
      success: true,
      text: pendingPreviewLines.join('\n'),
      pending: { operationId: pending.operationId, action: pending.action, lines: pendingPreviewLines },
    };
  }

  // 2b) Intentie WRITE masina / client (FAZA 2B ETAPA 2).
  const carParsed = parseCarWriteIntent(message);
  if (carParsed) {
    if ('error' in carParsed) {
      return { success: false, text: carParsed.error };
    }
    if (!isWriteActionAllowed(carParsed.action)) {
      return { success: false, text: 'Această operație de scriere nu este activată.' };
    }
    return await prepareCarOperation(carParsed);
  }

  // 2c) Faza 3B: intent administrativa previewable, dar execution blocked.
  const phase3Parsed = parsePhase3Intent(message);
  if (phase3Parsed) {
    if ('error' in phase3Parsed) return { success: false, text: phase3Parsed.error };
    pending = createPendingOperation(phase3Parsed.action, phase3Parsed.target, phase3Parsed.changes);
    pendingPlan = { kind: 'phase3_admin', description: phase3Parsed.action, params: phase3Parsed.changes };
    pendingPreviewLines = phase3Parsed.preview;
    flowState = 'awaiting_confirmation';
    return {
      success: true,
      text: pendingPreviewLines.join('\n'),
      pending: { operationId: pending.operationId, action: pending.action, lines: pendingPreviewLines },
    };
  }

  // 3) Confirmare fara pending -> nu se executa nimic.
  const loose = parseConfirmation(message);
  if (loose.status === 'approved') {
    return { success: false, text: 'Nu există nicio operație în așteptarea confirmării, deci nu am executat nimic.' };
  }

  // 4) READ / ANALYZE normal.
  return fallback();
}

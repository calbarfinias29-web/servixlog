import { useEffect, useMemo, useRef, useState } from 'react';
import { Home, CarFront, Wrench, History, UserRound, Clock3, Pause, Clock, Check, CheckCircle2, Play, Info, LogOut, X, Users, CalendarClock, FileBarChart, Settings } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { VehicleImage } from '@/components/VehicleImage';
import type { Car, Employee, Job, JobStatus, Schedule, ScheduleDay } from '@/types';

const C = {
  bg: '#0D0B14', card: '#181622', card2: '#1F1D2B',
  primary: '#7C3AED', primaryLight: '#A78BFA',
  green: '#22C55E', orange: '#F59E0B', red: '#EF4444',
  text: '#F3F4F6', sub: '#A1A1AA', border: '#2A2738',
};

type View = 'acasa' | 'masiniile' | 'lucrari' | 'istoric' | 'profil';

function getCarStatus(jobs: Job[]): JobStatus | 'none' {
  if (!jobs.length) return 'none';
  if (jobs.every((j) => j.status === 'finalizat')) return 'finalizat';
  if (jobs.some((j) => j.status === 'in_lucru')) return 'in_lucru';
  if (jobs.some((j) => j.status === 'asteptare_piese')) return 'asteptare_piese';
  return 'asteptare';
}

function minutesOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

// === TIMEZONE OBLIGATORIU: Europe/Bucharest ===
const TZ = 'Europe/Bucharest';
interface BchParts { y: number; mo: number; d: number; h: number; mi: number; s: number }
function bchParts(ms: number): BchParts {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const g = (t: string): number => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour') % 24, mi: g('minute'), s: g('second') };
}
function tzOffsetMs(ms: number): number {
  const p = bchParts(ms);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - ms;
}
function zonedMs(y: number, mo: number, d: number, h: number, mi: number): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const t = naive - tzOffsetMs(naive);
  return naive - tzOffsetMs(t);
}

export function getScheduleDay(schedule: Schedule, weekday: number): ScheduleDay {
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
  const name = names[weekday] ?? 'monday';
  const active = schedule[`${name}_active` as keyof Schedule];
  const start = schedule[`${name}_start` as keyof Schedule];
  const end = schedule[`${name}_end` as keyof Schedule];
  return {
    active: typeof active === 'boolean' ? active : weekday >= 1 && weekday <= 5,
    start: typeof start === 'string' ? start.slice(0, 5) : schedule.work_start.slice(0, 5),
    end: typeof end === 'string' ? end.slice(0, 5) : schedule.work_end.slice(0, 5),
  };
}
function inBreakNow(schedule: Schedule | null, ms: number): boolean {
  if (!schedule) return false;
  const p = bchParts(ms);
  const day = getScheduleDay(schedule, new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay());
  if (!day.active) return false;
  const n = p.h * 60 + p.mi;
  return n >= minutesOf(schedule.break_start) && n < minutesOf(schedule.break_end);
}
function afterHoursNow(schedule: Schedule | null, ms: number): boolean {
  if (!schedule) return false;
  const p = bchParts(ms);
  const day = getScheduleDay(schedule, new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay());
  return day.active && p.h * 60 + p.mi >= minutesOf(day.end);
}
// Fereastra legală pentru „CONTINUĂ PESTE PROGRAM”: 13:00–14:00 SAU 18:00–08:00.
function overtimeWindowOpen(schedule: Schedule | null, ms: number): boolean {
  if (!schedule) return false;
  const p = bchParts(ms);
  const day = getScheduleDay(schedule, new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay());
  const n = p.h * 60 + p.mi;
  if (!day.active) return true;
  return (n >= minutesOf(schedule.break_start) && n < minutesOf(schedule.break_end))
    || n >= minutesOf(day.end)
    || n < minutesOf(day.start);
}

// Suprapunerea unui interval [start,end] cu ferestrele zilnice (în secunde).
// 'normal' = work_start→break_start și break_end→work_end (plătit la tarif normal).
// 'ot'     = pauza de prânz 13:00–14:00 ȘI noaptea 18:00–08:00 (tarif suplimentar).
// Timpul din afara ferestrelor NU se contorizează nicăieri.
export function overlapSeconds(schedule: Schedule | null, startMs: number, endMs: number, kind: 'normal' | 'ot'): number {
  if (!schedule || endMs <= startMs) return 0;
  let total = 0;
  let cursor = startMs;
  for (let i = 0; i < 62 && cursor < endMs; i++) {
    const p = bchParts(cursor);
    const day = getScheduleDay(schedule, new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay());
    if (!day.active && kind === 'normal') { cursor = zonedMs(p.y, p.mo, p.d, 24, 0); continue; }
    if (!day.active && kind === 'ot') {
      const dayStart = zonedMs(p.y, p.mo, p.d, 0, 0);
      const dayEnd = zonedMs(p.y, p.mo, p.d, 24, 0);
      total += Math.max(0, Math.min(endMs, dayEnd) - Math.max(startMs, dayStart));
      cursor = dayEnd;
      continue;
    }
    const win: Array<[string, string]> = kind === 'normal'
      ? [[day.start, schedule.break_start], [schedule.break_end, day.end]]
      : [[schedule.break_start, schedule.break_end], [day.end, '24:00'], ['00:00', day.start]];
    const W = (t: string): number => zonedMs(p.y, p.mo, p.d, Math.floor(minutesOf(t) / 60), minutesOf(t) % 60);
    for (const [a, b] of win) {
      const wS = W(a); const wE = W(b);
      total += Math.max(0, Math.min(endMs, wE) - Math.max(startMs, wS));
    }
    cursor = zonedMs(p.y, p.mo, p.d, 24, 0);
  }
  return Math.floor(total / 1000);
}

export function fmt(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function km(mileage: number | null): string {
  return mileage != null ? `${mileage.toLocaleString('ro-RO')} km` : '— km';
}

function DusterImg() {
  return (
    <svg width="104" height="62" viewBox="0 0 104 62" aria-label="Mașină">
      <ellipse cx="52" cy="56" rx="44" ry="4" fill="rgba(0,0,0,0.45)" />
      <path d="M14 46 L12 30 Q12 24 18 22 L26 20 L34 12 Q37 9 43 9 L68 9 Q74 9 78 13 L86 20 L92 22 Q98 24 98 30 L96 46 Z" fill="#F4F4F5" stroke="#C9C9CF" strokeWidth="1" />
      <path d="M38 13 L48 13 L48 21 L32 21 Z" fill="#23202E" />
      <path d="M52 13 L66 13 Q69 13 71 15 L77 21 L52 21 Z" fill="#23202E" />
      <line x1="50" y1="12" x2="50" y2="44" stroke="#D8D8DD" strokeWidth="1" />
      <rect x="8" y="28" width="7" height="6" rx="1.5" fill="#E8E8EC" stroke="#BFBFC6" strokeWidth="0.8" />
      <rect x="95" y="28" width="7" height="6" rx="1.5" fill="#E8E8EC" stroke="#BFBFC6" strokeWidth="0.8" />
      <rect x="30" y="40" width="50" height="5" rx="2" fill="#2A2738" />
      <rect x="12" y="44" width="86" height="5" rx="2.5" fill="#3A3648" />
      <circle cx="30" cy="47" r="8" fill="#141220" stroke="#3A3648" strokeWidth="2" />
      <circle cx="30" cy="47" r="3.4" fill="#55515F" />
      <circle cx="80" cy="47" r="8" fill="#141220" stroke="#3A3648" strokeWidth="2" />
      <circle cx="80" cy="47" r="3.4" fill="#55515F" />
      <rect x="34" y="17" width="5" height="3" rx="1" fill="#DCDCE1" />
      <rect x="76" y="17" width="5" height="3" rx="1" fill="#DCDCE1" />
    </svg>
  );
}

function Card({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className} style={{ background: 'var(--surface)', border: `1px solid ${'var(--border)'}`, borderRadius: 14, padding: 12 }}>
      {title && <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-secondary)' }}>{title}</div>}
      {children}
    </div>
  );
}

function Timer({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center">
      <div className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="my-1.5 text-[34px] font-bold leading-none" style={{ color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{sub}</div>}
    </div>
  );
}

function Btn({ bg, icon, label, border, onClick, disabled }: { bg: string; icon: React.ReactNode; label: string; border?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-bold text-white transition active:scale-[0.98] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: bg, border: border ? `1px solid ${border}` : 'none' }}>
      {icon}{label}
    </button>
  );
}
export default function PanouAngajat({ employee, cars, schedule, onRefresh, onChange }: {
  employee: Employee; cars: Car[]; schedule: Schedule | null; onRefresh: () => Promise<void>; onChange?: () => void;
}) {
  const [selectedCarId, setSelectedCarId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showJobPicker, setShowJobPicker] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState<View>('acasa');
  const [showPicker, setShowPicker] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { const i = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(i); }, []);

  // === SINCRONIZARE EVENIMENTE AUTOMATE (Manual/Automat per angajat) ===
  // RPC idempotent (auto_sync_session): aplică evenimentele scadute conform
  // configurației angajatului, pe baza orei reale Europe/Bucharest.
  // Protecție anti-dublare în server (stare + session_event_log). NU modifică
  // logica orelor suplimentare, a butoanelor sau a pauzei — doar execută
  // automat evenimentele marcate AUTOMAT de administrator.
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useEffect(() => {
    let cancelled = false;
    const sync = async (forceRefresh = false): Promise<void> => {
      try {
        const { data } = await supabase.rpc('auto_sync_session', { p_employee_id: employee.id });
        // La schimbarea angajatului (forceRefresh) reîncărcăm întotdeauna datele:
        // sesiunea rămâne în backend (started_at nu e atins), dar snapshot-ul
        // afișat trebuie să fie la zi pentru timpul real acumulat.
        if (!cancelled && (data?.changed || forceRefresh)) await refreshRef.current();
      } catch { // rețea indisponibilă: reîncercăm la următorul tick
        if (!cancelled && forceRefresh) { try { await refreshRef.current(); } catch { /* ignore */ } }
      }
    };
    void sync(true);
    const i = window.setInterval(() => void sync(), 60_000);
    return () => { cancelled = true; window.clearInterval(i); };
  }, [employee.id]);

  // === DATE REALE DIN DB ===
  const myCars = useMemo(() => cars.filter((c) => c.assigned_employee_id === employee.id && getCarStatus(c.jobs ?? []) !== 'finalizat'), [cars, employee.id]);
  const selectedCar = cars.find((c) => c.id === selectedCarId) ?? myCars[0] ?? null;
  const activeJob = selectedCar?.jobs?.find((j) => j.status === 'in_lucru');
  const pendingJob = selectedCar?.jobs?.find((j) => j.status === 'asteptare_piese') ?? selectedCar?.jobs?.find((j) => j.status === 'asteptare');
  // Lucrarea ALEASĂ explicit de angajat (prin cheiță). Fără alegere → fallback pe fluxul vechi.
  const chosenJob = selectedJobId ? (selectedCar?.jobs ?? []).find((j) => j.id === selectedJobId) ?? null : null;
  const currentJob = activeJob ?? chosenJob ?? pendingJob ?? null;

  // === TIMER REAL (timestampuri DB + ferestre Europe/Bucharest) ===
  // Separare strictă: worked_seconds = DOAR ore normale; overtime_seconds = DOAR peste program.
  // Normal crește doar în 08:00–13:00 și 14:00–18:00.
  // Overtime crește doar în pauza 13:00–14:00 / după 18:00 ȘI doar dacă a fost pornit explicit
  // (is_overtime=true prin „CONTINUĂ PESTE PROGRAM”). La 14:00 segmentul de overtime din pauză
  // se oprește automat și normalul pornește automat — prin suprapunerea pe ferestre, fără click.
  const breakActive = inBreakNow(schedule, now);
  const afterHours = afterHoursNow(schedule, now);
  const otWindowOpen = overtimeWindowOpen(schedule, now);
  const running = Boolean(activeJob?.started_at);
  const isOvertimeActive = Boolean(activeJob?.is_overtime) && running;
  const runStartMs = activeJob?.started_at ? new Date(activeJob.started_at).getTime() : null;
  // Normalul live crește doar cu job pornit, doar în ferestrele normale
  // (după 18:00 suprapunerea dă 0 → normalul rămâne înghețat pentru restul zilei).
  const liveNormal = activeJob && runStartMs ? overlapSeconds(schedule, runStartMs, now, 'normal') : 0;
  // Overtime-ul live crește EXCLUSIV când a fost pornit explicit (is_overtime),
  // exclusiv în fereastra 13:00–14:00 / 18:00–08:00, de la momentul clickului.
  const liveOvertime = activeJob && runStartMs && isOvertimeActive ? overlapSeconds(schedule, runStartMs, now, 'ot') : 0;

  // Valorile salvate în DB sunt deja separate (vezi updateJob/handleOvertime).
  const storedNormal = currentJob ? currentJob.worked_seconds : 0;
  const storedOvertime = currentJob?.overtime_seconds ?? 0;
  const normalSeconds = storedNormal + (activeJob ? liveNormal : 0);
  const overtimeTotalSeconds = storedOvertime + (activeJob ? liveOvertime : 0);
  // „Timp total” = DOAR ore normale (worked_seconds + live normal).
  // overtime_seconds NU se adaugă la totalul orelor normale — e afișat separat la „Timp peste program”.
  const totalSeconds = normalSeconds;

  // === STATUS REAL ===
  let statusLabel = 'ÎN LUCRU'; let statusColor = 'var(--success)';
  if (!currentJob) { statusLabel = 'FĂRĂ LUCRARE'; statusColor = 'var(--text-secondary)'; }
  else if (isOvertimeActive) { statusLabel = 'PESTE PROGRAM'; statusColor = 'var(--secondary)'; }
  else if (running && breakActive) { statusLabel = 'PAUZĂ DE PRÂNZ'; statusColor = 'var(--warning)'; }
  else if (running && otWindowOpen) { statusLabel = 'PROGRAM ÎNCHEIAT'; statusColor = 'var(--secondary)'; }
  else if (!activeJob && currentJob.status === 'asteptare_piese') { statusLabel = 'AȘTEPTARE PIESE'; statusColor = 'var(--warning)'; }
  else if (!activeJob && currentJob.status === 'asteptare') { statusLabel = 'ÎN AȘTEPTARE'; statusColor = 'var(--text-secondary)'; }
  else if (currentJob.status === 'finalizat') { statusLabel = 'FINALIZAT'; statusColor = 'var(--success)'; }

  const observatii = selectedCar?.body_observations || selectedCar?.notes || currentJob?.description
    || (statusLabel === 'AȘTEPTARE PIESE' ? 'Așteptăm piese de la furnizor.' : '—');

  // === PROGRAM REAL DIN DB ===
  // Culorile sunt token-uri din temă: LUCRU = success (verde, vizibil în Dark),
  // PAUZĂ = warning, ORE SUPLIMENTARE = primary (mov).
  const program = schedule ? [
    { ore: `${schedule.work_start} - ${schedule.break_start}`, lbl: 'LUCRU', c: 'var(--success, #22C55E)' },
    { ore: `${schedule.break_start} - ${schedule.break_end}`, lbl: 'PAUZĂ', c: 'var(--warning, #F97316)' },
    { ore: `${schedule.break_end} - ${schedule.work_end}`, lbl: 'LUCRU', c: 'var(--success, #22C55E)' },
    { ore: `${schedule.work_end} - 22:00`, lbl: 'POSIBILE ORE SUPLIMENTARE', c: 'var(--primary, #6D35F2)' },
  ] : [
    { ore: '08:00 - 13:00', lbl: 'LUCRU', c: 'var(--success, #22C55E)' },
    { ore: '13:00 - 14:00', lbl: 'PAUZĂ', c: 'var(--warning, #F97316)' },
    { ore: '14:00 - 18:00', lbl: 'LUCRU', c: 'var(--success, #22C55E)' },
    { ore: '18:00 - 22:00', lbl: 'POSIBILE ORE SUPLIMENTARE', c: 'var(--primary, #6D35F2)' },
  ];

  // === ACȚIUNI REALE (UI → DB → UI) ===
  // Contabilitate separată: normalul merge în worked_seconds, overtime în overtime_seconds.
  // Minutele din afara ferestrelor (pauză fără continuare, după 18:00 fără continuare) NU se salvează.
  const reconcileRunning = (job: Job, nowMs: number): { worked_seconds: number; overtime_seconds: number } | null => {
    if (!job.started_at) return null;
    const S = new Date(job.started_at).getTime();
    return {
      worked_seconds: job.worked_seconds + overlapSeconds(schedule, S, nowMs, 'normal'),
      // FIX dublare: overtime_seconds primește DOAR segmentul overtime explicit.
      // Înainte se adăuga și overlap-ul normal aici → timpul normal dublat în overtime.
      overtime_seconds: (job.overtime_seconds ?? 0) + (job.is_overtime ? overlapSeconds(schedule, S, nowMs, 'ot') : 0),
    };
  };
// După o finalizare efectivă a unei lucrări, sincronizează cars.completed_at
  // DOAR dacă TOATE lucrările mașinii au acum status 'finalizat'. Aceeași logică
  // ca în admin (App.tsx updateJob). Rulează pe ambele căi de scriere (RPC și fallback)
  // pentru a acoperi finalizările făcute din panoul angajatului
  // (Admin → Mașini → Finalizate astăzi filtrează după cars.completed_at).
  const syncCarCompletion = async (job: Job, completedAt: string): Promise<void> => {
    const { data: carJobs, error: jobsErr } = await supabase.from('jobs').select('status').eq('car_id', job.car_id);
    if (jobsErr) {
      console.error('[syncCarCompletion]', formatDbError('SELECT jobs (verificare lucrări)', jobsErr));
      return;
    }
    if (!Array.isArray(carJobs) || carJobs.length === 0) return;
    if (carJobs.every((j) => j.status === 'finalizat')) {
      const { error: carErr } = await supabase.from('cars').update({ completed_at: completedAt }).eq('id', job.car_id);
      if (carErr) {
        console.error('[syncCarCompletion]', formatDbError('UPDATE cars.completed_at', carErr));
        setError('Lucrarea a fost finalizată, dar nu am putut sincroniza mașina (cars.completed_at).');
      }
    }
  };
  const updateJob = async (job: Job, status: JobStatus, key: string): Promise<void> => {
    if (busy) return;
    setBusy(key); setError('');
    let workedSeconds: number | null = null;
    let overtimeSeconds: number | null = null;
    let completedAt: string | null = null;
    if (status === 'in_lucru') {
      workedSeconds = job.worked_seconds;
      overtimeSeconds = job.overtime_seconds ?? 0;
    } else {
      const acc = reconcileRunning(job, Date.now());
      if (acc) {
        workedSeconds = acc.worked_seconds;
        overtimeSeconds = acc.overtime_seconds;
      }
    }
    if (status === 'finalizat') completedAt = new Date().toISOString();
    const { data, error: dbError } = await supabase.rpc('safe_update_job_status', {
      p_job_id: job.id,
      p_employee_id: employee.id,
      p_status: status,
      p_worked_seconds: workedSeconds,
      p_overtime_seconds: overtimeSeconds,
      p_completed_at: completedAt,
    });
    if (dbError) {
      // Cauza reală a erorii „Nu s-a putut actualiza lucrarea”: pe instanța
      // remote lipsă migrația 20260828100000 → RPC-ul safe_update_job_status
      // nu există (PostgREST PGRST202). Fallback controlat, cu EXACT aceeași
      // logică ca funcția din migrație (security: UPDATE pe jobs este permis
      // prin grant-urile coloanelor + politicile RLS existente ale aplicației;
      // nu se schimbă nimic din regulile de business):
      //   - status valid; started_at = NULL (timer oprit);
      //   - worked_seconds = doar timp normal reconciliat;
      //   - overtime_seconds = doar timp peste program;
      //   - completed_at doar la 'finalizat';
      //   - activity_log pentru audit.
      const code = (dbError as { code?: string | null }).code ?? '';
      if (code === 'PGRST202' || code === '404' || code === '42883') {
        const patch: Record<string, unknown> = { status, started_at: null };
        if (workedSeconds !== null) patch.worked_seconds = workedSeconds;
        if (overtimeSeconds !== null) patch.overtime_seconds = overtimeSeconds;
        if (completedAt) patch.completed_at = completedAt;
        const { error: upErr } = await supabase.from('jobs').update(patch).eq('id', job.id);
        if (!upErr) {
          await supabase.from('activity_log').insert({ employee_id: employee.id, car_id: job.car_id, job_id: job.id, action: status, detail: 'Angajatul a actualizat lucrarea' });
          if (status === 'finalizat' && completedAt) await syncCarCompletion(job, completedAt);
          await onRefresh(); setBusy(null); return;
        }
        const technical = formatDbError('UPDATE jobs (fallback)', upErr);
        console.error('[updateJob]', technical);
        setError(`Nu s-a putut actualiza lucrarea. ${technical}`);
        setBusy(null); return;
      }
      // Orice altă eroare reală (rețea, RLS etc.) este afișată complet — nu ascundem nimic.
      const technical = formatDbError('RPC safe_update_job_status', dbError);
      console.error('[updateJob]', technical);
      setError(`Nu s-a putut actualiza lucrarea. ${technical}`);
      setBusy(null); return;
    }
    if (data && data.ok === false) {
      setError(String(data?.reason));
      setBusy(null); return;
    }
    if (status === 'finalizat' && completedAt) await syncCarCompletion(job, completedAt);
    await onRefresh(); setBusy(null);
  };
  const handleStart = async (job: Job): Promise<void> => {
    if (busy || breakActive) return;
    setBusy('continua'); setError('');
    const { data, error: rpcError } = await supabase.rpc('safe_start_job', { p_job_id: job.id, p_employee_id: employee.id });
    if (rpcError || (data && data.ok === false)) { setError(rpcError ? 'Nu am putut porni lucrarea.' : String(data?.reason)); setBusy(null); return; }
    await onRefresh(); setBusy(null);
  };
  // „CONTINUĂ PESTE PROGRAM” / „OPREȘTE PESTE PROGRAM” — scrie EXCLUSIV prin
  // funcțiile RPC security-definer din migrația
  // 20260825120100_servix_split_time_accounting.sql:
  //   safe_start_overtime(p_job_id uuid, p_employee_id uuid) -> jsonb
  //   safe_stop_overtime(p_job_id uuid, p_employee_id uuid)  -> jsonb
  // Rolul anon NU are UPDATE direct pe public.jobs (intenționat), iar aceste
  // RPC-uri verifică ele înseși proprietatea mașinii și fereastra legală
  // (13:00–14:00 sau 18:00–08:00, Europe/Bucharest). Contabilitatea rămâne
  // separată server-side: worked_seconds = doar normal, overtime_seconds = doar peste program.
  const handleOvertime = async (job: Job, start: boolean): Promise<void> => {
    if (busy) return;
    if (!job.id) { setError('Lucrarea curentă nu are un ID valid.'); return; }
    setBusy(start ? 'start_ot' : 'stop_ot'); setError('');
    const rpcName = start ? 'safe_start_overtime' : 'safe_stop_overtime';
    const { data, error: rpcError } = await supabase.rpc(rpcName, { p_job_id: job.id, p_employee_id: employee.id });
    // Eroare de rețea / permisiuni / funcție inexistentă: afișăm eroarea reală,
    // NU modificăm UI-ul ca și cum operația ar fi reușit.
    if (rpcError) {
      const technicalError = formatDbError(`RPC ${rpcName} a eșuat`, rpcError);
      console.error('[overtime]', technicalError);
      setError(start
        ? `Nu am putut porni lucrarea peste program. ${technicalError}`
        : `Nu am putut opri lucrarea peste program. ${technicalError}`);
      setBusy(null); return;
    }
    // Refuz logic din funcție (fereastră ilegală, lucrarea nu-i alocată etc.).
    if (data && data.ok === false) {
      const reason = String(data.reason ?? 'Operația a fost refuzată de server.');
      console.error('[overtime]', `${rpcName} refuzat: ${reason}`);
      setError(reason);
      setBusy(null); return;
    }
    // Succes confirmat de server: timerul UI se recalculează din datele reale.
    await onRefresh(); setBusy(null);
  };
  const handleAssign = async (car: Car): Promise<void> => {
    if (busy) return;
    setBusy('assign'); setError('');
    const { data, error: rpcError } = await supabase.rpc('safe_assign_car', { p_car_id: car.id, p_employee_id: employee.id });
    if (rpcError || (data && data.ok === false)) { setError('Nu am putut aloca mașina.'); setBusy(null); return; }
    setSelectedCarId(car.id); setShowPicker(false); await onRefresh(); setBusy(null);
  };

  const availableCars = useMemo(() => cars.filter((c) => getCarStatus(c.jobs ?? []) !== 'finalizat' && (!c.assigned_employee_id || c.assigned_employee_id === employee.id)), [cars, employee.id]);
  const allMyJobs = useMemo(() => myCars.flatMap((c) => (c.jobs ?? []).map((j) => ({ car: c, job: j }))), [myCars]);

  // === SESIUNI ACTIVE (toți angajații, din date persistente) ===
  // Un angajat are sesiune activă dacă are vreun job 'in_lucru'. Timpul nu
  // depinde de angajatul afișat: fiecare sesiune trăiește în DB (started_at).
  const activeSessions = useMemo(() => new Set(
    cars.flatMap((c) => (c.jobs ?? []).filter((j) => j.status === 'in_lucru').map(() => c.assigned_employee_id)).filter((id): id is string => Boolean(id)),
  ).size, [cars]);

  // Meniu ANGAJAT — DOAR: Acasă, Lucrări, Mașini, Istoric (profilul rămâne în footer).
  // Fără secțiuni administrative: Clienți, Program, Rapoarte, Setări etc.
  const meniu = [
    { icon: <Home size={17} />, label: 'Acasă', activ: view === 'acasa', go: (): void => setView('acasa') },
    { icon: <Wrench size={17} />, label: 'Lucrări', activ: view === 'lucrari', go: (): void => setView('lucrari') },
    { icon: <CarFront size={17} />, label: 'Mașini', activ: view === 'masiniile', go: (): void => setView('masiniile') },
    { icon: <History size={17} />, label: 'Istoric', activ: view === 'istoric', go: (): void => setView('istoric') },
  ];

  const carImage = <VehicleImage car={selectedCar} fallback={<DusterImg />} className="h-[76px] w-[132px] flex-none rounded-xl object-contain" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)', padding: '2px' }} />;

  return (
    <div className="employee-shell min-h-screen" style={{ background: 'var(--background)' }}>
      <div className="employee-frame flex min-h-screen flex-col overflow-hidden lg:flex-row" style={{ border: `1px solid ${'var(--border)'}` }}>
        {/* SIDEBAR — tabletă landscape: 224px cu etichete; mobil: doar iconițe */}
        <aside className="employee-sidebar flex w-[76px] flex-none flex-col items-center py-3 lg:w-[219px] lg:items-stretch lg:px-4 lg:py-5" style={{ background: 'var(--sidebar)', borderRight: `1px solid ${'var(--border)'}` }}>
          <div className="mb-6 text-center text-[15px] font-extrabold leading-tight lg:text-left lg:text-[18px]">
            <span className="hidden lg:inline"><span style={{ color: 'var(--text-primary)' }}>Serv</span><span style={{ color: 'var(--primary)' }}>ix</span></span>
            <span className="lg:hidden"><span style={{ color: 'var(--text-primary)' }}>Serv</span><span style={{ color: 'var(--primary)' }}>ix</span></span>
          </div>
          <nav className="flex w-full flex-1 flex-col items-center gap-1.5 lg:items-stretch">
            {meniu.map((m) => (
              <button key={m.label} onClick={m.go} title={m.label}
                className="flex h-12 w-12 flex-none items-center justify-center gap-3 rounded-[10px] px-0 transition active:scale-[0.98] lg:h-12 lg:w-full lg:justify-start lg:px-4"
                style={{ background: m.activ ? 'var(--primary)' : 'transparent', color: m.activ ? '#FFFFFF' : 'var(--text-secondary)' }}>
                {m.icon}
                <span className="hidden text-[14px] font-semibold lg:inline">{m.label}</span>
              </button>
            ))}
          </nav>
          {/* FOOTER SIDEBAR — profil, deconectare, informații (conform machetei) */}
          <div className="mt-auto w-full border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <button onClick={() => setView('profil')} title="Profil" className="flex w-full items-center justify-center gap-2 rounded-lg px-2 py-2 transition active:scale-[0.98] hover:brightness-110 lg:justify-start">
              {employee.avatar_url
                ? <img src={employee.avatar_url} alt={employee.name} className="h-8 w-8 flex-none rounded-full object-cover" style={{ border: `1.5px solid ${'var(--primary)'}` }} />
                : <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[13px] font-bold" style={{ background: 'var(--card)', border: `1.5px solid ${'var(--primary)'}`, color: 'var(--secondary)' }}>{employee.name[0]}</span>}
              <span className="hidden min-w-0 flex-col items-start lg:flex">
                <span className="max-w-[130px] truncate text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>{employee.name}</span>
                <span className="flex items-center gap-1 text-[10.5px]" style={{ color: 'var(--text-secondary)' }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--success)' }} />{employee.role === 'admin' ? 'Administrator' : 'Angajat'}</span>
              </span>
            </button>
            {onChange && (
              <button onClick={onChange} title="Deconectare" className="flex w-full items-center justify-center gap-2 rounded-lg px-2 py-2 text-[13px] font-semibold transition active:scale-[0.98] lg:justify-start" style={{ color: 'var(--text-secondary)' }}>
                <LogOut size={16} />
                <span className="hidden lg:inline">Deconectare</span>
              </button>
            )}
            <div className="mt-2 hidden border-t pt-2 lg:block" style={{ borderColor: 'var(--border)' }}>
              <div className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>© 2026 Servix<br />Toate drepturile rezervate.</div>
              <div className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>Versiune 1.0.0 · <span style={{ color: 'var(--success)' }}>● Sistem online</span></div>
            </div>
          </div>
        </aside>

        {/* COLOANA DREAPTA */}
        <div className="min-w-0 flex-1">
          {/* HEADER — nume și oră REALE */}
          <header className="flex h-[64px] items-center justify-between px-5" style={{ background: 'var(--surface)', borderBottom: `1px solid ${'var(--border)'}` }}>
            <div className="flex items-center gap-5">
              <div className="text-[22px] font-extrabold tracking-tight">
                <span style={{ color: 'var(--text-primary)' }}>Serv</span><span style={{ color: 'var(--primary)' }}>ix</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock3 size={16} style={{ color: 'var(--text-secondary)' }} />
                <div>
                  <div className="text-[14px] font-bold leading-tight" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{new Date(now).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}</div>
                  <div className="text-[11px] capitalize leading-tight" style={{ color: 'var(--text-secondary)' }}>{new Date(now).toLocaleDateString('ro-RO', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              {onChange && (
                <button
                  onClick={onChange}
                  title="Schimbă angajatorul"
                  className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold uppercase tracking-wide transition active:scale-[0.98] hover:brightness-110"
                  style={{ background: 'var(--primary)', color: '#FFFFFF', border: '1px solid var(--primary)' }}
                >
                  <LogOut size={16} />
                  SCHIMBĂ ANGAJATUL
                </button>
              )}
              {employee.avatar_url
                ? <img src={employee.avatar_url} alt={employee.name} className="h-9 w-9 rounded-full border-2 object-cover" style={{ borderColor: 'var(--primary)' }} />
                : <span className="flex h-9 w-9 items-center justify-center rounded-full text-[14px] font-bold" style={{ background: 'var(--card)', border: `1.5px solid ${'var(--primary)'}`, color: 'var(--secondary)' }}>{employee.name[0]}</span>}
              <span className="flex items-center gap-1.5 text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>{employee.name}<span className="h-2 w-2 rounded-full" style={{ background: 'var(--success)' }} /></span>
            </div>
          </header>

          {/* CONȚINUT */}
          <main className="employee-content space-y-5 p-4 lg:p-5">
            {error && <div className="rounded-lg px-4 py-3 text-[13px] font-semibold" style={{ background: 'color-mix(in srgb, #EF4444 14%, transparent)', border: '1px solid color-mix(in srgb, #EF4444 35%, transparent)', color: '#F87171' }}>{error}</div>}

            {view === 'acasa' && <div className="employee-home grid grid-cols-1 gap-3">
              <Card title="Mașină curentă" className="employee-car">
              {selectedCar ? <div className="flex items-center gap-4">
                <div className="flex-none">{carImage}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-extrabold tracking-wide" style={{ color: 'var(--text-primary)' }}>{selectedCar.license_plate}</div>
                  <div className="truncate text-[13px] font-semibold" style={{ color: 'var(--secondary)' }}>{[selectedCar.make, selectedCar.model].filter(Boolean).join(' ') || '—'}</div>
                  <div className="truncate text-[12px]" style={{ color: 'var(--text-secondary)' }}>Client: {selectedCar.client_name || '—'}</div>
                  <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Kilometraj: {km(selectedCar.mileage)}</div>
                </div>
                <button onClick={() => setShowDetails(true)} className="h-10 flex-none rounded-lg px-4 text-[12px] font-bold text-white transition active:scale-[0.98] hover:brightness-110" style={{ background: 'var(--primary)' }}>DETALII</button>
              </div> : <div className="py-4 text-[13px]" style={{ color: 'var(--text-secondary)' }}>Nu ai nicio mașină alocată.</div>}
            </Card>

              <Card title="Timp lucrare" className="employee-timers grid grid-cols-3 grid-flow-row divide-x">
              <div className="flex flex-col items-center justify-center gap-0 px-2 text-center">
                <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--success) 16%, transparent)', color: 'var(--success)' }}><Clock size={15} /></span>
                <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Timp normal</span>
                <span className="text-[28px] font-extrabold leading-none" style={{ color: 'var(--success, #22C55E)', fontVariantNumeric: 'tabular-nums' }}>{fmt(normalSeconds)}</span>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>(în program)</span>
              </div>
              <div className="flex flex-col items-center justify-center gap-0 px-2 text-center">
                <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--warning) 16%, transparent)', color: 'var(--warning)' }}><Clock size={15} /></span>
                <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Timp peste program</span>
                <span className="text-[28px] font-extrabold leading-none" style={{ color: 'var(--warning, #F97316)', fontVariantNumeric: 'tabular-nums' }}>{fmt(overtimeTotalSeconds)}</span>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>(după program)</span>
              </div>
              <div className="flex flex-col items-center justify-center gap-0 px-2 text-center">
                <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--primary) 16%, transparent)', color: 'var(--primary)' }}><Clock size={15} /></span>
                <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Timp total</span>
                <span className="text-[28px] font-extrabold leading-none" style={{ color: 'var(--primary, #6D35F2)', fontVariantNumeric: 'tabular-nums' }}>{fmt(totalSeconds)}</span>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{'\u00A0'}</span>
              </div>
            </Card>
            {/* CONTROALE TOUCH — rând 1: PAUZĂ + CONTINUĂ PESTE PROGRAM, rând 2: FINALIZEAZĂ + AȘTEPT PIESE */}
            <div className="employee-controls grid grid-cols-2 gap-3">
              {activeJob ? (
                <>
                  <Btn bg={'var(--primary)'} icon={<Pause size={16} />} label="PAUZĂ" onClick={() => void updateJob(activeJob, 'asteptare', 'pauza')} disabled={busy !== null} />
                  <Btn bg={'var(--primary)'} icon={<Clock size={16} />} label="CONTINUĂ PESTE PROGRAM" onClick={() => void handleOvertime(activeJob, true)} disabled={busy !== null || !otWindowOpen || !running || isOvertimeActive} />
                  <Btn bg={'var(--danger)'} icon={<CheckCircle2 size={16} />} label="FINALIZEZ LUCRAREA" onClick={() => void updateJob(activeJob, 'finalizat', 'finalizeaza')} disabled={busy !== null} />
                  <Btn bg={'var(--warning)'} icon={<Clock size={16} />} label="AȘTEPT PIESE" onClick={() => void updateJob(activeJob, 'asteptare_piese', 'piese')} disabled={busy !== null} />
                </>
              ) : currentJob ? (
                <>
                  <Btn bg={'var(--success)'} icon={<Play size={16} />} label="CONTINUĂ LUCRAREA" onClick={() => void handleStart(currentJob)} disabled={busy !== null} />
                  <Btn bg={'var(--card)'} border={'var(--border)'} icon={<CarFront size={16} />} label="ALEGE ALTĂ MAȘINĂ" onClick={() => setShowPicker(true)} disabled={busy !== null} />
                </>
              ) : (
                <Btn bg={'var(--card)'} border={'var(--border)'} icon={<CarFront size={16} />} label="ALEGE ALTĂ MAȘINĂ" onClick={() => setShowPicker(true)} disabled={busy !== null} />
              )}
            </div>

            {/* REPARAȚIE / LUCRARE + PROGRAM DE LUCRU — două coloane pe 1024×768 (Reparație stânga ~60%, Program dreapta ~40%) */}
            <div className="employee-work-grid grid grid-cols-[1.6fr_1fr] gap-3">
              {/* REPARAȚIE / LUCRARE */}
              <Card title="Reparație / Lucrare" className="employee-repair">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Wrench size={16} style={{ color: 'var(--secondary)' }} />
                    <span className="truncate text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>{currentJob ? currentJob.title : 'Nicio lucrare activă'}</span>
                  </div>
                  {selectedCar && (selectedCar.jobs ?? []).length > 0 && (
                    <button onClick={() => setShowJobPicker(true)} disabled={busy !== null} className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-bold transition active:scale-[0.98] hover:brightness-125 disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--secondary)' }}>
                      <Wrench size={13} /> ALEGE LUCRAREA
                    </button>
                  )}
                </div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-secondary)' }}>Status</div>
                <span className="inline-block rounded-md border px-2.5 py-1 text-[11px] font-bold tracking-wide"
                  style={{ background: `color-mix(in srgb, ${statusColor} 18%, transparent)`, borderColor: `color-mix(in srgb, ${statusColor} 40%, transparent)`, color: statusColor }}>{statusLabel}</span>
                <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-secondary)' }}>Observații</div>
                <div className="mt-1 line-clamp-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{observatii}</div>
              </Card>

              {/* PROGRAM DE LUCRU */}
              <Card title="Program de lucru" className="employee-schedule">
                <div className="space-y-1 text-[12px]">
                  {program.map((p) => (
                    <div key={p.lbl + p.ore} className="flex items-center justify-between gap-3 leading-tight">
                      <span className="whitespace-nowrap" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{p.ore}</span>
                      <span className="flex items-center justify-end gap-1.5 text-right font-bold leading-tight" style={{ color: p.c }}>
                        <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: p.c }} />
                        <span className="whitespace-pre-line">{p.lbl === 'POSIBILE ORE SUPLIMENTARE' ? 'POSIBILE ORE\nSUPLIMENTARE' : p.lbl}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
              {activeJob && isOvertimeActive && (
                <div className="employee-overtime-stop flex justify-center">
                  <button onClick={() => void handleOvertime(activeJob, false)} disabled={busy !== null} className="h-[44px] w-full rounded-xl px-4 text-[14px] font-bold transition hover:brightness-110 disabled:opacity-50" style={{ background: 'var(--secondary)', color: 'var(--surface)' }}>OPREȘTE PESTE PROGRAM</button>
                </div>
              )}
            </div>

            {/* INFORMAȚII UTILE + RECOMANDARE */}
            <div className="employee-notes grid grid-cols-2 gap-3">
              <Card title="Informații utile" className="employee-info">
                <ul className="space-y-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  <li className="flex items-start gap-2"><Check size={15} className="mt-0.5 flex-none" style={{ color: 'var(--primary)' }} />La pauză, timerul se oprește automat.</li>
                  <li className="flex items-start gap-2"><Check size={15} className="mt-0.5 flex-none" style={{ color: 'var(--primary)' }} />La finalul programului normal, timerul normal se oprește automat.</li>
                  <li className="flex items-start gap-2"><Check size={15} className="mt-0.5 flex-none" style={{ color: 'var(--primary)' }} />Poți continua peste program apăsând butonul dedicat.</li>
                </ul>
              </Card>
              <Card title="Recomandare" className="employee-recommendation">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg" style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' }}><Info size={17} /></span>
                  <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>Finalizează lucrarea doar după ce toate operațiunile au fost completate și piesele au fost recepționate.</p>
                </div>
                                          </Card>
            </div></div>}
            
            {/* MAȘINI — listă reală */}

            {/* MAȘINI — listă reală */}
            
            {/* MAȘINI — listă reală */}
            {view === 'masiniile' && <Card title="Mașinile mele">
              {myCars.length === 0 && <div className="py-4 text-[13px]" style={{ color: 'var(--text-secondary)' }}>Nu ai mașini alocate.</div>}
              <div className="grid gap-3 sm:grid-cols-2">
                {myCars.map((c) => <button key={c.id} onClick={() => { setSelectedCarId(c.id); setView('acasa'); }} className="rounded-lg border p-3 text-left transition hover:brightness-125" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
                  <div className="text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>{c.license_plate}</div>
                  <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{[c.make, c.model].filter(Boolean).join(' ') || '—'} · {c.client_name}</div>
                </button>)}
              </div>
            </Card>}

            {/* LUCRĂRI — reale */}
            {view === 'lucrari' && <Card title="Lucrări active">
              {allMyJobs.filter((x) => x.job.status !== 'finalizat').length === 0 && <div className="py-4 text-[13px]" style={{ color: 'var(--text-secondary)' }}>Nicio lucrare activă.</div>}
              <div className="space-y-2">
                {allMyJobs.filter((x) => x.job.status !== 'finalizat').map(({ car, job }) => <button key={job.id} onClick={() => { setSelectedCarId(car.id); setView('acasa'); }} className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition hover:brightness-125" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
                  <span><span className="block text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>{job.title}</span><span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{car.license_plate}</span></span>
                  <span className="text-[11px] font-bold" style={{ color: job.status === 'in_lucru' ? 'var(--success)' : job.status === 'asteptare_piese' ? 'var(--warning)' : 'var(--text-secondary)' }}>{statusLabelFor(job.status)}</span>
                </button>)}
              </div>
            </Card>}

            {/* ISTORIC — real */}
            {view === 'istoric' && <Card title="Istoric lucrări finalizate">
              {allMyJobs.filter((x) => x.job.status === 'finalizat').length === 0 && <div className="py-4 text-[13px]" style={{ color: 'var(--text-secondary)' }}>Istoric gol.</div>}
              <div className="space-y-2">
                {allMyJobs.filter((x) => x.job.status === 'finalizat').map(({ car, job }) => <div key={job.id} className="flex items-center justify-between rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
                  <span><span className="block text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>{job.title}</span><span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{car.license_plate}</span></span>
                  <span className="text-[12px]" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{fmt(job.worked_seconds)}{job.completed_at ? ` · ${new Date(job.completed_at).toLocaleDateString('ro-RO')}` : ''}</span>
                </div>)}
              </div>
            </Card>}

            {/* PROFIL — real */}
            {view === 'profil' && <Card title="Profil">
              <div className="flex items-center gap-4">
                {employee.avatar_url
                  ? <img src={employee.avatar_url} alt={employee.name} className="h-16 w-16 rounded-full border-2 object-cover" style={{ borderColor: 'var(--primary)' }} />
                  : <span className="flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold" style={{ background: 'var(--card)', border: `2px solid ${'var(--primary)'}`, color: 'var(--secondary)' }}>{employee.name[0]}</span>}
                <div>
                  <div className="text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>{employee.name}</div>
                  <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Rol: {employee.role === 'admin' ? 'Administrator' : 'Angajat'}{employee.username ? ` · Utilizator: ${employee.username}` : ''}</div>
                  <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Mașini alocate: {myCars.length}</div>
                </div>
              </div>
            </Card>}
          </main>
        </div>
      </div>

      {/* OVERLAY DETALII — date reale */}
      {showDetails && selectedCar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(9,13,20,0.65)' }} onClick={() => setShowDetails(false)}>
          <div className="w-full max-w-md space-y-3 rounded-xl p-6" style={{ background: 'var(--surface)', border: `1px solid ${'var(--border)'}` }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-[18px] font-extrabold" style={{ color: 'var(--text-primary)' }}>{selectedCar.license_plate}</div>
              <button onClick={() => setShowDetails(false)} style={{ color: 'var(--text-secondary)' }}><X size={18} /></button>
            </div>
            <div className="text-[13px]" style={{ color: 'var(--secondary)' }}>{[selectedCar.make, selectedCar.model, selectedCar.year].filter(Boolean).join(' ') || '—'}</div>
            <div className="space-y-1.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              <div>Client: {selectedCar.client_name}{selectedCar.client_phone ? ` · ${selectedCar.client_phone}` : ''}</div>
              <div>Kilometraj: {km(selectedCar.mileage)}</div>
              {selectedCar.vin && <div>VIN: {selectedCar.vin}</div>}
              {selectedCar.notes && <div>Note: {selectedCar.notes}</div>}
            </div>
            {(selectedCar.jobs ?? []).length > 0 && <>
              <div className="pt-2 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-secondary)' }}>Lucrări</div>
              <div className="space-y-1.5">
                {(selectedCar.jobs ?? []).map((j) => <div key={j.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)' }}>
                  <span style={{ color: 'var(--text-primary)' }}>{j.title}</span>
                  <span className="text-[11px] font-bold" style={{ color: j.status === 'in_lucru' ? 'var(--success)' : j.status === 'asteptare_piese' ? 'var(--warning)' : 'var(--text-secondary)' }}>{statusLabelFor(j.status)}</span>
                </div>)}
              </div>
            </>}
          </div>
        </div>
      )}

      {/* OVERLAY ALEGE LUCRAREA — angajatul alege EXACT la ce lucrare lucrează */}
      {showJobPicker && selectedCar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(9,13,20,0.65)' }} onClick={() => setShowJobPicker(false)}>
          <div className="max-h-[75vh] w-full max-w-md space-y-2.5 overflow-auto rounded-xl p-6" style={{ background: 'var(--surface)', border: `1px solid ${'var(--border)'}` }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[18px] font-extrabold" style={{ color: 'var(--text-primary)' }}>Alege lucrarea</div>
                <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{selectedCar.license_plate} • {selectedCar.client_name}</div>
              </div>
              <button onClick={() => setShowJobPicker(false)} style={{ color: 'var(--text-secondary)' }}><X size={18} /></button>
            </div>
            <p className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Selectează lucrarea la care vei lucra. Timerul va contoriza DOAR timpul acestei lucrări.</p>
            {(selectedCar.jobs ?? []).length === 0 && <div className="py-4 text-[13px]" style={{ color: 'var(--text-secondary)' }}>Nu există lucrări pentru această mașină.</div>}
            {[...(selectedCar.jobs ?? [])].sort((a, b) => a.order_index - b.order_index).map((j) => {
              const isSel = j.id === (currentJob?.id ?? '');
              return (
                <button key={j.id} onClick={() => { setSelectedJobId(j.id); setShowJobPicker(false); }}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition hover:brightness-125"
                  style={{ borderColor: isSel ? 'var(--primary)' : 'var(--border)', background: isSel ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'var(--card)' }}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full border-2" style={{ borderColor: isSel ? 'var(--primary)' : 'var(--border)' }}>
                      {isSel && <span className="h-2 w-2 rounded-full" style={{ background: 'var(--primary)' }} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>{j.title}</span>
                      <span className="block text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>{fmt(j.worked_seconds)}{(j.overtime_seconds ?? 0) > 0 ? ` +${fmt(j.overtime_seconds ?? 0)}` : ''}</span>
                    </span>
                  </span>
                  <span className="shrink-0 rounded px-2 py-1 text-[10px] font-bold" style={{ color: j.status === 'in_lucru' ? 'var(--success)' : j.status === 'asteptare_piese' ? 'var(--warning)' : j.status === 'finalizat' ? 'var(--secondary)' : 'var(--text-secondary)', background: 'color-mix(in srgb, var(--border) 40%, transparent)' }}>{statusLabelFor(j.status)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* OVERLAY ALEGE ALTĂ MAȘINĂ — real */}
      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(9,13,20,0.65)' }} onClick={() => setShowPicker(false)}>
          <div className="max-h-[70vh] w-full max-w-md space-y-3 overflow-auto rounded-xl p-6" style={{ background: 'var(--surface)', border: `1px solid ${'var(--border)'}` }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-[18px] font-extrabold" style={{ color: 'var(--text-primary)' }}>Alege altă mașină</div>
              <button onClick={() => setShowPicker(false)} style={{ color: 'var(--text-secondary)' }}><X size={18} /></button>
            </div>
            {availableCars.length === 0 && <div className="py-4 text-[13px]" style={{ color: 'var(--text-secondary)' }}>Nu există mașini disponibile.</div>}
            <div className="space-y-2">
              {availableCars.map((c) => <button key={c.id} onClick={() => void handleAssign(c)} disabled={busy !== null} className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition hover:brightness-125 disabled:opacity-50" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
                <span><span className="block text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>{c.license_plate}</span><span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{[c.make, c.model].filter(Boolean).join(' ') || '—'} · {c.client_name}</span></span>
                <span className="text-[11px]" style={{ color: c.assigned_employee_id === employee.id ? 'var(--success)' : 'var(--text-secondary)' }}>{c.assigned_employee_id === employee.id ? 'A ta' : 'Disponibilă'}</span>
              </button>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function statusLabelFor(s: JobStatus): string {
  return s === 'in_lucru' ? 'ÎN LUCRU' : s === 'asteptare_piese' ? 'AȘTEPTARE PIESE' : s === 'asteptare' ? 'ÎN AȘTEPTARE' : 'FINALIZAT';
}

// Mesaj tehnic complet pentru debugging (cod, mesaj, details, hint — ex. erori RLS/permission).
function formatDbError(tag: string, err: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null): string {
  if (!err) return `${tag}: răspuns nul de la server.`;
  const parts = [tag];
  if (err.code) parts.push(`cod=${err.code}`);
  if (err.message) parts.push(`mesaj=${err.message}`);
  if (err.details) parts.push(`detalii=${err.details}`);
  if (err.hint) parts.push(`hint=${err.hint}`);
  return parts.join(' | ');
}

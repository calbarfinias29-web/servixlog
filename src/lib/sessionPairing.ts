/**
 * SERVIX — Reconstrucție sesiuni PORNIRE/OPRIRE din activity_log.
 *
 * PROBLEMĂ REALĂ: utilizarea efectivă (PanouAngajat/Local timer) NU scrie
 * niciodată în `time_entries` — acumulează timpul direct în
 * jobs.worked_seconds / jobs.overtime_seconds. Tabelul `time_entries` este
 * populat DOAR de datele demo (seed local / migrare Supabase demo), deci
 * rapoartele care citesc exclusiv din `time_entries` arată 0 pentru
 * activitatea reală.
 *
 * Sursa REALĂ, disponibilă identic pe Web (Supabase) și Local (SQLite), este
 * jurnalul `activity_log`: fiecare pornire/pauză/reluare/finalizare/overtime
 * start-stop/preluare este înregistrată acolo cu employee_id + job_id +
 * created_at. Această funcție reconstruiește perechile PORNIRE→OPRIRE din
 * evenimentele REALE, fără a inventa timp sau angajați.
 */

const START_ACTIONS = new Set(['in_lucru', 'overtime_start', 'takeover']);
const STOP_ACTIONS = new Set(['asteptare', 'asteptare_piese', 'finalizat', 'overtime_stop', 'takeover_stop']);
const OVERTIME_START_ACTIONS = new Set(['overtime_start']);

export interface ActivityLogEventForPairing {
  action: string;
  created_at: string;
  employee_id?: string | null;
  job_id?: string | null;
  car_id?: string | null;
}

/** O sesiune reconstruită PORNIRE→OPRIRE (formă compatibilă cu EmployeeTimeEntry). */
export interface DerivedTimeSession {
  employee_id: string;
  job_id: string;
  car_id: string | null;
  start_time: string;
  /** null = sesiune încă deschisă (fără eveniment de oprire încă). */
  end_time: string | null;
  /** null = nu poate fi calculată (sesiune deschisă) — NU se inventează. */
  duration_seconds: number | null;
  is_overtime: boolean;
}

interface OpenSession {
  employeeId: string;
  startedAt: string;
  overtime: boolean;
}

/**
 * Reconstruiește sesiunile de lucru (PORNIRE/OPRIRE) din evenimentele reale
 * activity_log, păstrând atribuirea angajatului pentru fiecare sesiune și
 * transferurile (takeover local / transfer admin Web pentru o lucrare activă).
 *
 * Regula de bază: fiecare acțiune START deschide o sesiune pentru job_id-ul
 * ei; prima acțiune STOP ulterioară a ACELUIAȘI job o închide. Un `transfer`
 * de admin (Web) oprește lucrarea server-side FĂRĂ un eveniment STOP propriu
 * legat de job_id — în acest caz închidem sesiunea deschisă a mașinii
 * respective la timestamp-ul real al transferului, păstrând angajatul care
 * chiar a lucrat (cel care a deschis sesiunea), nu administratorul.
 */
export function deriveTimeSessionsFromActivityLog(events: ActivityLogEventForPairing[]): DerivedTimeSession[] {
  const sorted = events.slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const openByJob = new Map<string, OpenSession>();
  const jobsByCar = new Map<string, Set<string>>();
  const carByJob = new Map<string, string>();
  const out: DerivedTimeSession[] = [];

  const closeSession = (jobId: string, endIso: string): void => {
    const open = openByJob.get(jobId);
    if (!open) return;
    const durationMs = new Date(endIso).getTime() - new Date(open.startedAt).getTime();
    out.push({
      employee_id: open.employeeId,
      job_id: jobId,
      car_id: carByJob.get(jobId) ?? null,
      start_time: open.startedAt,
      end_time: endIso,
      duration_seconds: durationMs >= 0 ? Math.round(durationMs / 1000) : 0,
      is_overtime: open.overtime,
    });
    openByJob.delete(jobId);
  };

  for (const e of sorted) {
    if (e.car_id && e.job_id) {
      const set = jobsByCar.get(e.car_id) ?? new Set<string>();
      set.add(e.job_id);
      jobsByCar.set(e.car_id, set);
      carByJob.set(e.job_id, e.car_id);
    }

    if (e.action === 'transfer' && !e.job_id && e.car_id) {
      // admin_transfer_car oprește server-side lucrarea activă a mașinii,
      // fără un eveniment STOP legat de job_id — închidem sesiunea deschisă.
      const jobIds = jobsByCar.get(e.car_id);
      if (jobIds) {
        for (const jobId of jobIds) {
          if (openByJob.has(jobId)) closeSession(jobId, e.created_at);
        }
      }
      continue;
    }

    if (!e.job_id || !e.employee_id) continue;

    if (START_ACTIONS.has(e.action)) {
      // Defensiv: dacă exista deja o sesiune deschisă (eveniment STOP lipsă),
      // o închidem la timpul noii porniri, fără să inventăm alt moment.
      if (openByJob.has(e.job_id)) closeSession(e.job_id, e.created_at);
      openByJob.set(e.job_id, { employeeId: e.employee_id, startedAt: e.created_at, overtime: OVERTIME_START_ACTIONS.has(e.action) });
    } else if (STOP_ACTIONS.has(e.action)) {
      closeSession(e.job_id, e.created_at);
    }
  }

  // Sesiunile rămase deschise = lucrare încă activă: OPRIRE goală, fără timp inventat.
  for (const [jobId, open] of openByJob) {
    out.push({
      employee_id: open.employeeId,
      job_id: jobId,
      car_id: carByJob.get(jobId) ?? null,
      start_time: open.startedAt,
      end_time: null,
      duration_seconds: null,
      is_overtime: open.overtime,
    });
  }

  out.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  return out;
}

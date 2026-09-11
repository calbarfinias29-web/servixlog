import { useState } from 'react';
import { dataAdapter, type EmployeeTimeEntry } from '@/data';
import type { Employee } from '@/types';
import { calculateCostSummary } from '@/lib/costs';
import { generateReportPdf, heading as pdfHeading, row as pdfRow, title as pdfTitle, type PdfLine } from '@/lib/pdf';
import { deriveTimeSessionsFromActivityLog } from '@/lib/sessionPairing';
import { aggregateEmployeeTimeEntries, type EmployeeReportRow } from '@/lib/employeeReportAggregation';

/**
 * TAB „Rapoarte angajați” — raport afișat în pagină (fără PDF).
 *
 * Surse de date:
 *  1. `time_entries` (istoric atomic per angajat, dacă există): employee_id,
 *     job_id, start_time, end_time, duration_seconds, is_overtime.
 *  2. `activity_log` (sursa REALĂ a activității zilnice — pornire/pauză/
 *     reluare/finalizare/overtime/preluare): reconstruim sesiunile PORNIRE→
 *     OPRIRE cu src/lib/sessionPairing.ts. Este necesar deoarece fluxul real
 *     de lucru (PanouAngajat / Local timer) NU scrie în `time_entries` —
 *     acumulează timpul direct în jobs.worked_seconds/overtime_seconds, deci
 *     `time_entries` conține DOAR date demo. Fără această a doua sursă,
 *     raportul ar arăta mereu 0 pentru activitatea reală.
 *
 * - „Mașini lucrate” = numărul de mașini DISTINCTE (jobs.car_id) atinse de
 *   înregistrările de timp ale angajatului în perioada selectată.
 *   Aceeași lucrare / mașină cu mai multe înregistrări se numără O SINGURĂ DATĂ.
 * - „Ore lucrate” = suma duration_seconds din intervalele reale (time_entries
 *   + sesiuni reconstruite din activity_log), inclusiv overtime — is_overtime.
 * - Lucrările transferate: fiecare interval de timp are employee_id-ul propriu,
 *   deci timpul rămâne atribuit angajatului care l-a lucrat efectiv.
 */

function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return s > 0 ? `${h}h ${m}m ${s}s` : `${h}h ${m}m`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

function buildEmployeeReportLines(rows: EmployeeReportRow[], periodLabel: string, employeeLabel: string, normalRate: number, overtimeRate: number, vatRate: number): PdfLine[] {
  const normalSeconds = rows.reduce((total, row) => total + row.normalSeconds, 0);
  const overtimeSeconds = rows.reduce((total, row) => total + row.overtimeSeconds, 0);
  const normalCost = normalSeconds / 3600 * normalRate;
  const overtimeCost = overtimeSeconds / 3600 * overtimeRate;
  const summary = calculateCostSummary(normalCost + overtimeCost, vatRate);
  const lines: PdfLine[] = [
    pdfTitle('SERVIX - Raport angajat'),
    pdfRow('Angajat', employeeLabel),
    pdfRow('Perioada', periodLabel),
    pdfHeading('Activitate'),
  ];
  if (rows.length === 0) {
    lines.push(pdfRow('-', 'Nu exista inregistrari pentru perioada selectata'));
  } else {
    rows.forEach((row) => {
      lines.push(pdfRow(row.name, `${row.cars} masini / ${row.jobs} lucrari / ${formatHours(row.seconds)}`));
    });
  }
  lines.push(
    pdfHeading('Timp si cost'),
    pdfRow('Ore normale', formatHours(normalSeconds)),
    pdfRow('Ore suplimentare', formatHours(overtimeSeconds)),
    pdfRow('SUBTOTAL FARA TVA', `${summary.subtotal.toFixed(2)} lei`),
    pdfRow(`TVA (${vatRate}%)`, `${summary.vatAmount.toFixed(2)} lei`),
    pdfRow('TOTAL CU TVA', `${summary.totalWithVat.toFixed(2)} lei`),
  );
  return lines;
}

export function EmployeeReportsTab({ employees }: { employees: Employee[] }) {
  const [employeeId, setEmployeeId] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // Astăzi în fusul orar LOCAL al aplicației (fără date hardcodate), format AAAA-LL-ZZ.
  const todayStr = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<EmployeeReportRow[] | null>(null);
  const [periodLabel, setPeriodLabel] = useState('');

  const applyFilters = async (): Promise<void> => {
    setError('');
    setInfo('');
    setRows(null);

    if (!fromDate) {
      // „De la” gol → păstrăm comportamentul anterior: se cere perioada explicită.
      setError('Selectează data „De la”.');
      return;
    }
    // „Până la” gol → se folosește automat ASTĂZI (data locală a aplicației).
    const effectiveTo = toDate || todayStr();
    // Data viitoare NU este permisă (max = astăzi, aplicat și în input și la validare).
    if (effectiveTo > todayStr()) {
      setError('Data „Până la” nu poate fi în viitor. Maxim permis: astăzi.');
      return;
    }
    if (fromDate > effectiveTo) {
      setError('Data „De la” este după data „Până la”. Corectează perioada.');
      return;
    }

    // Perioadă INCLUSIVĂ: de la 00:00:00 în ziua „De la” până la 23:59:59.999 în ziua „Până la”.
    const startIso = new Date(`${fromDate}T00:00:00`).toISOString();
    const endIso = new Date(`${effectiveTo}T23:59:59.999`).toISOString();

    setLoading(true);
    try {
      const timeRes = await dataAdapter.getTimeEntries({
        fromIso: startIso,
        toIso: endIso,
        employeeId: employeeId === 'all' ? undefined : employeeId,
      });
      const qError = timeRes.error;
      if (qError) {
        setError('Nu am putut încărca istoricul de timp. ' + qError.message);
        return;
      }

      const entries: EmployeeTimeEntry[] = [...(timeRes.data ?? [])];

      // Sursa REALĂ: activity_log (pornire/pauză/reluare/finalizare/overtime/
      // preluare), acoperind și activitatea care nu a scris în time_entries.
      // Fereastra de citire se extinde până la „acum” pentru a prinde
      // evenimentul de oprire chiar dacă survine după „Până la”; sesiunile
      // sunt apoi filtrate după start_time în intervalul cerut de utilizator.
      if (dataAdapter.getActivityLogRange) {
        const nowIso = new Date().toISOString();
        const activityRes = await dataAdapter.getActivityLogRange({ fromIso: startIso, toIso: nowIso > endIso ? nowIso : endIso });
        if (!activityRes.error) {
          const sessions = deriveTimeSessionsFromActivityLog(activityRes.data ?? []);
          const seen = new Set(entries.map((e) => `${e.job_id}|${e.start_time}|${e.employee_id}`));
          for (const s of sessions) {
            if (s.start_time < startIso || s.start_time > endIso) continue;
            if (employeeId !== 'all' && s.employee_id !== employeeId) continue;
            const key = `${s.job_id}|${s.start_time}|${s.employee_id}`;
            if (seen.has(key)) continue; // evită dublarea dacă aceeași sesiune există deja în time_entries
            seen.add(key);
            entries.push({
              employee_id: s.employee_id,
              job_id: s.job_id,
              start_time: s.start_time,
              end_time: s.end_time,
              duration_seconds: s.duration_seconds,
              is_overtime: s.is_overtime,
              jobs: s.car_id ? { car_id: s.car_id } : null,
            });
          }
        }
      }

      if (entries.length === 0) {
        setInfo('Nu există înregistrări de timp pentru perioada selectată.');
      }

      const nameOf = (id: string): string => employees.find((emp: Employee) => emp.id === id)?.name ?? 'Angajat necunoscut';
      const result = aggregateEmployeeTimeEntries(entries, nameOf, employeeId);
      setRows(result);
      setPeriodLabel(`${new Date(`${fromDate}T00:00:00`).toLocaleDateString('ro-RO')} — ${new Date(`${effectiveTo}T00:00:00`).toLocaleDateString('ro-RO')}`);
    } finally {
      setLoading(false);
    }
  };

  const generatePdf = async (): Promise<void> => {
    if (!rows) return;
    const ratesResult = await dataAdapter.getRates();
    if (ratesResult.error || !ratesResult.data) {
      setError('Nu am putut încărca tarifele pentru raportul PDF.');
      return;
    }
    const selectedName = employeeId === 'all' ? 'Toți angajații' : employees.find((employee) => employee.id === employeeId)?.name ?? 'Angajat necunoscut';
    const lines = buildEmployeeReportLines(rows, periodLabel, selectedName, ratesResult.data.normal_rate, ratesResult.data.overtime_rate, ratesResult.data.vat_rate);
    generateReportPdf(`servix_raport_angajat_${employeeId === 'all' ? 'toti' : employeeId}.pdf`, lines);
  };

  const totalCars = rows?.reduce((t, r) => t + r.cars, 0) ?? 0;
  const totalJobs = rows?.reduce((t, r) => t + r.jobs, 0) ?? 0;
  const totalSeconds = rows?.reduce((t, r) => t + r.seconds, 0) ?? 0;

  const inputCls = 'h-11 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm font-semibold outline-none';
  const borderStyle = { borderColor: 'var(--border)', color: 'var(--text-primary)' };

  return (
    <div className="space-y-5">
      <div className="rounded-[16px] border bg-[var(--surface)] p-5 shadow-sm" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>Raport angajați</h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Activitate reală per angajat, pe baza sesiunilor de lucru reale (pornire/pauză/reluare/finalizare). Perioada este inclusivă la ambele capete.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Angajat</span>
            <select value={employeeId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEmployeeId(e.target.value)} className={inputCls} style={borderStyle}>
              <option value="all">Toți angajații</option>
              {employees.map((emp: Employee) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>De la</span>
            <input type="date" value={fromDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFromDate(e.target.value)} className={inputCls} style={borderStyle} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>Până la <span className="font-normal normal-case tracking-normal">(gol = astăzi)</span></span>
            <input type="date" value={toDate} max={todayStr()} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToDate(e.target.value)} className={inputCls} style={borderStyle} />
          </label>
          <div className="flex items-end">
            <div className="flex gap-2">
              <button onClick={() => void applyFilters()} disabled={loading} className="h-11 flex-1 rounded-lg px-4 text-sm font-bold text-white shadow-sm transition disabled:opacity-50" style={{ background: 'var(--button)' }}>
                {loading ? 'Se încarcă...' : 'Aplică filtrele'}
              </button>
              <button onClick={() => void generatePdf()} disabled={!rows || loading} className="h-11 rounded-lg border px-4 text-sm font-bold transition disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                PDF
              </button>
            </div>
          </div>
        </div>
        {error && <p className="mt-3 rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</p>}
        {info && <p className="mt-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>{info}</p>}
      </div>

      {rows && (
        <div className="overflow-hidden rounded-[16px] border bg-[var(--surface)] shadow-sm" style={{ borderColor: 'var(--border)' }}>
          <div className="border-b px-6 py-4" style={{ borderColor: 'var(--border)' }}>
            <h3 className="text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>
              Raport activitate {periodLabel && <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>({periodLabel})</span>}
            </h3>
          </div>
          <div className="hidden grid-cols-[1.4fr_1fr_1fr] gap-4 border-b bg-[var(--surface-secondary)] px-6 py-3 text-[11px] font-bold uppercase tracking-[0.12em] sm:grid" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            <span>Angajat</span><span>Mașini lucrate</span><span>Ore lucrate</span>
          </div>
          {rows.length === 0
            ? <div className="p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Niciun angajat nu are activitate în perioada selectată.</div>
            : rows.map((r) => (
              <div key={r.id} className="grid grid-cols-[1.4fr_1fr_1fr] gap-4 border-b px-6 py-4 last:border-0" style={{ borderColor: 'var(--border)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{r.name}</span>
                <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{r.cars} mașini</span>
                <span className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>{formatHours(r.seconds)}</span>
              </div>
            ))}
          {rows.length > 0 && (
            <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-4 px-6 py-4" style={{ background: 'var(--surface-secondary)' }}>
              <span className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>TOTAL GENERAL</span>
              <span className="text-sm font-bold" style={{ color: 'var(--primary)' }}>{totalCars} mașini / {totalJobs} lucrări</span>
              <span className="font-mono text-sm font-bold" style={{ color: 'var(--primary)' }}>{formatHours(totalSeconds)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


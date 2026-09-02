import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Employee } from '@/types';

/**
 * TAB „Rapoarte angajați” — raport afișat în pagină (fără PDF).
 *
 * Sursa de date EXISTENTĂ: tabelul `time_entries` (istoric atomic per angajat):
 *   employee_id, job_id, start_time, end_time, duration_seconds, is_overtime.
 *
 * - „Mașini lucrate” = numărul de mașini DISTINCTE (jobs.car_id) atinse de
 *   înregistrările de timp ale angajatului în perioada selectată.
 *   Aceeași lucrare / mașină cu mai multe înregistrări se numără O SINGURĂ DATĂ.
 * - „Ore lucrate” = suma duration_seconds din time_entries (timpul real,
 *   contabilizat deja de mecanismul existent, inclusiv overtime — is_overtime).
 * - Lucrările transferate: fiecare interval de timp are employee_id-ul propriu,
 *   deci timpul rămâne atribuit angajatului care l-a lucrat efectiv.
 */

interface TimeEntryRow {
  employee_id: string;
  job_id: string;
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  is_overtime: boolean;
  jobs: { car_id: string } | null;
}

function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return s > 0 ? `${h}h ${m}m ${s}s` : `${h}h ${m}m`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
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
  const [rows, setRows] = useState<Array<{ id: string; name: string; cars: number; jobs: number; seconds: number }> | null>(null);
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
      let query = supabase
        .from('time_entries')
        .select('employee_id, job_id, start_time, end_time, duration_seconds, is_overtime, jobs!inner(car_id)')
        .gte('start_time', startIso)
        .lte('start_time', endIso);
      if (employeeId !== 'all') query = query.eq('employee_id', employeeId);

      const { data, error: qError } = await query;
      if (qError) {
        setError('Nu am putut încărca istoricul de timp. ' + qError.message);
        return;
      }

      const entries = (data ?? []) as unknown as TimeEntryRow[];
      if (entries.length === 0) {
        setInfo('Nu există înregistrări de timp (time_entries) pentru perioada selectată. Atenție: lucrările pornite cu timerul acumulează timp doar în jobs.worked_seconds (per lucrare, nu per angajat) și apar aici doar dacă există intervale înregistrate în istoricul time_entries.');
        return;
      }

      const byEmployee = new Map<string, { cars: Set<string>; jobs: Set<string>; seconds: number }>();
      for (const e of entries) {
        const sec = e.duration_seconds ?? 0; // null = interval încă în derulare — nu-l inventăm
        if (sec <= 0) continue;
        let agg = byEmployee.get(e.employee_id);
        if (!agg) { agg = { cars: new Set(), jobs: new Set(), seconds: 0 }; byEmployee.set(e.employee_id, agg); }
        agg.jobs.add(e.job_id); // lucrarea se numără o singură dată, indiferent câte intervale are
        const carId = e.jobs?.car_id;
        if (carId) agg.cars.add(carId);
        agg.seconds += sec;
      }

      const nameOf = (id: string): string => employees.find((emp: Employee) => emp.id === id)?.name ?? 'Angajat necunoscut';
      const result = Array.from(byEmployee.entries())
        .map(([id, agg]) => ({ id, name: nameOf(id), cars: agg.cars.size, jobs: agg.jobs.size, seconds: agg.seconds }))
        .sort((a, b) => b.seconds - a.seconds);
      setRows(result);
      setPeriodLabel(`${new Date(`${fromDate}T00:00:00`).toLocaleDateString('ro-RO')} — ${new Date(`${effectiveTo}T00:00:00`).toLocaleDateString('ro-RO')}`);
    } finally {
      setLoading(false);
    }
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
          Activitate reală per angajat, pe baza istoricului detaliat de timp (time_entries). Perioada este inclusivă la ambele capete.
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
            <button onClick={() => void applyFilters()} disabled={loading} className="h-11 w-full rounded-lg px-4 text-sm font-bold text-white shadow-sm transition disabled:opacity-50" style={{ background: 'var(--button)' }}>
              {loading ? 'Se încarcă...' : 'Aplică filtrele'}
            </button>
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


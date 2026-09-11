/**
 * SERVIX — Agregare rapoarte angajați (extras din EmployeeReportsTab pentru testabilitate).
 *
 * Primește intrările de timp REALE (time_entries + sesiuni reconstruite din
 * activity_log — vezi src/lib/sessionPairing.ts) și le agregă per angajat:
 * mașini distincte, lucrări distincte, ore normale/overtime.
 * Nu inventează timp: intrările cu duration_seconds null/≤0 (sesiune încă
 * deschisă) sunt ignorate din totaluri.
 */
import type { EmployeeTimeEntry } from '@/data/DataAdapter';

export interface EmployeeReportRow {
  id: string;
  name: string;
  cars: number;
  jobs: number;
  normalSeconds: number;
  overtimeSeconds: number;
  seconds: number;
}

export function aggregateEmployeeTimeEntries(
  entries: EmployeeTimeEntry[],
  nameOf: (id: string) => string,
  employeeId: string,
): EmployeeReportRow[] {
  const byEmployee = new Map<string, { cars: Set<string>; jobs: Set<string>; normalSeconds: number; overtimeSeconds: number }>();
  for (const e of entries) {
    const sec = e.duration_seconds ?? 0; // null = interval încă în derulare — nu-l inventăm
    if (sec <= 0) continue;
    let agg = byEmployee.get(e.employee_id);
    if (!agg) { agg = { cars: new Set(), jobs: new Set(), normalSeconds: 0, overtimeSeconds: 0 }; byEmployee.set(e.employee_id, agg); }
    agg.jobs.add(e.job_id); // lucrarea se numără o singură dată, indiferent câte intervale are
    const carId = e.jobs?.car_id;
    if (carId) agg.cars.add(carId);
    if (e.is_overtime) agg.overtimeSeconds += sec;
    else agg.normalSeconds += sec;
  }

  const result = Array.from(byEmployee.entries())
    .map(([id, agg]) => ({ id, name: nameOf(id), cars: agg.cars.size, jobs: agg.jobs.size, normalSeconds: agg.normalSeconds, overtimeSeconds: agg.overtimeSeconds, seconds: agg.normalSeconds + agg.overtimeSeconds }))
    .sort((a, b) => b.seconds - a.seconds);
  if (employeeId !== 'all' && !result.some((row) => row.id === employeeId)) {
    result.push({ id: employeeId, name: nameOf(employeeId), cars: 0, jobs: 0, normalSeconds: 0, overtimeSeconds: 0, seconds: 0 });
  }
  return result;
}

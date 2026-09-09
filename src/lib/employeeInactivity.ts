import type { Car, Employee, Schedule } from '@/types';

export const INACTIVITY_THRESHOLDS_MINUTES = [10, 20, 30] as const;
export type InactivityThresholdMinutes = typeof INACTIVITY_THRESHOLDS_MINUTES[number];

export interface EmployeeInactivityNotification {
  id: string;
  employee_id: string;
  period_id: string;
  threshold_minutes: InactivityThresholdMinutes;
  created_at: string;
  read_at: string | null;
}

export interface InactivityObservationResult {
  created: EmployeeInactivityNotification[];
  unread: EmployeeInactivityNotification[];
}

function minutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function bucharestParts(now: Date): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Bucharest',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: weekdays[values.weekday] ?? 0, minute: Number(values.hour) * 60 + Number(values.minute) };
}

function daySchedule(schedule: Schedule, weekday: number): { active: boolean; start: string; end: string } {
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

export function eligibleInactivityEmployeeIds(employees: Employee[], cars: Car[], schedule: Schedule | null, now = new Date()): string[] {
  if (!schedule) return [];
  const current = bucharestParts(now);
  const day = daySchedule(schedule, current.weekday);
  if (!day.active || current.minute < minutes(day.start) || current.minute >= minutes(day.end)) return [];
  if (current.minute >= minutes(schedule.break_start) && current.minute < minutes(schedule.break_end)) return [];

  return employees
    .filter((employee) => employee.role === 'employee' && employee.active)
    .filter((employee) => !cars.some((car) => car.assigned_employee_id === employee.id))
    .map((employee) => employee.id);
}

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface TimerOutcome {
  status: number;
  payload: unknown;
}

type Body = Record<string, unknown>;
type TimerRow = Record<string, unknown>;
type ScheduleRow = Record<string, unknown>;
type SqlValue = null | number | bigint | string | NodeJS.ArrayBufferView;

const TZ = 'Europe/Bucharest';
const TIMER_STATUSES = new Set(['asteptare', 'asteptare_piese', 'finalizat']);

function error(status: number, code: string, message: string, extra: Record<string, unknown> = {}): TimerOutcome {
  return { status, payload: { ok: false, error: code, message, ...extra } };
}

function requiredString(body: Body, field: string): string | null {
  const value = body[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nowIso(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString();
}

function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function row(db: DatabaseSync, sql: string, ...params: SqlValue[]): TimerRow | null {
  return (db.prepare(sql).get(...params) as TimerRow | undefined) ?? null;
}

function schedule(db: DatabaseSync): ScheduleRow | null {
  return row(db, 'SELECT * FROM work_schedule WHERE active = 1 ORDER BY created_at DESC, id LIMIT 1');
}

function parts(ms: number): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const values = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour) % 24, minute: Number(values.minute), weekday: weekdays[values.weekday] ?? 0,
  };
}

function minutes(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return 0;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function zonedTimestamp(year: number, month: number, day: number, hour: number, minute: number): number {
  const target = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const values = Object.fromEntries(formatter.formatToParts(target).map((part) => [part.type, part.value]));
  const seen = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour) % 24, Number(values.minute));
  return target.getTime() + (target.getTime() - seen);
}

function dayWindow(scheduleRow: ScheduleRow, weekday: number): { active: boolean; start: string; end: string } {
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const name = names[weekday] ?? 'monday';
  const active = scheduleRow[`${name}_active`];
  return {
    active: typeof active === 'number' ? active === 1 : weekday >= 1 && weekday <= 5,
    start: typeof scheduleRow[`${name}_start`] === 'string' ? String(scheduleRow[`${name}_start`]).slice(0, 5) : String(scheduleRow.work_start).slice(0, 5),
    end: typeof scheduleRow[`${name}_end`] === 'string' ? String(scheduleRow[`${name}_end`]).slice(0, 5) : String(scheduleRow.work_end).slice(0, 5),
  };
}

/** Same scheduled overlap model as the active Web timer, in Europe/Bucharest. */
export function overlapSeconds(scheduleRow: ScheduleRow | null, startMs: number, endMs: number, kind: 'normal' | 'overtime'): number {
  if (!scheduleRow || endMs <= startMs) return 0;
  let total = 0;
  let cursor = startMs;
  for (let i = 0; i < 370 && cursor < endMs; i += 1) {
    const current = parts(cursor);
    const day = dayWindow(scheduleRow, current.weekday);
    const dayStart = zonedTimestamp(current.year, current.month, current.day, 0, 0);
    const dayEnd = zonedTimestamp(current.year, current.month, current.day + 1, 0, 0);
    if (!day.active && kind === 'normal') {
      cursor = dayEnd;
      continue;
    }
    if (!day.active && kind === 'overtime') {
      total += Math.max(0, Math.min(endMs, dayEnd) - Math.max(startMs, dayStart));
      cursor = dayEnd;
      continue;
    }
    const windows = kind === 'normal'
      ? [[day.start, String(scheduleRow.break_start).slice(0, 5)], [String(scheduleRow.break_end).slice(0, 5), day.end]]
      : [[String(scheduleRow.break_start).slice(0, 5), String(scheduleRow.break_end).slice(0, 5)], [day.end, '24:00'], ['00:00', day.start]];
    for (const [from, to] of windows) {
      const fromMinutes = from === '24:00' ? 1440 : minutes(from);
      const toMinutes = to === '24:00' ? 1440 : minutes(to);
      const fromMs = zonedTimestamp(current.year, current.month, current.day + (fromMinutes === 1440 ? 1 : 0), Math.floor(fromMinutes / 60) % 24, fromMinutes % 60);
      const toMs = zonedTimestamp(current.year, current.month, current.day + (toMinutes === 1440 ? 1 : 0), Math.floor(toMinutes / 60) % 24, toMinutes % 60);
      total += Math.max(0, Math.min(endMs, toMs) - Math.max(startMs, fromMs));
    }
    cursor = dayEnd;
  }
  return Math.floor(total / 1000);
}

function getJob(db: DatabaseSync, jobId: string): TimerRow | null {
  return row(db, 'SELECT j.*, c.assigned_employee_id, c.completed_at AS car_completed_at FROM jobs j JOIN cars c ON c.id = j.car_id WHERE j.id = ?', jobId);
}

function getSession(db: DatabaseSync, jobId: string, employeeId?: string): TimerRow | null {
  if (employeeId) return row(db, "SELECT * FROM timer_sessions WHERE job_id = ? AND employee_id = ? AND state IN ('running', 'paused') ORDER BY created_at DESC LIMIT 1", jobId, employeeId);
  return row(db, "SELECT * FROM timer_sessions WHERE job_id = ? AND state IN ('running', 'paused') ORDER BY created_at DESC LIMIT 1", jobId);
}

function activeEmployeeSession(db: DatabaseSync, employeeId: string, jobId: string): TimerRow | null {
  return row(db, "SELECT * FROM timer_sessions WHERE employee_id = ? AND job_id != ? AND state IN ('running', 'paused') LIMIT 1", employeeId, jobId);
}

function employeeExists(db: DatabaseSync, employeeId: string, role?: string): boolean {
  const found = role
    ? row(db, 'SELECT id FROM employees WHERE id = ? AND role = ?', employeeId, role)
    : row(db, 'SELECT id FROM employees WHERE id = ?', employeeId);
  return Boolean(found);
}

function audit(db: DatabaseSync, job: TimerRow, employeeId: string, action: string, detail: string, now: string): void {
  db.prepare('INSERT INTO activity_log (id, employee_id, car_id, job_id, action, detail, created_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
    .run(randomUUID(), employeeId, String(job.car_id), String(job.id), action, detail, now);
}

function activeInterval(db: DatabaseSync, sessionId: string): TimerRow | null {
  return row(db, 'SELECT * FROM timer_intervals WHERE session_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1', sessionId);
}

function closeInterval(db: DatabaseSync, session: TimerRow, interval: TimerRow, endMs: number, pauseReason?: string): { normal: number; overtime: number } {
  const startMs = new Date(String(interval.started_at)).getTime();
  const kind = String(interval.kind) as 'normal' | 'overtime';
  const seconds = overlapSeconds(schedule(db), startMs, endMs, kind);
  db.prepare('UPDATE timer_intervals SET ended_at = ?, pause_reason = COALESCE(?, pause_reason) WHERE id = ? AND ended_at IS NULL').run(nowIso(endMs), pauseReason ?? null, String(interval.id));
  return { normal: kind === 'normal' ? seconds : 0, overtime: kind === 'overtime' ? seconds : 0 };
}

function reconcileSession(db: DatabaseSync, session: TimerRow, endMs: number, reason: string, mode: 'overlap' | 'elapsed' = 'overlap'): { normal: number; overtime: number } {
  const interval = activeInterval(db, String(session.id));
  if (!interval) return { normal: 0, overtime: 0 };
  const amounts = closeInterval(db, session, interval, endMs, reason);
  const elapsed = Math.max(0, Math.floor((endMs - new Date(String(interval.started_at)).getTime()) / 1000));
  const measured = mode === 'elapsed'
    ? (String(interval.kind) === 'overtime' ? { normal: 0, overtime: elapsed } : { normal: elapsed, overtime: 0 })
    : amounts;
  const normal = Number(session.normal_seconds) + measured.normal;
  const overtime = Number(session.overtime_seconds) + measured.overtime;
  const ended = nowIso(endMs);
  db.prepare("UPDATE timer_sessions SET state = 'stopped', paused_at = ?, stopped_at = ?, normal_seconds = ?, overtime_seconds = ?, is_overtime = 0, updated_at = ? WHERE id = ?")
    .run(ended, ended, normal, overtime, ended, String(session.id));
  db.prepare('UPDATE jobs SET worked_seconds = ?, overtime_seconds = ?, started_at = NULL, is_overtime = 0, updated_at = ? WHERE id = ?')
    .run(normal, overtime, ended, String(session.job_id));
  return { normal, overtime };
}

function activeJobForCar(db: DatabaseSync, carId: string): TimerRow | null {
  return row(db, "SELECT j.* FROM jobs j WHERE j.car_id = ? AND j.status = 'in_lucru' AND j.started_at IS NOT NULL ORDER BY j.started_at DESC LIMIT 1", carId);
}

function takeoverJob(db: DatabaseSync, body: Body, nowMs: number): TimerOutcome {
  const identity = validateIdentity(db, body);
  if ('status' in identity) return identity;
  const job = getJob(db, identity.jobId)!;
  const targetEmployee = identity.employeeId;
  const session = getSession(db, identity.jobId);
  if (!session) return error(409, 'JOB_NOT_ACTIVE', 'Lucrarea nu are o sesiune activă pentru takeover.');
  if (String(session.employee_id) === targetEmployee) return { status: 200, payload: { ok: true, no_op: true, job, session } };
  if (!employeeExists(db, targetEmployee)) return error(404, 'EMPLOYEE_NOT_FOUND', 'Angajatul nu există.');
  const other = activeEmployeeSession(db, targetEmployee, identity.jobId);
  if (other) return error(409, 'EMPLOYEE_ALREADY_HAS_ACTIVE_JOB', 'Angajatul are deja o lucrare activă.', { job_id: other.job_id });
  const interval = activeInterval(db, String(session.id));
  if (!interval) return error(409, 'INVALID_STATE', 'Sesiunea nu are interval activ.');
  const elapsed = Math.max(0, Math.floor((nowMs - new Date(String(interval.started_at)).getTime()) / 1000));
  if (elapsed >= 60) return error(409, 'TAKEOVER_WINDOW_EXPIRED', 'Preluarea este permisă doar în primele 60 de secunde.');
  const amounts = reconcileSession(db, session, nowMs, 'takeover', 'elapsed');
  const now = nowIso(nowMs);
  db.prepare('UPDATE cars SET assigned_employee_id = ?, updated_at = ? WHERE id = ?').run(targetEmployee, now, String(job.car_id));
  audit(db, job, String(session.employee_id), 'takeover_stop', `Sesiune închisă la takeover; timp păstrat pentru angajatul ${String(session.employee_id)}.`, now);
  audit(db, job, targetEmployee, 'takeover', `Lucrare preluată de ${targetEmployee} de la ${String(session.employee_id)} în ${elapsed} secunde.`, now);
  const newSessionId = randomUUID();
  db.prepare('INSERT INTO timer_sessions (id, job_id, employee_id, started_at, state, is_overtime, normal_seconds, overtime_seconds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newSessionId, identity.jobId, targetEmployee, now, 'running', Number(session.is_overtime) === 1 ? 1 : 0, amounts.normal, amounts.overtime, now, now);
  db.prepare('INSERT INTO timer_intervals (id, session_id, employee_id, started_at, kind) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), newSessionId, targetEmployee, now, Number(session.is_overtime) === 1 ? 'overtime' : 'normal');
  db.prepare("UPDATE jobs SET status = 'in_lucru', started_at = ?, is_overtime = ?, updated_at = ? WHERE id = ?")
    .run(now, Number(session.is_overtime) === 1 ? 1 : 0, now, identity.jobId);
  return { status: 200, payload: { ok: true, taken_over: true, job: getJob(db, identity.jobId), session: getSession(db, identity.jobId, targetEmployee) } };
}

function transferCar(db: DatabaseSync, body: Body, nowMs: number): TimerOutcome {
  const carId = requiredString(body, 'car_id');
  const newEmployeeId = requiredString(body, 'new_employee_id');
  const adminId = requiredString(body, 'admin_id');
  if (!carId || !newEmployeeId || !adminId) return error(422, 'INVALID_PAYLOAD', 'car_id, new_employee_id și admin_id sunt obligatorii.');
  if (!employeeExists(db, adminId, 'admin')) return error(403, 'ADMIN_REQUIRED', 'Transferul necesită un angajat cu rol admin.');
  if (!employeeExists(db, newEmployeeId)) return error(404, 'EMPLOYEE_NOT_FOUND', 'Angajatul destinație nu există.');
  const car = row(db, 'SELECT * FROM cars WHERE id = ?', carId);
  if (!car) return error(404, 'CAR_NOT_FOUND', 'Mașina nu există.');
  if (String(car.assigned_employee_id ?? '') === newEmployeeId) return { status: 200, payload: { ok: true, no_op: true, car } };
  const activeJob = activeJobForCar(db, carId);
  if (activeJob) {
    const targetConflict = activeEmployeeSession(db, newEmployeeId, String(activeJob.id));
    if (targetConflict) return error(409, 'EMPLOYEE_ALREADY_HAS_ACTIVE_JOB', 'Angajatul destinație are deja o lucrare activă.', { job_id: targetConflict.job_id });
  }
  const now = nowIso(nowMs);
  if (activeJob) {
    const session = getSession(db, String(activeJob.id));
    if (session) reconcileSession(db, session, nowMs, 'transfer');
    db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('asteptare', now, String(activeJob.id));
    audit(db, activeJob, String(session?.employee_id ?? car.assigned_employee_id ?? adminId), 'transfer_stop', 'Timer înghețat înainte de transferul Admin.', now);
  }
  db.prepare('UPDATE cars SET assigned_employee_id = ?, updated_at = ? WHERE id = ?').run(newEmployeeId, now, carId);
  const transferJob = activeJob ?? row(db, 'SELECT * FROM jobs WHERE car_id = ? ORDER BY order_index, id LIMIT 1', carId);
  if (transferJob) audit(db, transferJob, adminId, 'transfer', `Administratorul ${adminId} a transferat lucrarea de la ${String(car.assigned_employee_id ?? 'Nealocat')} la ${newEmployeeId}.`, now);
  return { status: 200, payload: { ok: true, car: row(db, 'SELECT * FROM cars WHERE id = ?', carId), job: transferJob ? getJob(db, String(transferJob.id)) : null } };
}

function validateIdentity(db: DatabaseSync, body: Body): { jobId: string; employeeId: string } | TimerOutcome {
  const jobId = requiredString(body, 'job_id');
  const employeeId = requiredString(body, 'employee_id');
  if (!jobId) return error(422, 'INVALID_PAYLOAD', 'job_id este obligatoriu.');
  if (!employeeId) return error(422, 'INVALID_PAYLOAD', 'employee_id este obligatoriu.');
  if (!row(db, 'SELECT id FROM employees WHERE id = ?', employeeId)) return error(404, 'EMPLOYEE_NOT_FOUND', 'Angajatul nu există.');
  if (!getJob(db, jobId)) return error(404, 'JOB_NOT_FOUND', 'Lucrarea nu există.');
  return { jobId, employeeId };
}

function startJob(db: DatabaseSync, body: Body, nowMs: number): TimerOutcome {
  const identity = validateIdentity(db, body);
  if ('status' in identity) return identity;
  const job = getJob(db, identity.jobId)!;
  if (job.assigned_employee_id !== identity.employeeId) return error(409, 'JOB_NOT_ASSIGNED', 'Lucrarea nu este atribuită angajatului.');
  const other = activeEmployeeSession(db, identity.employeeId, identity.jobId);
  if (other) return error(409, 'EMPLOYEE_ALREADY_HAS_ACTIVE_JOB', 'Angajatul are deja o lucrare activă.', { job_id: other.job_id });
  const current = getSession(db, identity.jobId);
  const now = nowIso(nowMs);
  if (current && current.employee_id !== identity.employeeId) return error(409, 'JOB_ALREADY_ACTIVE', 'Lucrarea are deja o sesiune activă.');
  if (current && current.state === 'running') return { status: 200, payload: { ok: true, no_op: true, job, session: current } };
  const session = current ?? row(db, 'SELECT * FROM timer_sessions WHERE job_id = ? AND employee_id = ? ORDER BY created_at DESC LIMIT 1', identity.jobId, identity.employeeId);
  if (session) {
    db.prepare("UPDATE timer_sessions SET state = 'running', paused_at = NULL, stopped_at = NULL, is_overtime = 0, updated_at = ? WHERE id = ?").run(now, String(session.id));
    db.prepare('INSERT INTO timer_intervals (id, session_id, employee_id, started_at, kind) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), String(session.id), identity.employeeId, now, 'normal');
    db.prepare("UPDATE jobs SET status = 'in_lucru', started_at = ?, is_overtime = 0, updated_at = ? WHERE id = ?").run(now, now, identity.jobId);
    audit(db, job, identity.employeeId, 'in_lucru', 'Reluare cronometru lucrare', now);
    return { status: 200, payload: { ok: true, job: getJob(db, identity.jobId), session: getSession(db, identity.jobId) } };
  }
  const sessionId = randomUUID();
  db.prepare('INSERT INTO timer_sessions (id, job_id, employee_id, started_at, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(sessionId, identity.jobId, identity.employeeId, now, 'running', now, now);
  db.prepare('INSERT INTO timer_intervals (id, session_id, employee_id, started_at, kind) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), sessionId, identity.employeeId, now, 'normal');
  db.prepare("UPDATE jobs SET status = 'in_lucru', started_at = ?, is_overtime = 0, updated_at = ? WHERE id = ?").run(now, now, identity.jobId);
  audit(db, job, identity.employeeId, 'in_lucru', 'Pornire cronometru lucrare', now);
  return { status: 201, payload: { ok: true, job: getJob(db, identity.jobId), session: getSession(db, identity.jobId) } };
}

function updateStatus(db: DatabaseSync, body: Body, nowMs: number): TimerOutcome {
  const identity = validateIdentity(db, body);
  if ('status' in identity) return identity;
  const status = requiredString(body, 'status');
  if (!status || !TIMER_STATUSES.has(status)) return error(422, 'INVALID_STATE', 'Statusul timerului nu este valid.');
  const job = getJob(db, identity.jobId)!;
  const session = getSession(db, identity.jobId, identity.employeeId);
  if (!session || session.state !== 'running') return error(409, 'TIMER_NOT_ACTIVE', 'Nu există o sesiune activă.');
  const interval = activeInterval(db, String(session.id));
  if (!interval) return error(409, 'INVALID_STATE', 'Sesiunea nu are interval activ.');
  const now = nowIso(nowMs);
  const amounts = closeInterval(db, session, interval, nowMs, typeof body.pause_reason === 'string' ? body.pause_reason : undefined);
  const normal = Number(session.normal_seconds) + amounts.normal;
  const overtime = Number(session.overtime_seconds) + amounts.overtime;
  const state = status === 'finalizat' ? 'finalized' : 'stopped';
  db.prepare('UPDATE timer_sessions SET state = ?, paused_at = ?, stopped_at = ?, normal_seconds = ?, overtime_seconds = ?, is_overtime = 0, updated_at = ? WHERE id = ?')
    .run(state, now, now, normal, overtime, now, String(session.id));
  db.prepare("UPDATE jobs SET status = ?, worked_seconds = ?, overtime_seconds = ?, started_at = NULL, is_overtime = 0, completed_at = CASE WHEN ? = 'finalizat' THEN COALESCE(completed_at, ?) ELSE completed_at END, updated_at = ? WHERE id = ?")
    .run(status, normal, overtime, status, now, now, identity.jobId);
  audit(db, job, identity.employeeId, status, 'Angajatul a actualizat lucrarea', now);
  if (status === 'finalizat') {
    const remaining = row(db, "SELECT COUNT(*) AS count FROM jobs WHERE car_id = ? AND status != 'finalizat'", String(job.car_id));
    if (Number(remaining?.count ?? 0) === 0) db.prepare('UPDATE cars SET completed_at = ?, updated_at = ? WHERE id = ?').run(now, now, String(job.car_id));
  }
  return { status: 200, payload: { ok: true, job: getJob(db, identity.jobId), session: row(db, 'SELECT * FROM timer_sessions WHERE id = ?', String(session.id)) } };
}

function isOvertimeWindow(scheduleRow: ScheduleRow | null, nowMs: number): boolean {
  if (!scheduleRow) return false;
  const current = parts(nowMs);
  const day = dayWindow(scheduleRow, current.weekday);
  if (!day.active) return true;
  const value = current.hour * 60 + current.minute;
  return (value >= minutes(scheduleRow.break_start) && value < minutes(scheduleRow.break_end))
    || value >= minutes(day.end) || value < minutes(day.start);
}

function startOvertime(db: DatabaseSync, body: Body, nowMs: number): TimerOutcome {
  const identity = validateIdentity(db, body);
  if ('status' in identity) return identity;
  const job = getJob(db, identity.jobId)!;
  if (job.assigned_employee_id !== identity.employeeId) return error(409, 'JOB_NOT_ASSIGNED', 'Lucrarea nu este atribuită angajatului.');
  const session = getSession(db, identity.jobId, identity.employeeId);
  if (!session || session.state !== 'running') return error(409, 'TIMER_NOT_ACTIVE', 'Lucrarea nu este pornită.');
  if (Number(session.is_overtime) === 1) return { status: 200, payload: { ok: true, no_op: true, job, session } };
  if (!isOvertimeWindow(schedule(db), nowMs)) return error(409, 'INVALID_OVERTIME_WINDOW', 'Orele suplimentare pot fi pornite doar în fereastra legală.');
  const interval = activeInterval(db, String(session.id));
  if (!interval) return error(409, 'INVALID_STATE', 'Sesiunea nu are interval activ.');
  const now = nowIso(nowMs);
  const amounts = closeInterval(db, session, interval, nowMs);
  const normal = Number(session.normal_seconds) + amounts.normal;
  db.prepare('UPDATE timer_sessions SET normal_seconds = ?, is_overtime = 1, updated_at = ? WHERE id = ?').run(normal, now, String(session.id));
  db.prepare('INSERT INTO timer_intervals (id, session_id, employee_id, started_at, kind) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), String(session.id), identity.employeeId, now, 'overtime');
  db.prepare('UPDATE jobs SET worked_seconds = ?, is_overtime = 1, started_at = ?, updated_at = ? WHERE id = ?').run(normal, now, now, identity.jobId);
  audit(db, job, identity.employeeId, 'overtime_start', 'Ore peste program pornite', now);
  return { status: 200, payload: { ok: true, job: getJob(db, identity.jobId), session: getSession(db, identity.jobId, identity.employeeId) } };
}

function stopOvertime(db: DatabaseSync, body: Body, nowMs: number): TimerOutcome {
  const identity = validateIdentity(db, body);
  if ('status' in identity) return identity;
  const job = getJob(db, identity.jobId)!;
  if (job.assigned_employee_id !== identity.employeeId) return error(409, 'JOB_NOT_ASSIGNED', 'Lucrarea nu este atribuită angajatului.');
  const session = getSession(db, identity.jobId, identity.employeeId);
  if (!session || session.state !== 'running' || Number(session.is_overtime) !== 1) return error(409, 'TIMER_NOT_ACTIVE', 'Nu există o sesiune overtime activă.');
  const interval = activeInterval(db, String(session.id));
  if (!interval) return error(409, 'INVALID_STATE', 'Sesiunea nu are interval activ.');
  const now = nowIso(nowMs);
  const amounts = closeInterval(db, session, interval, nowMs);
  const overtime = Number(session.overtime_seconds) + amounts.overtime;
  db.prepare("UPDATE timer_sessions SET state = 'stopped', paused_at = ?, stopped_at = ?, overtime_seconds = ?, is_overtime = 0, updated_at = ? WHERE id = ?").run(now, now, overtime, now, String(session.id));
  db.prepare("UPDATE jobs SET overtime_seconds = ?, started_at = NULL, is_overtime = 0, status = 'asteptare', updated_at = ? WHERE id = ?").run(overtime, now, identity.jobId);
  audit(db, job, identity.employeeId, 'overtime_stop', 'Ore peste program oprite', now);
  return { status: 200, payload: { ok: true, job: getJob(db, identity.jobId), session: row(db, 'SELECT * FROM timer_sessions WHERE id = ?', String(session.id)) } };
}

type AutoEvent = 'break_start' | 'break_end' | 'work_end';

function eventMode(db: DatabaseSync, employeeId: string, event: AutoEvent): boolean {
  const setting = row(db, 'SELECT * FROM employee_event_settings WHERE employee_id = ?', employeeId);
  return String(setting?.[`${event}_mode`] ?? 'auto') === 'auto';
}

function eventLogged(db: DatabaseSync, employeeId: string, jobId: string, day: string, event: AutoEvent): boolean {
  return Boolean(row(
    db,
    'SELECT id FROM session_event_log WHERE employee_id = ? AND job_id = ? AND event_date = ? AND event_type = ?',
    employeeId,
    jobId,
    day,
    event,
  ));
}

function logAutoEvent(db: DatabaseSync, employeeId: string, jobId: string, day: string, event: AutoEvent, now: string): void {
  db.prepare('INSERT INTO session_event_log (id, employee_id, event_date, event_type, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), employeeId, day, event, jobId, now);
}

function dateString(value: { year: number; month: number; day: number }): string {
  return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

/** Reconciles one active session against missed Bucharest schedule boundaries. */
function reconcileAutoEvents(db: DatabaseSync, sessionId: string, nowMs: number): { reconciled: number; alreadySynced: number } {
  let reconciled = 0;
  let alreadySynced = 0;
  let session = row(db, 'SELECT * FROM timer_sessions WHERE id = ?', sessionId);
  if (!session || !['running', 'paused'].includes(String(session.state))) return { reconciled, alreadySynced };
  const scheduleRow = schedule(db);
  if (!scheduleRow || Number(session.is_overtime) === 1) return { reconciled, alreadySynced };
  const employeeId = String(session.employee_id);
  const jobId = String(session.job_id);
  const started = parts(new Date(String(session.started_at)).getTime());
  const current = parts(nowMs);
  const dayCount = Math.floor((Date.UTC(current.year, current.month - 1, current.day) - Date.UTC(started.year, started.month - 1, started.day)) / 86_400_000);
  const now = nowIso(nowMs);

  for (let offset = 0; offset <= Math.max(0, dayCount); offset += 1) {
    const civilDate = parts(Date.UTC(started.year, started.month - 1, started.day + offset, 12, 0));
    const day = dayWindow(scheduleRow, civilDate.weekday);
    if (!day.active) continue;
    const dayStr = dateString(civilDate);
    const boundaries: Array<{ event: AutoEvent; ms: number }> = [
      { event: 'break_start', ms: zonedTimestamp(civilDate.year, civilDate.month, civilDate.day, Math.floor(minutes(scheduleRow.break_start) / 60), minutes(scheduleRow.break_start) % 60) },
      { event: 'break_end', ms: zonedTimestamp(civilDate.year, civilDate.month, civilDate.day, Math.floor(minutes(scheduleRow.break_end) / 60), minutes(scheduleRow.break_end) % 60) },
      { event: 'work_end', ms: zonedTimestamp(civilDate.year, civilDate.month, civilDate.day, Math.floor(minutes(day.end) / 60), minutes(day.end) % 60) },
    ];

    for (const boundary of boundaries) {
      if (nowMs < boundary.ms || !eventMode(db, employeeId, boundary.event)) continue;
      if (eventLogged(db, employeeId, jobId, dayStr, boundary.event)) {
        alreadySynced += 1;
        continue;
      }
      session = row(db, 'SELECT * FROM timer_sessions WHERE id = ?', sessionId);
      if (!session || !['running', 'paused'].includes(String(session.state))) continue;
      const job = getJob(db, jobId);
      if (!job) continue;

      if (boundary.event === 'break_start' && String(session.state) === 'running') {
        const interval = activeInterval(db, sessionId);
        if (!interval || String(interval.kind) !== 'normal') continue;
        const amounts = closeInterval(db, session, interval, boundary.ms, 'auto_break');
        const normal = Number(session.normal_seconds) + amounts.normal;
        db.prepare("UPDATE timer_sessions SET state = 'paused', paused_at = ?, normal_seconds = ?, updated_at = ? WHERE id = ?")
          .run(nowIso(boundary.ms), normal, now, sessionId);
        db.prepare("UPDATE jobs SET worked_seconds = ?, started_at = NULL, is_overtime = 0, updated_at = ? WHERE id = ?")
          .run(normal, now, jobId);
      } else if (boundary.event === 'break_end' && String(session.state) === 'paused') {
        db.prepare("UPDATE timer_sessions SET state = 'running', paused_at = NULL, updated_at = ? WHERE id = ?").run(now, sessionId);
        db.prepare('INSERT INTO timer_intervals (id, session_id, employee_id, started_at, kind) VALUES (?, ?, ?, ?, ?)')
          .run(randomUUID(), sessionId, employeeId, nowIso(boundary.ms), 'normal');
        db.prepare("UPDATE jobs SET status = 'in_lucru', started_at = ?, is_overtime = 0, updated_at = ? WHERE id = ?")
          .run(nowIso(boundary.ms), now, jobId);
      } else if (boundary.event === 'work_end' && String(session.state) === 'running') {
        const interval = activeInterval(db, sessionId);
        if (!interval || String(interval.kind) !== 'normal') continue;
        const amounts = closeInterval(db, session, interval, boundary.ms, 'work_end');
        const normal = Number(session.normal_seconds) + amounts.normal;
        db.prepare("UPDATE timer_sessions SET state = 'stopped', paused_at = ?, stopped_at = ?, normal_seconds = ?, is_overtime = 0, updated_at = ? WHERE id = ?")
          .run(nowIso(boundary.ms), nowIso(boundary.ms), normal, now, sessionId);
        db.prepare("UPDATE jobs SET status = 'asteptare', worked_seconds = ?, started_at = NULL, is_overtime = 0, updated_at = ? WHERE id = ?")
          .run(normal, now, jobId);
      } else {
        continue;
      }
      logAutoEvent(db, employeeId, jobId, dayStr, boundary.event, now);
      audit(db, job, employeeId, 'auto_sync', `Session reconciled at ${boundary.event}`, now);
      reconciled += 1;
    }
  }
  return { reconciled, alreadySynced };
}

/** Check for sessions that crossed auto-sync windows during server downtime and reconcile them. */
export function checkAutoSyncWindows(db: DatabaseSync, nowMs: number): void {
  try {
    return tx(db, () => {
      const activeSessions = db.prepare(
        "SELECT id FROM timer_sessions WHERE state IN ('running', 'paused')"
      ).all() as Array<{ id: string }>;
      
      for (const { id } of activeSessions) {
        reconcileAutoEvents(db, id, nowMs);
      }
    });
  } catch (err) {
    // Log but don't fail server startup on auto-sync error.
    console.error('Auto-sync window check failed:', err);
  }
}

export function dispatchTimer(db: DatabaseSync, method: string, path: string, body: Body, nowMs = Date.now()): TimerOutcome | null {
  if (method !== 'POST') return null;
  try {
    return tx(db, () => {
      if (path === '/api/timer/start' || path === '/api/timer/resume') return startJob(db, body, nowMs);
      if (path === '/api/timer/status') return updateStatus(db, body, nowMs);
      if (path === '/api/timer/pause' || path === '/api/timer/stop') return updateStatus(db, { ...body, status: 'asteptare' }, nowMs);
      if (path === '/api/timer/finalize') return updateStatus(db, { ...body, status: 'finalizat', pause_reason: 'completed' }, nowMs);
      if (path === '/api/timer/overtime/start') return startOvertime(db, body, nowMs);
      if (path === '/api/timer/overtime/stop') return stopOvertime(db, body, nowMs);
      if (path === '/api/timer/takeover') return takeoverJob(db, body, nowMs);
      if (path === '/api/timer/transfer') return transferCar(db, body, nowMs);
      return null;
    });
  } catch {
    return error(500, 'TIMER_TRANSACTION_FAILED', 'Operația timerului nu a putut fi finalizată.');
  }
}

export function getTimerState(db: DatabaseSync, jobId: string): TimerOutcome {
  const job = getJob(db, jobId);
  if (!job) return error(404, 'JOB_NOT_FOUND', 'Lucrarea nu există.');
  const session = getSession(db, jobId);
  const interval = session ? activeInterval(db, String(session.id)) : null;
  return { status: 200, payload: { ok: true, job, session, interval } };
}

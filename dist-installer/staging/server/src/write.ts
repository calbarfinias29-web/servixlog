/**
 * SERVIX — WRITE LOCAL de bază (FAZA 7A).
 *
 * Operații de scriere în SQLite, prin Local Server, COMPLET izolate de
 * Supabase. Niciun apel către Supabase, nicio sincronizare.
 *
 * Principii:
 *  - validare strictă server-side (tipuri, câmpuri obligatorii, enum-uri);
 *  - clientul NU poate trimite SQL — doar corpuri JSON pe allow-list;
 *  - câmpurile de TIMER sunt PROTEJATE (respinse cu 422);
 *  - fiecare scriere rulează într-o tranzacție SQLite;
 *  - duplicate evidente respinse (ex. license_plate deja existent);
 *  - referințe invalide (FK logice) respinse cu 422;
 *  - ID-uri generate server-side (randomUUID).
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';

import { dispatchTimer } from './timer.ts';

const CAR_STATUSES = ['noua', 'in_lucru', 'asteptare_piese', 'in_garantie', 'finalizata'];
const PRIORITIES = ['normala', 'urgenta'];
const JOB_STATUSES = ['asteptare', 'in_lucru', 'asteptare_piese', 'finalizat'];
const ROLES = ['admin', 'employee'];
const APPOINTMENT_STATUSES = ['programata', 'preluata', 'in_lucru', 'finalizata', 'anulata', 'neprezentata'];

/** Câmpuri de timer PROTEJATE — nu pot fi scrise prin API-ul local (FAZA 7A). */
export const TIMER_PROTECTED_FIELDS = [
  'worked_seconds',
  'overtime_seconds',
  'is_overtime',
  'started_at',
  'completed_at',
] as const;

export interface WriteOutcome {
  status: number;
  payload: unknown;
}

interface ValidationIssue {
  field: string;
  message: string;
}

type Body = Record<string, unknown>;

function reqString(body: Body, field: string, issues: ValidationIssue[]): string | null {
  const v = body[field];
  if (typeof v !== 'string' || v.trim() === '') {
    issues.push({ field, message: `câmpul '${field}' este obligatoriu (string nevid)` });
    return null;
  }
  return v.trim();
}

function optString(body: Body, field: string, issues: ValidationIssue[]): string | null | undefined {
  if (!(field in body)) return undefined;
  const v = body[field];
  if (v === null) return null;
  if (typeof v !== 'string') {
    issues.push({ field, message: `câmpul '${field}' trebuie să fie string sau null` });
    return undefined;
  }
  return v.trim() === '' ? null : v.trim();
}

function optBool(body: Body, field: string, issues: ValidationIssue[]): boolean | undefined {
  if (!(field in body)) return undefined;
  const v = body[field];
  if (typeof v !== 'boolean') {
    issues.push({ field, message: `câmpul '${field}' trebuie să fie boolean` });
    return undefined;
  }
  return v;
}

function optInt(body: Body, field: string, issues: ValidationIssue[], min = 0, max = Number.MAX_SAFE_INTEGER): number | undefined {
  if (!(field in body)) return undefined;
  const v = body[field];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    issues.push({ field, message: `câmpul '${field}' trebuie să fie întreg în [${min}, ${max}]` });
    return undefined;
  }
  return v;
}

function optEnum<T extends string>(body: Body, field: string, allowed: readonly T[], issues: ValidationIssue[]): T | undefined {
  if (!(field in body)) return undefined;
  const v = body[field];
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    issues.push({ field, message: `câmpul '${field}' trebuie să fie unul din: ${allowed.join(', ')}` });
    return undefined;
  }
  return v as T;
}

function optDate(body: Body, field: string, issues: ValidationIssue[]): string | null | undefined {
  if (!(field in body)) return undefined;
  const v = body[field];
  if (v === null) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    issues.push({ field, message: `câmpul '${field}' trebuie să fie dată YYYY-MM-DD` });
    return undefined;
  }
  return v;
}

function optTime(body: Body, field: string, issues: ValidationIssue[]): string | undefined {
  if (!(field in body)) return undefined;
  const v = body[field];
  if (typeof v !== 'string' || !/^\d{2}:\d{2}$/.test(v)) {
    issues.push({ field, message: `câmpul '${field}' trebuie să fie oră HH:MM` });
    return undefined;
  }
  return v;
}

function invalid(issues: ValidationIssue[]): WriteOutcome {
  return { status: 422, payload: { ok: false, error: 'invalid_payload', issues } };
}

function referenceNotFound(field: string, id: string): WriteOutcome {
  return { status: 422, payload: { ok: false, error: 'reference_not_found', field, id } };
}

function notFound(resource: string, id: string): WriteOutcome {
  return { status: 404, payload: { ok: false, error: 'not_found', resource, id } };
}

function timerProtected(fields: string[]): WriteOutcome {
  return {
    status: 422,
    payload: { ok: false, error: 'timer_fields_protected', fields, message: 'Câmpurile de timer nu pot fi modificate prin WRITE local (FAZA 7A).' },
  };
}

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

export async function readJsonBody(req: IncomingMessage): Promise<{ body?: Body; error?: WriteOutcome }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      return { error: { status: 413, payload: { ok: false, error: 'payload_too_large' } } };
    }
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) {
    return { error: { status: 400, payload: { ok: false, error: 'empty_body' } } };
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: { status: 400, payload: { ok: false, error: 'invalid_json', message: 'body-ul trebuie să fie un obiect JSON' } } };
    }
    return { body: parsed as Body };
  } catch {
    return { error: { status: 400, payload: { ok: false, error: 'invalid_json', message: 'JSON invalid' } } };
  }
}

/** Tranzacție SQLite — nimic parțial nu rămâne la eroare. */
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

function rowExists(db: DatabaseSync, table: string, id: string): boolean {
  const row = db.prepare(`SELECT 1 FROM "${table}" WHERE id = ? LIMIT 1`).get(id);
  return row !== undefined;
}

function getById(db: DatabaseSync, table: string, id: string): Record<string, unknown> | null {
  const row = db.prepare(`SELECT * FROM "${table}" WHERE id = ? LIMIT 1`).get(id) as Record<string, unknown> | undefined;
  return row ?? null;
}

interface SetEntry {
  col: string;
  value: string | number | null;
}

/**
 * UPDATE pe allow-list fixă de coloane (nume de coloane din cod, nu din input).
 * Returnează 404 dacă rândul nu există; altfel rândul actualizat.
 */
function applyUpdate(db: DatabaseSync, table: string, singular: string, id: string, sets: SetEntry[]): WriteOutcome {
  if (sets.length === 0) {
    return { status: 400, payload: { ok: false, error: 'no_fields', message: 'Niciun câmp valid de actualizat.' } };
  }
  return tx(db, () => {
    if (!rowExists(db, table, id)) return notFound(table, id);
    const sql = `UPDATE "${table}" SET ${sets.map((s) => `"${s.col}" = ?`).join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...sets.map((s) => s.value), id);
    return { status: 200, payload: { ok: true, [singular]: getById(db, table, id) } };
  });
}

// ---------------------------------------------------------------- cars

function createCar(db: DatabaseSync, body: Body): WriteOutcome {
  const issues: ValidationIssue[] = [];
  const licensePlate = reqString(body, 'license_plate', issues);
  const clientName = reqString(body, 'client_name', issues);
  const clientPhone = optString(body, 'client_phone', issues);
  const clientEmail = optString(body, 'client_email', issues);
  const make = optString(body, 'make', issues);
  const model = optString(body, 'model', issues);
  const year = optInt(body, 'year', issues, 1900, 2100);
  const color = optString(body, 'color', issues);
  const vin = optString(body, 'vin', issues);
  const mileage = optInt(body, 'mileage', issues);
  const fuelLevel = optString(body, 'fuel_level', issues);
  const status = optEnum(body, 'status', CAR_STATUSES, issues);
  const priority = optEnum(body, 'priority', PRIORITIES, issues);
  const deadline = optString(body, 'deadline', issues);
  const isWarranty = optBool(body, 'is_warranty', issues);
  const notes = optString(body, 'notes', issues);
  const assignedEmployeeId = optString(body, 'assigned_employee_id', issues);
  if (issues.length > 0) return invalid(issues);

  return tx(db, () => {
    if (assignedEmployeeId && !rowExists(db, 'employees', assignedEmployeeId)) {
      return referenceNotFound('assigned_employee_id', assignedEmployeeId);
    }
    const dup = db
      .prepare('SELECT id FROM cars WHERE LOWER(TRIM(license_plate)) = LOWER(?) LIMIT 1')
      .get(licensePlate) as { id: string } | undefined;
    if (dup) {
      return { status: 409, payload: { ok: false, error: 'duplicate_license_plate', id: dup.id } };
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO cars (id, license_plate, client_name, client_phone, client_email, make, model, year, color, vin, mileage, fuel_level, status, priority, deadline, is_warranty, notes, assigned_employee_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, licensePlate, clientName, clientPhone ?? null, clientEmail ?? null, make ?? null, model ?? null, year ?? null, color ?? null,
      vin ?? null, mileage ?? null, fuelLevel ?? null, status ?? 'noua', priority ?? 'normala', deadline ?? null, isWarranty ? 1 : 0,
      notes ?? null, assignedEmployeeId ?? null, new Date().toISOString(),
    );
    return { status: 201, payload: { ok: true, car: getById(db, 'cars', id) } };
  });
}

const CAR_UPDATE_FIELDS = new Set([
  'license_plate', 'client_name', 'client_phone', 'client_email', 'make', 'model', 'year', 'color', 'vin', 'mileage', 'fuel_level', 'status', 'priority', 'deadline',
  'is_warranty', 'notes', 'assigned_employee_id',
]);

function updateCar(db: DatabaseSync, id: string, body: Body): WriteOutcome {
  const issues: ValidationIssue[] = [];
  const licensePlate = optString(body, 'license_plate', issues);
  const clientName = optString(body, 'client_name', issues);
  const clientPhone = optString(body, 'client_phone', issues);
  const clientEmail = optString(body, 'client_email', issues);
  const make = optString(body, 'make', issues);
  const model = optString(body, 'model', issues);
  const year = optInt(body, 'year', issues, 1900, 2100);
  const color = optString(body, 'color', issues);
  const vin = optString(body, 'vin', issues);
  const mileage = optInt(body, 'mileage', issues);
  const fuelLevel = optString(body, 'fuel_level', issues);
  const status = optEnum(body, 'status', CAR_STATUSES, issues);
  const priority = optEnum(body, 'priority', PRIORITIES, issues);
  const deadline = optString(body, 'deadline', issues);
  const isWarranty = optBool(body, 'is_warranty', issues);
  const notes = optString(body, 'notes', issues);
  const assignedEmployeeId = optString(body, 'assigned_employee_id', issues);
  if (issues.length > 0) return invalid(issues);
  const unknown = Object.keys(body).filter((k) => !CAR_UPDATE_FIELDS.has(k));
  if (unknown.length > 0) {
    return { status: 422, payload: { ok: false, error: 'unknown_fields', fields: unknown } };
  }

  const sets: SetEntry[] = [];
  if (licensePlate !== undefined) sets.push({ col: 'license_plate', value: licensePlate });
  if (clientName !== undefined) sets.push({ col: 'client_name', value: clientName });
  if (clientPhone !== undefined) sets.push({ col: 'client_phone', value: clientPhone });
  if (clientEmail !== undefined) sets.push({ col: 'client_email', value: clientEmail });
  if (make !== undefined) sets.push({ col: 'make', value: make });
  if (model !== undefined) sets.push({ col: 'model', value: model });
  if (year !== undefined) sets.push({ col: 'year', value: year });
  if (color !== undefined) sets.push({ col: 'color', value: color });
  if (vin !== undefined) sets.push({ col: 'vin', value: vin });
  if (mileage !== undefined) sets.push({ col: 'mileage', value: mileage });
  if (fuelLevel !== undefined) sets.push({ col: 'fuel_level', value: fuelLevel });
  if (status !== undefined) sets.push({ col: 'status', value: status });
  if (priority !== undefined) sets.push({ col: 'priority', value: priority });
  if (deadline !== undefined) sets.push({ col: 'deadline', value: deadline });
  if (isWarranty !== undefined) sets.push({ col: 'is_warranty', value: isWarranty ? 1 : 0 });
  if (notes !== undefined) sets.push({ col: 'notes', value: notes });
  if (assignedEmployeeId !== undefined) sets.push({ col: 'assigned_employee_id', value: assignedEmployeeId });

  return tx(db, () => {
    if (assignedEmployeeId && !rowExists(db, 'employees', assignedEmployeeId)) {
      return referenceNotFound('assigned_employee_id', assignedEmployeeId);
    }
    if (licensePlate !== undefined) {
      const dup = db
        .prepare('SELECT id FROM cars WHERE LOWER(TRIM(license_plate)) = LOWER(?) AND id != ? LIMIT 1')
        .get(licensePlate, id) as { id: string } | undefined;
      if (dup) {
        return { status: 409, payload: { ok: false, error: 'duplicate_license_plate', id: dup.id } };
      }
    }
    if (!rowExists(db, 'cars', id)) return notFound('cars', id);
    if (sets.length === 0) {
      return { status: 400, payload: { ok: false, error: 'no_fields', message: 'Niciun câmp valid de actualizat.' } };
    }
    const sql = `UPDATE cars SET ${sets.map((s) => `"${s.col}" = ?`).join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...sets.map((s) => s.value), id);
    return { status: 200, payload: { ok: true, car: getById(db, 'cars', id) } };
  });
}

// ---------------------------------------------------------------- jobs

function createJob(db: DatabaseSync, body: Body): WriteOutcome {
  const issues: ValidationIssue[] = [];
  const carId = reqString(body, 'car_id', issues);
  const title = reqString(body, 'title', issues);
  const description = optString(body, 'description', issues);
  const status = optEnum(body, 'status', JOB_STATUSES, issues);
  const orderIndex = optInt(body, 'order_index', issues);
  if (issues.length > 0) return invalid(issues);
  const protectedTouched = Object.keys(body).filter((k) => (TIMER_PROTECTED_FIELDS as readonly string[]).includes(k));
  if (protectedTouched.length > 0) return timerProtected(protectedTouched);

  return tx(db, () => {
    if (!rowExists(db, 'cars', carId!)) return referenceNotFound('car_id', carId!);
    const id = randomUUID();
    db.prepare(
      'INSERT INTO jobs (id, car_id, title, description, status, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, carId, title, description ?? null, status ?? 'asteptare', orderIndex ?? 0, new Date().toISOString());
    return { status: 201, payload: { ok: true, job: getById(db, 'jobs', id) } };
  });
}

const JOB_UPDATE_FIELDS = new Set(['title', 'description', 'status', 'order_index']);

function updateJob(db: DatabaseSync, id: string, body: Body): WriteOutcome {
  const protectedTouched = Object.keys(body).filter((k) => (TIMER_PROTECTED_FIELDS as readonly string[]).includes(k));
  if (protectedTouched.length > 0) return timerProtected(protectedTouched);
  const issues: ValidationIssue[] = [];
  const title = optString(body, 'title', issues);
  const description = optString(body, 'description', issues);
  const status = optEnum(body, 'status', JOB_STATUSES, issues);
  const orderIndex = optInt(body, 'order_index', issues);
  if (issues.length > 0) return invalid(issues);
  const unknown = Object.keys(body).filter((k) => !JOB_UPDATE_FIELDS.has(k));
  if (unknown.length > 0) {
    return { status: 422, payload: { ok: false, error: 'unknown_fields', fields: unknown } };
  }
  const sets: SetEntry[] = [];
  if (title !== undefined) sets.push({ col: 'title', value: title });
  if (description !== undefined) sets.push({ col: 'description', value: description });
  if (status !== undefined) sets.push({ col: 'status', value: status });
  if (orderIndex !== undefined) sets.push({ col: 'order_index', value: orderIndex });
  return applyUpdate(db, 'jobs', 'job', id, sets);
}

// ---------------------------------------------------------------- employees

function createEmployee(db: DatabaseSync, body: Body): WriteOutcome {
  const issues: ValidationIssue[] = [];
  const name = reqString(body, 'name', issues);
  const role = optEnum(body, 'role', ROLES, issues);
  const active = optBool(body, 'active', issues);
  const username = optString(body, 'username', issues);
  if (issues.length > 0) return invalid(issues);
  return tx(db, () => {
    const id = randomUUID();
    db.prepare('INSERT INTO employees (id, name, role, active, username, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, name, role ?? 'employee', active === false ? 0 : 1, username ?? null, new Date().toISOString(),
    );
    return { status: 201, payload: { ok: true, employee: getById(db, 'employees', id) } };
  });
}

const EMPLOYEE_UPDATE_FIELDS = new Set(['name', 'role', 'active', 'username']);

function updateEmployee(db: DatabaseSync, id: string, body: Body): WriteOutcome {
  const issues: ValidationIssue[] = [];
  const name = optString(body, 'name', issues);
  const role = optEnum(body, 'role', ROLES, issues);
  const active = optBool(body, 'active', issues);
  const username = optString(body, 'username', issues);
  if (issues.length > 0) return invalid(issues);
  const unknown = Object.keys(body).filter((k) => !EMPLOYEE_UPDATE_FIELDS.has(k));
  if (unknown.length > 0) {
    return { status: 422, payload: { ok: false, error: 'unknown_fields', fields: unknown } };
  }
  const sets: SetEntry[] = [];
  if (name !== undefined) sets.push({ col: 'name', value: name });
  if (role !== undefined) sets.push({ col: 'role', value: role });
  if (active !== undefined) sets.push({ col: 'active', value: active ? 1 : 0 });
  if (username !== undefined) sets.push({ col: 'username', value: username });
  return applyUpdate(db, 'employees', 'employee', id, sets);
}

// ---------------------------------------------------------------- appointments

function createAppointment(db: DatabaseSync, body: Body): WriteOutcome {
  const issues: ValidationIssue[] = [];
  const licensePlate = reqString(body, 'license_plate', issues);
  const clientName = optString(body, 'client_name', issues);
  const make = optString(body, 'make', issues);
  const model = optString(body, 'model', issues);
  const appointmentDate = optDate(body, 'appointment_date', issues);
  if (appointmentDate === undefined) {
    issues.push({ field: 'appointment_date', message: "câmpul 'appointment_date' este obligatoriu (YYYY-MM-DD)" });
  }
  const appointmentTime = optTime(body, 'appointment_time', issues);
  if (appointmentTime === undefined) {
    issues.push({ field: 'appointment_time', message: "câmpul 'appointment_time' este obligatoriu (HH:MM)" });
  }
  const status = optEnum(body, 'status', APPOINTMENT_STATUSES, issues);
  const notes = optString(body, 'notes', issues);
  const carId = optString(body, 'car_id', issues);
  const employeeId = optString(body, 'employee_id', issues);
  if (issues.length > 0) return invalid(issues);

  return tx(db, () => {
    if (carId && !rowExists(db, 'cars', carId)) return referenceNotFound('car_id', carId);
    if (employeeId && !rowExists(db, 'employees', employeeId)) return referenceNotFound('employee_id', employeeId);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO appointments (id, license_plate, client_name, make, model, appointment_date, appointment_time, status, notes, car_id, employee_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, licensePlate, clientName ?? null, make ?? null, model ?? null,
      appointmentDate!, appointmentTime!, status ?? 'programata', notes ?? null,
      carId ?? null, employeeId ?? null, new Date().toISOString(),
    );
    return { status: 201, payload: { ok: true, appointment: getById(db, 'appointments', id) } };
  });
}

const APPOINTMENT_UPDATE_FIELDS = new Set([
  'license_plate', 'client_name', 'make', 'model',
  'appointment_date', 'appointment_time', 'status', 'notes',
]);

function updateAppointment(db: DatabaseSync, id: string, body: Body): WriteOutcome {
  const issues: ValidationIssue[] = [];
  const licensePlate = optString(body, 'license_plate', issues);
  const clientName = optString(body, 'client_name', issues);
  const make = optString(body, 'make', issues);
  const model = optString(body, 'model', issues);
  const appointmentDate = optDate(body, 'appointment_date', issues);
  const appointmentTime = optTime(body, 'appointment_time', issues);
  const status = optEnum(body, 'status', APPOINTMENT_STATUSES, issues);
  const notes = optString(body, 'notes', issues);
  if (issues.length > 0) return invalid(issues);
  const unknown = Object.keys(body).filter((k) => !APPOINTMENT_UPDATE_FIELDS.has(k));
  if (unknown.length > 0) {
    return { status: 422, payload: { ok: false, error: 'unknown_fields', fields: unknown } };
  }
  const sets: SetEntry[] = [];
  if (licensePlate !== undefined) sets.push({ col: 'license_plate', value: licensePlate });
  if (clientName !== undefined) sets.push({ col: 'client_name', value: clientName });
  if (make !== undefined) sets.push({ col: 'make', value: make });
  if (model !== undefined) sets.push({ col: 'model', value: model });
  if (appointmentDate !== undefined) sets.push({ col: 'appointment_date', value: appointmentDate });
  if (appointmentTime !== undefined) sets.push({ col: 'appointment_time', value: appointmentTime });
  if (status !== undefined) sets.push({ col: 'status', value: status });
  if (notes !== undefined) sets.push({ col: 'notes', value: notes });
  return applyUpdate(db, 'appointments', 'appointment', id, sets);
}

function deleteDemoAppointment(db: DatabaseSync, id: string): WriteOutcome {
  const appointment = getById(db, 'appointments', id) as { is_demo?: number } | null;
  if (!appointment) return notFound('appointments', id);
  if (Number(appointment.is_demo) !== 1) {
    return { status: 403, payload: { ok: false, error: 'demo_only', message: 'Doar programările demo pot fi șterse.' } };
  }
  db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
  return { status: 200, payload: { ok: true, appointment } };
}

// ---------------------------------------------------------------- rates

const RATE_FIELDS = new Set(['normal_rate', 'urgent_rate', 'warranty_rate', 'overtime_rate', 'vat_rate']);

function updateRates(db: DatabaseSync, body: Body): WriteOutcome {
  const issues: ValidationIssue[] = [];
  const normalRate = optInt(body, 'normal_rate', issues);
  const urgentRate = optInt(body, 'urgent_rate', issues);
  const warrantyRate = optInt(body, 'warranty_rate', issues);
  const overtimeRate = optInt(body, 'overtime_rate', issues);
  const vatRate = optInt(body, 'vat_rate', issues, 0, 100);
  if (issues.length > 0) return invalid(issues);
  const unknown = Object.keys(body).filter((k) => !RATE_FIELDS.has(k));
  if (unknown.length > 0) {
    return { status: 422, payload: { ok: false, error: 'unknown_fields', fields: unknown } };
  }
  const sets: SetEntry[] = [];
  if (normalRate !== undefined) sets.push({ col: 'normal_rate', value: normalRate });
  if (urgentRate !== undefined) sets.push({ col: 'urgent_rate', value: urgentRate });
  if (warrantyRate !== undefined) sets.push({ col: 'warranty_rate', value: warrantyRate });
  if (overtimeRate !== undefined) sets.push({ col: 'overtime_rate', value: overtimeRate });
  if (vatRate !== undefined) sets.push({ col: 'vat_rate', value: vatRate });
  const active = db.prepare('SELECT id FROM rates WHERE active = 1 ORDER BY created_at DESC, id LIMIT 1').get() as { id: string } | undefined;
  if (!active) return notFound('rates', 'active');
  return applyUpdate(db, 'rates', 'rates', active.id, sets);
}

// ---------------------------------------------------------------- schedule

const SCHEDULE_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const SCHEDULE_FIELDS = new Set([
  'work_start', 'work_end', 'break_start', 'break_end',
  ...SCHEDULE_DAYS.flatMap((day) => [`${day}_active`, `${day}_start`, `${day}_end`]),
]);

function updateSchedule(db: DatabaseSync, body: Body): WriteOutcome {
  const issues: ValidationIssue[] = [];
  const workStart = optTime(body, 'work_start', issues);
  const workEnd = optTime(body, 'work_end', issues);
  const breakStart = optTime(body, 'break_start', issues);
  const breakEnd = optTime(body, 'break_end', issues);
  const dayValues = SCHEDULE_DAYS.map((day) => ({
    day,
    active: optBool(body, `${day}_active`, issues),
    start: optTime(body, `${day}_start`, issues),
    end: optTime(body, `${day}_end`, issues),
  }));
  if (issues.length > 0) return invalid(issues);
  const unknown = Object.keys(body).filter((k) => !SCHEDULE_FIELDS.has(k));
  if (unknown.length > 0) {
    return { status: 422, payload: { ok: false, error: 'unknown_fields', fields: unknown } };
  }
  const sets: SetEntry[] = [];
  if (workStart !== undefined) sets.push({ col: 'work_start', value: workStart });
  if (workEnd !== undefined) sets.push({ col: 'work_end', value: workEnd });
  if (breakStart !== undefined) sets.push({ col: 'break_start', value: breakStart });
  if (breakEnd !== undefined) sets.push({ col: 'break_end', value: breakEnd });
  for (const value of dayValues) {
    if (value.active !== undefined) sets.push({ col: `${value.day}_active`, value: value.active ? 1 : 0 });
    if (value.start !== undefined) sets.push({ col: `${value.day}_start`, value: value.start });
    if (value.end !== undefined) sets.push({ col: `${value.day}_end`, value: value.end });
  }
  const active = db.prepare('SELECT id FROM work_schedule WHERE active = 1 ORDER BY created_at DESC, id LIMIT 1').get() as { id: string } | undefined;
  if (!active) return notFound('work_schedule', 'active');
  return applyUpdate(db, 'work_schedule', 'schedule', active.id, sets);
}

// ---------------------------------------------------------------- dispatch

const ID_ROUTE = /^\/api\/(cars|jobs|employees|appointments)\/([^/]+)$/;

/**
 * Dispatcher WRITE local. Doar POST (create) și PATCH (update).
 * Clientul trimite DOAR JSON validat pe allow-list — niciodată SQL.
 * NU există endpoint /api/sql sau echivalent.
 */
export async function dispatchWrite(db: DatabaseSync, method: string, path: string, req: IncomingMessage): Promise<WriteOutcome> {
  if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') {
    return { status: 405, payload: { ok: false, error: 'Method Not Allowed' } };
  }
  const read = method === 'DELETE' ? { body: {} as Body, error: null } : await readJsonBody(req);
  if (read.error) return read.error;
  const body = read.body!;

  const timerOutcome = dispatchTimer(db, method, path, body);
  if (timerOutcome) return timerOutcome;

  if (method === 'DELETE') {
    const match = ID_ROUTE.exec(path);
    if (match?.[1] === 'appointments') return deleteDemoAppointment(db, match[2]);
    return { status: 404, payload: { ok: false, error: 'not_found', path } };
  }

  if (method === 'POST') {
    switch (path) {
      case '/api/cars': return createCar(db, body);
      case '/api/jobs': return createJob(db, body);
      case '/api/employees': return createEmployee(db, body);
      case '/api/appointments': return createAppointment(db, body);
      default:
        return { status: 404, payload: { ok: false, error: 'not_found', path } };
    }
  }

  // PATCH
  switch (path) {
    case '/api/rates': return updateRates(db, body);
    case '/api/schedule': return updateSchedule(db, body);
    default: break;
  }
  const match = ID_ROUTE.exec(path);
  if (match) {
    const [, resource, id] = match;
    switch (resource) {
      case 'cars': return updateCar(db, id, body);
      case 'jobs': return updateJob(db, id, body);
      case 'employees': return updateEmployee(db, id, body);
      case 'appointments': return updateAppointment(db, id, body);
      default: break;
    }
  }
  return { status: 404, payload: { ok: false, error: 'not_found', path } };
}


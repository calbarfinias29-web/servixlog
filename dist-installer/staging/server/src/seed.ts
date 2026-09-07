/**
 * SERVIX — Seed DEMO local (FAZA 3).
 *
 * Date minimale de test, marcate explicit TEST/DEMO. Complet izolate de
 * Supabase — NU copiază niciun dat real.
 *
 * Idempotent: inserează DOAR dacă tabela employees este goală.
 */
import type { DatabaseSync } from 'node:sqlite';

const now = (): string => new Date().toISOString();

export function seedIfEmpty(db: DatabaseSync): void {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM employees').get() as { c: number };
  if (existing.c > 0) return;

  const insertEmployee = db.prepare(
    'INSERT INTO employees (id, name, role, active, username, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertCar = db.prepare(
    'INSERT INTO cars (id, license_plate, client_name, make, model, status, priority, assigned_employee_id, is_warranty, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertJob = db.prepare(
    'INSERT INTO jobs (id, car_id, title, status, worked_seconds, overtime_seconds, is_overtime, started_at, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertAppointment = db.prepare(
    'INSERT INTO appointments (id, license_plate, client_name, appointment_date, appointment_time, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertRate = db.prepare(
    'INSERT INTO rates (id, normal_rate, urgent_rate, warranty_rate, overtime_rate, vat_rate, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertSchedule = db.prepare(
    'INSERT INTO work_schedule (id, work_start, work_end, break_start, break_end, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  // FAZA 5 — seed extins (READ-only demo).
  const insertTheme = db.prepare(
    'INSERT INTO themes (id, name, config, created_at) VALUES (?, ?, ?, ?)'
  );
  const insertMake = db.prepare(
    'INSERT INTO vehicle_makes (id, name, normalized_name) VALUES (?, ?, ?)'
  );
  const insertModel = db.prepare(
    'INSERT INTO vehicle_models (id, make_id, name, normalized_name) VALUES (?, ?, ?, ?)'
  );
  const insertCatalog = db.prepare(
    'INSERT INTO work_catalog (id, name, normalized_name) VALUES (?, ?, ?)'
  );
  const insertActivity = db.prepare(
    'INSERT INTO activity_log (id, car_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insertTimeEntry = db.prepare(
    'INSERT INTO time_entries (id, employee_id, job_id, start_time, end_time, duration_seconds, is_overtime, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const ts = now();

  insertEmployee.run('emp-demo-1', 'Angajat DEMO (TEST)', 'employee', 1, 'demo.angajat', ts);
  insertEmployee.run('emp-demo-2', 'Angajat DEMO 2 (TEST)', 'employee', 1, 'demo.angajat.2', ts);
  insertEmployee.run('admin-demo-1', 'Admin DEMO (TEST)', 'admin', 1, 'demo.admin', ts);
  insertCar.run('car-demo-1', 'TEST-01', 'Client DEMO (TEST)', 'Mercedes', 'Clasa C', 'in_lucru', 'normala', 'emp-demo-1', 0, ts);
  insertJob.run('job-demo-1', 'car-demo-1', 'Revizie DEMO (TEST)', 'in_lucru', 0, 0, 0, ts, 1, ts);
  insertAppointment.run('apt-demo-1', 'TEST-02', 'Programare DEMO (TEST)', '2026-09-10', '09:00', 'programata', ts);
  insertRate.run('rate-demo-1', 100, 150, 0, 150, 21, 1, ts);
  insertSchedule.run('sched-demo-1', '07:00', '18:00', '13:00', '14:00', 1, ts);

  insertTheme.run('theme-demo-1', 'Dark DEMO (TEST)', '{"mode":"dark"}', ts);
  insertTheme.run('theme-demo-2', 'Light DEMO (TEST)', '{"mode":"light"}', ts);

  insertMake.run('make-demo-1', 'Mercedes', 'mercedes');
  insertMake.run('make-demo-2', 'Bmw', 'bmw');
  insertModel.run('model-demo-1', 'make-demo-1', 'Clasa C', 'clasa c');
  insertModel.run('model-demo-2', 'make-demo-2', 'Seria 3', 'seria 3');

  insertCatalog.run('cat-demo-1', 'Revizie DEMO (TEST)', 'revizie demo (test)');
  insertCatalog.run('cat-demo-2', 'Schimb ulei DEMO (TEST)', 'schimb ulei demo (test)');

  // Două intrări de activitate pentru mașina demo — testează filtrarea carId.
  insertActivity.run('act-demo-1', 'car-demo-1', 'status_changed', 'noua -> in_lucru (DEMO TEST)', '2026-09-01T08:00:00.000Z');
  insertActivity.run('act-demo-2', 'car-demo-1', 'note_added', 'Nota DEMO TEST', '2026-09-01T09:00:00.000Z');

  // Două intrări de timp — una normală, una overtime — pentru filtre
  // fromIso/toIso/employeeId și testarea is_overtime.
  insertTimeEntry.run('te-demo-1', 'emp-demo-1', 'job-demo-1', '2026-09-01T07:00:00.000Z', '2026-09-01T09:00:00.000Z', 7200, 0, ts);
  insertTimeEntry.run('te-demo-2', 'emp-demo-1', 'job-demo-1', '2026-09-02T18:30:00.000Z', '2026-09-02T19:30:00.000Z', 3600, 1, ts);
}
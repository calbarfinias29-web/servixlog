/*
# SERVIX - Add demo data support

## Overview
Adds an `is_demo` column to track demo vs real data across all content tables.
Demo data can be deleted; real data cannot. This is enforced at the database
level via RLS DELETE policies (USING (is_demo = true)), not just in the UI.

## Changes

### 1. New columns
- `employees.is_demo` (boolean, default false)
- `cars.is_demo` (boolean, default false)
- `jobs.is_demo` (boolean, default false)
- `time_entries.is_demo` (boolean, default false)
- `activity_log.is_demo` (boolean, default false)

### 2. Security changes (RLS DELETE policies)
All DELETE policies updated from `USING (true)` to `USING (is_demo = true)`.
This means only rows marked as demo can be deleted. Real data (is_demo = false)
cannot be deleted even via direct API calls with the anon key.

Affected tables: employees, cars, jobs, time_entries, activity_log.

### 3. Demo data
Creates 5 demo employees (Alex D., Marius P., Robert C., Cristian V., Daniel M.)
with associated demo cars, jobs, time entries, and activity log entries.
Includes a multi-year history car (TM 27 DEMO) and an overdue car.

## Important notes
1. Sami, Gogu, Ghiță, and Admin remain real (is_demo = false).
2. All existing data keeps is_demo = false (the column default).
3. Demo data is safe to re-run: all inserts use IF NOT EXISTS / ON CONFLICT guards.
*/

-- Add is_demo columns
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- Update DELETE policies: only demo rows can be deleted
DROP POLICY IF EXISTS "anon_delete_employees" ON employees;
CREATE POLICY "anon_delete_employees" ON employees FOR DELETE
  TO anon, authenticated USING (is_demo = true);

DROP POLICY IF EXISTS "anon_delete_cars" ON cars;
CREATE POLICY "anon_delete_cars" ON cars FOR DELETE
  TO anon, authenticated USING (is_demo = true);

DROP POLICY IF EXISTS "anon_delete_jobs" ON jobs;
CREATE POLICY "anon_delete_jobs" ON jobs FOR DELETE
  TO anon, authenticated USING (is_demo = true);

DROP POLICY IF EXISTS "anon_delete_time_entries" ON time_entries;
CREATE POLICY "anon_delete_time_entries" ON time_entries FOR DELETE
  TO anon, authenticated USING (is_demo = true);

DROP POLICY IF EXISTS "anon_delete_activity_log" ON activity_log;
CREATE POLICY "anon_delete_activity_log" ON activity_log FOR DELETE
  TO anon, authenticated USING (is_demo = true);

-- Insert demo employees
INSERT INTO employees (name, role, is_demo) VALUES
  ('Alex D.', 'employee', true),
  ('Marius P.', 'employee', true),
  ('Robert C.', 'employee', true),
  ('Cristian V.', 'employee', true),
  ('Daniel M.', 'employee', true)
ON CONFLICT (name) DO NOTHING;

-- Insert demo data (cars, jobs, time entries, activity log)
DO $$
DECLARE
  alex_id uuid;     marius_id uuid;  robert_id uuid;
  cristian_id uuid; daniel_id uuid;
  car_id uuid;      job_id uuid;
BEGIN
  SELECT id INTO alex_id     FROM employees WHERE name = 'Alex D.'     LIMIT 1;
  SELECT id INTO marius_id   FROM employees WHERE name = 'Marius P.'    LIMIT 1;
  SELECT id INTO robert_id   FROM employees WHERE name = 'Robert C.'   LIMIT 1;
  SELECT id INTO cristian_id FROM employees WHERE name = 'Cristian V.'  LIMIT 1;
  SELECT id INTO daniel_id   FROM employees WHERE name = 'Daniel M.'   LIMIT 1;

  -- ============================================================
  -- TM 27 DEMO — car with multi-year history (Alex D. / Marius P. / Robert C.)
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'TM 27 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo, completed_at)
    VALUES ('TM 27 DEMO', 'Demo Client 1', '0700 000 001', 'Volkswagen', 'Passat', 2018, 'finalizata', 'normala', alex_id, '2025-03-20', true, '2027-01-10')
    RETURNING id INTO car_id;

    -- 2025: Schimb ulei by Alex D., 2h 10m = 7800s
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Schimb ulei', 'Ulei motor și filtre — revizie 2025', 'finalizat', 7800, '2025-03-15 10:10:00', 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2025-03-15 08:00:00', '2025-03-15 10:10:00', 7800, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (alex_id, car_id, job_id, 'finalizat', 'Schimb ulei finalizat — 2h 10m', true);

    -- 2026: Schimb ambreiaj by Marius P., 4h 20m = 15600s
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Schimb ambreiaj', 'Kit ambreiaj complet — 2026', 'finalizat', 15600, '2026-05-20 12:20:00', 2, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, marius_id, '2026-05-20 08:00:00', '2026-05-20 12:20:00', 15600, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (marius_id, car_id, job_id, 'finalizat', 'Schimb ambreiaj finalizat — 4h 20m', true);

    -- 2027: Schimb planetare by Robert C., 3h 15m = 11700s
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Schimb planetare', 'Planetară dreapta — 2027', 'finalizat', 11700, '2027-01-10 11:15:00', 3, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, robert_id, '2027-01-10 08:00:00', '2027-01-10 11:15:00', 11700, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (robert_id, car_id, job_id, 'finalizat', 'Schimb planetare finalizat — 3h 15m', true);
  END IF;

  -- ============================================================
  -- B 10 DEMO — in lucru (Alex D.)
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'B 10 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo)
    VALUES ('B 10 DEMO', 'Demo Client 2', '0700 000 002', 'BMW', 'Seria 3', 2020, 'in_lucru', 'normala', alex_id, current_date + 2, true)
    RETURNING id INTO car_id;

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Verificare frâne', 'Inspecție plăcuțe și discuri', 'in_lucru', 5400, 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2026-08-20 08:00:00', '2026-08-20 09:30:00', 5400, false, 'manual', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (alex_id, car_id, job_id, 'in_lucru', 'Verificare frâne începută', true);

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Schimb plăcuțe frână', 'Plăcuțe față', 'asteptare', 0, 2, true);
  END IF;

  -- ============================================================
  -- CJ 55 DEMO — așteptare piese (Marius P.)
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'CJ 55 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo)
    VALUES ('CJ 55 DEMO', 'Demo Client 3', '0700 000 003', 'Audi', 'A4', 2019, 'asteptare_piese', 'urgenta', marius_id, current_date + 1, true)
    RETURNING id INTO car_id;

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Schimb ambreiaj', 'Kit ambreiaj — piese comandate', 'asteptare_piese', 7200, 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, marius_id, '2026-08-15 08:00:00', '2026-08-15 10:00:00', 7200, false, 'parts', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (marius_id, car_id, job_id, 'asteptare_piese', 'Ambreiaj pus în așteptare piese', true);

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Verificare cutie viteze', 'Inspecție cutie', 'asteptare', 0, 2, true);
  END IF;

  -- ============================================================
  -- TM 99 DEMO — finalizată (Marius P.)
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'TM 99 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo, completed_at)
    VALUES ('TM 99 DEMO', 'Demo Client 4', '0700 000 004', 'Ford', 'Focus', 2017, 'finalizata', 'normala', marius_id, '2026-06-15', true, '2026-06-10')
    RETURNING id INTO car_id;

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Revizie generală', 'Ulei, filtre, verificare lichide', 'finalizat', 14400, '2026-06-10 16:00:00', 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, marius_id, '2026-06-10 08:00:00', '2026-06-10 16:00:00', 14400, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (marius_id, car_id, job_id, 'finalizat', 'Revizie generală finalizată — 4h', true);
  END IF;

  -- ============================================================
  -- IS 22 DEMO — în lucru + întârziat (Robert C.)
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'IS 22 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo)
    VALUES ('IS 22 DEMO', 'Demo Client 5', '0700 000 005', 'Opel', 'Astra', 2016, 'in_lucru', 'urgenta', robert_id, current_date - 3, true)
    RETURNING id INTO car_id;

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Schimb planetare', 'Planetară stânga', 'in_lucru', 9000, 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, robert_id, '2026-08-22 08:00:00', '2026-08-22 10:30:00', 9000, false, 'manual', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (robert_id, car_id, job_id, 'in_lucru', 'Schimb planetare început', true);

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Verificare suspensie', 'Inspecție amortizoare', 'asteptare', 0, 2, true);
  END IF;

  -- ============================================================
  -- TM 44 DEMO — nouă (Cristian V.)
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'TM 44 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo)
    VALUES ('TM 44 DEMO', 'Demo Client 6', '0700 000 006', 'Skoda', 'Octavia', 2022, 'noua', 'normala', cristian_id, current_date + 5, true)
    RETURNING id INTO car_id;

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Diagnoză motor', 'Diagnoză computerizată motor', 'asteptare', 0, 1, true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (cristian_id, car_id, null, 'noua', 'Mașină nouă adăugată', true);
  END IF;

  -- ============================================================
  -- B 77 DEMO — finalizată (Daniel M.)
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'B 77 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo, completed_at)
    VALUES ('B 77 DEMO', 'Demo Client 7', '0700 000 007', 'Renault', 'Clio', 2021, 'finalizata', 'normala', daniel_id, '2026-07-20', true, '2026-07-15')
    RETURNING id INTO car_id;

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Schimb ulei', 'Ulei motor și filtre', 'finalizat', 5400, '2026-07-15 09:30:00', 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, daniel_id, '2026-07-15 08:00:00', '2026-07-15 09:30:00', 5400, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (daniel_id, car_id, job_id, 'finalizat', 'Schimb ulei finalizat — 1h 30m', true);

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Verificare frâne', 'Inspecție plăcuțe', 'finalizat', 3600, '2026-07-15 11:00:00', 2, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, daniel_id, '2026-07-15 10:00:00', '2026-07-15 11:00:00', 3600, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (daniel_id, car_id, job_id, 'finalizat', 'Verificare frâne finalizată — 1h', true);
  END IF;
END $$;

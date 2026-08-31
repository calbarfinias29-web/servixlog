/*
# SERVIX - Themes table + expanded demo data

## Overview
1. Adds a `themes` table for storing admin and employee color themes independently.
2. Expands demo data: more cars for Alex D. (5 in lucru, 2 finalizate, 3 asteptare piese, 2 intarziate),
   TM99 DEMO with 3-year history (2023-2026), additional demo cars.

## New Tables
- `themes`: id, name (unique), scope ('admin' | 'employee'), is_builtin (bool),
  is_custom (bool), colors (jsonb with CSS variable mappings), created_at, updated_at.
  Builtin themes are seeded; custom themes created by admin are is_custom = true.

## Security
- RLS enabled on themes, anon+authenticated full CRUD (internal app).

## Demo Data
- 5 cars IN LUCRU for Alex D. (B10 DEMO already exists + 4 new)
- 2 cars FINALIZATE for Alex D. (2 new)
- 3 cars AȘTEPTARE PIESE for Alex D. (3 new, CJ55 is Marius's)
- 2 cars ÎNTÂRZIATE (IS22 already exists + 1 new for Alex D.)
- TM99 DEMO: expanded with 2023, 2024, 2025 history jobs + 2026 current job
- Additional demo cars TM88, TM77, TM66, TM55, TM33, TM22
*/

-- ============================================================
-- THEMES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  scope text NOT NULL DEFAULT 'employee',
  is_builtin boolean NOT NULL DEFAULT false,
  is_custom boolean NOT NULL DEFAULT false,
  colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_themes" ON themes;
CREATE POLICY "anon_select_themes" ON themes FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_themes" ON themes;
CREATE POLICY "anon_insert_themes" ON themes FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_themes" ON themes;
CREATE POLICY "anon_update_themes" ON themes FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_themes" ON themes;
CREATE POLICY "anon_delete_themes" ON themes FOR DELETE
  TO anon, authenticated USING (is_custom = true);

-- Re-seed builtin themes with SERVIX PURPLE mockup palettes:
-- employee = dark theme with purple accents, admin = light theme with purple accents.
UPDATE themes SET colors = colors || '{"--primary":"#8b5cf6","--secondary":"#a78bfa","--accent":"#7c3aed","--background":"#0d0b14","--surface":"#17141f","--sidebar":"#120f1a","--card":"#1b1726","--button":"#7c3aed","--text-primary":"#f3f1fa","--text-secondary":"#9d94b8","--border":"#2a2438","--success":"#34d399","--warning":"#fbbf24","--danger":"#f87171","--info":"#60a5fa"}'::jsonb
WHERE is_builtin = true AND scope = 'employee';

UPDATE themes SET colors = colors || '{"--primary":"#7c3aed","--secondary":"#8b5cf6","--accent":"#a78bfa","--background":"#f5f4fb","--surface":"#ffffff","--sidebar":"#ffffff","--card":"#ffffff","--button":"#7c3aed","--text-primary":"#211d33","--text-secondary":"#6f688c","--border":"#e5e2f2"}'::jsonb
WHERE is_builtin = true AND scope = 'admin';

-- ============================================================
-- EXPANDED DEMO DATA
-- All variables used below are declared here and resolved from
-- the existing employees table by name (no hardcoded UUIDs).
-- If a demo employee is missing we fail fast with an explicit,
-- clear error instead of leaving a NULL that would break inserts
-- with obscure NOT NULL / FK violations later on.
-- ============================================================
DO $$
DECLARE
  alex_id uuid;     marius_id uuid;  robert_id uuid;
  cristian_id uuid; daniel_id uuid;
  car_id uuid;      job_id uuid;
BEGIN
  -- Resolve demo employees from the existing employees table
  SELECT id INTO alex_id     FROM employees WHERE name = 'Alex D.'     LIMIT 1;
  SELECT id INTO marius_id   FROM employees WHERE name = 'Marius P.'    LIMIT 1;
  SELECT id INTO robert_id   FROM employees WHERE name = 'Robert C.'   LIMIT 1;
  SELECT id INTO cristian_id FROM employees WHERE name = 'Cristian V.'  LIMIT 1;
  SELECT id INTO daniel_id   FROM employees WHERE name = 'Daniel M.'   LIMIT 1;

  -- Explicit, clear guard: every demo employee referenced below must exist.
  IF alex_id IS NULL THEN
    RAISE EXCEPTION 'Demo employee ''Alex D.'' not found in employees table. Run migration 20260824122127_servix_demo_data_support.sql first.';
  END IF;
  IF marius_id IS NULL THEN
    RAISE EXCEPTION 'Demo employee ''Marius P.'' not found in employees table. Run migration 20260824122127_servix_demo_data_support.sql first.';
  END IF;
  IF robert_id IS NULL THEN
    RAISE EXCEPTION 'Demo employee ''Robert C.'' not found in employees table. Run migration 20260824122127_servix_demo_data_support.sql first.';
  END IF;
  IF cristian_id IS NULL THEN
    RAISE EXCEPTION 'Demo employee ''Cristian V.'' not found in employees table. Run migration 20260824122127_servix_demo_data_support.sql first.';
  END IF;
  IF daniel_id IS NULL THEN
    RAISE EXCEPTION 'Demo employee ''Daniel M.'' not found in employees table. Run migration 20260824122127_servix_demo_data_support.sql first.';
  END IF;

  -- ============================================================
  -- TM99 DEMO — car with 3-year history (2023-2026) for Alex D.
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'TM99 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo)
    VALUES ('TM99 DEMO', 'Andrei Popescu', '0720 999 999', 'Dacia', 'Logan', 2019, 'in_lucru', 'normala', alex_id, current_date + 2, true)
    RETURNING id INTO car_id;

    -- 2023: Revizie completă by Alex D., 3h = 10800s
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Revizie completă', 'Revizie completă anuală 2023', 'finalizat', 10800, '2023-06-15 12:00:00', 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2023-06-15 09:00:00', '2023-06-15 12:00:00', 10800, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (alex_id, car_id, job_id, 'finalizat', 'Revizie completă — 3h', true);

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Schimb ulei', 'Ulei motor 2023', 'finalizat', 3600, '2023-06-15 15:00:00', 2, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2023-06-15 14:00:00', '2023-06-15 15:00:00', 3600, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (alex_id, car_id, job_id, 'finalizat', 'Schimb ulei — 1h', true);

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Schimb filtre', 'Filtre aer și polen 2023', 'finalizat', 2700, '2023-06-15 15:45:00', 3, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2023-06-15 15:00:00', '2023-06-15 15:45:00', 2700, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (alex_id, car_id, job_id, 'finalizat', 'Schimb filtre — 45m', true);

    -- 2024: Schimb ambreiaj + Verificare frâne
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Schimb ambreiaj', 'Kit ambreiaj complet 2024', 'finalizat', 18000, '2024-03-20 16:00:00', 4, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, marius_id, '2024-03-20 08:00:00', '2024-03-20 13:00:00', 18000, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (marius_id, car_id, job_id, 'finalizat', 'Schimb ambreiaj — 5h', true);

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Verificare frâne', 'Inspecție sistem frânare 2024', 'finalizat', 5400, '2024-03-20 17:30:00', 5, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, marius_id, '2024-03-20 16:00:00', '2024-03-20 17:30:00', 5400, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (marius_id, car_id, job_id, 'finalizat', 'Verificare frâne — 1h 30m', true);

    -- 2025: Schimb planetare + Diagnoză
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Schimb planetare', 'Planetară dreapta 2025', 'finalizat', 14400, '2025-09-10 16:00:00', 6, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, robert_id, '2025-09-10 08:00:00', '2025-09-10 12:00:00', 14400, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (robert_id, car_id, job_id, 'finalizat', 'Schimb planetare — 4h', true);

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Diagnoză', 'Diagnoză computerizată 2025', 'finalizat', 3600, '2025-09-10 13:00:00', 7, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, robert_id, '2025-09-10 12:00:00', '2025-09-10 13:00:00', 3600, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (robert_id, car_id, job_id, 'finalizat', 'Diagnoză — 1h', true);

    -- 2026: Lucrarea actuală (in lucru)
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Schimb filtre ulei', 'Schimb filtre ulei + aer — 2026', 'in_lucru', 7200, 8, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2026-08-24 08:00:00', '2026-08-24 10:00:00', 7200, false, 'manual', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (alex_id, car_id, job_id, 'in_lucru', 'Schimb filtre ulei început', true);

    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Verificare suspensie', 'Inspecție amortizoare 2026', 'asteptare', 0, 9, true);
  END IF;

  -- ============================================================
  -- Alex D. — 4 more IN LUCRU cars (B10 DEMO already exists = 5 total)
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'TM88 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo)
    VALUES ('TM88 DEMO', 'Mihai Georgescu', '0721 111 222', 'Volkswagen', 'Golf 8', 2021, 'in_lucru', 'normala', alex_id, current_date + 3, true)
    RETURNING id INTO car_id;
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Schimb ambreiaj', 'Kit ambreiaj', 'in_lucru', 10800, 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2026-08-23 08:00:00', '2026-08-23 11:00:00', 10800, false, 'manual', true);
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Verificare frâne', 'Inspecție plăcuțe', 'asteptare', 0, 2, true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'TM77 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo)
    VALUES ('TM77 DEMO', 'Elena Dumitrescu', '0722 333 444', 'Skoda', 'Superb', 2020, 'in_lucru', 'urgenta', alex_id, current_date + 1, true)
    RETURNING id INTO car_id;
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Schimb planetare', 'Planetară stânga', 'in_lucru', 5400, 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2026-08-24 08:00:00', '2026-08-24 09:30:00', 5400, false, 'manual', true);
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Schimb ulei', 'Ulei motor', 'asteptare', 0, 2, true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'TM66 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo)
    VALUES ('TM66 DEMO', 'Radu Ionescu', '0723 555 666', 'Toyota', 'Corolla', 2019, 'in_lucru', 'normala', alex_id, current_date + 5, true)
    RETURNING id INTO car_id;
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Diagnoză motor', 'Diagnoză computerizată', 'in_lucru', 3600, 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2026-08-24 08:00:00', '2026-08-24 09:00:00', 3600, false, 'manual', true);
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Verificare frâne', 'Inspecție plăcuțe', 'asteptare', 0, 2, true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'TM55 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo)
    VALUES ('TM55 DEMO', 'Cristina Vasile', '0724 777 888', 'Honda', 'Civic', 2022, 'in_lucru', 'normala', alex_id, current_date + 4, true)
    RETURNING id INTO car_id;
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Schimb plăcuțe frână', 'Plăcuțe față', 'in_lucru', 2700, 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2026-08-24 08:00:00', '2026-08-24 08:45:00', 2700, false, 'manual', true);
  END IF;

  -- ============================================================
  -- Alex D. — 2 FINALIZATE cars
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'TM33 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo, completed_at)
    VALUES ('TM33 DEMO', 'George Petrescu', '0725 999 000', 'Ford', 'Focus', 2018, 'finalizata', 'normala', alex_id, '2026-08-10', true, '2026-08-08')
    RETURNING id INTO car_id;
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Revizie generală', 'Ulei, filtre, verificare', 'finalizat', 14400, '2026-08-08 16:00:00', 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2026-08-08 08:00:00', '2026-08-08 12:00:00', 14400, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (alex_id, car_id, job_id, 'finalizat', 'Revizie generală — 4h', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'TM22 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo, completed_at)
    VALUES ('TM22 DEMO', 'Ana Constantin', '0726 111 222', 'BMW', 'Seria 1', 2020, 'finalizata', 'urgenta', alex_id, '2026-07-25', true, '2026-07-22')
    RETURNING id INTO car_id;
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Schimb ambreiaj', 'Kit ambreiaj complet', 'finalizat', 21600, '2026-07-22 17:00:00', 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2026-07-22 08:00:00', '2026-07-22 14:00:00', 21600, false, 'completed', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (alex_id, car_id, job_id, 'finalizat', 'Schimb ambreiaj — 6h', true);
  END IF;

  -- ============================================================
  -- Alex D. — 3 AȘTEPTARE PIESE cars
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'CJ10 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo)
    VALUES ('CJ10 DEMO', 'Vlad Marinescu', '0727 333 444', 'Audi', 'A6', 2019, 'asteptare_piese', 'normala', alex_id, current_date + 2, true)
    RETURNING id INTO car_id;
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Schimb turbo', 'Turbo compressor — piese comandate', 'asteptare_piese', 9000, 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2026-08-20 08:00:00', '2026-08-20 10:30:00', 9000, false, 'parts', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (alex_id, car_id, job_id, 'asteptare_piese', 'Turbo pus în așteptare piese', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'IS05 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo)
    VALUES ('IS05 DEMO', 'Diana Stoica', '0728 555 666', 'Mercedes', 'Clasa C', 2021, 'asteptare_piese', 'urgenta', alex_id, current_date + 1, true)
    RETURNING id INTO car_id;
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Schimb etrier frână', 'Etrier față dreapta — piese comandate', 'asteptare_piese', 5400, 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2026-08-21 08:00:00', '2026-08-21 09:30:00', 5400, false, 'parts', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (alex_id, car_id, job_id, 'asteptare_piese', 'Etrier pus în așteptare piese', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'TM01 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo)
    VALUES ('TM01 DEMO', 'Tudor Angelescu', '0729 777 888', 'Peugeot', '308', 2020, 'asteptare_piese', 'normala', alex_id, current_date + 6, true)
    RETURNING id INTO car_id;
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Schimb pompă apă', 'Pompă apă — piese comandate', 'asteptare_piese', 7200, 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2026-08-19 08:00:00', '2026-08-19 10:00:00', 7200, false, 'parts', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (alex_id, car_id, job_id, 'asteptare_piese', 'Pompă apă pusă în așteptare piese', true);
  END IF;

  -- ============================================================
  -- Alex D. — 1 ÎNTÂRZIAT car (IS22 already exists for Robert = 2 total in system)
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'B91 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo)
    VALUES ('B91 DEMO', 'Sorin Mihalache', '0730 999 000', 'Opel', 'Corsa', 2017, 'in_lucru', 'urgenta', alex_id, current_date - 5, true)
    RETURNING id INTO car_id;
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Reparație motor', 'Reparație motor — scurgeri ulei', 'in_lucru', 10800, 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, alex_id, '2026-08-22 08:00:00', '2026-08-22 11:00:00', 10800, false, 'manual', true);
    INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
    VALUES (alex_id, car_id, job_id, 'in_lucru', 'Reparație motor începută — termen depășit', true);
  END IF;

  -- ============================================================
  -- Additional demo cars for other employees
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'TM44 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo)
    VALUES ('TM44 DEMO', 'Demo Client 6', '0700 000 006', 'Skoda', 'Octavia', 2022, 'noua', 'normala', cristian_id, current_date + 5, true)
    RETURNING id INTO car_id;
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, order_index, is_demo)
    VALUES (car_id, 'Diagnoză motor', 'Diagnoză computerizată motor', 'asteptare', 0, 1, true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cars WHERE license_plate = 'B77 DEMO' AND is_demo = true) THEN
    INSERT INTO cars (license_plate, client_name, client_phone, make, model, year, status, priority, assigned_employee_id, deadline, is_demo, completed_at)
    VALUES ('B77 DEMO', 'Demo Client 7', '0700 000 007', 'Renault', 'Clio', 2021, 'finalizata', 'normala', daniel_id, '2026-07-20', true, '2026-07-15')
    RETURNING id INTO car_id;
    INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
    VALUES (car_id, 'Schimb ulei', 'Ulei motor și filtre', 'finalizat', 5400, '2026-07-15 09:30:00', 1, true)
    RETURNING id INTO job_id;
    INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
    VALUES (job_id, daniel_id, '2026-07-15 08:00:00', '2026-07-15 09:30:00', 5400, false, 'completed', true);
  END IF;

END $$;

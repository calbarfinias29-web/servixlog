/*
# SERVIX - Initial Schema

## Overview
Creates the full foundation for SERVIX, a private auto repair shop management system.
Two roles: ADMINISTRATOR and ANGajAT. Employees use a shared tablet and select their profile by name.

## Tables

### employees
- Auto shop employees (e.g. Sami, Gogu, Ghiță).
- `id` (uuid PK), `name` (text, unique), `role` (enum: 'admin' | 'employee'), `active` (bool), `created_at`.
- Role determines access: admin = full panel, employee = simple tablet panel.

### cars
- Vehicles brought into the shop.
- `id`, `license_plate` (text), `client_name` (text), `client_phone` (text), `client_email` (text),
  `make` (text), `model` (text), `year` (int), `color` (text), `vin` (text),
  `status` (enum: 'noua' | 'in_lucru' | 'asteptare_piese' | 'in_garantie' | 'finalizata'),
  `priority` (enum: 'normala' | 'urgenta'),
  `assigned_employee_id` (FK employees),
  `deadline` (date), `is_warranty` (bool default false), `notes` (text),
  `created_at`, `updated_at`, `completed_at`.

### jobs
- Individual repair jobs on a car. A car can have many jobs.
- `id`, `car_id` (FK cars), `title` (text), `description` (text),
  `status` (enum: 'asteptare' | 'in_lucru' | 'asteptare_piese' | 'finalizat'),
  `worked_seconds` (int, accumulated active work time in seconds, NOT counting pauses),
  `started_at` (timestamptz, when current timer run started, null when paused),
  `completed_at` (timestamptz), `order_index` (int), `created_at`, `updated_at`.

### time_entries
- Atomic work intervals for the history/activity log.
- `id`, `job_id` (FK jobs), `employee_id` (FK employees),
  `start_time` (timestamptz), `end_time` (timestamptz, null = still running),
  `duration_seconds` (int, null while running),
  `is_overtime` (bool, true if work happened outside normal schedule),
  `pause_reason` (text, why it stopped: 'manual' | 'auto_break' | 'parts' | 'completed'),
  `created_at`.

### activity_log
- High-level audit trail of actions across the shop.
- `id`, `employee_id` (FK employees, nullable for system events), `car_id` (FK cars, nullable),
  `job_id` (FK jobs, nullable), `action` (text), `detail` (text), `created_at`.

### work_schedule
- Configurable work hours and auto break. Single active row.
- `id`, `work_start` (time), `work_end` (time), `break_start` (time), `break_end` (time),
  `active` (bool), `created_at`, `updated_at`.

### rates
- Configurable hourly rates. Single active row.
- `id`, `normal_rate` (numeric), `urgent_rate` (numeric), `warranty_rate` (numeric),
  `overtime_rate` (numeric), `active` (bool), `created_at`, `updated_at`.

## Security
- This is a PRIVATE internal app with no public sign-up. Employees select a profile by name on a shared tablet.
- RLS enabled on all tables.
- Policies allow `anon, authenticated` full CRUD because the app is intentionally internal/shared
  (the tablet is a trusted device; there is no per-user Supabase auth session).
- Future versions can tighten this with real auth.
*/

-- Enums
DO $$ BEGIN
  CREATE TYPE employee_role AS ENUM ('admin', 'employee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE car_status AS ENUM ('noua', 'in_lucru', 'asteptare_piese', 'in_garantie', 'finalizata');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE car_priority AS ENUM ('normala', 'urgenta');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('asteptare', 'in_lucru', 'asteptare_piese', 'finalizat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- employees
CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  role employee_role NOT NULL DEFAULT 'employee',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_employees" ON employees;
CREATE POLICY "anon_select_employees" ON employees FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_employees" ON employees;
CREATE POLICY "anon_insert_employees" ON employees FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_employees" ON employees;
CREATE POLICY "anon_update_employees" ON employees FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_employees" ON employees;
CREATE POLICY "anon_delete_employees" ON employees FOR DELETE
  TO anon, authenticated USING (true);

-- cars
CREATE TABLE IF NOT EXISTS cars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_plate text NOT NULL,
  client_name text NOT NULL,
  client_phone text,
  client_email text,
  make text,
  model text,
  year int,
  color text,
  vin text,
  status car_status NOT NULL DEFAULT 'noua',
  priority car_priority NOT NULL DEFAULT 'normala',
  assigned_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  deadline date,
  is_warranty boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE cars ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_cars_status ON cars(status);
CREATE INDEX IF NOT EXISTS idx_cars_employee ON cars(assigned_employee_id);
CREATE INDEX IF NOT EXISTS idx_cars_plate ON cars(license_plate);
CREATE INDEX IF NOT EXISTS idx_cars_client ON cars(client_name);

DROP POLICY IF EXISTS "anon_select_cars" ON cars;
CREATE POLICY "anon_select_cars" ON cars FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_cars" ON cars;
CREATE POLICY "anon_insert_cars" ON cars FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_cars" ON cars;
CREATE POLICY "anon_update_cars" ON cars FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_cars" ON cars;
CREATE POLICY "anon_delete_cars" ON cars FOR DELETE
  TO anon, authenticated USING (true);

-- jobs
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status job_status NOT NULL DEFAULT 'asteptare',
  worked_seconds int NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  order_index int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_jobs_car ON jobs(car_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

DROP POLICY IF EXISTS "anon_select_jobs" ON jobs;
CREATE POLICY "anon_select_jobs" ON jobs FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_jobs" ON jobs;
CREATE POLICY "anon_insert_jobs" ON jobs FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_jobs" ON jobs;
CREATE POLICY "anon_update_jobs" ON jobs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_jobs" ON jobs;
CREATE POLICY "anon_delete_jobs" ON jobs FOR DELETE
  TO anon, authenticated USING (true);

-- time_entries
CREATE TABLE IF NOT EXISTS time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  start_time timestamptz NOT NULL DEFAULT now(),
  end_time timestamptz,
  duration_seconds int,
  is_overtime boolean NOT NULL DEFAULT false,
  pause_reason text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_time_entries_job ON time_entries(job_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_employee ON time_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_start ON time_entries(start_time);

DROP POLICY IF EXISTS "anon_select_time_entries" ON time_entries;
CREATE POLICY "anon_select_time_entries" ON time_entries FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_time_entries" ON time_entries;
CREATE POLICY "anon_insert_time_entries" ON time_entries FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_time_entries" ON time_entries;
CREATE POLICY "anon_update_time_entries" ON time_entries FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_time_entries" ON time_entries;
CREATE POLICY "anon_delete_time_entries" ON time_entries FOR DELETE
  TO anon, authenticated USING (true);

-- activity_log
CREATE TABLE IF NOT EXISTS activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  car_id uuid REFERENCES cars(id) ON DELETE SET NULL,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_activity_log_employee ON activity_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_car ON activity_log(car_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);

DROP POLICY IF EXISTS "anon_select_activity_log" ON activity_log;
CREATE POLICY "anon_select_activity_log" ON activity_log FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_activity_log" ON activity_log;
CREATE POLICY "anon_insert_activity_log" ON activity_log FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_activity_log" ON activity_log;
CREATE POLICY "anon_update_activity_log" ON activity_log FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_activity_log" ON activity_log;
CREATE POLICY "anon_delete_activity_log" ON activity_log FOR DELETE
  TO anon, authenticated USING (true);

-- work_schedule
CREATE TABLE IF NOT EXISTS work_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_start time NOT NULL DEFAULT '07:00',
  work_end time NOT NULL DEFAULT '18:00',
  break_start time NOT NULL DEFAULT '13:00',
  break_end time NOT NULL DEFAULT '14:00',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE work_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_work_schedule" ON work_schedule;
CREATE POLICY "anon_select_work_schedule" ON work_schedule FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_work_schedule" ON work_schedule;
CREATE POLICY "anon_insert_work_schedule" ON work_schedule FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_work_schedule" ON work_schedule;
CREATE POLICY "anon_update_work_schedule" ON work_schedule FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_work_schedule" ON work_schedule;
CREATE POLICY "anon_delete_work_schedule" ON work_schedule FOR DELETE
  TO anon, authenticated USING (true);

-- rates
CREATE TABLE IF NOT EXISTS rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normal_rate numeric(10,2) NOT NULL DEFAULT 100,
  urgent_rate numeric(10,2) NOT NULL DEFAULT 150,
  warranty_rate numeric(10,2) NOT NULL DEFAULT 0,
  overtime_rate numeric(10,2) NOT NULL DEFAULT 150,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_rates" ON rates;
CREATE POLICY "anon_select_rates" ON rates FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_rates" ON rates;
CREATE POLICY "anon_insert_rates" ON rates FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_rates" ON rates;
CREATE POLICY "anon_update_rates" ON rates FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_rates" ON rates;
CREATE POLICY "anon_delete_rates" ON rates FOR DELETE
  TO anon, authenticated USING (true);

-- updated_at triggers
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cars_updated ON cars;
CREATE TRIGGER trg_cars_updated BEFORE UPDATE ON cars
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_jobs_updated ON jobs;
CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_work_schedule_updated ON work_schedule;
CREATE TRIGGER trg_work_schedule_updated BEFORE UPDATE ON work_schedule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_rates_updated ON rates;
CREATE TRIGGER trg_rates_updated BEFORE UPDATE ON rates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed data
INSERT INTO employees (name, role) VALUES
  ('Sami', 'employee'),
  ('Gogu', 'employee'),
  ('Ghiță', 'employee'),
  ('Admin', 'admin')
ON CONFLICT (name) DO NOTHING;

INSERT INTO work_schedule (work_start, work_end, break_start, break_end, active)
SELECT '07:00', '18:00', '13:00', '14:00', true
WHERE NOT EXISTS (SELECT 1 FROM work_schedule WHERE active = true);

INSERT INTO rates (normal_rate, urgent_rate, warranty_rate, overtime_rate, active)
SELECT 100, 150, 0, 150, true
WHERE NOT EXISTS (SELECT 1 FROM rates WHERE active = true);

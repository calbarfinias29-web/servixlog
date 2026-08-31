/*
# SERVIX - Employee profile fields + multi-year demo car history

## Overview
1. Adds `username` and `avatar_url` columns to `employees` for admin create/edit.
2. Updates column privileges for the new columns.
3. Adds realistic multi-year history (2023-2025) to every demo car that lacks it.
   Each demo car gets 2-3 completed jobs per year with time entries and activity log.

## Schema Changes
- `employees.username` (text, nullable)
- `employees.avatar_url` (text, nullable)

## Security
- RLS already enabled; column privileges updated for new columns.

## Data
- Historical jobs marked `is_demo = true`, `status = 'finalizat'`.
- Time entries and activity log rows also `is_demo = true`.
- No real data modified or deleted.
*/

-- ============================================================
-- 1. EMPLOYEE PROFILE COLUMNS
-- ============================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS avatar_url text;

REVOKE INSERT, UPDATE ON employees FROM anon, authenticated;
GRANT INSERT (id, name, role, active, created_at, username, avatar_url) ON employees TO anon, authenticated;
GRANT UPDATE (name, role, active, created_at, username, avatar_url) ON employees TO anon, authenticated;

-- ============================================================
-- 2. MULTI-YEAR DEMO CAR HISTORY
-- ============================================================
DO $$
DECLARE
  car_rec RECORD;
  emp_ids uuid[] := ARRAY[]::uuid[];
  assigned_emp uuid;
  hist_emp uuid;
  job_id uuid;
  base_order int;
  yr int;
  worked int;
  start_ts timestamptz;
  end_ts timestamptz;
  all_titles text[] := ARRAY['Revizie generală','Schimb ulei','Schimb filtre','Verificare frâne','Schimb plăcuțe frână','Diagnoză computerizată','Schimb ambreiaj','Verificare suspensie','Schimb planetare','Reparație motor','Schimb turbo','Verificare etanșare','Schimb etrier frână','Verificare direcție','Schimb baterie'];
  job_title text;
  title_idx int;
  num_jobs int;
  seed text;
  emp_count int;
  title_count int;
BEGIN
  SELECT array_agg(id) INTO emp_ids FROM employees WHERE is_demo = true AND role = 'employee';
  emp_count := COALESCE(array_length(emp_ids, 1), 0);
  title_count := array_length(all_titles, 1);

  FOR car_rec IN SELECT id, license_plate, assigned_employee_id FROM cars WHERE is_demo = true LOOP
    assigned_emp := car_rec.assigned_employee_id;
    IF assigned_emp IS NULL AND emp_count > 0 THEN
      assigned_emp := emp_ids[1];
    END IF;

    seed := car_rec.license_plate;
    SELECT COALESCE(max(order_index), 0) INTO base_order FROM jobs WHERE car_id = car_rec.id;

    FOR yr IN 2023..2025 LOOP
      IF NOT EXISTS (SELECT 1 FROM jobs WHERE car_id = car_rec.id AND completed_at IS NOT NULL AND extract(year FROM completed_at) = yr) THEN
        IF emp_count > 0 THEN
          hist_emp := emp_ids[(abs(hashtext(seed || yr::text)) % emp_count) + 1];
        ELSE
          hist_emp := assigned_emp;
        END IF;

        num_jobs := 2 + (abs(hashtext(seed || yr::text || 'jobs')) % 2);
        FOR title_idx IN 1..num_jobs LOOP
          job_title := all_titles[(abs(hashtext(seed || yr::text || title_idx::text)) % title_count) + 1];
          worked := 3600 + (abs(hashtext(seed || yr::text || title_idx::text)) % 6) * 1800;
          start_ts := make_timestamptz(yr, 2 + (abs(hashtext(seed || yr::text || title_idx::text)) % 10), 5 + (abs(hashtext(seed || yr::text || title_idx::text || 'd')) % 20), 8, 0, 0);
          end_ts := start_ts + (worked || ' seconds')::interval;
          base_order := base_order + 1;

          INSERT INTO jobs (car_id, title, description, status, worked_seconds, completed_at, order_index, is_demo)
          VALUES (car_rec.id, job_title, 'Lucrare efectuată ' || yr::text, 'finalizat', worked, end_ts, base_order, true)
          RETURNING id INTO job_id;

          INSERT INTO time_entries (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, is_demo)
          VALUES (job_id, hist_emp, start_ts, end_ts, worked, false, 'completed', true);

          INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, is_demo)
          VALUES (hist_emp, car_rec.id, job_id, 'finalizat',
            job_title || ' — ' || (worked / 3600) || 'h ' || ((worked % 3600) / 60) || 'm', true);
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
END $$;

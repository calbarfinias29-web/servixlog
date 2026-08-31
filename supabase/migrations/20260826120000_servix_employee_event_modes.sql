-- ============================================================
-- CONFIGURARE MANUAL/AUTOMAT PER ANGAJAT PENTRU EVENIMENTELE ZILEI
--
-- NU modifică logica existentă: safe_start_job, safe_start_overtime,
-- safe_stop_overtime, ferestrele orare, contabilitatea separată
-- (worked_seconds / overtime_seconds) rămân INTACTE.
--
-- Adaugă DOAR:
--   1. employee_event_settings - 4 moduri (auto/manual) per angajat.
--      Lipsește rândul => TOATE automate (comportamentul actual).
--   2. session_event_log - marcaj unic per (angajat, eveniment, zi)
--      pentru protecția la execuție duplicată.
--   3. servix_normal_overlap_seconds - ajutor: suprapunerea unui
--      interval cu ferestrele normale (Europe/Bucharest).
--   4. auto_sync_session(p_employee_id) - RPC idempotent, apelat de
--      client la deschidere și periodic; determină starea din ora
--      reală, deci nu depinde de browser deschis la ora exactă.
-- ============================================================

-- 1. Setările per angajat -----------------------------------------
CREATE TABLE IF NOT EXISTS employee_event_settings (
  employee_id uuid PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  work_start_mode text NOT NULL DEFAULT 'auto' CHECK (work_start_mode IN ('auto', 'manual')),
  break_start_mode text NOT NULL DEFAULT 'auto' CHECK (break_start_mode IN ('auto', 'manual')),
  break_end_mode text NOT NULL DEFAULT 'auto' CHECK (break_end_mode IN ('auto', 'manual')),
  work_end_mode text NOT NULL DEFAULT 'auto' CHECK (work_end_mode IN ('auto', 'manual')),
  is_demo boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employee_event_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_employee_event_settings" ON employee_event_settings;
CREATE POLICY "anon_select_employee_event_settings" ON employee_event_settings
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_write_employee_event_settings" ON employee_event_settings;
CREATE POLICY "anon_write_employee_event_settings" ON employee_event_settings
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 2. Marcaje anti-duplicat ----------------------------------------
CREATE TABLE IF NOT EXISTS session_event_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  job_id uuid,
  event text NOT NULL CHECK (event IN ('work_start', 'break_start', 'break_end', 'work_end')),
  event_date date NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, event, event_date)
);

ALTER TABLE session_event_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_session_event_log" ON session_event_log;
CREATE POLICY "anon_select_session_event_log" ON session_event_log
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_write_session_event_log" ON session_event_log;
CREATE POLICY "anon_write_session_event_log" ON session_event_log
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON employee_event_settings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON session_event_log TO anon, authenticated;

-- 3. Suprapunerea unui interval cu ferestrele normale (secunde) ---
-- Aceeași definiție ca overlapSeconds(..., 'normal') din frontend:
-- work_start→break_start și break_end→work_end, Europe/Bucharest.
CREATE OR REPLACE FUNCTION servix_normal_overlap_seconds(p_start timestamptz, p_end timestamptz)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sched RECORD;
  v_day date;
  v_last date;
  v_ws timestamptz; v_bs timestamptz; v_be timestamptz; v_we timestamptz;
  v_total int := 0;
BEGIN
  IF p_end <= p_start THEN RETURN 0; END IF;
  SELECT * INTO v_sched FROM work_schedule WHERE active = true ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_day := (p_start AT TIME ZONE 'Europe/Bucharest')::date;
  v_last := (p_end AT TIME ZONE 'Europe/Bucharest')::date;
  WHILE v_day <= v_last LOOP
    v_ws := (v_day + v_sched.work_start) AT TIME ZONE 'Europe/Bucharest';
    v_bs := (v_day + v_sched.break_start) AT TIME ZONE 'Europe/Bucharest';
    v_be := (v_day + v_sched.break_end) AT TIME ZONE 'Europe/Bucharest';
    v_we := (v_day + v_sched.work_end) AT TIME ZONE 'Europe/Bucharest';
    v_total := v_total + GREATEST(0, EXTRACT(EPOCH FROM (LEAST(p_end, v_bs) - GREATEST(p_start, v_ws)))::int);
    v_total := v_total + GREATEST(0, EXTRACT(EPOCH FROM (LEAST(p_end, v_we) - GREATEST(p_start, v_be)))::int);
    v_day := v_day + 1;
  END LOOP;
  RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION servix_normal_overlap_seconds(timestamptz, timestamptz) FROM PUBLIC;

-- 4. Sincronizarea idempotentă a sesiunii -------------------------
-- Apelat de client (la deschidere + la fiecare minut). Determină
-- evenimentele scadute DIN ORA REALĂ și le aplică o singură dată:
--   - break_start AUTO: oprește normalul la pauză, salvează worked_seconds;
--   - break_end   AUTO: repornește normalul (backdat la break_end);
--   - work_end    AUTO: oprește normalul la final de program, salvează;
--   - work_start  AUTO: reia dimineața sesiunea oprită automat cu seara.
-- Nu atinge niciodată un job în overtime (is_overtime = true), nu
-- modifică overtime_seconds și nu schimbă regulile butoanelor.
CREATE OR REPLACE FUNCTION auto_sync_session(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sched RECORD;
  v_modes RECORD;
  v_local TIME;
  v_today date;
  v_job RECORD;
  v_resume_id uuid;
  v_changed boolean := false;
BEGIN
  SELECT * INTO v_sched FROM work_schedule WHERE active = true ORDER BY id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'changed', false);
  END IF;

  SELECT * INTO v_modes FROM employee_event_settings WHERE employee_id = p_employee_id;
  -- Fără configurare => toate evenimentele AUTOMATE (comportamentul actual).

  v_local := (now() AT TIME ZONE 'Europe/Bucharest')::time;
  v_today := (now() AT TIME ZONE 'Europe/Bucharest')::date;

  -- ============ 08:00 — ÎNCEPUT PROGRAM ============
  IF COALESCE(v_modes.work_start_mode, 'auto') = 'auto'
     AND v_local >= v_sched.work_start AND v_local < v_sched.break_start THEN
    -- Doar dacă angajatul nu are nicio lucrare activă.
    IF NOT EXISTS (
      SELECT 1 FROM jobs j JOIN cars c ON c.id = j.car_id
      WHERE c.assigned_employee_id = p_employee_id AND j.status = 'in_lucru'
    ) THEN
      -- Ultima sesiune oprită automat la sfârșitul programului.
      SELECT e.job_id INTO v_resume_id
      FROM session_event_log e
      WHERE e.employee_id = p_employee_id AND e.event = 'work_end' AND e.job_id IS NOT NULL
      ORDER BY e.event_date DESC, e.applied_at DESC
      LIMIT 1;
      IF v_resume_id IS NOT NULL THEN
        SELECT * INTO v_job FROM jobs WHERE id = v_resume_id;
        IF FOUND AND v_job.status = 'asteptare' AND v_job.started_at IS NULL
           AND EXISTS (SELECT 1 FROM cars c WHERE c.id = v_job.car_id AND c.assigned_employee_id = p_employee_id) THEN
          UPDATE jobs
          SET status = 'in_lucru',
              started_at = (v_today + v_sched.work_start) AT TIME ZONE 'Europe/Bucharest'
          WHERE id = v_job.id AND started_at IS NULL;
          INSERT INTO session_event_log (employee_id, job_id, event, event_date)
          VALUES (p_employee_id, v_job.id, 'work_start', v_today)
          ON CONFLICT (employee_id, event, event_date) DO NOTHING;
          v_changed := true;
        END IF;
      END IF;
    END IF;
  END IF;

  -- ============ 13:00 — ÎNCEPUT PAUZĂ ============
  IF COALESCE(v_modes.break_start_mode, 'auto') = 'auto'
     AND v_local >= v_sched.break_start AND v_local < v_sched.break_end THEN
    SELECT j.* INTO v_job
    FROM jobs j JOIN cars c ON c.id = j.car_id
    WHERE c.assigned_employee_id = p_employee_id
      AND j.status = 'in_lucru' AND j.started_at IS NOT NULL AND j.is_overtime = false
    ORDER BY j.started_at DESC
    LIMIT 1;
    IF FOUND THEN
      UPDATE jobs
      SET worked_seconds = worked_seconds
            + servix_normal_overlap_seconds(
                v_job.started_at,
                LEAST(now(), (v_today + v_sched.break_start) AT TIME ZONE 'Europe/Bucharest')),
          started_at = NULL
      WHERE id = v_job.id AND started_at IS NOT NULL;
      INSERT INTO session_event_log (employee_id, job_id, event, event_date)
      VALUES (p_employee_id, v_job.id, 'break_start', v_today)
      ON CONFLICT (employee_id, event, event_date) DO NOTHING;
      v_changed := true;
    END IF;
  END IF;

  -- ============ 14:00 — SFÂRȘIT PAUZĂ / RELUARE ============
  IF COALESCE(v_modes.break_end_mode, 'auto') = 'auto'
     AND v_local >= v_sched.break_end AND v_local < v_sched.work_end THEN
    -- Doar jobul oprit automat de evenimentul de pauză (in_lucru, fără cronometru).
    SELECT j.* INTO v_job
    FROM jobs j JOIN cars c ON c.id = j.car_id
    WHERE c.assigned_employee_id = p_employee_id
      AND j.status = 'in_lucru' AND j.started_at IS NULL AND j.is_overtime = false
    ORDER BY j.started_at DESC NULLS LAST
    LIMIT 1;
    IF FOUND THEN
      UPDATE jobs
      SET started_at = (v_today + v_sched.break_end) AT TIME ZONE 'Europe/Bucharest'
      WHERE id = v_job.id AND started_at IS NULL;
      INSERT INTO session_event_log (employee_id, job_id, event, event_date)
      VALUES (p_employee_id, v_job.id, 'break_end', v_today)
      ON CONFLICT (employee_id, event, event_date) DO NOTHING;
      v_changed := true;
    END IF;
  END IF;

  -- ============ 18:00 — SFÂRȘIT PROGRAM ============
  IF COALESCE(v_modes.work_end_mode, 'auto') = 'auto'
     AND v_local >= v_sched.work_end THEN
    SELECT j.* INTO v_job
    FROM jobs j JOIN cars c ON c.id = j.car_id
    WHERE c.assigned_employee_id = p_employee_id
      AND j.status = 'in_lucru' AND j.started_at IS NOT NULL AND j.is_overtime = false
    ORDER BY j.started_at DESC
    LIMIT 1;
    IF FOUND THEN
      UPDATE jobs
      SET worked_seconds = worked_seconds
            + servix_normal_overlap_seconds(
                v_job.started_at,
                (v_today + v_sched.work_end) AT TIME ZONE 'Europe/Bucharest'),
          started_at = NULL,
          status = 'asteptare'
      WHERE id = v_job.id AND started_at IS NOT NULL;
      INSERT INTO session_event_log (employee_id, job_id, event, event_date)
      VALUES (p_employee_id, v_job.id, 'work_end', v_today)
      ON CONFLICT (employee_id, event, event_date) DO NOTHING;
      v_changed := true;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'changed', v_changed);
END;
$$;

REVOKE EXECUTE ON FUNCTION auto_sync_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auto_sync_session(uuid) TO anon, authenticated;
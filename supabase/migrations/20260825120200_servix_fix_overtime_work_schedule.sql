-- ============================================================
-- FIX 42P01: relation "schedules" does not exist
--
-- CAUZA: safe_start_overtime / safe_stop_overtime (20260825120100)
-- și servix_can_start_overtime (20260825120000) referențiau tabelul
-- `schedules`, care NU există în schema proiectului. Schema reală
-- folosește `work_schedule` (creată în 20260824115251, rând activ
-- 07:00–18:00, pauză 13:00–14:00) — același tabel din care citește
-- programul frontend-ul.
--
-- ACEASTĂ MIGRARE recreatează cele 3 funcții cu tabelul corect,
-- păstrând INTACTE toate regulile de business:
--   - proprietatea mașinii prin cars.assigned_employee_id = p_employee_id;
--   - statusul jobului trebuie să fie 'in_lucru';
--   - fereastra legală Europe/Bucharest 13:00–14:00 SAU 18:00–08:00;
--   - overtime pornește DOAR la click (started_at = now());
--   - worked_seconds NU este modificat la start/stop overtime;
--   - overtime_seconds conține EXCLUSIV timpul overtime;
--   - activity_log pentru overtime_start / overtime_stop;
--   - SECURITY DEFINER păstrat;
--   - anon NU primește UPDATE direct pe public.jobs.
-- Idempotentă: CREATE OR REPLACE, sigură la rerulare.
-- ============================================================

CREATE OR REPLACE FUNCTION servix_can_start_overtime()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule RECORD;
  v_local TIME;
BEGIN
  SELECT * INTO v_schedule FROM work_schedule WHERE active = true ORDER BY id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Nu există program de lucru definit.');
  END IF;

  v_local := (now() AT TIME ZONE 'Europe/Bucharest')::time;

  IF (v_local >= v_schedule.break_start::time AND v_local < v_schedule.break_end::time)
     OR v_local >= v_schedule.work_end::time
     OR v_local < v_schedule.work_start::time THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  RETURN jsonb_build_object('ok', false, 'reason', 'Orele peste program pot fi pornite doar în pauza de prânz sau după terminarea programului.');
END;
$$;

REVOKE EXECUTE ON FUNCTION servix_can_start_overtime() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION servix_can_start_overtime() TO anon, authenticated;

CREATE OR REPLACE FUNCTION safe_start_overtime(p_job_id uuid, p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job jobs%ROWTYPE;
  v_local TIME;
  v_schedule RECORD;
BEGIN
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Lucrarea nu există.');
  END IF;

  -- Proprietate: angajatul poate porni overtime DOAR pentru mașina alocată lui.
  IF NOT EXISTS (
    SELECT 1 FROM cars c
    WHERE c.id = v_job.car_id AND c.assigned_employee_id = p_employee_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Lucrarea nu îți este alocată.');
  END IF;

  IF v_job.status != 'in_lucru' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Lucrarea nu este pornită.');
  END IF;

  -- Garda ferestrei (Europe/Bucharest): doar 13:00–14:00 sau 18:00–08:00.
  SELECT * INTO v_schedule FROM work_schedule WHERE active = true ORDER BY id LIMIT 1;
  IF FOUND THEN
    v_local := (now() AT TIME ZONE 'Europe/Bucharest')::time;
    IF NOT (
      (v_local >= v_schedule.break_start::time AND v_local < v_schedule.break_end::time)
      OR v_local >= v_schedule.work_end::time
      OR v_local < v_schedule.work_start::time
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'Orele peste program pot fi pornite doar în pauza de prânz sau după terminarea programului.');
    END IF;
  END IF;

  IF v_job.is_overtime AND v_job.started_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'no_op', true);
  END IF;

  -- Contabilitate separată: NU se atinge worked_seconds aici.
  UPDATE jobs
  SET started_at = now(),
      is_overtime = true
  WHERE id = p_job_id;

  INSERT INTO activity_log (employee_id, car_id, job_id, action, detail)
  VALUES (p_employee_id, v_job.car_id, p_job_id, 'overtime_start', 'Ore peste program pornite');

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION safe_start_overtime(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safe_start_overtime(uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION safe_stop_overtime(p_job_id uuid, p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job jobs%ROWTYPE;
  v_elapsed int;
BEGIN
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Lucrarea nu există.');
  END IF;

  -- Proprietate: angajatul poate opri overtime DOAR pentru mașina alocată lui.
  IF NOT EXISTS (
    SELECT 1 FROM cars c
    WHERE c.id = v_job.car_id AND c.assigned_employee_id = p_employee_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Lucrarea nu îți este alocată.');
  END IF;

  IF v_job.status != 'in_lucru' OR v_job.started_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'no_op', true);
  END IF;

  v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_job.started_at))::int);

  UPDATE jobs
  SET overtime_seconds = overtime_seconds + v_elapsed,  -- DOAR overtime, fără worked_seconds
      started_at = NULL,
      status = 'asteptare',
      is_overtime = false
  WHERE id = p_job_id;

  INSERT INTO activity_log (employee_id, car_id, job_id, action, detail)
  VALUES (p_employee_id, v_job.car_id, p_job_id, 'overtime_stop', 'Ore peste program oprite');

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION safe_stop_overtime(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safe_stop_overtime(uuid, uuid) TO anon, authenticated;
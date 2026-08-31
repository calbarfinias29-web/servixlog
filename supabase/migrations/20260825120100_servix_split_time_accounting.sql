-- ============================================================
-- CONTABILITATE SEPARATĂ ORE NORMALE / ORE PESTE PROGRAM
--
-- NU A FOST APLICATĂ ÎNCĂ (fără acces la Supabase).
-- De aplicat ÎMPREUNĂ cu 20260825120000_servix_overtime_window_guard.sql.
--
-- Reguli implementate:
--   worked_seconds   = EXCLUSIV timp lucrat în ferestrele normale
--                      (work_start→break_start și break_end→work_end)
--   overtime_seconds = EXCLUSIV timp peste program, pornit EXPLICIT,
--                      calculat din momentul pornirii (started_at),
--                      niciodată din work_end.
--
-- Înlocuiește versiunile vechi ale RPC-urilor care adăugau overtime-ul
-- ȘI în worked_seconds (contabilitate amestecată — incorectă).
-- ============================================================

-- Pornește overtime: apelat DOAR la click pe „CONTINUĂ PESTE PROGRAM”.
-- Timpul rulat normal până acum este înghețat în worked_seconds (fără fereastră aici:
-- reconcilierea pe ferestre se face de client înainte de apel); segmentul nou
-- pornește de la started_at = now() și va fi numărat integral ca overtime
-- doar dacă se află într-o fereastră legală (verificat de garda de mai jos).
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
  -- FIX 42P01: tabelul real este work_schedule (nu `schedules`, care nu există).
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
  -- Segmentul anterior (normal) trebuie reconciliat de client înainte de apel.
  UPDATE jobs
  SET started_at = now(),
      is_overtime = true
  WHERE id = p_job_id;

  INSERT INTO activity_log (employee_id, car_id, job_id, action, detail)
  VALUES (p_employee_id, v_job.car_id, p_job_id, 'overtime_start', 'Ore peste program pornite');

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Oprește overtime: adaugă elapsed EXCLUSIV în overtime_seconds.
-- worked_seconds rămâne neatins (regula: normalul e înghețat după 18:00 / în pauză).
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

-- Politica RLS necesară pentru scrierea directă (update) folosită de Panoul Angajat
-- cu contabilitate separată. Angajatul poate actualiza doar joburile mașinilor alocate lui.
-- ACTIVĂ doar dacă tabelul folosește RLS; decomentează după verificarea schemei de autentificare:
--
-- CREATE POLICY jobs_employee_update ON jobs
-- FOR UPDATE TO anon, authenticated
-- USING (
--   EXISTS (
--     SELECT 1 FROM cars c
--     WHERE c.id = jobs.car_id
--       AND c.assigned_employee_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'employee_id')
--   )
-- );
--
-- ALTERNATIVA RECOMANDATĂ (fără niciun GRANT/UPDATE direct pe jobs):
-- funcțiile security-definer de mai sus (safe_start_overtime / safe_stop_overtime)
-- verifică ele înseși proprietatea (assigned_employee_id) și fereastra orară,
-- deci frontend-ul poate apela exclusiv aceste RPC-uri — rolul anon rămâne fără
-- UPDATE direct pe public.jobs. După aplicarea migrației, comută handleOvertime
-- din src/PanouAngajat.tsx pe aceste RPC-uri ca unică cale de scriere.
-- ============================================================
-- FIX PERSISTENȚĂ TIMP (audit pontaj)
--
-- BUG 1: safe_start_overtime reseta started_at = now() FĂRĂ să
--   înghețe segmentul normal rulat până la acel moment în
--   worked_seconds. Comentariul din 20260825120100 spunea explicit
--   „Segmentul anterior (normal) trebuie reconciliat de client
--   înainte de apel", dar clientul NU reconcilia → timpul normal
--   acumulat de la pornire se PIERDEA la „CONTINUĂ PESTE PROGRAM".
--   FIX: reconcilierea se face ACUM server-side, cu ajutorul
--   servix_normal_overlap_seconds (Europe/Bucharest), înainte de
--   repornirea ceasului. Dacă sesiunea anterioară era overtime,
--   elapsed-ul intră în overtime_seconds (ca la safe_stop_overtime).
--
-- BUG 2: safe_update_job_status nu reseta is_overtime la oprirea
--   unei sesiuni overtime (pauză/așteptare/finalizare), lăsând
--   flag-ul stăgarn în DB. FIX: is_overtime = false la orice oprire.
--
-- NU se schimbă: ferestrele orare, RLS, contabilitatea separată,
-- regula de 1 minut (safe_start_job), admin_transfer_car.
-- Idempotentă: CREATE OR REPLACE.
-- ============================================================

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
  v_elapsed int;
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

  -- Garda ferestrei (Europe/Bucharest): doar pauza de prânz sau după program.
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

  -- FIX BUG 1: îngheață segmentul anterior ÎNAINTE de repornirea ceasului.
  IF v_job.started_at IS NOT NULL THEN
    v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_job.started_at))::int);
    IF v_job.is_overtime THEN
      -- Sesiune overtime anterioară: elapsed-ul intră în overtime_seconds.
      UPDATE jobs SET overtime_seconds = overtime_seconds + v_elapsed WHERE id = p_job_id;
    ELSE
      -- Sesiune normală: DOAR suprapunerea cu ferestrele normale intră în
      -- worked_seconds (pauza fără continuare NU se contorizează).
      UPDATE jobs
      SET worked_seconds = worked_seconds
            + servix_normal_overlap_seconds(v_job.started_at, now())
      WHERE id = p_job_id;
    END IF;
  END IF;

  -- Contabilitate separată: segmentul nou va fi numărat EXCLUSIV ca overtime.
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

-- FIX BUG 2: is_overtime = false la orice oprire de sesiune.
CREATE OR REPLACE FUNCTION safe_update_job_status(
  p_job_id uuid,
  p_employee_id uuid,
  p_status text,
  p_worked_seconds int DEFAULT NULL,
  p_overtime_seconds int DEFAULT NULL,
  p_completed_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job jobs%ROWTYPE;
BEGIN
  SELECT j.* INTO v_job
  FROM jobs j
  JOIN cars c ON c.id = j.car_id
  WHERE j.id = p_job_id
    AND c.assigned_employee_id = p_employee_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Lucrarea nu îți este alocată.');
  END IF;

  IF p_status NOT IN ('asteptare', 'asteptare_piese', 'finalizat') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Statusul lucrării nu este valid.');
  END IF;

  UPDATE jobs
  SET status = p_status,
      worked_seconds = COALESCE(p_worked_seconds, worked_seconds),
      overtime_seconds = COALESCE(p_overtime_seconds, overtime_seconds),
      started_at = NULL,
      is_overtime = false,
      completed_at = CASE
        WHEN p_status = 'finalizat' THEN COALESCE(p_completed_at, completed_at, now())
        ELSE completed_at
      END
  WHERE id = p_job_id;

  INSERT INTO activity_log (employee_id, car_id, job_id, action, detail)
  VALUES (p_employee_id, v_job.car_id, p_job_id, p_status, 'Angajatul a actualizat lucrarea');

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION safe_update_job_status(uuid, uuid, text, int, int, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safe_update_job_status(uuid, uuid, text, int, int, timestamptz) TO anon, authenticated;

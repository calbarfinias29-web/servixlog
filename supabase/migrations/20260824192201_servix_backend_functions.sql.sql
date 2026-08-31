-- ============================================================
-- safe_change_plate: change license plate with history preservation
-- ============================================================
CREATE OR REPLACE FUNCTION safe_change_plate(p_car_id uuid, p_new_plate text, p_employee_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_plate text;
  v_is_demo boolean;
BEGIN
  SELECT license_plate, is_demo INTO v_old_plate, v_is_demo FROM cars WHERE id = p_car_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mașina nu există';
  END IF;

  IF v_old_plate = p_new_plate THEN
    RETURN jsonb_build_object('ok', true, 'no_change', true);
  END IF;

  -- Record old plate in history
  INSERT INTO plate_history (car_id, license_plate, changed_by, is_demo)
  VALUES (p_car_id, v_old_plate, p_employee_id, v_is_demo);

  -- Update to new plate
  UPDATE cars SET license_plate = p_new_plate WHERE id = p_car_id;

  RETURN jsonb_build_object('ok', true, 'old_plate', v_old_plate);
END;
$$;

REVOKE EXECUTE ON FUNCTION safe_change_plate(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safe_change_plate(uuid, text, uuid) TO anon, authenticated;

-- ============================================================
-- safe_start_overtime: start overtime session on a job
-- Validates: employee must not have another active in_lucru job
-- Marks the job as is_overtime = true
-- ============================================================
CREATE OR REPLACE FUNCTION safe_start_overtime(p_job_id uuid, p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job record;
  v_other_active boolean;
BEGIN
  SELECT j.* INTO v_job FROM jobs j WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lucrarea nu există';
  END IF;

  -- Check if employee already has another active in_lucru job
  SELECT EXISTS(
    SELECT 1 FROM jobs j2
    JOIN cars c2 ON c2.id = j2.car_id
    WHERE c2.assigned_employee_id = p_employee_id
      AND j2.status = 'in_lucru'
      AND j2.id != p_job_id
  ) INTO v_other_active;

  IF v_other_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Ai deja o lucrare activă. Finalizează lucrarea sau pune-o în așteptare înainte de a începe o altă mașină.');
  END IF;

  -- If job already running, just mark overtime flag
  IF v_job.status = 'in_lucru' AND v_job.started_at IS NOT NULL THEN
    UPDATE jobs SET is_overtime = true WHERE id = p_job_id;
    RETURN jsonb_build_object('ok', true, 'no_op', true);
  END IF;

  -- Accumulate previous worked time if had a started_at
  IF v_job.started_at IS NOT NULL THEN
    UPDATE jobs
    SET worked_seconds = worked_seconds + GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int),
        started_at = now(),
        status = 'in_lucru',
        is_overtime = true
    WHERE id = p_job_id;
  ELSE
    UPDATE jobs
    SET started_at = now(),
        status = 'in_lucru',
        is_overtime = true
    WHERE id = p_job_id;
  END IF;

  INSERT INTO activity_log (employee_id, car_id, job_id, action, detail)
  VALUES (p_employee_id, v_job.car_id, p_job_id, 'in_lucru', 'Pornire cronometru peste program');

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION safe_start_overtime(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safe_start_overtime(uuid, uuid) TO anon, authenticated;

-- ============================================================
-- safe_stop_overtime: stop overtime, accumulate overtime_seconds
-- ============================================================
CREATE OR REPLACE FUNCTION safe_stop_overtime(p_job_id uuid, p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job record;
  v_elapsed integer;
BEGIN
  SELECT j.* INTO v_job FROM jobs j WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lucrarea nu există';
  END IF;

  IF v_job.status != 'in_lucru' OR v_job.started_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'no_op', true);
  END IF;

  v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_job.started_at))::int);

  UPDATE jobs
  SET overtime_seconds = overtime_seconds + v_elapsed,
      worked_seconds = worked_seconds + v_elapsed,
      started_at = NULL,
      status = 'asteptare',
      is_overtime = false
  WHERE id = p_job_id;

  INSERT INTO activity_log (employee_id, car_id, job_id, action, detail)
  VALUES (p_employee_id, v_job.car_id, p_job_id, 'asteptare', 'Oprire cronometru peste program');

  RETURN jsonb_build_object('ok', true, 'overtime_added', v_elapsed);
END;
$$;

REVOKE EXECUTE ON FUNCTION safe_stop_overtime(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safe_stop_overtime(uuid, uuid) TO anon, authenticated;

-- ============================================================
-- set_employee_access_code: set/update employee access code
-- ============================================================
CREATE OR REPLACE FUNCTION set_employee_access_code(p_employee_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF LENGTH(TRIM(p_code)) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Codul trebuie să aibă cel puțin 4 caractere.');
  END IF;

  UPDATE employees SET access_code = TRIM(p_code) WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Angajatul nu există';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION set_employee_access_code(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_employee_access_code(uuid, text) TO anon, authenticated;

-- ============================================================
-- verify_employee_access_code: verify employee access code at login
-- ============================================================
CREATE OR REPLACE FUNCTION verify_employee_access_code(p_employee_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stored_code text;
BEGIN
  SELECT access_code INTO v_stored_code FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Angajat inexistent.');
  END IF;

  IF v_stored_code IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'no_code', true);
  END IF;

  IF v_stored_code = TRIM(p_code) THEN
    RETURN jsonb_build_object('ok', true);
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'Cod incorect.');
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION verify_employee_access_code(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_employee_access_code(uuid, text) TO anon, authenticated;
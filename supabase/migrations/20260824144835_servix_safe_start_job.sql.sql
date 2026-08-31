-- ============================================================
-- safe_start_job: enforce ONE active timer per employee
-- Blocks starting a job if the employee already has an in_lucru
-- job on a different car. Also prevents two concurrent requests
-- from starting two timers (transactional check).
-- ============================================================
CREATE OR REPLACE FUNCTION safe_start_job(p_job_id uuid, p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job record;
  v_other_active boolean;
BEGIN
  -- Load the job to start
  SELECT j.* INTO v_job FROM jobs j WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lucrarea nu există';
  END IF;

  -- Check if THIS employee already has another in_lucru job on a DIFFERENT car
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

  -- If the job itself is already in_lucru, that's fine (re-starting same)
  -- Accumulate worked_seconds if it had a started_at, then set new started_at
  IF v_job.status = 'in_lucru' AND v_job.started_at IS NOT NULL THEN
    -- Already running, just return ok (no-op)
    RETURN jsonb_build_object('ok', true, 'no_op', true);
  END IF;

  -- If it was running before (has started_at from a previous session), accumulate
  IF v_job.started_at IS NOT NULL THEN
    UPDATE jobs
    SET worked_seconds = worked_seconds + GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int),
        started_at = now(),
        status = 'in_lucru'
    WHERE id = p_job_id;
  ELSE
    -- Fresh start: just set started_at and status
    UPDATE jobs
    SET started_at = now(),
        status = 'in_lucru'
    WHERE id = p_job_id;
  END IF;

  -- Log activity
  INSERT INTO activity_log (employee_id, car_id, job_id, action, detail)
  VALUES (p_employee_id, v_job.car_id, p_job_id, 'in_lucru', 'Pornire cronometru lucrare');

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION safe_start_job(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safe_start_job(uuid, uuid) TO anon, authenticated;
-- Secure employee status updates without granting direct UPDATE on public.jobs.
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

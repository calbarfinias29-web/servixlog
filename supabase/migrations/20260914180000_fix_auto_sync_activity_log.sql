-- Fix: persist automatic schedule transitions in activity_log.
-- This replaces only auto_sync_session; no schema changes are required.
CREATE OR REPLACE FUNCTION auto_sync_session(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sched RECORD;
  v_modes RECORD;
  v_local time;
  v_today date;
  v_active boolean;
  v_start time;
  v_end time;
  v_job RECORD;
  v_resume_id uuid;
  v_changed boolean := false;
BEGIN
  -- Serialize all automatic transitions for one employee. This closes the
  -- race between checking session_event_log and inserting the audit event.
  PERFORM pg_advisory_xact_lock(hashtextextended('auto_sync_session:' || p_employee_id::text, 0));

  SELECT * INTO v_sched FROM work_schedule WHERE active = true ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'changed', false); END IF;
  v_today := (now() AT TIME ZONE 'Europe/Bucharest')::date;
  SELECT day_active, day_start, day_end INTO v_active, v_start, v_end FROM servix_schedule_day_values(v_today);
  IF NOT COALESCE(v_active, false) THEN RETURN jsonb_build_object('ok', true, 'changed', false); END IF;
  v_sched.work_start := v_start;
  v_sched.work_end := v_end;
  SELECT * INTO v_modes FROM employee_event_settings WHERE employee_id = p_employee_id;
  v_local := (now() AT TIME ZONE 'Europe/Bucharest')::time;

  -- Automatic resume at the real scheduled work-start boundary.
  IF COALESCE(v_modes.work_start_mode, 'auto') = 'auto' AND v_local >= v_sched.work_start AND v_local < v_sched.break_start THEN
    IF NOT EXISTS (SELECT 1 FROM jobs j JOIN cars c ON c.id = j.car_id WHERE c.assigned_employee_id = p_employee_id AND j.status = 'in_lucru') THEN
      SELECT e.job_id INTO v_resume_id
      FROM session_event_log e
      WHERE e.employee_id = p_employee_id AND e.event = 'work_end' AND e.job_id IS NOT NULL AND e.event_date < v_today
      ORDER BY e.event_date DESC, e.applied_at DESC
      LIMIT 1;
      IF v_resume_id IS NOT NULL THEN
        SELECT * INTO v_job FROM jobs WHERE id = v_resume_id FOR UPDATE;
        IF FOUND AND v_job.status = 'asteptare' AND v_job.started_at IS NULL
           AND EXISTS (SELECT 1 FROM cars c WHERE c.id = v_job.car_id AND c.assigned_employee_id = p_employee_id) THEN
          UPDATE jobs
          SET status = 'in_lucru', started_at = (v_today + v_sched.work_start) AT TIME ZONE 'Europe/Bucharest'
          WHERE id = v_job.id AND started_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM session_event_log WHERE employee_id = p_employee_id AND job_id = v_job.id AND event = 'work_start' AND event_date = v_today);
          IF FOUND THEN
            INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, created_at)
            VALUES (p_employee_id, v_job.car_id, v_job.id, 'in_lucru', 'Reluare automată la începutul programului', (v_today + v_sched.work_start) AT TIME ZONE 'Europe/Bucharest');
            INSERT INTO session_event_log (employee_id, job_id, event, event_date)
            VALUES (p_employee_id, v_job.id, 'work_start', v_today)
            ON CONFLICT (employee_id, event, event_date) DO NOTHING;
            v_changed := true;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Automatic scheduled break stop.
  IF COALESCE(v_modes.break_start_mode, 'auto') = 'auto' AND v_local >= v_sched.break_start AND v_local < v_sched.break_end THEN
    SELECT j.* INTO v_job
    FROM jobs j JOIN cars c ON c.id = j.car_id
    WHERE c.assigned_employee_id = p_employee_id
      AND j.status = 'in_lucru' AND j.started_at IS NOT NULL AND j.is_overtime = false
      AND NOT EXISTS (SELECT 1 FROM session_event_log WHERE employee_id = p_employee_id AND job_id = j.id AND event = 'break_start' AND event_date = v_today)
    ORDER BY j.started_at DESC
    LIMIT 1 FOR UPDATE OF j;
    IF FOUND THEN
      UPDATE jobs
      SET worked_seconds = worked_seconds + servix_normal_overlap_seconds(v_job.started_at, (v_today + v_sched.break_start) AT TIME ZONE 'Europe/Bucharest'),
          started_at = NULL
      WHERE id = v_job.id AND started_at IS NOT NULL;
      IF FOUND THEN
        INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, created_at)
        VALUES (p_employee_id, v_job.car_id, v_job.id, 'schedule_pause', 'Oprire automată - pauză programată', (v_today + v_sched.break_start) AT TIME ZONE 'Europe/Bucharest');
        INSERT INTO session_event_log (employee_id, job_id, event, event_date)
        VALUES (p_employee_id, v_job.id, 'break_start', v_today)
        ON CONFLICT (employee_id, event, event_date) DO NOTHING;
        v_changed := true;
      END IF;
    END IF;
  END IF;

  -- Automatic resume at the real scheduled break-end boundary.
  IF COALESCE(v_modes.break_end_mode, 'auto') = 'auto' AND v_local >= v_sched.break_end AND v_local < v_sched.work_end THEN
    SELECT j.* INTO v_job
    FROM jobs j JOIN cars c ON c.id = j.car_id
    WHERE c.assigned_employee_id = p_employee_id
      AND j.status = 'in_lucru' AND j.started_at IS NULL AND j.is_overtime = false
      AND NOT EXISTS (SELECT 1 FROM session_event_log WHERE employee_id = p_employee_id AND job_id = j.id AND event = 'break_end' AND event_date = v_today)
    ORDER BY j.started_at DESC NULLS LAST
    LIMIT 1 FOR UPDATE OF j;
    IF FOUND THEN
      UPDATE jobs
      SET started_at = (v_today + v_sched.break_end) AT TIME ZONE 'Europe/Bucharest'
      WHERE id = v_job.id AND started_at IS NULL;
      IF FOUND THEN
        INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, created_at)
        VALUES (p_employee_id, v_job.car_id, v_job.id, 'in_lucru', 'Reluare automată după pauza programată', (v_today + v_sched.break_end) AT TIME ZONE 'Europe/Bucharest');
        INSERT INTO session_event_log (employee_id, job_id, event, event_date)
        VALUES (p_employee_id, v_job.id, 'break_end', v_today)
        ON CONFLICT (employee_id, event, event_date) DO NOTHING;
        v_changed := true;
      END IF;
    END IF;
  END IF;

  -- Automatic scheduled workday-end stop. The audit timestamp is the
  -- configured boundary, never the polling time (now()).
  IF COALESCE(v_modes.work_end_mode, 'auto') = 'auto' AND v_local >= v_sched.work_end THEN
    SELECT j.* INTO v_job
    FROM jobs j JOIN cars c ON c.id = j.car_id
    WHERE c.assigned_employee_id = p_employee_id
      AND j.status = 'in_lucru' AND j.started_at IS NOT NULL AND j.is_overtime = false
      AND NOT EXISTS (SELECT 1 FROM session_event_log WHERE employee_id = p_employee_id AND job_id = j.id AND event = 'work_end' AND event_date = v_today)
    ORDER BY j.started_at DESC
    LIMIT 1 FOR UPDATE OF j;
    IF FOUND THEN
      UPDATE jobs
      SET worked_seconds = worked_seconds + servix_normal_overlap_seconds(v_job.started_at, (v_today + v_sched.work_end) AT TIME ZONE 'Europe/Bucharest'),
          started_at = NULL,
          status = 'asteptare'
      WHERE id = v_job.id AND started_at IS NOT NULL;
      IF FOUND THEN
        INSERT INTO activity_log (employee_id, car_id, job_id, action, detail, created_at)
        VALUES (p_employee_id, v_job.car_id, v_job.id, 'schedule_end', 'Oprire automată - sfârșit program', (v_today + v_sched.work_end) AT TIME ZONE 'Europe/Bucharest');
        INSERT INTO session_event_log (employee_id, job_id, event, event_date)
        VALUES (p_employee_id, v_job.id, 'work_end', v_today)
        ON CONFLICT (employee_id, event, event_date) DO NOTHING;
        v_changed := true;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'changed', v_changed);
END;
$$;

REVOKE EXECUTE ON FUNCTION auto_sync_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auto_sync_session(uuid) TO anon, authenticated;

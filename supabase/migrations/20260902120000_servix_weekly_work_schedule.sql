ALTER TABLE work_schedule
  ADD COLUMN IF NOT EXISTS monday_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS monday_start time NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS monday_end time NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS tuesday_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tuesday_start time NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS tuesday_end time NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS wednesday_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS wednesday_start time NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS wednesday_end time NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS thursday_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS thursday_start time NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS thursday_end time NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS friday_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS friday_start time NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS friday_end time NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS saturday_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS saturday_start time NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS saturday_end time NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS sunday_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sunday_start time NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS sunday_end time NOT NULL DEFAULT '18:00';

UPDATE work_schedule
SET monday_active = active, monday_start = work_start, monday_end = work_end,
    tuesday_active = active, tuesday_start = work_start, tuesday_end = work_end,
    wednesday_active = active, wednesday_start = work_start, wednesday_end = work_end,
    thursday_active = active, thursday_start = work_start, thursday_end = work_end,
    friday_active = active, friday_start = work_start, friday_end = work_end,
    saturday_active = false, saturday_start = work_start, saturday_end = work_end,
    sunday_active = false, sunday_start = work_start, sunday_end = work_end;

CREATE OR REPLACE FUNCTION servix_schedule_day_values(p_day date)
RETURNS TABLE(day_active boolean, day_start time, day_end time)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE EXTRACT(ISODOW FROM p_day)::int
           WHEN 1 THEN monday_active WHEN 2 THEN tuesday_active
           WHEN 3 THEN wednesday_active WHEN 4 THEN thursday_active
           WHEN 5 THEN friday_active WHEN 6 THEN saturday_active
           ELSE sunday_active END,
         CASE EXTRACT(ISODOW FROM p_day)::int
           WHEN 1 THEN monday_start WHEN 2 THEN tuesday_start
           WHEN 3 THEN wednesday_start WHEN 4 THEN thursday_start
           WHEN 5 THEN friday_start WHEN 6 THEN saturday_start
           ELSE sunday_start END,
         CASE EXTRACT(ISODOW FROM p_day)::int
           WHEN 1 THEN monday_end WHEN 2 THEN tuesday_end
           WHEN 3 THEN wednesday_end WHEN 4 THEN thursday_end
           WHEN 5 THEN friday_end WHEN 6 THEN saturday_end
           ELSE sunday_end END
  FROM work_schedule
  WHERE active = true
  ORDER BY id
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION servix_schedule_day_values(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION servix_schedule_day_values(date) TO anon, authenticated;

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
  v_active boolean;
  v_start time;
  v_end time;
  v_ws timestamptz;
  v_bs timestamptz;
  v_be timestamptz;
  v_we timestamptz;
  v_total int := 0;
BEGIN
  IF p_end <= p_start THEN RETURN 0; END IF;
  SELECT * INTO v_sched FROM work_schedule WHERE active = true ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_day := (p_start AT TIME ZONE 'Europe/Bucharest')::date;
  v_last := (p_end AT TIME ZONE 'Europe/Bucharest')::date;
  WHILE v_day <= v_last LOOP
    SELECT day_active, day_start, day_end INTO v_active, v_start, v_end FROM servix_schedule_day_values(v_day);
    IF COALESCE(v_active, false) THEN
      v_ws := (v_day + v_start) AT TIME ZONE 'Europe/Bucharest';
      v_bs := (v_day + v_sched.break_start) AT TIME ZONE 'Europe/Bucharest';
      v_be := (v_day + v_sched.break_end) AT TIME ZONE 'Europe/Bucharest';
      v_we := (v_day + v_end) AT TIME ZONE 'Europe/Bucharest';
      v_total := v_total + GREATEST(0, EXTRACT(EPOCH FROM (LEAST(p_end, v_bs) - GREATEST(p_start, v_ws)))::int);
      v_total := v_total + GREATEST(0, EXTRACT(EPOCH FROM (LEAST(p_end, v_we) - GREATEST(p_start, v_be)))::int);
    END IF;
    v_day := v_day + 1;
  END LOOP;
  RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION servix_normal_overlap_seconds(timestamptz, timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION safe_start_overtime(p_job_id uuid, p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job jobs%ROWTYPE;
  v_local time;
  v_today date;
  v_schedule RECORD;
  v_active boolean;
  v_start time;
  v_end time;
  v_elapsed int;
BEGIN
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'Lucrarea nu există.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM cars c WHERE c.id = v_job.car_id AND c.assigned_employee_id = p_employee_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Lucrarea nu îți este alocată.');
  END IF;
  IF v_job.status != 'in_lucru' THEN RETURN jsonb_build_object('ok', false, 'reason', 'Lucrarea nu este pornită.'); END IF;

  SELECT * INTO v_schedule FROM work_schedule WHERE active = true ORDER BY id LIMIT 1;
  IF FOUND THEN
    v_today := (now() AT TIME ZONE 'Europe/Bucharest')::date;
    SELECT day_active, day_start, day_end INTO v_active, v_start, v_end FROM servix_schedule_day_values(v_today);
    v_local := (now() AT TIME ZONE 'Europe/Bucharest')::time;
    IF COALESCE(v_active, false) AND NOT ((v_local >= v_schedule.break_start AND v_local < v_schedule.break_end) OR v_local >= v_end OR v_local < v_start) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'Orele peste program pot fi pornite doar în pauză sau după program.');
    END IF;
  END IF;

  IF v_job.is_overtime AND v_job.started_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'no_op', true); END IF;
  IF v_job.started_at IS NOT NULL THEN
    v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_job.started_at))::int);
    IF v_job.is_overtime THEN
      UPDATE jobs SET overtime_seconds = overtime_seconds + v_elapsed WHERE id = p_job_id;
    ELSE
      UPDATE jobs SET worked_seconds = worked_seconds + servix_normal_overlap_seconds(v_job.started_at, now()) WHERE id = p_job_id;
    END IF;
  END IF;
  UPDATE jobs SET started_at = now(), is_overtime = true WHERE id = p_job_id;
  INSERT INTO activity_log (employee_id, car_id, job_id, action, detail)
  VALUES (p_employee_id, v_job.car_id, p_job_id, 'overtime_start', 'Ore peste program pornite');
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION safe_start_overtime(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safe_start_overtime(uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION servix_overtime_overlap_seconds(p_start timestamptz, p_end timestamptz)
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
  v_active boolean;
  v_start time;
  v_end time;
  v_local_start timestamptz;
  v_local_end timestamptz;
  v_break_start timestamptz;
  v_break_end timestamptz;
  v_total int := 0;
BEGIN
  IF p_end <= p_start THEN RETURN 0; END IF;
  SELECT * INTO v_sched FROM work_schedule WHERE active = true ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_day := (p_start AT TIME ZONE 'Europe/Bucharest')::date;
  v_last := (p_end AT TIME ZONE 'Europe/Bucharest')::date;
  WHILE v_day <= v_last LOOP
    SELECT day_active, day_start, day_end INTO v_active, v_start, v_end FROM servix_schedule_day_values(v_day);
    v_local_start := (v_day + time '00:00') AT TIME ZONE 'Europe/Bucharest';
    v_local_end := (v_day + time '24:00') AT TIME ZONE 'Europe/Bucharest';
    IF NOT COALESCE(v_active, false) THEN
      v_total := v_total + GREATEST(0, EXTRACT(EPOCH FROM (LEAST(p_end, v_local_end) - GREATEST(p_start, v_local_start)))::int);
    ELSE
      v_break_start := (v_day + v_sched.break_start) AT TIME ZONE 'Europe/Bucharest';
      v_break_end := (v_day + v_sched.break_end) AT TIME ZONE 'Europe/Bucharest';
      v_local_start := (v_day + v_end) AT TIME ZONE 'Europe/Bucharest';
      v_local_end := ((v_day + 1) + time '00:00') AT TIME ZONE 'Europe/Bucharest';
      v_total := v_total + GREATEST(0, EXTRACT(EPOCH FROM (LEAST(p_end, v_break_end) - GREATEST(p_start, v_break_start)))::int);
      v_total := v_total + GREATEST(0, EXTRACT(EPOCH FROM (LEAST(p_end, v_local_end) - GREATEST(p_start, v_local_start)))::int);
    END IF;
    v_day := v_day + 1;
  END LOOP;
  RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION servix_overtime_overlap_seconds(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION servix_overtime_overlap_seconds(timestamptz, timestamptz) TO anon, authenticated;

CREATE OR REPLACE FUNCTION safe_stop_overtime(p_job_id uuid, p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job jobs%ROWTYPE;
  v_overtime int;
BEGIN
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'Lucrarea nu există.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM cars c WHERE c.id = v_job.car_id AND c.assigned_employee_id = p_employee_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Lucrarea nu îți este alocată.');
  END IF;
  IF v_job.status != 'in_lucru' OR v_job.started_at IS NULL THEN RETURN jsonb_build_object('ok', true, 'no_op', true); END IF;

  v_overtime := servix_overtime_overlap_seconds(v_job.started_at, now());
  UPDATE jobs
  SET overtime_seconds = overtime_seconds + v_overtime,
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
  SELECT * INTO v_sched FROM work_schedule WHERE active = true ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'changed', false); END IF;
  v_today := (now() AT TIME ZONE 'Europe/Bucharest')::date;
  SELECT day_active, day_start, day_end INTO v_active, v_start, v_end FROM servix_schedule_day_values(v_today);
  IF NOT COALESCE(v_active, false) THEN RETURN jsonb_build_object('ok', true, 'changed', false); END IF;
  v_sched.work_start := v_start;
  v_sched.work_end := v_end;
  SELECT * INTO v_modes FROM employee_event_settings WHERE employee_id = p_employee_id;
  v_local := (now() AT TIME ZONE 'Europe/Bucharest')::time;

  IF COALESCE(v_modes.work_start_mode, 'auto') = 'auto' AND v_local >= v_sched.work_start AND v_local < v_sched.break_start THEN
    IF NOT EXISTS (SELECT 1 FROM jobs j JOIN cars c ON c.id = j.car_id WHERE c.assigned_employee_id = p_employee_id AND j.status = 'in_lucru') THEN
      SELECT e.job_id INTO v_resume_id FROM session_event_log e WHERE e.employee_id = p_employee_id AND e.event = 'work_end' AND e.job_id IS NOT NULL ORDER BY e.event_date DESC, e.applied_at DESC LIMIT 1;
      IF v_resume_id IS NOT NULL THEN
        SELECT * INTO v_job FROM jobs WHERE id = v_resume_id;
        IF FOUND AND v_job.status = 'asteptare' AND v_job.started_at IS NULL AND EXISTS (SELECT 1 FROM cars c WHERE c.id = v_job.car_id AND c.assigned_employee_id = p_employee_id) THEN
          UPDATE jobs SET status = 'in_lucru', started_at = (v_today + v_sched.work_start) AT TIME ZONE 'Europe/Bucharest' WHERE id = v_job.id AND started_at IS NULL;
          INSERT INTO session_event_log (employee_id, job_id, event, event_date) VALUES (p_employee_id, v_job.id, 'work_start', v_today) ON CONFLICT (employee_id, event, event_date) DO NOTHING;
          v_changed := true;
        END IF;
      END IF;
    END IF;
  END IF;

  IF COALESCE(v_modes.break_start_mode, 'auto') = 'auto' AND v_local >= v_sched.break_start AND v_local < v_sched.break_end THEN
    SELECT j.* INTO v_job FROM jobs j JOIN cars c ON c.id = j.car_id WHERE c.assigned_employee_id = p_employee_id AND j.status = 'in_lucru' AND j.started_at IS NOT NULL AND j.is_overtime = false ORDER BY j.started_at DESC LIMIT 1;
    IF FOUND THEN
      UPDATE jobs SET worked_seconds = worked_seconds + servix_normal_overlap_seconds(v_job.started_at, LEAST(now(), (v_today + v_sched.break_start) AT TIME ZONE 'Europe/Bucharest')), started_at = NULL WHERE id = v_job.id AND started_at IS NOT NULL;
      INSERT INTO session_event_log (employee_id, job_id, event, event_date) VALUES (p_employee_id, v_job.id, 'break_start', v_today) ON CONFLICT (employee_id, event, event_date) DO NOTHING;
      v_changed := true;
    END IF;
  END IF;

  IF COALESCE(v_modes.break_end_mode, 'auto') = 'auto' AND v_local >= v_sched.break_end AND v_local < v_sched.work_end THEN
    SELECT j.* INTO v_job FROM jobs j JOIN cars c ON c.id = j.car_id WHERE c.assigned_employee_id = p_employee_id AND j.status = 'in_lucru' AND j.started_at IS NULL AND j.is_overtime = false ORDER BY j.started_at DESC NULLS LAST LIMIT 1;
    IF FOUND THEN
      UPDATE jobs SET started_at = (v_today + v_sched.break_end) AT TIME ZONE 'Europe/Bucharest' WHERE id = v_job.id AND started_at IS NULL;
      INSERT INTO session_event_log (employee_id, job_id, event, event_date) VALUES (p_employee_id, v_job.id, 'break_end', v_today) ON CONFLICT (employee_id, event, event_date) DO NOTHING;
      v_changed := true;
    END IF;
  END IF;

  IF COALESCE(v_modes.work_end_mode, 'auto') = 'auto' AND v_local >= v_sched.work_end THEN
    SELECT j.* INTO v_job FROM jobs j JOIN cars c ON c.id = j.car_id WHERE c.assigned_employee_id = p_employee_id AND j.status = 'in_lucru' AND j.started_at IS NOT NULL AND j.is_overtime = false ORDER BY j.started_at DESC LIMIT 1;
    IF FOUND THEN
      UPDATE jobs SET worked_seconds = worked_seconds + servix_normal_overlap_seconds(v_job.started_at, (v_today + v_sched.work_end) AT TIME ZONE 'Europe/Bucharest'), started_at = NULL, status = 'asteptare' WHERE id = v_job.id AND started_at IS NOT NULL;
      INSERT INTO session_event_log (employee_id, job_id, event, event_date) VALUES (p_employee_id, v_job.id, 'work_end', v_today) ON CONFLICT (employee_id, event, event_date) DO NOTHING;
      v_changed := true;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'changed', v_changed);
END;
$$;

REVOKE EXECUTE ON FUNCTION auto_sync_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auto_sync_session(uuid) TO anon, authenticated;
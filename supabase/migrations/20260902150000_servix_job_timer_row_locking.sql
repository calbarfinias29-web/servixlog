-- ============================================================
-- FIX: race conditions (READ -> CALCUL -> UPDATE) pe timpul lucrat.
--
-- Problemă: safe_start_job, safe_update_job_status, safe_start_overtime,
-- safe_stop_overtime și auto_sync_session citesc rândul din `jobs`
-- (started_at/worked_seconds/overtime_seconds/is_overtime), calculează
-- delta în memorie, apoi scriu rezultatul — fără să blocheze rândul.
-- Două apeluri simultane pe ACEEAȘI lucrare (dublu-click, două tab-uri,
-- retry de rețea) pot citi aceeași stare inițială și pot suprascrie/
-- dubla secundele calculate de celălalt apel.
--
-- FIX: adăugăm `FOR UPDATE` (sau `FOR UPDATE OF j` la join-uri) pe
-- SELECT-ul care precede orice UPDATE al acelorași câmpuri. Acest lucru
-- serializează apelurile concurente PE ACEEAȘI LUCRARE (a doua cerere
-- așteaptă până când prima își încheie tranzacția și vede starea deja
-- actualizată), fără să blocheze alte lucrări sau alți angajați.
--
-- De ce nu introduce deadlock-uri: fiecare funcție ia lock DOAR pe un
-- singur rând din `jobs` (identificat prin p_job_id sau prin căutarea
-- lucrării active a angajatului), niciodată pe mai multe rânduri diferite
-- în aceeași tranzacție — deci nu poate exista o așteptare circulară
-- între două tranzacții care ar bloca lock-uri în ordine inversă.
--
-- Nu se schimbă: logica de calcul, valorile scrise, regulile de business,
-- comportamentul normal al timerului. Singura schimbare este ADĂUGAREA
-- unui `FOR UPDATE` pe SELECT-urile deja existente.
--
-- Limitare cunoscută (nerezolvată intenționat aici, pentru a nu introduce
-- lock-uri suplimentare neaerute): regula "un angajat nu poate avea două
-- cronometre active simultan" din safe_start_job este verificată printr-un
-- EXISTS pe TOATE lucrările angajatului, nu pe un singur rând — dacă
-- angajatul pornește DOUĂ lucrări diferite exact simultan (din două
-- dispozitive), verificarea nu e garantat atomică între cele două job_id
-- diferite. Nu produce dublare/pierdere de timp (fiecare job are propriile
-- coloane), doar o posibilă încălcare tranzitorie a regulii de business.
-- Rezolvarea completă ar necesita un advisory lock pe employee_id în toate
-- funcțiile de mai jos — nu l-am adăugat fără acordul tău explicit,
-- fiind o schimbare mai amplă decât „adaugă FOR UPDATE unde e necesar”.
-- ============================================================

-- 1) safe_start_job (regula de 1 minut / pornire / preluare)
CREATE OR REPLACE FUNCTION safe_start_job(p_job_id uuid, p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job record;
  v_other_active boolean;
  v_current_employee uuid;
  v_running_sec integer;
BEGIN
  SELECT j.* INTO v_job FROM jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lucrarea nu există';
  END IF;

  -- Un angajat nu poate avea două cronometre active simultan
  SELECT EXISTS(
    SELECT 1 FROM jobs j2
    JOIN cars c2 ON c2.id = j2.car_id
    WHERE c2.assigned_employee_id = p_employee_id
      AND j2.status = 'in_lucru'
      AND j2.id != p_job_id
      AND j2.started_at IS NOT NULL
  ) INTO v_other_active;

  IF v_other_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Ai deja o lucrare activă. Finalizează lucrarea sau pune-o în așteptare înainte de a începe o altă mașină.');
  END IF;

  -- Cine „deține” momentan mașina lucrării
  SELECT c.assigned_employee_id INTO v_current_employee
  FROM cars c WHERE c.id = v_job.car_id;

  -- Lucrarea rulează deja (sesiune activă)
  IF v_job.status = 'in_lucru' AND v_job.started_at IS NOT NULL THEN
    IF v_current_employee = p_employee_id THEN
      RETURN jsonb_build_object('ok', true, 'no_op', true);
    END IF;

    v_running_sec := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_job.started_at))::int);

    IF v_running_sec < 60 THEN
      -- Sub 1 minut: preluare permisă. Sesiunea anterioară se închide,
      -- timpul rulat rămâne în worked_seconds (istoric păstrat).
      UPDATE jobs
      SET worked_seconds = worked_seconds + v_running_sec,
          started_at = now()
      WHERE id = p_job_id;

      UPDATE cars SET assigned_employee_id = p_employee_id WHERE id = v_job.car_id;

      INSERT INTO activity_log (employee_id, car_id, job_id, action, detail)
      VALUES (p_employee_id, v_job.car_id, p_job_id, 'in_lucru', 'Lucrare preluată de alt angajat (sub 1 minut)');

      RETURN jsonb_build_object('ok', true, 'taken_over', true);
    ELSE
      -- Peste 1 minut: lucrarea este preluată definitiv de angajatul curent.
      RETURN jsonb_build_object('ok', false, 'reason', 'Lucrarea este deja preluată de alt angajat. Doar administratorul o poate reassigna.');
    END IF;
  END IF;

  -- Pornire normală (lucrarea nu rulează acum)
  IF v_job.started_at IS NOT NULL THEN
    UPDATE jobs
    SET worked_seconds = worked_seconds + GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int),
        started_at = now(),
        status = 'in_lucru'
    WHERE id = p_job_id;
  ELSE
    UPDATE jobs
    SET started_at = now(),
        status = 'in_lucru'
    WHERE id = p_job_id;
  END IF;

  INSERT INTO activity_log (employee_id, car_id, job_id, action, detail)
  VALUES (p_employee_id, v_job.car_id, p_job_id, 'in_lucru', 'Pornire cronometru lucrare');

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION safe_start_job(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safe_start_job(uuid, uuid) TO anon, authenticated;

-- 2) safe_update_job_status (pauză / așteptare piese / finalizare)
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
    AND c.assigned_employee_id = p_employee_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Lucrarea nu îți este alocată.');
  END IF;

  IF p_status NOT IN ('asteptare', 'asteptare_piese', 'finalizat') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Statusul lucrării nu este valid.');
  END IF;

  UPDATE jobs
  SET status = p_status::job_status,
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

-- 3) safe_start_overtime (pornire ore peste program)
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
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id FOR UPDATE;
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

-- 4) safe_stop_overtime (oprire ore peste program)
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
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id FOR UPDATE;
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

-- 5) auto_sync_session (sincronizare automată pontaj)
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
        SELECT * INTO v_job FROM jobs WHERE id = v_resume_id FOR UPDATE;
        IF FOUND AND v_job.status = 'asteptare' AND v_job.started_at IS NULL AND EXISTS (SELECT 1 FROM cars c WHERE c.id = v_job.car_id AND c.assigned_employee_id = p_employee_id) THEN
          UPDATE jobs SET status = 'in_lucru', started_at = (v_today + v_sched.work_start) AT TIME ZONE 'Europe/Bucharest' WHERE id = v_job.id AND started_at IS NULL;
          INSERT INTO session_event_log (employee_id, job_id, event, event_date) VALUES (p_employee_id, v_job.id, 'work_start', v_today) ON CONFLICT (employee_id, event, event_date) DO NOTHING;
          v_changed := true;
        END IF;
      END IF;
    END IF;
  END IF;

  IF COALESCE(v_modes.break_start_mode, 'auto') = 'auto' AND v_local >= v_sched.break_start AND v_local < v_sched.break_end THEN
    SELECT j.* INTO v_job FROM jobs j JOIN cars c ON c.id = j.car_id WHERE c.assigned_employee_id = p_employee_id AND j.status = 'in_lucru' AND j.started_at IS NOT NULL AND j.is_overtime = false ORDER BY j.started_at DESC LIMIT 1 FOR UPDATE OF j;
    IF FOUND THEN
      UPDATE jobs SET worked_seconds = worked_seconds + servix_normal_overlap_seconds(v_job.started_at, LEAST(now(), (v_today + v_sched.break_start) AT TIME ZONE 'Europe/Bucharest')), started_at = NULL WHERE id = v_job.id AND started_at IS NOT NULL;
      INSERT INTO session_event_log (employee_id, job_id, event, event_date) VALUES (p_employee_id, v_job.id, 'break_start', v_today) ON CONFLICT (employee_id, event, event_date) DO NOTHING;
      v_changed := true;
    END IF;
  END IF;

  IF COALESCE(v_modes.break_end_mode, 'auto') = 'auto' AND v_local >= v_sched.break_end AND v_local < v_sched.work_end THEN
    SELECT j.* INTO v_job FROM jobs j JOIN cars c ON c.id = j.car_id WHERE c.assigned_employee_id = p_employee_id AND j.status = 'in_lucru' AND j.started_at IS NULL AND j.is_overtime = false ORDER BY j.started_at DESC NULLS LAST LIMIT 1 FOR UPDATE OF j;
    IF FOUND THEN
      UPDATE jobs SET started_at = (v_today + v_sched.break_end) AT TIME ZONE 'Europe/Bucharest' WHERE id = v_job.id AND started_at IS NULL;
      INSERT INTO session_event_log (employee_id, job_id, event, event_date) VALUES (p_employee_id, v_job.id, 'break_end', v_today) ON CONFLICT (employee_id, event, event_date) DO NOTHING;
      v_changed := true;
    END IF;
  END IF;

  IF COALESCE(v_modes.work_end_mode, 'auto') = 'auto' AND v_local >= v_sched.work_end THEN
    SELECT j.* INTO v_job FROM jobs j JOIN cars c ON c.id = j.car_id WHERE c.assigned_employee_id = p_employee_id AND j.status = 'in_lucru' AND j.started_at IS NOT NULL AND j.is_overtime = false ORDER BY j.started_at DESC LIMIT 1 FOR UPDATE OF j;
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

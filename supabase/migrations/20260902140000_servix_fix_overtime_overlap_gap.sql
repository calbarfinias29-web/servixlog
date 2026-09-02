-- ============================================================
-- FIX: servix_overtime_overlap_seconds — fereastra lipsă
-- 00:00 -> ora de start a programului, pentru o zi ACTIVĂ.
--
-- Înainte: pentru o zi activă se contoriza overtime DOAR pentru
-- [break_start,break_end) și [work_end, miezul nopții următor).
-- Intervalul [00:00, work_start) al zilei active nu era contorizat
-- NICĂIERI (nici normal, nici overtime) => secunde pierdute pentru
-- sesiuni care rulează noaptea/dimineața devreme într-o zi activă.
--
-- Frontend (src/PanouAngajat.tsx -> overlapSeconds, kind='ot') tratează
-- deja acest interval ca overtime pentru zi activă:
--   [[break_start,break_end], [day.end,'24:00'], ['00:00', day.start]]
-- Acest fix aliniază exact SQL-ul la acest comportament existent.
--
-- Nu se schimbă: zi inactivă (întreaga zi rămâne overtime, ca înainte),
-- fereastra de pauză, fereastra de după program, servix_normal_overlap_seconds.
-- ============================================================

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
  v_day_midnight timestamptz;
  v_work_start timestamptz;
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
      -- FIX: fereastra 00:00 -> work_start, lipsă în versiunea anterioară.
      v_day_midnight := v_local_start;
      v_work_start := (v_day + v_start) AT TIME ZONE 'Europe/Bucharest';
      v_break_start := (v_day + v_sched.break_start) AT TIME ZONE 'Europe/Bucharest';
      v_break_end := (v_day + v_sched.break_end) AT TIME ZONE 'Europe/Bucharest';
      v_local_start := (v_day + v_end) AT TIME ZONE 'Europe/Bucharest';
      v_local_end := ((v_day + 1) + time '00:00') AT TIME ZONE 'Europe/Bucharest';
      v_total := v_total + GREATEST(0, EXTRACT(EPOCH FROM (LEAST(p_end, v_work_start) - GREATEST(p_start, v_day_midnight)))::int);
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

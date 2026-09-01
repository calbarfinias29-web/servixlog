-- ============================================================
-- 1) Regula de 1 minut pentru preluarea unei lucrări (safe_start_job)
--    - Dacă lucrarea rulează deja pentru alt angajat de SUB 1 minut,
--      un alt angajat o poate prelua (sesiunea anterioară se închide,
--      timpul rulat rămâne în worked_seconds — nu se pierde nimic).
--    - După 1 minut, lucrarea este considerată preluată: alt angajat
--      NU mai poate porni timerul (doar administratorul poate transfera).
--    - Rămâne interzis unui angajat să aibă două cronometre active.
-- 2) admin_transfer_car: administratorul poate reassigna mașina fără
--    să piardă timpul lucrat (istoric păstrat în activity_log).
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
  v_current_employee uuid;
  v_running_sec integer;
BEGIN
  SELECT j.* INTO v_job FROM jobs j WHERE j.id = p_job_id;
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

-- ============================================================
-- admin_transfer_car: transferul unei mașini de către administrator.
-- NU atinge worked_seconds / overtime_seconds / started_at —
-- timpul deja lucrat rămâne în istoricul lucrării.
-- ============================================================
CREATE OR REPLACE FUNCTION admin_transfer_car(p_car_id uuid, p_new_employee_id uuid, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_employee uuid;
  v_old_name text;
  v_new_name text;
BEGIN
  IF p_new_employee_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Selectează un angajat.');
  END IF;

  SELECT assigned_employee_id INTO v_old_employee FROM cars WHERE id = p_car_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mașina nu există';
  END IF;

  IF v_old_employee = p_new_employee_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Mașina este deja alocată acestui angajat.');
  END IF;

  UPDATE cars SET assigned_employee_id = p_new_employee_id WHERE id = p_car_id;

  SELECT name INTO v_old_name FROM employees WHERE id = v_old_employee;
  SELECT name INTO v_new_name FROM employees WHERE id = p_new_employee_id;

  INSERT INTO activity_log (employee_id, car_id, action, detail)
  VALUES (p_admin_id, p_car_id, 'transfer',
          'Administratorul a transferat lucrarea de la ' || COALESCE(v_old_name, 'Nealocat') || ' la ' || COALESCE(v_new_name, '?'));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_transfer_car(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_transfer_car(uuid, uuid, uuid) TO anon, authenticated;

-- ============================================================
-- FIX: admin_transfer_car nu finaliza o lucrare care rulează pe
-- mașină înainte de a schimba assigned_employee_id.
--
-- BUG: dacă un job avea started_at NENUL (cronometru pornit) la
-- momentul transferului, cronometrul rămânea legat de vechiul
-- started_at, dar din acel moment doar noul angajat mai putea opri/
-- actualiza lucrarea (verificarea de proprietate se face pe
-- cars.assigned_employee_id curent). Timpul acumulat înainte de
-- transfer (lucrat efectiv de vechiul angajat) ajungea contorizat ca
-- și cum ar fi fost lucrat integral de noul angajat.
--
-- FIX: înainte de UPDATE pe cars, îngheață orice job activ al
-- mașinii (worked_seconds/overtime_seconds + started_at=NULL +
-- status='asteptare' + is_overtime=false) — exact aceeași logică
-- folosită deja de safe_stop_overtime/auto_sync_session la oprirea
-- unei sesiuni. Noul angajat trebuie să pornească explicit lucrarea
-- (safe_start_job), la fel ca la orice altă lucrare în așteptare.
--
-- Nu se schimbă: semnătura funcției, mesajele existente, logica de
-- verificare (aceeași mașină/angajat), activity_log.
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
  v_job jobs%ROWTYPE;
  v_elapsed int;
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

  -- Îngheață orice cronometru activ înainte de transfer.
  FOR v_job IN
    SELECT * FROM jobs WHERE car_id = p_car_id AND status = 'in_lucru' AND started_at IS NOT NULL FOR UPDATE
  LOOP
    v_elapsed := CASE WHEN v_job.is_overtime
      THEN servix_overtime_overlap_seconds(v_job.started_at, now())
      ELSE servix_normal_overlap_seconds(v_job.started_at, now())
    END;
    UPDATE jobs
    SET worked_seconds = worked_seconds + (CASE WHEN v_job.is_overtime THEN 0 ELSE v_elapsed END),
        overtime_seconds = overtime_seconds + (CASE WHEN v_job.is_overtime THEN v_elapsed ELSE 0 END),
        started_at = NULL,
        status = 'asteptare',
        is_overtime = false
    WHERE id = v_job.id;
  END LOOP;

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

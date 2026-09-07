-- SERVIX FAZA 3A: server-side identity and role boundary.
-- This migration does not activate Agent FAZA 3 writes.
-- An authenticated Supabase user is mapped to exactly one employee row.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_auth_user_id
  ON employees(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- The public client must never assign or change the auth identity mapping.
REVOKE INSERT (auth_user_id) ON employees FROM anon, authenticated;
REVOKE UPDATE (auth_user_id) ON employees FROM anon, authenticated;

CREATE OR REPLACE FUNCTION current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id
  FROM employees e
  WHERE e.auth_user_id = auth.uid()
    AND e.active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_current_user_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM employees e
    WHERE e.auth_user_id = auth.uid()
      AND e.active = true
      AND e.role = 'admin'::employee_role
  );
$$;

CREATE OR REPLACE FUNCTION servix_assert_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION current_employee_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION is_current_user_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION servix_assert_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_employee_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION is_current_user_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION servix_assert_admin() TO authenticated;

-- Existing administrative RPCs now require the authenticated mapped Admin.
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
  PERFORM servix_assert_admin();

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
  VALUES (current_employee_id(), p_car_id, 'transfer',
          'Administratorul a transferat lucrarea de la ' || COALESCE(v_old_name, 'Nealocat') || ' la ' || COALESCE(v_new_name, '?'));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_transfer_car(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_transfer_car(uuid, uuid, uuid) TO authenticated;

-- Keep reset protected by both the existing server-side password and Admin role.
CREATE OR REPLACE FUNCTION reset_operational_data(p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_count integer;
  v_car_count integer;
BEGIN
  PERFORM servix_assert_admin();

  IF md5(coalesce(p_password, '')) <> 'd3f34b2895a80d234596d158fc015bdc' THEN
    RAISE EXCEPTION 'Parolă incorectă';
  END IF;

  DELETE FROM activity_log;
  DELETE FROM session_event_log;
  DELETE FROM appointments;
  DELETE FROM storage.objects
  WHERE bucket_id IN ('employee-photos', 'car-photos');

  DELETE FROM cars;
  GET DIAGNOSTICS v_car_count = ROW_COUNT;

  DELETE FROM employees;
  GET DIAGNOSTICS v_employee_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'employees', v_employee_count, 'cars', v_car_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION reset_operational_data(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reset_operational_data(text) TO authenticated;

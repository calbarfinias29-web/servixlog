-- Atomic administrative reset for operational data only.
-- The password is represented only by its server-side MD5 hash here.

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

REVOKE EXECUTE ON FUNCTION reset_operational_data(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_operational_data(text) TO anon, authenticated;
-- ============================================================
-- SCHIMBARE PAROLA reset_operational_data.
--
-- Context: 20260907100000_servix_restore_operational_reset.sql a
-- restaurat functia cu lockout (deja aplicata). Aceasta migratie
-- schimba DOAR hash-ul parolei server-side (md5, acelasi mecanism,
-- acelasi format — vezi decizia "Optiunea 1": pastram md5 identic
-- cu implementarea originala a resetarii).
--
-- - Parola in clar NU apare in acest fisier si nu apare in frontend.
-- - Se pastreaza: verificarea server-side, lockout 5 incercari
--   gresite -> 15 minute pe secvente, resetarea contoarelor la
--   succes, SECURITY DEFINER, search_path = public, fara SQL dinamic,
--   GRANT EXECUTE pentru anon + authenticated, fara
--   servix_assert_admin.
-- - NU se modifica alte functii sau migratii istorice.
-- ============================================================

CREATE OR REPLACE FUNCTION reset_operational_data(p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked_until_epoch bigint;
  v_fail_no bigint;
  v_employee_count integer;
  v_car_count integer;
BEGIN
  -- 1. Lockout: daca sunt in fereastra de blocare, refuz orice apel
  --    (inclusiv cu parola corecta), fara sa consum incercari.
  SELECT last_value INTO v_locked_until_epoch FROM reset_lock_until_epoch;

  IF v_locked_until_epoch > extract(epoch FROM now())::bigint THEN
    RAISE EXCEPTION 'Prea multe încercări greșite. Reîncearcă după %.',
      to_char(to_timestamp(v_locked_until_epoch) AT TIME ZONE 'Europe/Bucharest', 'HH24:MI:SS');
  END IF;

  -- 2. Verificarea parolei DOAR server-side (hash md5, valoarea noua).
  IF md5(coalesce(p_password, '')) <> 'b44f95103ffcd3233800aee875c0c903' THEN
    v_fail_no := nextval('reset_fail_seq');   -- secvente: NU sunt anulate de ROLLBACK
    IF v_fail_no >= 5 THEN
      PERFORM setval('reset_lock_until_epoch', extract(epoch FROM now() + interval '15 minutes')::bigint);
    END IF;
    RAISE EXCEPTION 'Parolă incorectă';
  END IF;

  -- 3. Parola corecta: resetam contorul si blocarea, apoi executam resetarea.
  PERFORM setval('reset_fail_seq', 0, true);
  PERFORM setval('reset_lock_until_epoch', 0, true);

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

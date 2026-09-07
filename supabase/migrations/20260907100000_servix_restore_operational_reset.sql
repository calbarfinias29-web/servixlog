-- ============================================================
-- RESTAURARE reset_operational_data — reparatie pentru regresia
-- introdusa de 20260904100000_servix_auth_role_boundary.sql.
--
-- CAUZA PROBLEMEI: migratia 20260904100000 a rescris functia cu
--   REVOKE ... FROM anon + GRANT ... TO authenticated + servix_assert_admin().
-- Frontend-ul SERVIX nu foloseste Supabase Auth (client mereu anon),
-- deci orice apel primea "permission denied for function
-- reset_operational_data(text)" INAINTE de verificarea parolei —
-- chiar si cu parola corecta. In plus, suprascrierea a ELIMINAT
-- lockout-ul 5/15 min din 20260902170000_servix_reset_rate_limit.sql.
--
-- ACEASTA MIGRATIE:
--   1. Restaureaza EXACT comportamentul din 20260902170000:
--      - parola verificata server-side (md5, aceeasi valoare de hash,
--        nu expunem hash-ul catre frontend);
--      - lockout 5 incercari gresite consecutive -> 15 minute GLOBAL,
--        pastrat pe secvente (imune la ROLLBACK, vezi 20260902170000);
--      - contorul de esecuri se reseteaza la un apel reusit;
--      - aceleasi stergeri, in aceeasi ordine, atomic.
--   2. GRANT EXECUTE pentru anon + authenticated (clientul actual e anon).
--      Securitatea ramane: parola server-side + lockout, nu rolul de auth.
--   3. NU se atinge admin_transfer_car, servix_assert_admin, RLS sau
--      orice alt obiect — doar reset_operational_data si grant-urile ei.
--
-- NU se modifica migrațiile istorice.
-- ============================================================

-- Secventele exista deja (create in 20260902170000); IF NOT EXISTS +
-- ALTER asigura idempotenta fara sa piarda valoarea curenta.
CREATE SEQUENCE IF NOT EXISTS reset_fail_seq MINVALUE 0 START WITH 0;
CREATE SEQUENCE IF NOT EXISTS reset_lock_until_epoch MINVALUE 0 START WITH 0;
ALTER SEQUENCE reset_fail_seq MINVALUE 0;
ALTER SEQUENCE reset_lock_until_epoch MINVALUE 0;

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

  -- 2. Verificarea parolei DOAR server-side (hash md5, valoarea existenta).
  IF md5(coalesce(p_password, '')) <> 'd3f34b2895a80d234596d158fc015bdc' THEN
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

-- ============================================================
-- SERVIX security hardening
-- 1. Admin authentication: verify_admin_password RPC backed by
--    app_settings (md5 hash stored, table not readable by anon).
-- 2. Employee access codes: store md5 hashes instead of plaintext.
--    Behavior unchanged: employees still enter their normal code.
-- ============================================================

-- 1. Admin auth ------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

INSERT INTO app_settings (key, value)
VALUES ('admin_password_hash', md5('servix'))
ON CONFLICT (key) DO NOTHING;

REVOKE ALL ON app_settings FROM PUBLIC;
REVOKE ALL ON app_settings FROM anon, authenticated;

CREATE OR REPLACE FUNCTION verify_admin_password(p_password text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_settings
    WHERE key = 'admin_password_hash'
      AND value = md5(coalesce(p_password, ''))
  );
$$;

REVOKE EXECUTE ON FUNCTION verify_admin_password(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_admin_password(text) TO anon, authenticated;

-- 2. Hash existing plaintext access codes ----------------------
-- md5 hex digests are exactly 32 chars; anything else is plaintext.
UPDATE employees
SET access_code = md5(access_code)
WHERE access_code IS NOT NULL AND length(access_code) <> 32;

-- set_employee_access_code: now stores an md5 hash of the code
CREATE OR REPLACE FUNCTION set_employee_access_code(p_employee_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF LENGTH(TRIM(p_code)) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Codul trebuie să aibă cel puțin 4 caractere.');
  END IF;

  UPDATE employees SET access_code = md5(TRIM(p_code)) WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Angajatul nu există';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION set_employee_access_code(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_employee_access_code(uuid, text) TO anon, authenticated;

-- verify_employee_access_code: compares md5(p_code) with the stored hash
CREATE OR REPLACE FUNCTION verify_employee_access_code(p_employee_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stored_code text;
BEGIN
  SELECT access_code INTO v_stored_code FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Angajat inexistent.');
  END IF;

  IF v_stored_code IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'no_code', true);
  END IF;

  -- Support both legacy plaintext and hashed codes during transition
  IF v_stored_code = TRIM(p_code) OR v_stored_code = md5(TRIM(p_code)) THEN
    RETURN jsonb_build_object('ok', true);
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'Cod incorect.');
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION verify_employee_access_code(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_employee_access_code(uuid, text) TO anon, authenticated;

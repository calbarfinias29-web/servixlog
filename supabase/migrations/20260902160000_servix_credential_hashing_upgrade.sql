-- ============================================================
-- FIX: înlocuire MD5 cu hashing modern cu sare (pgcrypto / bcrypt)
-- pentru credențialele existente.
--
-- INSPECȚIE (înainte de scriere fix):
--   - `employees.access_code` — codul de acces al angajatului. Setat prin
--     RPC `set_employee_access_code` (hash md5, fără sare), verificat prin
--     `verify_employee_access_code` (acceptă md5 SAU text simplu legacy).
--     Este mecanismul de autentificare REAL, folosit activ din
--     src/App.tsx (linia care apelează verify_employee_access_code /
--     set_employee_access_code).
--   - `app_settings.admin_password_hash` — o singură linie, inserată o
--     singură dată în 20260825000000 cu `md5('servix')`. NU există nicio
--     funcție care să actualizeze ulterior această valoare, iar RPC-ul
--     `verify_admin_password` NU este apelat din nicăieri în front-end-ul
--     actual (grep pe src/ nu găsește niciun apel). Cu alte cuvinte, acest
--     mecanism de „parolă admin” pare neutilizat de aplicația curentă —
--     îl securizăm oricum, fiindcă există în schemă și e apelabil de orice
--     client cu cheia anon.
--   - `reset_operational_data(p_password)` are propriul hash md5 INLINE,
--     complet SEPARAT de `app_settings` — NU este atins de acest fix
--     (parola cerută de resetare rămâne exact aceeași; protecția ei este
--     tratată separat, în altă migrație, fără schimbarea algoritmului de
--     hash, pentru că nu cunoaștem parola originală din spatele hash-ului
--     respectiv și nu vrem să riscăm blocarea adminului).
--
-- STRATEGIE DE COMPATIBILITATE (nimeni nu e blocat):
--   - `app_settings.admin_password_hash`: valoarea a fost întotdeauna
--     md5('servix') (nicio cale de update anterioară) => o putem re-hash-ui
--     direct și sigur, condiționat explicit de valoarea veche exactă.
--   - `employees.access_code`: NU cunoaștem codurile în clar ale
--     angajaților existenți (sunt hash-uri md5 ireversibile) => migrare
--     LAZY: `verify_employee_access_code` recunoaște formatul stocat
--     (bcrypt / md5 / text simplu legacy), verifică potrivit formatului,
--     iar la un match reușit pe un format vechi re-scrie codul cu bcrypt.
--     Niciun angajat nu este deconectat; codurile noi setate de admin
--     folosesc bcrypt de la început.
--
-- Necesită extensia `pgcrypto` (standard pe Supabase, instalată de obicei
-- în schema `extensions`). Apelurile sunt calificate explicit ca
-- `extensions.crypt(...)` / `extensions.gen_salt(...)` — dacă în proiectul
-- tău extensia e instalată în alt schema, ajustează calificarea înainte
-- de a aplica migrația.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Migrează singura linie de admin_password_hash, DOAR dacă e încă exact
-- valoarea implicită md5('servix') (nicio cale de update nu a existat
-- vreodată pentru ea) — altfel nu atingem nimic, ca să nu riscăm să
-- suprascriem o valoare pe care nu o cunoaștem.
UPDATE app_settings
SET value = extensions.crypt('servix', extensions.gen_salt('bf'))
WHERE key = 'admin_password_hash' AND value = md5('servix');

CREATE OR REPLACE FUNCTION verify_admin_password(p_password text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_settings
    WHERE key = 'admin_password_hash'
      AND value = extensions.crypt(coalesce(p_password, ''), value)
  );
$$;

REVOKE EXECUTE ON FUNCTION verify_admin_password(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_admin_password(text) TO anon, authenticated;

-- set_employee_access_code: orice cod NOU setat de admin este stocat cu
-- bcrypt (cu sare) în loc de md5. Comportamentul de validare a lungimii
-- minime rămâne neschimbat.
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

  UPDATE employees SET access_code = extensions.crypt(TRIM(p_code), extensions.gen_salt('bf')) WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Angajatul nu există';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION set_employee_access_code(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_employee_access_code(uuid, text) TO anon, authenticated;

-- verify_employee_access_code: recunoaște bcrypt (curent) sau formatul
-- legacy (md5 ORICE text simplu — verificate AMBELE, exact ca în versiunea
-- anterioară din 20260825000000). NU folosim lungimea (32 caractere) pentru
-- a distinge md5 de text simplu: între 20260824192201 (set_employee_access_code
-- accepta orice text simplu de minim 4 caractere, fără maxim) și 20260825000000
-- (când s-a introdus hash-uirea), un admin ar fi putut seta din greșeală un
-- cod în clar de EXACT 32 caractere, care ar fi rămas nehash-uit de migrarea
-- 20260825000000 (condiția ei era `length(access_code) <> 32`). Un asemenea
-- cod ar fi indistingibil de un md5 doar după lungime, deci verificăm ambele
-- variante (la fel ca înainte), nu alegem una pe baza lungimii.
CREATE OR REPLACE FUNCTION verify_employee_access_code(p_employee_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stored_code text;
  v_input text := TRIM(p_code);
  v_ok boolean := false;
BEGIN
  SELECT access_code INTO v_stored_code FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Angajat inexistent.');
  END IF;

  IF v_stored_code IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'no_code', true);
  END IF;

  IF v_stored_code LIKE '$2%' THEN
    -- bcrypt (format curent)
    v_ok := (extensions.crypt(v_input, v_stored_code) = v_stored_code);
  ELSE
    -- Legacy (md5 SAU text simplu, indiferent de lungime — vezi comentariul de mai sus).
    v_ok := (v_stored_code = v_input OR v_stored_code = md5(v_input));
  END IF;

  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Cod incorect.');
  END IF;

  -- Upgrade transparent la bcrypt după un match reușit pe format vechi.
  IF v_stored_code NOT LIKE '$2%' THEN
    UPDATE employees SET access_code = extensions.crypt(v_input, extensions.gen_salt('bf')) WHERE id = p_employee_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION verify_employee_access_code(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_employee_access_code(uuid, text) TO anon, authenticated;

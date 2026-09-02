-- ============================================================
-- FIX: protecție anti-brute-force pentru reset_operational_data.
--
-- VULNERABILITATE ACTUALĂ: `reset_operational_data(p_password)` e
-- accesibilă oricui are cheia anon (GRANT EXECUTE ... TO anon,
-- authenticated), protejată DOAR de o comparație md5 fără nicio limită
-- de încercări. Un client poate încerca parole la nesfârșit.
--
-- NU SCHIMBĂM: parola cerută (rămâne exact același hash md5 verificat),
-- ce se șterge / ce se păstrează, ordinea ștergerilor, atomicitatea
-- (funcția rămâne o singură tranzacție implicită, ca înainte).
--
-- CORECȚIE FAȚĂ DE PRIMA VERSIUNE A ACESTUI FIX: contorul de eșecuri NU
-- poate fi ținut într-un tabel normal, actualizat pe aceeași ramură care
-- face `RAISE EXCEPTION` — orice eroare necapturată face ROLLBACK la
-- ÎNTREAGA tranzacție (întregul apel RPC), deci UPDATE-ul de pe
-- ramura „parolă greșită” ar fi anulat exact de excepția care raportează
-- eșecul, iar contorul nu ar crește NICIODATĂ cu adevărat. Un tabel +
-- `FOR UPDATE` nu rezolvă asta — problema e la nivel de tranzacție, nu de
-- concurență. Singurul mecanism din Postgres care garantat NU este anulat
-- de un ROLLBACK este o secvență (`nextval`/`setval`), folosită exact în
-- acest scop (evită gap-uri la INSERT-uri concurente eșuate). De aceea
-- contorul și „blocat până la ora X” sunt ținute în două secvențe, nu
-- într-un tabel.
--
-- PROTECȚIE: după 5 parole greșite consecutive, orice apel (inclusiv cu
-- parola corectă) e blocat 15 minute. Contorul se resetează la un apel
-- reușit. Secvențele nu au nevoie de `FOR UPDATE` — `nextval()` este deja
-- atomic și sigur la apeluri concurente prin design.
--
-- LIMITARE CUNOSCUTĂ (arhitecturală, nu o rezolvăm prin presupuneri):
-- aplicația nu are sesiuni/JWT per-utilizator (design „tabletă
-- partajată”, cheie anon comună), deci nu putem limita per-IP sau
-- per-utilizator din PostgreSQL — lockout-ul este GLOBAL. Asta înseamnă
-- că un atacator poate declanșa 5 eșecuri intenționat și bloca temporar
-- (15 min) și adminul legitim de la resetare. Este cel mai bun
-- compromis posibil fără a introduce autentificare nouă (care ar fi o
-- schimbare arhitecturală majoră, în afara scopului acestui fix).
-- ============================================================

-- MINVALUE 0: implicit e 1, iar setval(...,0,...) de mai jos ar eșua
-- ("value 0 is out of bounds") fără această coborâre explicită a limitei.
-- ALTER SEQUENCE separat: `CREATE SEQUENCE IF NOT EXISTS ... MINVALUE 0`
-- NU aplică MINVALUE dacă secvența există deja (clauza e ignorată la
-- IF NOT EXISTS pe un obiect existent) — ALTER garantează MINVALUE 0
-- indiferent dacă secvența e nou creată sau exista deja, fără să-i
-- recreeze/piardă valoarea curentă.
CREATE SEQUENCE IF NOT EXISTS reset_fail_seq MINVALUE 0 START WITH 0;
CREATE SEQUENCE IF NOT EXISTS reset_lock_until_epoch MINVALUE 0 START WITH 0;
ALTER SEQUENCE reset_fail_seq MINVALUE 0;
ALTER SEQUENCE reset_lock_until_epoch MINVALUE 0;

SELECT setval('reset_fail_seq', 0, true);
SELECT setval('reset_lock_until_epoch', 0, true);

REVOKE ALL ON SEQUENCE reset_fail_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE reset_lock_until_epoch FROM PUBLIC, anon, authenticated;

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
  SELECT last_value INTO v_locked_until_epoch FROM reset_lock_until_epoch;

  IF v_locked_until_epoch > extract(epoch FROM now())::bigint THEN
    RAISE EXCEPTION 'Prea multe încercări greșite. Reîncearcă după %.',
      to_char(to_timestamp(v_locked_until_epoch) AT TIME ZONE 'Europe/Bucharest', 'HH24:MI:SS');
  END IF;

  IF md5(coalesce(p_password, '')) <> 'd3f34b2895a80d234596d158fc015bdc' THEN
    v_fail_no := nextval('reset_fail_seq');
    IF v_fail_no >= 5 THEN
      PERFORM setval('reset_lock_until_epoch', extract(epoch FROM now() + interval '15 minutes')::bigint);
    END IF;
    RAISE EXCEPTION 'Parolă incorectă';
  END IF;

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


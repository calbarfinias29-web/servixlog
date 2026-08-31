-- ============================================================
-- 1. FIX safe_assign_car: check car existence, not employee assignment
-- The old code raised an exception when assigned_employee_id was NULL
-- (i.e. available cars), blocking the entire ALEGE ALTĂ MAȘINĂ flow.
-- ============================================================
CREATE OR REPLACE FUNCTION safe_assign_car(p_car_id uuid, p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_car_employee_id uuid;
  v_car_has_active boolean;
  v_emp_has_active boolean;
BEGIN
  SELECT assigned_employee_id INTO v_car_employee_id FROM cars WHERE id = p_car_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mașina nu există';
  END IF;

  -- Block if another employee has an active job on this car
  SELECT EXISTS(
    SELECT 1 FROM jobs
    WHERE car_id = p_car_id AND status = 'in_lucru'
      AND EXISTS (SELECT 1 FROM cars WHERE id = p_car_id AND assigned_employee_id != p_employee_id)
  ) INTO v_car_has_active;

  IF v_car_has_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Mașina este lucrată activ de alt angajat');
  END IF;

  -- Block if this employee has an active job (in_lucru) on a DIFFERENT car
  -- asteptare_piese does NOT count as active — employee can switch
  SELECT EXISTS(
    SELECT 1 FROM jobs j
    JOIN cars c ON c.id = j.car_id
    WHERE c.assigned_employee_id = p_employee_id
      AND j.status = 'in_lucru'
      AND j.car_id != p_car_id
  ) INTO v_emp_has_active;

  IF v_emp_has_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Aveți o lucrare activă la altă mașină');
  END IF;

  UPDATE cars SET assigned_employee_id = p_employee_id WHERE id = p_car_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION safe_assign_car(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safe_assign_car(uuid, uuid) TO anon, authenticated;

-- ============================================================
-- 2. Add demo cars with jobs (real DB data, not frontend hardcoded)
-- ============================================================
INSERT INTO cars (license_plate, client_name, client_phone, make, model, deadline, priority, status, is_demo, assigned_employee_id)
VALUES
  ('TM 99 DEMO', 'Ion Popescu', '0721 000 099', 'Dacia', 'Duster', '2026-09-15', 'normala', 'noua', true, NULL),
  ('TM 88 DEMO', 'Mihai Ionescu', '0721 000 088', 'BMW', '320d', '2026-09-10', 'normala', 'noua', true, NULL),
  ('TM 77 DEMO', 'Vlad Georgescu', '0721 000 077', 'Audi', 'A4', '2026-09-08', 'urgenta', 'noua', true, NULL),
  ('TM 66 DEMO', 'Andrei Stan', '0721 000 066', 'Volkswagen', 'Passat', '2026-09-12', 'normala', 'noua', true, NULL),
  ('TM 55 DEMO', 'Daniel Marin', '0721 000 055', 'Ford', 'Focus', '2026-09-14', 'normala', 'noua', true, NULL),
  ('TM 44 DEMO', 'Cristian Pavel', '0721 000 044', 'Skoda', 'Octavia', '2026-09-11', 'normala', 'noua', true, NULL),
  ('TM 33 DEMO', 'Robert Dumitru', '0721 000 033', 'Mercedes', 'C-Class', '2026-09-09', 'urgenta', 'noua', true, NULL),
  ('TM 22 DEMO', 'Marius Ene', '0721 000 022', 'Opel', 'Astra', '2026-09-13', 'normala', 'noua', true, NULL)
ON CONFLICT DO NOTHING;

-- Add jobs for each new demo car
INSERT INTO jobs (car_id, title, status, order_index, worked_seconds)
SELECT c.id, 'Schimb ambreiaj', 'asteptare', 1, 0
FROM cars c WHERE c.license_plate = 'TM 99 DEMO' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id)
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds)
SELECT c.id, 'Schimb planetare', 'asteptare', 2, 0
FROM cars c WHERE c.license_plate = 'TM 99 DEMO' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Schimb planetare')
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds)
SELECT c.id, 'Schimb filtre ulei', 'asteptare', 3, 0
FROM cars c WHERE c.license_plate = 'TM 99 DEMO' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Schimb filtre ulei')
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds)
SELECT c.id, 'Verificare frâne', 'asteptare', 4, 0
FROM cars c WHERE c.license_plate = 'TM 99 DEMO' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Verificare frâne')
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds)
SELECT c.id, 'Schimb planetare', 'asteptare', 1, 0
FROM cars c WHERE c.license_plate = 'TM 88 DEMO' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id)
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds)
SELECT c.id, 'Schimb ambreiaj', 'asteptare', 2, 0
FROM cars c WHERE c.license_plate = 'TM 88 DEMO' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id AND j.title = 'Schimb ambreiaj')
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds)
SELECT c.id, 'Diagnosticare motor', 'asteptare', 1, 0
FROM cars c WHERE c.license_plate = 'TM 77 DEMO' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id)
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds)
SELECT c.id, 'Schimb ambreiaj', 'asteptare', 1, 0
FROM cars c WHERE c.license_plate = 'TM 66 DEMO' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id)
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds)
SELECT c.id, 'Schimb filtre ulei', 'asteptare', 1, 0
FROM cars c WHERE c.license_plate = 'TM 55 DEMO' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id)
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds)
SELECT c.id, 'Verificare frâne', 'asteptare', 1, 0
FROM cars c WHERE c.license_plate = 'TM 44 DEMO' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id)
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds)
SELECT c.id, 'Diagnosticare electronică', 'asteptare', 1, 0
FROM cars c WHERE c.license_plate = 'TM 33 DEMO' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id)
ON CONFLICT DO NOTHING;

INSERT INTO jobs (car_id, title, status, order_index, worked_seconds)
SELECT c.id, 'Schimb ulei motor', 'asteptare', 1, 0
FROM cars c WHERE c.license_plate = 'TM 22 DEMO' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.car_id = c.id)
ON CONFLICT DO NOTHING;
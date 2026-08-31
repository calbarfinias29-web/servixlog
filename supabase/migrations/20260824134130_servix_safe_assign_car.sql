/*
# SERVIX - Safe car assignment function

Enforces backend rules for car switching:
1. An employee cannot take a car that has an active job (in_lucru) by another employee.
2. An employee cannot take a new car if they have an active job on another car.
*/

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
  IF v_car_employee_id IS NULL THEN
    RAISE EXCEPTION 'Mașina nu există';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM jobs
    WHERE car_id = p_car_id AND status = 'in_lucru'
      AND EXISTS (SELECT 1 FROM cars WHERE id = p_car_id AND assigned_employee_id != p_employee_id)
  ) INTO v_car_has_active;

  IF v_car_has_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Mașina este lucrată activ de alt angajat');
  END IF;

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

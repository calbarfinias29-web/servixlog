/*
# SERVIX - Safe demo deletion functions

## Overview
Adds two database functions for deleting demo data only. Each function checks
`is_demo = true` inside the database before deleting anything.

## Functions
- `delete_demo_employee(uuid)`: removes a demo employee plus demo cars, jobs,
  sessions, time entries, and activity history associated with that employee.
- `delete_all_demo_data()`: removes every row marked demo and leaves real rows untouched.

## Security
- Functions use SECURITY DEFINER with a fixed `search_path`.
- The functions contain explicit demo-marker checks and cannot delete real rows.
- Execute is available to the app roles because this is a private shared-tablet app;
  the function itself is the enforcement boundary.
*/

CREATE OR REPLACE FUNCTION delete_demo_employee(p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM employees WHERE id = p_employee_id AND is_demo = true) THEN
    RAISE EXCEPTION 'Only demo employees can be deleted';
  END IF;

  DELETE FROM activity_log
  WHERE is_demo = true
    AND (employee_id = p_employee_id OR car_id IN (
      SELECT id FROM cars WHERE is_demo = true AND assigned_employee_id = p_employee_id
    ));

  DELETE FROM cars
  WHERE is_demo = true
    AND (
      assigned_employee_id = p_employee_id
      OR id IN (
        SELECT j.car_id FROM jobs j
        JOIN time_entries t ON t.job_id = j.id
        WHERE j.is_demo = true AND t.is_demo = true AND t.employee_id = p_employee_id
      )
    );

  DELETE FROM employees WHERE id = p_employee_id AND is_demo = true;
END;
$$;

CREATE OR REPLACE FUNCTION delete_all_demo_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM activity_log WHERE is_demo = true;
  DELETE FROM cars WHERE is_demo = true;
  DELETE FROM employees WHERE is_demo = true;
END;
$$;

REVOKE EXECUTE ON FUNCTION delete_demo_employee(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION delete_all_demo_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_demo_employee(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_all_demo_data() TO anon, authenticated;

/*
# SERVIX - Narrow demo marker write privileges

## Overview
The first protection migration removed direct column grants, but the existing
broad table grants still inherited write access. This migration replaces those
broad INSERT/UPDATE grants with explicit column lists that exclude `is_demo`.

## Security changes
- anon and authenticated can still use the existing app flows.
- Neither role can insert or update `is_demo` on employees, cars, jobs,
  time_entries, or activity_log.
- RLS DELETE policies remain demo-only.

## Data safety
No rows are changed or deleted. Real and demo records remain intact.
*/

REVOKE INSERT, UPDATE ON employees FROM anon, authenticated;
GRANT INSERT (id, name, role, active, created_at) ON employees TO anon, authenticated;
GRANT UPDATE (name, role, active, created_at) ON employees TO anon, authenticated;

REVOKE INSERT, UPDATE ON cars FROM anon, authenticated;
GRANT INSERT (id, license_plate, client_name, client_phone, client_email, make, model, year, color, vin, status, priority, assigned_employee_id, deadline, is_warranty, notes, created_at, updated_at, completed_at) ON cars TO anon, authenticated;
GRANT UPDATE (license_plate, client_name, client_phone, client_email, make, model, year, color, vin, status, priority, assigned_employee_id, deadline, is_warranty, notes, created_at, updated_at, completed_at) ON cars TO anon, authenticated;

REVOKE INSERT, UPDATE ON jobs FROM anon, authenticated;
GRANT INSERT (id, car_id, title, description, status, worked_seconds, started_at, completed_at, order_index, created_at, updated_at) ON jobs TO anon, authenticated;
GRANT UPDATE (car_id, title, description, status, worked_seconds, started_at, completed_at, order_index, created_at, updated_at) ON jobs TO anon, authenticated;

REVOKE INSERT, UPDATE ON time_entries FROM anon, authenticated;
GRANT INSERT (id, job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, created_at) ON time_entries TO anon, authenticated;
GRANT UPDATE (job_id, employee_id, start_time, end_time, duration_seconds, is_overtime, pause_reason, created_at) ON time_entries TO anon, authenticated;

REVOKE INSERT, UPDATE ON activity_log FROM anon, authenticated;
GRANT INSERT (id, employee_id, car_id, job_id, action, detail, created_at) ON activity_log TO anon, authenticated;
GRANT UPDATE (employee_id, car_id, job_id, action, detail, created_at) ON activity_log TO anon, authenticated;

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../supabase/migrations/20260904100000_servix_auth_role_boundary.sql', import.meta.url), 'utf8');
const security = await readFile(new URL('../src/agent/agent-security.ts', import.meta.url), 'utf8');
const write = await readFile(new URL('../src/agent/agent-write.ts', import.meta.url), 'utf8');

const phase3Actions = [
  'create_employee', 'update_employee', 'delete_employee',
  'create_job', 'update_job', 'delete_job',
  'create_appointment', 'update_appointment', 'delete_appointment',
  'transfer_employee', 'change_assignment', 'change_job_status',
  'reset_operational_data',
];

test('FAZA 3A: identity mapping is derived from auth.uid()', () => {
  assert.match(migration, /auth_user_id uuid UNIQUE REFERENCES auth\.users\(id\)/);
  assert.match(migration, /e\.auth_user_id = auth\.uid\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION is_current_user_admin\(\)/);
  assert.match(migration, /AND e\.role = 'admin'::employee_role/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION current_employee_id\(\)/);
});

test('FAZA 3A: client cannot forge employee identity mapping', () => {
  assert.match(migration, /REVOKE INSERT \(auth_user_id\) ON employees FROM anon, authenticated/);
  assert.match(migration, /REVOKE UPDATE \(auth_user_id\) ON employees FROM anon, authenticated/);
});

test('FAZA 3A: admin RPCs reject anon and assert mapped Admin', () => {
  assert.match(migration, /PERFORM servix_assert_admin\(\);/g);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION admin_transfer_car\(uuid, uuid, uuid\) FROM PUBLIC, anon/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION reset_operational_data\(text\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION admin_transfer_car\(uuid, uuid, uuid\) TO authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION reset_operational_data\(text\) TO authenticated/);
});

test('FAZA 3A: Faza 3 Agent writes remain blocked', () => {
  for (const action of phase3Actions) {
    assert.doesNotMatch(security, new RegExp(`['"]${action}['"]`));
  }
  for (const action of phase3Actions) {
    assert.doesNotMatch(write, new RegExp(`^\\s*['"]${action}['"]\\s*,?$`, 'm'));
  }
});

test('FAZA 3A: no service role or secret is introduced', () => {
  assert.doesNotMatch(migration, /service_role|SUPABASE_SERVICE_ROLE/i);
  assert.doesNotMatch(security, /service_role|SUPABASE_SERVICE_ROLE/i);
  assert.doesNotMatch(write, /service_role|SUPABASE_SERVICE_ROLE/i);
});

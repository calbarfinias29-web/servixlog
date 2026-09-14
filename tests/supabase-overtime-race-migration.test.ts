import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('supabase/migrations/20260914190000_fix_overtime_work_end_race.sql');
const sql = readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log('  PASS - ' + name); }
  catch (error) { failed++; console.error('  FAIL - ' + name); console.error(error); }
}
function count(pattern: string): number { return (sql.match(new RegExp(pattern, 'g')) ?? []).length; }

test('defines one private work-end helper and replaces the three server functions', () => {
  assert.equal(count('CREATE OR REPLACE FUNCTION servix_reconcile_work_end_for_job'), 1);
  assert.equal(count('CREATE OR REPLACE FUNCTION safe_start_overtime'), 1);
  assert.equal(count('CREATE OR REPLACE FUNCTION auto_sync_session'), 1);
  assert.match(sql, /REVOKE ALL ON FUNCTION servix_reconcile_work_end_for_job/);
  assert.doesNotMatch(sql, /CREATE TABLE|ALTER TABLE|CREATE INDEX|DROP TABLE/);
});

test('uses the same employee advisory lock before job locking', () => {
  assert.equal(count('pg_advisory_xact_lock\\(hashtextextended'), 2);
  assert.equal(count('FROM jobs WHERE id = p_job_id FOR UPDATE'), 2);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('[^']*' \|\| p_employee_id::text, 0\)\);[\s\S]*?FROM jobs WHERE id = p_job_id FOR UPDATE/);
});

test('reconciles work_end before overtime activation', () => {
  const safeStart = sql.indexOf('CREATE OR REPLACE FUNCTION safe_start_overtime');
  const autoSync = sql.indexOf('CREATE OR REPLACE FUNCTION auto_sync_session');
  const safeBody = sql.slice(safeStart, autoSync);
  const overtimeStart = safeBody.indexOf("SET started_at = v_now,\n      status = 'in_lucru',\n      is_overtime = true");
  const helperCall = safeBody.indexOf('v_reconciled := servix_reconcile_work_end_for_job');
  assert.ok(helperCall >= 0 && helperCall < overtimeStart);
  assert.match(sql, /'schedule_end', 'Oprire automată - sfârșit program'/);
  assert.match(sql, /'work_end'/);
  assert.match(sql, /'overtime_start', 'Ore peste program pornite', v_now/);
});

test('uses the schedule boundary for schedule_end and now for overtime_start', () => {
  assert.match(sql, /v_boundary := \(v_today \+ v_end\) AT TIME ZONE 'Europe\/Bucharest'/);
  assert.match(sql, /created_at\)\n    VALUES \(p_employee_id, v_job\.car_id, p_job_id, 'schedule_end'.*v_boundary/s);
  assert.match(sql, /created_at\)\n  VALUES \(p_employee_id, v_job\.car_id, p_job_id, 'overtime_start'.*v_now/s);
  assert.doesNotMatch(sql, /'schedule_end'[^;]*v_now/s);
});

test('preserves no-op overtime and before-work-end validation', () => {
  assert.match(sql, /IF v_job\.is_overtime AND v_job\.started_at IS NOT NULL THEN[\s\S]*'no_op'/);
  assert.match(sql, /v_local >= v_end/);
  assert.match(sql, /Orele peste program pot fi pornite doar în pauză sau după program/);
  assert.match(sql, /v_job\.is_overtime/);
});

test('guards duplicate work_end and keeps marker idempotency', () => {
  assert.match(sql, /event = 'work_end'[\s\S]*event_date = v_today/);
  assert.match(sql, /ON CONFLICT \(employee_id, event, event_date\) DO NOTHING/);
  assert.match(sql, /action = 'schedule_end'[\s\S]*created_at = v_boundary/);
});

test('keeps next-day resume protection and existing pause/resume behavior', () => {
  assert.match(sql, /e\.event = 'work_end' AND e\.job_id IS NOT NULL AND e\.event_date < v_today/);
  assert.match(sql, /'schedule_pause'/);
  assert.match(sql, /'Reluare automată după pauza programată'/);
  assert.match(sql, /'Reluare automată la începutul programului'/);
});

console.log('SUPABASE OVERTIME RACE MIGRATION: ' + passed + ' pass, ' + failed + ' fail');
if (failed > 0) process.exit(1);

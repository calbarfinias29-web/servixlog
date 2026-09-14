import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('supabase/migrations/20260914180000_fix_auto_sync_activity_log.sql');
const sql = readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log('  PASS - ' + name); }
  catch (error) { failed++; console.error('  FAIL - ' + name); console.error(error); }
}

function count(value: string): number {
  return (sql.match(new RegExp(value, 'g')) ?? []).length;
}

test('replaces only auto_sync_session without schema changes', () => {
  assert.equal(count('CREATE OR REPLACE FUNCTION auto_sync_session\\(p_employee_id uuid\\)'), 1);
  assert.equal(/CREATE TABLE|ALTER TABLE|CREATE INDEX|DROP TABLE/.test(sql), false);
});

test('records every automatic transition in activity_log', () => {
  assert.equal(count("'schedule_pause'"), 1);
  assert.equal(count("'schedule_end'"), 1);
  assert.equal(count("'Reluare automată după pauza programată'"), 1);
  assert.equal(count("'Reluare automată la începutul programului'"), 1);
  assert.equal(count("INSERT INTO activity_log"), 4);
});

test('uses scheduled boundary timestamps, never polling now()', () => {
  assert.match(sql, /'schedule_pause'.*\(v_today \+ v_sched\.break_start\).*AT TIME ZONE/s);
  assert.match(sql, /'schedule_end'.*\(v_today \+ v_sched\.work_end\).*AT TIME ZONE/s);
  assert.match(sql, /'Reluare automată după pauza programată'.*\(v_today \+ v_sched\.break_end\).*AT TIME ZONE/s);
  assert.doesNotMatch(sql, /'schedule_end'[^;]*now\(\)/s);
});

test('preserves marker idempotency and serializes concurrent polls', () => {
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(/);
  assert.equal(count(String.raw`ON CONFLICT \(employee_id, event, event_date\) DO NOTHING`), 4);
  assert.equal(count("event = 'break_start' AND event_date = v_today"), 1);
  assert.equal(count("event = 'break_end' AND event_date = v_today"), 1);
  assert.equal(count("event = 'work_end' AND event_date = v_today"), 1);
});

test('keeps the next-day protection for automatic resume', () => {
  assert.match(sql, /e\.event = 'work_end'.*e\.event_date < v_today/s);
  assert.match(sql, /event = 'work_start' AND event_date = v_today/);
});

test('keeps job ownership and row locking', () => {
  assert.equal(count('FOR UPDATE OF j'), 3);
  assert.match(sql, /c\.assigned_employee_id = p_employee_id/);
  assert.match(sql, /j\.is_overtime = false/);
});

console.log('SUPABASE AUTO-SYNC MIGRATION: ' + passed + ' pass, ' + failed + ' fail');
if (failed > 0) process.exit(1);

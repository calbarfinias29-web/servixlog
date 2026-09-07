import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createDatabase } from '../src/db.ts';
import { SCHEMA_VERSION } from '../src/schema.ts';

function tempDbPath(prefix: string): string {
  return join(mkdtempSync(join(tmpdir(), prefix)), 'local.db');
}

test('schema v5 creează fundația timerului, weekly schedule și device registry', () => {
  const app = createDatabase(tempDbPath('servix-schema-v5-'), { seed: false });
  try {
    assert.equal(app.schemaVersion, SCHEMA_VERSION);
    assert.equal(SCHEMA_VERSION, 5);
    const tables = app.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    for (const name of ['timer_sessions', 'timer_intervals', 'plate_history', 'mileage_log', 'car_photos', 'employee_event_settings', 'session_event_log']) {
      assert.ok(tables.some((table) => table.name === name), `missing table: ${name}`);
    }
    const devices = app.db.prepare('PRAGMA table_info(devices)').all() as Array<{ name: string }>;
    for (const name of ['device_id', 'device_type', 'credential_hash', 'last_seen_at', 'revoked_at']) {
      assert.ok(devices.some((column) => column.name === name), `missing devices column: ${name}`);
    }
    assert.ok(tables.some((table) => table.name === 'local_service'), 'missing local_service table');
    const schedule = app.db.prepare('PRAGMA table_info(work_schedule)').all() as Array<{ name: string }>;
    for (const name of ['monday_active', 'monday_start', 'monday_end', 'saturday_active', 'sunday_end']) {
      assert.ok(schedule.some((column) => column.name === name), `missing schedule column: ${name}`);
    }
  } finally {
    app.close();
  }
});

test('upgrade v2 -> v5 păstrează datele existente', () => {
  const path = tempDbPath('servix-schema-upgrade-');
  const old = new DatabaseSync(path);
  old.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE employees (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'employee', active INTEGER NOT NULL DEFAULT 1, username TEXT, created_at TEXT NOT NULL);
    CREATE TABLE cars (id TEXT PRIMARY KEY, license_plate TEXT NOT NULL, client_name TEXT NOT NULL, client_phone TEXT, make TEXT, model TEXT, status TEXT NOT NULL DEFAULT 'noua', priority TEXT NOT NULL DEFAULT 'normala', assigned_employee_id TEXT, deadline TEXT, is_warranty INTEGER NOT NULL DEFAULT 0, notes TEXT, overtime_seconds INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE jobs (id TEXT PRIMARY KEY, car_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'asteptare', worked_seconds INTEGER NOT NULL DEFAULT 0, overtime_seconds INTEGER NOT NULL DEFAULT 0, is_overtime INTEGER NOT NULL DEFAULT 0, started_at TEXT, completed_at TEXT, order_index INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE appointments (id TEXT PRIMARY KEY, car_id TEXT, license_plate TEXT, client_name TEXT, make TEXT, model TEXT, appointment_date TEXT NOT NULL, appointment_time TEXT NOT NULL, employee_id TEXT, status TEXT NOT NULL DEFAULT 'programata', notes TEXT, created_at TEXT NOT NULL);
    CREATE TABLE rates (id TEXT PRIMARY KEY, normal_rate REAL NOT NULL DEFAULT 100, urgent_rate REAL NOT NULL DEFAULT 150, warranty_rate REAL NOT NULL DEFAULT 0, overtime_rate REAL NOT NULL DEFAULT 150, vat_rate REAL NOT NULL DEFAULT 21, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE work_schedule (id TEXT PRIMARY KEY, work_start TEXT NOT NULL DEFAULT '07:00', work_end TEXT NOT NULL DEFAULT '18:00', break_start TEXT NOT NULL DEFAULT '13:00', break_end TEXT NOT NULL DEFAULT '14:00', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE themes (id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT, created_at TEXT NOT NULL);
    CREATE TABLE vehicle_makes (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL);
    CREATE TABLE vehicle_models (id TEXT PRIMARY KEY, make_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL);
    CREATE TABLE work_catalog (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL);
    CREATE TABLE activity_log (id TEXT PRIMARY KEY, car_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL);
    CREATE TABLE time_entries (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, job_id TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT, duration_seconds INTEGER, is_overtime INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    INSERT INTO employees VALUES ('emp-old', 'Existing employee', 'employee', 1, 'old.user', '2026-09-04T10:00:00.000Z');
    INSERT INTO cars (id, license_plate, client_name, created_at) VALUES ('car-old', 'OLD-123', 'Existing client', '2026-09-04T10:00:00.000Z');
    INSERT INTO jobs (id, car_id, title, created_at) VALUES ('job-old', 'car-old', 'Existing job', '2026-09-04T10:00:00.000Z');
    INSERT INTO work_schedule (id, work_start, work_end, break_start, break_end, active, created_at) VALUES ('schedule-old', '08:00', '17:00', '12:00', '13:00', 1, '2026-09-04T10:00:00.000Z');
  `);
  old.close();

  const app = createDatabase(path, { seed: false });
  try {
    assert.equal((app.db.prepare('SELECT name FROM employees WHERE id = ?').get('emp-old') as { name: string }).name, 'Existing employee');
    assert.equal((app.db.prepare('SELECT license_plate FROM cars WHERE id = ?').get('car-old') as { license_plate: string }).license_plate, 'OLD-123');
    assert.equal((app.db.prepare('SELECT title FROM jobs WHERE id = ?').get('job-old') as { title: string }).title, 'Existing job');
    const schedule = app.db.prepare('SELECT monday_start, friday_end, saturday_active FROM work_schedule WHERE id = ?').get('schedule-old') as { monday_start: string; friday_end: string; saturday_active: number };
    assert.equal(schedule.monday_start, '08:00');
    assert.equal(schedule.friday_end, '17:00');
    assert.equal(schedule.saturday_active, 0);
    assert.equal((app.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 5);
    const backupNames = readdirSync(join(dirname(path), 'backups'));
    assert.ok(backupNames.some((name) => name.includes('pre-schema-v5')));
    app.db.prepare("INSERT INTO timer_sessions (id, job_id, employee_id, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run('session-1', 'job-old', 'emp-old', '2026-09-04T10:00:00.000Z', '2026-09-04T10:00:00.000Z', '2026-09-04T10:00:00.000Z');
    assert.throws(() => app.db.prepare("INSERT INTO timer_sessions (id, job_id, employee_id, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run('session-2', 'job-old', 'emp-old', '2026-09-04T10:01:00.000Z', '2026-09-04T10:01:00.000Z', '2026-09-04T10:01:00.000Z'));
  } finally {
    app.close();
  }
});

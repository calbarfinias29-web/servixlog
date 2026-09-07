/**
 * SERVIX — Local SQLite schema (FAZA 3).
 *
 * Set pilot de tabele (subset din modelul SERVIX/Supabase), suficiente
 * pentru a demonstra arhitectura locală. Denumirile păstrează modelul
 * actual pentru a facilita integrarea viitoare.
 *
 * ACEASTA NU ESTE O MIGRARE SUPABASE. Este doar schema locală de
 * infrastructură, complet izolată de cloud.
 *
 * Tabele pilot: employees, cars, jobs, appointments, rates, work_schedule.
 */

export const SCHEMA_VERSION = 5;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS employees (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'employee',
  active      INTEGER NOT NULL DEFAULT 1,
  username    TEXT,
  is_demo     INTEGER NOT NULL DEFAULT 0,
  avatar_url  TEXT,
  access_code TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cars (
  id                    TEXT PRIMARY KEY,
  license_plate         TEXT NOT NULL,
  client_name           TEXT NOT NULL,
  client_phone          TEXT,
  make                  TEXT,
  model                 TEXT,
  status                TEXT NOT NULL DEFAULT 'noua',
  priority              TEXT NOT NULL DEFAULT 'normala',
  assigned_employee_id  TEXT REFERENCES employees(id) ON DELETE SET NULL,
  deadline              TEXT,
  is_warranty           INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT,
  internal_id            TEXT,
  client_email           TEXT,
  year                   INTEGER,
  color                  TEXT,
  vin                    TEXT,
  mileage                INTEGER,
  body_observations      TEXT,
  photo_url              TEXT,
  fuel_level             TEXT,
  payment_status         TEXT,
  invoice_status         TEXT,
  financial_status       TEXT,
  is_demo                INTEGER NOT NULL DEFAULT 0,
  overtime_seconds      INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  completed_at          TEXT,
  updated_at            TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id               TEXT PRIMARY KEY,
  car_id           TEXT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'asteptare',
  worked_seconds   INTEGER NOT NULL DEFAULT 0,
  overtime_seconds INTEGER NOT NULL DEFAULT 0,
  is_overtime      INTEGER NOT NULL DEFAULT 0,
  started_at       TEXT,
  completed_at     TEXT,
  order_index      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT
);

CREATE TABLE IF NOT EXISTS appointments (
  id                TEXT PRIMARY KEY,
  car_id            TEXT,
  license_plate     TEXT,
  client_name       TEXT,
  client_phone      TEXT,
  make              TEXT,
  model             TEXT,
  internal_id       TEXT,
  vin               TEXT,
  appointment_date  TEXT NOT NULL,
  appointment_time  TEXT NOT NULL,
  employee_id       TEXT,
  status            TEXT NOT NULL DEFAULT 'programata',
  notes             TEXT,
  created_at        TEXT NOT NULL,
  is_demo           INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT
);

CREATE TABLE IF NOT EXISTS rates (
  id             TEXT PRIMARY KEY,
  normal_rate    REAL NOT NULL DEFAULT 100,
  urgent_rate    REAL NOT NULL DEFAULT 150,
  warranty_rate  REAL NOT NULL DEFAULT 0,
  overtime_rate  REAL NOT NULL DEFAULT 150,
  vat_rate       REAL NOT NULL DEFAULT 21,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_schedule (
  id           TEXT PRIMARY KEY,
  work_start   TEXT NOT NULL DEFAULT '07:00',
  work_end     TEXT NOT NULL DEFAULT '18:00',
  break_start  TEXT NOT NULL DEFAULT '13:00',
  break_end    TEXT NOT NULL DEFAULT '14:00',
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  monday_active    INTEGER NOT NULL DEFAULT 1,
  monday_start    TEXT NOT NULL DEFAULT '07:00',
  monday_end      TEXT NOT NULL DEFAULT '18:00',
  tuesday_active  INTEGER NOT NULL DEFAULT 1,
  tuesday_start  TEXT NOT NULL DEFAULT '07:00',
  tuesday_end    TEXT NOT NULL DEFAULT '18:00',
  wednesday_active INTEGER NOT NULL DEFAULT 1,
  wednesday_start TEXT NOT NULL DEFAULT '07:00',
  wednesday_end   TEXT NOT NULL DEFAULT '18:00',
  thursday_active INTEGER NOT NULL DEFAULT 1,
  thursday_start TEXT NOT NULL DEFAULT '07:00',
  thursday_end   TEXT NOT NULL DEFAULT '18:00',
  friday_active  INTEGER NOT NULL DEFAULT 1,
  friday_start   TEXT NOT NULL DEFAULT '07:00',
  friday_end     TEXT NOT NULL DEFAULT '18:00',
  saturday_active INTEGER NOT NULL DEFAULT 0,
  saturday_start TEXT NOT NULL DEFAULT '07:00',
  saturday_end   TEXT NOT NULL DEFAULT '18:00',
  sunday_active  INTEGER NOT NULL DEFAULT 0,
  sunday_start   TEXT NOT NULL DEFAULT '07:00',
  sunday_end     TEXT NOT NULL DEFAULT '18:00',
  updated_at     TEXT
);

-- ===== FAZA 5 — extensie READ-only =====

CREATE TABLE IF NOT EXISTS themes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  config      TEXT,
  created_at  TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'employee',
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  is_custom   INTEGER NOT NULL DEFAULT 0,
  colors      TEXT,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS vehicle_makes (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicle_models (
  id              TEXT PRIMARY KEY,
  make_id         TEXT NOT NULL REFERENCES vehicle_makes(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_catalog (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id          TEXT PRIMARY KEY,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  car_id      TEXT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  job_id      TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL,
  is_demo     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS time_entries (
  id               TEXT PRIMARY KEY,
  employee_id      TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  job_id           TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  start_time       TEXT NOT NULL,
  end_time         TEXT,
  duration_seconds INTEGER,
  is_overtime      INTEGER NOT NULL DEFAULT 0,
  pause_reason     TEXT,
  session_id       TEXT,
  created_at       TEXT NOT NULL,
  is_demo          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS timer_sessions (
  id               TEXT PRIMARY KEY,
  job_id           TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  employee_id      TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  started_at       TEXT NOT NULL,
  paused_at        TEXT,
  stopped_at       TEXT,
  state            TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'paused', 'stopped', 'finalized')),
  is_overtime      INTEGER NOT NULL DEFAULT 0 CHECK (is_overtime IN (0, 1)),
  normal_seconds   INTEGER NOT NULL DEFAULT 0 CHECK (normal_seconds >= 0),
  overtime_seconds INTEGER NOT NULL DEFAULT 0 CHECK (overtime_seconds >= 0),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timer_intervals (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES timer_sessions(id) ON DELETE CASCADE,
  employee_id  TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('normal', 'overtime')),
  pause_reason TEXT
);

CREATE TABLE IF NOT EXISTS plate_history (
  id          TEXT PRIMARY KEY,
  car_id      TEXT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  license_plate TEXT NOT NULL,
  changed_at  TEXT NOT NULL,
  changed_by  TEXT REFERENCES employees(id) ON DELETE SET NULL,
  is_demo     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mileage_log (
  id          TEXT PRIMARY KEY,
  car_id      TEXT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  mileage     INTEGER NOT NULL CHECK (mileage >= 0),
  recorded_at TEXT NOT NULL,
  recorded_by TEXT REFERENCES employees(id) ON DELETE SET NULL,
  is_demo     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS car_photos (
  id          TEXT PRIMARY KEY,
  car_id      TEXT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  file_name   TEXT,
  mime_type   TEXT,
  size_bytes  INTEGER,
  created_at  TEXT NOT NULL,
  is_demo     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS employee_event_settings (
  employee_id      TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  work_start_mode  TEXT NOT NULL DEFAULT 'auto' CHECK (work_start_mode IN ('auto', 'manual')),
  break_start_mode TEXT NOT NULL DEFAULT 'auto' CHECK (break_start_mode IN ('auto', 'manual')),
  break_end_mode   TEXT NOT NULL DEFAULT 'auto' CHECK (break_end_mode IN ('auto', 'manual')),
  work_end_mode    TEXT NOT NULL DEFAULT 'auto' CHECK (work_end_mode IN ('auto', 'manual'))
);

CREATE TABLE IF NOT EXISTS session_event_log (
  id           TEXT PRIMARY KEY,
  employee_id  TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_date   TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  job_id       TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (employee_id, event_date, event_type, job_id)
);

CREATE TABLE IF NOT EXISTS devices (
  device_id       TEXT PRIMARY KEY,
  device_type     TEXT NOT NULL CHECK (device_type IN ('MAIN_PC', 'PC_COMPANION', 'TABLET', 'PHONE')),
  device_name     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paired', 'revoked')),
  credential_salt TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  api_version     TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  paired_at       TEXT,
  last_seen_at    TEXT,
  revoked_at      TEXT
);

CREATE TABLE IF NOT EXISTS local_service (
  service_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

`;

type SqliteColumn = { name: string };

function existingColumns(db: { prepare(sql: string): { all(): unknown[] } }, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as SqliteColumn[];
  return new Set(rows.map((row) => row.name));
}

function addColumnIfMissing(db: { prepare(sql: string): { all(): unknown[]; run(): unknown } }, table: string, column: string, definition: string): void {
  if (!existingColumns(db, table).has(column)) db.prepare(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`).run();
}

/** Evoluează bazele v2 existente fără să recreeze tabelele sau să piardă date. */
export function migrateSchema(db: { exec(sql: string): void; prepare(sql: string): { all(): unknown[]; run(...params: unknown[]): unknown } }): void {
  const columns: Record<string, Record<string, string>> = {
    employees: { is_demo: 'INTEGER NOT NULL DEFAULT 0', avatar_url: 'TEXT', access_code: 'TEXT' },
    cars: {
      internal_id: 'TEXT', client_email: 'TEXT', year: 'INTEGER', color: 'TEXT', vin: 'TEXT', mileage: 'INTEGER',
      body_observations: 'TEXT', photo_url: 'TEXT', fuel_level: 'TEXT', payment_status: 'TEXT', invoice_status: 'TEXT',
      financial_status: 'TEXT', is_demo: 'INTEGER NOT NULL DEFAULT 0', updated_at: 'TEXT',
    },
    jobs: { is_demo: 'INTEGER NOT NULL DEFAULT 0', updated_at: 'TEXT' },
    appointments: { client_phone: 'TEXT', internal_id: 'TEXT', vin: 'TEXT', is_demo: 'INTEGER NOT NULL DEFAULT 0', updated_at: 'TEXT' },
    work_schedule: {
      monday_active: 'INTEGER NOT NULL DEFAULT 1', monday_start: "TEXT NOT NULL DEFAULT '07:00'", monday_end: "TEXT NOT NULL DEFAULT '18:00'",
      tuesday_active: 'INTEGER NOT NULL DEFAULT 1', tuesday_start: "TEXT NOT NULL DEFAULT '07:00'", tuesday_end: "TEXT NOT NULL DEFAULT '18:00'",
      wednesday_active: 'INTEGER NOT NULL DEFAULT 1', wednesday_start: "TEXT NOT NULL DEFAULT '07:00'", wednesday_end: "TEXT NOT NULL DEFAULT '18:00'",
      thursday_active: 'INTEGER NOT NULL DEFAULT 1', thursday_start: "TEXT NOT NULL DEFAULT '07:00'", thursday_end: "TEXT NOT NULL DEFAULT '18:00'",
      friday_active: 'INTEGER NOT NULL DEFAULT 1', friday_start: "TEXT NOT NULL DEFAULT '07:00'", friday_end: "TEXT NOT NULL DEFAULT '18:00'",
      saturday_active: 'INTEGER NOT NULL DEFAULT 0', saturday_start: "TEXT NOT NULL DEFAULT '07:00'", saturday_end: "TEXT NOT NULL DEFAULT '18:00'",
      sunday_active: 'INTEGER NOT NULL DEFAULT 0', sunday_start: "TEXT NOT NULL DEFAULT '07:00'", sunday_end: "TEXT NOT NULL DEFAULT '18:00'", updated_at: 'TEXT',
    },
    themes: { scope: "TEXT NOT NULL DEFAULT 'employee'", is_builtin: 'INTEGER NOT NULL DEFAULT 0', is_custom: 'INTEGER NOT NULL DEFAULT 0', colors: 'TEXT', updated_at: 'TEXT' },
    activity_log: { employee_id: 'TEXT', job_id: 'TEXT', is_demo: 'INTEGER NOT NULL DEFAULT 0' },
    time_entries: { pause_reason: 'TEXT', session_id: 'TEXT', is_demo: 'INTEGER NOT NULL DEFAULT 0' },
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [table, tableColumns] of Object.entries(columns)) {
      for (const [column, definition] of Object.entries(tableColumns)) addColumnIfMissing(db, table, column, definition);
    }
    db.exec(`
      UPDATE work_schedule
      SET monday_active = active, monday_start = work_start, monday_end = work_end,
          tuesday_active = active, tuesday_start = work_start, tuesday_end = work_end,
          wednesday_active = active, wednesday_start = work_start, wednesday_end = work_end,
          thursday_active = active, thursday_start = work_start, thursday_end = work_end,
          friday_active = active, friday_start = work_start, friday_end = work_end
      WHERE monday_active = 1 AND tuesday_active = 1 AND wednesday_active = 1
        AND thursday_active = 1 AND friday_active = 1
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS timer_sessions (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL, paused_at TEXT, stopped_at TEXT,
        state TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'paused', 'stopped', 'finalized')),
        is_overtime INTEGER NOT NULL DEFAULT 0 CHECK (is_overtime IN (0, 1)),
        normal_seconds INTEGER NOT NULL DEFAULT 0 CHECK (normal_seconds >= 0),
        overtime_seconds INTEGER NOT NULL DEFAULT 0 CHECK (overtime_seconds >= 0),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS timer_intervals (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES timer_sessions(id) ON DELETE CASCADE,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL, ended_at TEXT, kind TEXT NOT NULL CHECK (kind IN ('normal', 'overtime')), pause_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS plate_history (id TEXT PRIMARY KEY, car_id TEXT NOT NULL REFERENCES cars(id) ON DELETE CASCADE, license_plate TEXT NOT NULL, changed_at TEXT NOT NULL, changed_by TEXT REFERENCES employees(id) ON DELETE SET NULL, is_demo INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS mileage_log (id TEXT PRIMARY KEY, car_id TEXT NOT NULL REFERENCES cars(id) ON DELETE CASCADE, mileage INTEGER NOT NULL CHECK (mileage >= 0), recorded_at TEXT NOT NULL, recorded_by TEXT REFERENCES employees(id) ON DELETE SET NULL, is_demo INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS car_photos (id TEXT PRIMARY KEY, car_id TEXT NOT NULL REFERENCES cars(id) ON DELETE CASCADE, storage_key TEXT NOT NULL, file_name TEXT, mime_type TEXT, size_bytes INTEGER, created_at TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS employee_event_settings (employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE, work_start_mode TEXT NOT NULL DEFAULT 'auto' CHECK (work_start_mode IN ('auto', 'manual')), break_start_mode TEXT NOT NULL DEFAULT 'auto' CHECK (break_start_mode IN ('auto', 'manual')), break_end_mode TEXT NOT NULL DEFAULT 'auto' CHECK (break_end_mode IN ('auto', 'manual')), work_end_mode TEXT NOT NULL DEFAULT 'auto' CHECK (work_end_mode IN ('auto', 'manual')));
      CREATE TABLE IF NOT EXISTS session_event_log (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE, event_date TEXT NOT NULL, event_type TEXT NOT NULL, job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL, created_at TEXT NOT NULL, UNIQUE (employee_id, event_date, event_type, job_id));
      CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, device_type TEXT NOT NULL CHECK (device_type IN ('MAIN_PC', 'PC_COMPANION', 'TABLET', 'PHONE')), device_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paired', 'revoked')), credential_salt TEXT NOT NULL, credential_hash TEXT NOT NULL, api_version TEXT NOT NULL, created_at TEXT NOT NULL, paired_at TEXT, last_seen_at TEXT, revoked_at TEXT);
      CREATE TABLE IF NOT EXISTS local_service (service_id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_timer_sessions_active_job ON timer_sessions(job_id) WHERE state IN ('running', 'paused');
      CREATE UNIQUE INDEX IF NOT EXISTS ux_timer_sessions_active_employee ON timer_sessions(employee_id) WHERE state IN ('running', 'paused');
      CREATE INDEX IF NOT EXISTS idx_timer_intervals_session ON timer_intervals(session_id);
      CREATE INDEX IF NOT EXISTS idx_time_entries_session ON time_entries(session_id);
      CREATE INDEX IF NOT EXISTS idx_activity_log_job ON activity_log(job_id);
      CREATE INDEX IF NOT EXISTS idx_activity_log_employee ON activity_log(employee_id);
      CREATE INDEX IF NOT EXISTS idx_plate_history_car ON plate_history(car_id);
      CREATE INDEX IF NOT EXISTS idx_mileage_log_car ON mileage_log(car_id);
      CREATE INDEX IF NOT EXISTS idx_car_photos_car ON car_photos(car_id);
      CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
    `);
    db.exec('PRAGMA user_version = 5;');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
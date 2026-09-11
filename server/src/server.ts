/**
 * SERVIX — Local Server (FAZA 3).
 *
 * API local MINIM, READ-ONLY, peste SQLite.
 *
 * Endpoint-uri:
 *   GET /api/health    — server pornit + SQLite conectat + versiune schema
 *   GET /api/cars      — mașinile din baza locală
 *   GET /api/employees — angajații din baza locală
 *   GET /api/jobs      — lucrările din baza locală
 *   GET /api/rates     — configurația de tarife (prima activă)
 *   GET /api/schedule  — programul de lucru (prima activă)
 *
 * Implicit ascultă pe 127.0.0.1 (localhost). NU expune secrete.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';


import { loadConfig } from './config.ts';
import { LOCAL_VERSION } from './compatibility.ts';
import { createDatabase } from './db.ts';
import { authenticateDevice, dispatchDeviceRequest } from './devices.ts';
import { eventForWrite, LocalEventBus } from './events.ts';
import { SCHEMA_VERSION } from './schema.ts';
import { dispatchWrite, readJsonBody } from './write.ts';
import { getTimerState, checkAutoSyncWindows } from './timer.ts';

const CORS_ALLOWED_ORIGINS = new Set(['http://127.0.0.1:5173', 'http://localhost:5173']);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function tableAll(db: DatabaseSync, table: string): unknown[] {
  // table provine dintr-un set fix (SCHEMA_TABLES), nu din input utilizator.
  return db.prepare(`SELECT * FROM "${table}" ORDER BY created_at DESC, id`).all() as unknown[];
}

/**
 * FAZA 8F — servire statică securizată pentru frontend-ul built (production).
 * Activă doar când `staticRoot` este configurat (nu există în development).
 * Protecție path traversal: calea rezolvată trebuie să rămână în interiorul root.
 */
const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

function safeStaticPath(staticRoot: string, urlPath: string): string | null {
  let relative: string;
  try {
    relative = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (relative.includes('\0') || relative.includes('..')) return null;
  const target = resolve(staticRoot, '.' + relative.replace(/\\/g, '/'));
  const root = resolve(staticRoot);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

function serveStaticFile(staticRoot: string, urlPath: string, res: ServerResponse): boolean {
  let filePath = safeStaticPath(staticRoot, urlPath);
  if (!filePath || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA fallback: rutele de client (ex. /admin) primesc index.html.
    filePath = join(staticRoot, 'index.html');
    if (!existsSync(filePath)) return false;
  }
  const mime = STATIC_MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': statSync(filePath).size,
    'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(filePath).pipe(res);
  return true;
}


function firstActiveRow(db: DatabaseSync, table: string): unknown {
  // table provine dintr-un set fix, nu din input utilizator.
  const rows = db.prepare(`SELECT * FROM "${table}" WHERE active = 1 ORDER BY created_at DESC, id LIMIT 1`).all() as unknown[];
  return rows[0] ?? null;
}

/** Rânduri ordonate alfabetic pe nume (themes, cataloage). */
function rowsByName(db: DatabaseSync, table: string, columns: string): unknown[] {
  return db.prepare(`SELECT ${columns} FROM "${table}" ORDER BY name ASC`).all() as unknown[];
}

const LOCAL_THEME_LIGHT = {
  '--primary': '#6D35F2', '--primary-hover': '#7C4DFF', '--secondary': '#7C4DFF', '--accent': '#7C4DFF',
  '--background': '#F6F7FB', '--surface': '#FFFFFF', '--surface-secondary': '#FFFFFF', '--sidebar': '#FFFFFF', '--card': '#FFFFFF',
  '--button': '#6D35F2', '--text-primary': '#171A24', '--text-secondary': '#687083', '--text-muted': '#8B93A3',
  '--border': '#E5E7EF', '--success': '#22A05A', '--warning': '#F97316', '--danger': '#EF233C', '--info': '#3B82F6',
};
const LOCAL_THEME_DARK = {
  '--primary': '#6D35F2', '--primary-hover': '#7C4DFF', '--secondary': '#A78BFA', '--accent': '#6D35F2',
  '--background': '#0B0F17', '--surface': '#131B27', '--surface-secondary': '#1A2333', '--sidebar': '#0E1420', '--card': '#131B27',
  '--button': '#6D35F2', '--text-primary': '#F7F9FC', '--text-secondary': '#B7C0D1', '--text-muted': '#8B95A8',
  '--border': '#2B3547', '--success': '#34D399', '--warning': '#FBBF24', '--danger': '#F87171', '--info': '#60A5FA',
};

function localThemes(db: DatabaseSync): unknown[] {
  return rowsByName(db, 'themes', '*').map((value) => {
    const theme = value as Record<string, unknown>;
    let colors: Record<string, string> | null = null;
    try {
      const parsed = typeof theme.colors === 'string' ? JSON.parse(theme.colors) : theme.colors;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) colors = parsed as Record<string, string>;
    } catch { /* invalid legacy JSON falls back to the configured mode */ }
    const config = typeof theme.config === 'string' ? theme.config : '';
    return {
      ...theme,
      scope: theme.scope === 'admin' ? 'admin' : 'employee',
      is_builtin: Number(theme.is_builtin) === 1,
      is_custom: Number(theme.is_custom) === 1,
      colors: colors ?? (config.includes('"dark"') ? LOCAL_THEME_DARK : LOCAL_THEME_LIGHT),
    };
  });
}

/** FAZA 5 — activity_log filtrat pe carId, ordonat cronologic (ca în SupabaseDataAdapter). */
function activityLogForCar(db: DatabaseSync, carId: string): unknown[] {
  return db
    .prepare('SELECT id, action, detail, created_at, employee_id, job_id FROM activity_log WHERE car_id = ? ORDER BY created_at ASC')
    .all(carId) as unknown[];
}

/**
 * activity_log pentru TOATE mașinile, filtrat pe fereastra [fromIso, toIso]
 * (created_at), ordonat cronologic — sursă reală pentru reconstruirea
 * sesiunilor PORNIRE/OPRIRE (src/lib/sessionPairing.ts), echivalentul
 * getActivityLogRange din SupabaseDataAdapter.
 */
function activityLogRange(db: DatabaseSync, fromIso: string, toIso: string): unknown[] {
  return db
    .prepare('SELECT id, action, detail, created_at, employee_id, job_id, car_id FROM activity_log WHERE created_at >= ? AND created_at <= ? ORDER BY created_at ASC')
    .all(fromIso, toIso) as unknown[];
}

/**
 * FAZA 5 — time_entries + jobs!inner(car_id), echivalentul query-ului din
 * SupabaseDataAdapter: start_time între [fromIso, toIso] + employeeId opțional.
 * is_overtime este mapat din 0/1 la boolean, forma așteptată de UI.
 */
interface TimeEntryRow {
  employee_id: string;
  job_id: string;
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  is_overtime: number;
}
function timeEntries(db: DatabaseSync, fromIso: string, toIso: string, employeeId: string | null): unknown[] {
  let sql = 'SELECT te.employee_id, te.job_id, te.start_time, te.end_time, te.duration_seconds, te.is_overtime, j.car_id AS job_car_id FROM time_entries te INNER JOIN jobs j ON j.id = te.job_id WHERE te.start_time >= ? AND te.start_time <= ?';
  const params: (string)[] = [fromIso, toIso];
  if (employeeId) {
    sql += ' AND te.employee_id = ?';
    params.push(employeeId);
  }
  const rows = db.prepare(sql).all(...params) as unknown as Array<TimeEntryRow & { job_car_id: string }>;
  return rows.map((r) => ({
    employee_id: r.employee_id,
    job_id: r.job_id,
    start_time: r.start_time,
    end_time: r.end_time,
    duration_seconds: r.duration_seconds,
    is_overtime: r.is_overtime === 1,
    jobs: { car_id: r.job_car_id },
  }));
}

export interface LocalServerOptions {
  lanEnabled?: boolean;
  lanAddress?: string | null;
  eventBus?: LocalEventBus;
  /** FAZA 8F — root-ul frontend-ului built servit static (production only). */
  staticRoot?: string | null;
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function createApp(db: DatabaseSync, startedAt = new Date(), options: LocalServerOptions = {}) {
  const eventBus = options.eventBus ?? new LocalEventBus();
  const staticRoot = options.staticRoot ?? null;
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const origin = req.headers.origin;
    if (origin && CORS_ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
      res.setHeader('Vary', 'Origin');
    }

    // FAZA 8F — static frontend (production). Doar GET, în afara /api.
    if (staticRoot && method === 'GET' && !path.startsWith('/api')) {
      if (serveStaticFile(staticRoot, url.pathname, res)) return;
    }

    if (method === 'OPTIONS') {
      if (!origin || !CORS_ALLOWED_ORIGINS.has(origin)) {
        sendJson(res, 403, { ok: false, error: 'Origin not allowed' });
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === 'GET' && path === '/api/events') {
      if (options.lanEnabled && !isLoopbackRequest(req)) {
        const auth = authenticateDevice(db, req);
        if (auth) { sendJson(res, auth.status, auth.payload); return; }
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no-store',
      });
      res.write(': servix-events-connected\n\n');
      const subscription = eventBus.subscribe(res);
      req.on('close', () => subscription.close());
      return;
    }

    const deviceOutcome = await dispatchDeviceRequest(db, method, path, req, { lanEnabled: options.lanEnabled === true, lanAddress: options.lanAddress ?? null });
    if (deviceOutcome) {
      if (deviceOutcome.status >= 200 && deviceOutcome.status < 300 && path.startsWith('/api/devices/')) eventBus.publish('device.updated', 'device', null);
      sendJson(res, deviceOutcome.status, deviceOutcome.payload);
      return;
    }

    if (options.lanEnabled && !isLoopbackRequest(req) && path !== '/api/health' && path !== '/api/version') {
      const auth = authenticateDevice(db, req);
      if (auth) {
        sendJson(res, auth.status, auth.payload);
        return;
      }
    }

    if (method === 'POST' && path === '/api/inactivity/observe') {
      const parsed = await readJsonBody(req);
      if (parsed.error) { sendJson(res, parsed.error.status, parsed.error.payload); return; }
      const body = parsed.body ?? {};
      const employeeIds = Array.isArray(body.employee_ids) ? body.employee_ids.filter((id): id is string => typeof id === 'string') : [];
      const observedAt = typeof body.observed_at === 'string' ? body.observed_at : new Date().toISOString();
      try {
        sendJson(res, 200, { ok: true, ...inactivityNotifications(db, employeeIds, observedAt) });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Invalid inactivity observation.' });
      }
      return;
    }

    if (method === 'PATCH' && /^\/api\/inactivity\/notifications\/[^/]+$/.test(path)) {
      const notificationId = decodeURIComponent(path.split('/').pop() ?? '');
      db.prepare('UPDATE employee_inactivity_notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?').run(new Date().toISOString(), notificationId);
      const notification = db.prepare('SELECT * FROM employee_inactivity_notifications WHERE id = ?').get(notificationId);
      if (!notification) { sendJson(res, 404, { ok: false, error: 'Notification not found.' }); return; }
      sendJson(res, 200, { ok: true, notification });
      return;
    }

    // FAZA 7A — WRITE local (POST create / PATCH update), validat pe server.
    const localAppointmentDelete = method === 'DELETE' && /^\/api\/appointments\/[^/?]+$/.test(req.url ?? '');
    if (method === 'POST' || method === 'PATCH' || localAppointmentDelete) {
      const outcome = await dispatchWrite(db, method, req.url ?? '/', req);
      const event = outcome.status >= 200 && outcome.status < 300 ? eventForWrite(method, path, outcome.payload) : null;
      if (event) eventBus.publish(event.type, event.entity, event.entityId);
      sendJson(res, outcome.status, outcome.payload);
      return;
    }

    if (method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      return;
    }
    const timerMatch = /^\/api\/timer\/([^/]+)$/.exec(path);
    if (timerMatch) {
      const timerState = getTimerState(db, decodeURIComponent(timerMatch[1]));
      sendJson(res, timerState.status, timerState.payload);
      return;
    }

    switch (path) {
      case '/':
      case '/api':
        sendJson(res, 200, {
          name: 'SERVIX Local Server',
          endpoints: ['/api/health', '/api/version', '/api/cars', '/api/employees', '/api/jobs', '/api/rates', '/api/schedule',
            '/api/themes', '/api/appointments', '/api/vehicle-makes', '/api/vehicle-models', '/api/work-catalog',
            '/api/activity-log?carId=', '/api/time-entries?fromIso=&toIso=&employeeId=', '/api/activity-log-range?fromIso=&toIso='],
        });
        return;

      case '/api/health':
        sendJson(res, 200, {
          ok: true,
          status: 'ok',
          sqlite: 'connected',
          schemaVersion: SCHEMA_VERSION,
          server: 'servix-local',
          serverVersion: LOCAL_VERSION.serverVersion,
          apiVersion: LOCAL_VERSION.apiVersion,
          startedAt: startedAt.toISOString(),
          uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)),
          timestamp: new Date().toISOString(),
        });
        return;

      case '/api/version':
        sendJson(res, 200, { ...LOCAL_VERSION, currentSchemaVersion: SCHEMA_VERSION, targetSchemaVersion: SCHEMA_VERSION });
        return;

      case '/api/cars':
        sendJson(res, 200, { count: tableAll(db, 'cars').length, cars: tableAll(db, 'cars') });
        return;

      case '/api/employees':
        sendJson(res, 200, {
          count: tableAll(db, 'employees').length,
          employees: tableAll(db, 'employees'),
        });
        return;

      case '/api/jobs':
        sendJson(res, 200, { count: tableAll(db, 'jobs').length, jobs: tableAll(db, 'jobs') });
        return;

      case '/api/rates':
        sendJson(res, 200, { rates: firstActiveRow(db, 'rates') });
        return;

      case '/api/schedule':
        sendJson(res, 200, { schedule: firstActiveRow(db, 'work_schedule') });
        return;

      // ===== FAZA 5 — READ extins =====
      case '/api/themes':
        {
          const themes = localThemes(db);
          sendJson(res, 200, { count: themes.length, themes });
        }
        return;

      case '/api/appointments': {
        const rows = db
          .prepare('SELECT * FROM appointments ORDER BY appointment_date ASC, appointment_time ASC')
          .all() as unknown[];
        sendJson(res, 200, { count: rows.length, appointments: rows });
        return;
      }

      case '/api/vehicle-makes':
        sendJson(res, 200, {
          count: rowsByName(db, 'vehicle_makes', 'id, name, normalized_name').length,
          makes: rowsByName(db, 'vehicle_makes', 'id, name, normalized_name'),
        });
        return;

      case '/api/vehicle-models':
        sendJson(res, 200, {
          count: rowsByName(db, 'vehicle_models', 'id, make_id, name, normalized_name').length,
          models: rowsByName(db, 'vehicle_models', 'id, make_id, name, normalized_name'),
        });
        return;

      case '/api/work-catalog':
        sendJson(res, 200, {
          count: rowsByName(db, 'work_catalog', 'id, name, normalized_name').length,
          catalog: rowsByName(db, 'work_catalog', 'id, name, normalized_name'),
        });
        return;

      case '/api/activity-log': {
        const carId = url.searchParams.get('carId') ?? '';
        if (!carId) {
          // Fără carId — respectăm contractul adapter-ului: filtrarea e obligatorie.
          sendJson(res, 400, { ok: false, error: 'Parametrul carId este obligatoriu.' });
          return;
        }
        const entries = activityLogForCar(db, carId);
        sendJson(res, 200, { count: entries.length, entries });
        return;
      }

      case '/api/time-entries': {
        const fromIso = url.searchParams.get('fromIso') ?? '';
        const toIso = url.searchParams.get('toIso') ?? '';
        if (!fromIso || !toIso) {
          sendJson(res, 400, { ok: false, error: 'Parametrii fromIso si toIso sunt obligatorii.' });
          return;
        }
        const employeeId = url.searchParams.get('employeeId');
        const entries = timeEntries(db, fromIso, toIso, employeeId);
        sendJson(res, 200, { count: entries.length, entries });
        return;
      }

      case '/api/activity-log-range': {
        const fromIso = url.searchParams.get('fromIso') ?? '';
        const toIso = url.searchParams.get('toIso') ?? '';
        if (!fromIso || !toIso) {
          sendJson(res, 400, { ok: false, error: 'Parametrii fromIso si toIso sunt obligatorii.' });
          return;
        }
        const entries = activityLogRange(db, fromIso, toIso);
        sendJson(res, 200, { count: entries.length, entries });
        return;
      }

      case '/api/inactivity-notifications': {
        const unreadOnly = url.searchParams.get('unreadOnly') !== 'false';
        const notifications = listInactivityNotifications(db, unreadOnly);
        sendJson(res, 200, { count: notifications.length, notifications });
        return;
      }

      default:
        sendJson(res, 404, { ok: false, error: 'Not Found' });
        return;
    }
  };
}

/** Detectează dacă fișierul a fost rulat direct ca entry point. */
function isMain(): boolean {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  const config = loadConfig();
  const appDb = createDatabase(config.dbPath, { seed: config.seedDemo });
  const startedAt = new Date();
  const server = createHttpServer(createApp(appDb.db, startedAt, { lanEnabled: config.lanEnabled, lanAddress: config.lanAddress, staticRoot: config.staticDir }));

  server.listen(config.port, config.host, () => {
    // eslint-disable-next-line no-console
    console.log(`[SERVIX-LOCAL] Server listening on http://${config.host}:${config.port}`);
    // eslint-disable-next-line no-console
    console.log(`[SERVIX-LOCAL] SQLite DB: ${appDb.dbPath}`);
    if (config.staticDir) {
      // eslint-disable-next-line no-console
      console.log(`[SERVIX-LOCAL] Static frontend: ${config.staticDir}`);
    }
    
    // Check for any active sessions that crossed auto-sync windows during downtime.
    checkAutoSyncWindows(appDb.db, Date.now());
  });

  // Reconcile the deterministic Bucharest schedule while the Local Server runs.
  const autoSyncTimer = setInterval(() => checkAutoSyncWindows(appDb.db, Date.now()), 60_000);

  const shutdown = (): void => {
    clearInterval(autoSyncTimer);
    server.close(() => {
      appDb.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const INACTIVITY_THRESHOLDS_MINUTES = [10, 20, 30] as const;

function inactivityNotifications(db: DatabaseSync, employeeIds: string[], observedAt: string): { created: unknown[]; unread: unknown[] } {
  const observedMs = new Date(observedAt).getTime();
  if (!Number.isFinite(observedMs)) throw new Error('observed_at invalid');
  const eligible = new Set(employeeIds.filter((id) => typeof id === 'string' && id.trim()));
  const created: unknown[] = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    const openPeriods = db.prepare('SELECT id, employee_id FROM employee_inactivity_periods WHERE ended_at IS NULL').all() as Array<{ id: string; employee_id: string }>;
    for (const period of openPeriods) {
      if (!eligible.has(period.employee_id)) db.prepare('UPDATE employee_inactivity_periods SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(observedAt, period.id);
    }
    for (const employeeId of eligible) {
      let period = db.prepare('SELECT id, started_at FROM employee_inactivity_periods WHERE employee_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get(employeeId) as { id: string; started_at: string } | undefined;
      if (!period) {
        const id = randomUUID();
        db.prepare('INSERT INTO employee_inactivity_periods (id, employee_id, started_at, created_at) VALUES (?, ?, ?, ?)').run(id, employeeId, observedAt, observedAt);
        period = { id, started_at: observedAt };
      }
      const elapsedMinutes = Math.floor((observedMs - new Date(period.started_at).getTime()) / 60000);
      if (elapsedMinutes < 0) continue;
      for (const threshold of INACTIVITY_THRESHOLDS_MINUTES) {
        if (elapsedMinutes < threshold) continue;
        const notificationId = randomUUID();
        const result = db.prepare(`
          INSERT INTO employee_inactivity_notifications (id, employee_id, period_id, threshold_minutes, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (period_id, threshold_minutes) DO NOTHING
        `).run(notificationId, employeeId, period.id, threshold, observedAt);
        if (Number(result.changes) > 0) {
          created.push(db.prepare('SELECT * FROM employee_inactivity_notifications WHERE id = ?').get(notificationId));
        }
      }
    }
    const unread = db.prepare('SELECT * FROM employee_inactivity_notifications WHERE read_at IS NULL ORDER BY created_at DESC').all();
    db.exec('COMMIT');
    return { created, unread };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function listInactivityNotifications(db: DatabaseSync, unreadOnly: boolean): unknown[] {
  return db.prepare(`SELECT * FROM employee_inactivity_notifications ${unreadOnly ? 'WHERE read_at IS NULL' : ''} ORDER BY created_at DESC`).all();
}
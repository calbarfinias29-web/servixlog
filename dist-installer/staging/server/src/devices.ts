import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';

import { SERVIX_API_VERSION } from '../../src/version.ts';
import { readJsonBody } from './write.ts';

const DEVICE_TYPES = new Set(['MAIN_PC', 'PC_COMPANION', 'TABLET', 'PHONE']);

type DeviceStatus = 'pending' | 'paired' | 'revoked';
type DeviceRow = {
  device_id: string;
  device_type: string;
  device_name: string;
  status: DeviceStatus;
  credential_salt: string;
  credential_hash: string;
  api_version: string;
  created_at: string;
  paired_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export interface DeviceOutcome {
  status: number;
  payload: unknown;
}

export interface PairingServerConfiguration {
  lanEnabled: boolean;
  lanAddress: string | null;
}

function now(): string {
  return new Date().toISOString();
}

function error(status: number, code: string, message: string): DeviceOutcome {
  return { status, payload: { ok: false, error: code, message } };
}

function publicDevice(device: DeviceRow): Record<string, unknown> {
  return {
    deviceId: device.device_id,
    deviceType: device.device_type,
    deviceName: device.device_name,
    status: device.status,
    apiVersion: device.api_version,
    createdAt: device.created_at,
    pairedAt: device.paired_at,
    lastSeenAt: device.last_seen_at,
    revokedAt: device.revoked_at,
  };
}

function hashCredential(salt: string, credential: string): string {
  return createHash('sha256').update(`${salt}:${credential}`, 'utf8').digest('hex');
}

function credentialMatches(device: DeviceRow, credential: string): boolean {
  const expected = Buffer.from(device.credential_hash, 'hex');
  const actual = Buffer.from(hashCredential(device.credential_salt, credential), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function findDevice(db: DatabaseSync, deviceId: string): DeviceRow | null {
  return (db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId) as DeviceRow | undefined) ?? null;
}

function serviceId(db: DatabaseSync): string {
  const existing = db.prepare('SELECT service_id FROM local_service LIMIT 1').get() as { service_id: string } | undefined;
  if (existing) return existing.service_id;
  const id = randomUUID();
  db.prepare('INSERT INTO local_service (service_id, created_at) VALUES (?, ?)').run(id, now());
  return id;
}

export function authenticateDevice(db: DatabaseSync, req: IncomingMessage): DeviceOutcome | null {
  const deviceId = header(req, 'x-servix-device-id');
  const credential = header(req, 'x-servix-device-credential');
  if (!deviceId || !credential) return error(401, 'DEVICE_CREDENTIAL_REQUIRED', 'Este necesar credentialul dispozitivului.');
  const device = findDevice(db, deviceId);
  if (!device || !credentialMatches(device, credential)) return error(401, 'DEVICE_CREDENTIAL_INVALID', 'Credentialul dispozitivului nu este valid.');
  if (device.status === 'revoked') return error(403, 'DEVICE_REVOKED', 'Dispozitivul a fost revocat.');
  if (device.status !== 'paired') return error(403, 'DEVICE_NOT_PAIRED', 'Dispozitivul nu este încă împerecheat.');
  return null;
}

/** Device-management endpoints are intentionally restricted to the Main PC loopback interface. */
export async function dispatchDeviceRequest(db: DatabaseSync, method: string, path: string, req: IncomingMessage, configuration: PairingServerConfiguration = { lanEnabled: false, lanAddress: null }): Promise<DeviceOutcome | null> {
  const isDevicePath = path === '/api/devices' || path.startsWith('/api/devices/');
  if (!isDevicePath) return null;

  if (method === 'GET' && path === '/api/devices') {
    if (!isLoopbackRequest(req)) return error(403, 'LOCAL_ADMIN_REQUIRED', 'Administrarea dispozitivelor este disponibilă doar pe PC-ul principal.');
    const devices = db.prepare('SELECT * FROM devices ORDER BY created_at ASC').all() as DeviceRow[];
    return { status: 200, payload: { ok: true, devices: devices.map(publicDevice) } };
  }

  if (method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', 'Metoda nu este permisă.');
  const parsed = await readJsonBody(req);
  if (parsed.error) return parsed.error;
  const body = parsed.body!;

  if (path === '/api/devices/pair') {
    if (!isLoopbackRequest(req)) return error(403, 'LOCAL_ADMIN_REQUIRED', 'Inițierea pairing-ului este disponibilă doar pe PC-ul principal.');
    const deviceType = typeof body.deviceType === 'string' ? body.deviceType : '';
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim() : '';
    if (!DEVICE_TYPES.has(deviceType) || !deviceName) return error(422, 'INVALID_DEVICE', 'deviceType și deviceName valide sunt obligatorii.');
    const deviceId = randomUUID();
    const credential = randomBytes(32).toString('base64url');
    const salt = randomBytes(16).toString('hex');
    const createdAt = now();
    db.prepare('INSERT INTO devices (device_id, device_type, device_name, status, credential_salt, credential_hash, api_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(deviceId, deviceType, deviceName, 'pending', salt, hashCredential(salt, credential), SERVIX_API_VERSION, createdAt);
    const device = findDevice(db, deviceId)!;
    return {
      status: 201,
      payload: {
        ok: true,
        device: publicDevice(device),
        credential,
        pairing: { serviceId: serviceId(db), serverAddress: configuration.lanEnabled ? configuration.lanAddress : null, apiVersion: SERVIX_API_VERSION },
      },
    };
  }

  if (path === '/api/devices/pair/confirm') {
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
    const credential = typeof body.credential === 'string' ? body.credential : '';
    const device = findDevice(db, deviceId);
    if (!device || !credential || !credentialMatches(device, credential)) return error(401, 'DEVICE_CREDENTIAL_INVALID', 'Credentialul dispozitivului nu este valid.');
    if (device.status === 'revoked') return error(403, 'DEVICE_REVOKED', 'Dispozitivul a fost revocat.');
    const pairedAt = now();
    db.prepare("UPDATE devices SET status = 'paired', paired_at = COALESCE(paired_at, ?), last_seen_at = ? WHERE device_id = ?").run(pairedAt, pairedAt, deviceId);
    return { status: 200, payload: { ok: true, device: publicDevice(findDevice(db, deviceId)!) } };
  }

  if (path === '/api/devices/heartbeat') {
    const auth = authenticateDevice(db, req);
    if (auth) return auth;
    const deviceId = header(req, 'x-servix-device-id')!;
    db.prepare('UPDATE devices SET last_seen_at = ? WHERE device_id = ?').run(now(), deviceId);
    return { status: 200, payload: { ok: true, device: publicDevice(findDevice(db, deviceId)!) } };
  }

  if (path === '/api/devices/revoke' || path === '/api/devices/reactivate') {
    if (!isLoopbackRequest(req)) return error(403, 'LOCAL_ADMIN_REQUIRED', 'Administrarea dispozitivelor este disponibilă doar pe PC-ul principal.');
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
    const device = findDevice(db, deviceId);
    if (!device) return error(404, 'DEVICE_NOT_FOUND', 'Dispozitivul nu există.');
    if (path.endsWith('/revoke')) {
      db.prepare("UPDATE devices SET status = 'revoked', revoked_at = ? WHERE device_id = ?").run(now(), deviceId);
      return { status: 200, payload: { ok: true, device: publicDevice(findDevice(db, deviceId)!) } };
    }
    const credential = randomBytes(32).toString('base64url');
    const salt = randomBytes(16).toString('hex');
    const pairedAt = now();
    db.prepare("UPDATE devices SET status = 'pending', credential_salt = ?, credential_hash = ?, paired_at = NULL, last_seen_at = NULL, revoked_at = NULL WHERE device_id = ?")
      .run(salt, hashCredential(salt, credential), deviceId);
    return {
      status: 200,
      payload: {
        ok: true,
        device: publicDevice(findDevice(db, deviceId)!),
        credential,
        issuedAt: pairedAt,
        pairing: { serviceId: serviceId(db), serverAddress: configuration.lanEnabled ? configuration.lanAddress : null, apiVersion: SERVIX_API_VERSION },
      },
    };
  }

  return error(404, 'NOT_FOUND', 'Endpoint dispozitiv inexistent.');
}

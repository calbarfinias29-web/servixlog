/**
 * SERVIX Angajat — Gate dispozitiv (logică PUR, fără React).
 *
 * Conectarea dispozitivului (Angajat Local Client):
 *   1. Admin (PC principal, loopback) generează QR / cod de bare cu payload-ul
 *      canonic `servix-pairing/v1` (src/devicePairing.ts).
 *   2. Dispozitivul Angajat scanează/introduce payload-ul → aici îl parsează
 *      (REUTILIZARE parsePairingPayload), confirmă pairing-ul pe serverul din
 *      payload (POST /api/devices/pair/confirm — endpoint deja existent) și
 *      salvează asocierea LOCAL (localStorage-ul dispozitivului).
 *   3. La următoarea pornire: asocierea salvată este verificată cu heartbeat
 *      (POST /api/devices/heartbeat — endpoint existent):
 *        - 200          → reconectare automată, fără QR;
 *        - 401 / 403    → asocierea NU mai e validă (revocată/invalidă) →
 *                         asocierea locală este ștearsă → înapoi la ecranul
 *                         „Conectează dispozitivul”;
 *        - server indisponibil → asocierea rămâne salvată (reconectare mai târziu).
 *
 * Zero dependențe: fetch + storage sunt injectate (testabile determinist).
 * NU schimbă Web/Supabase și NU schimbă comportamentul Admin-ului.
 */
import { parsePairingPayload, type DevicePairingEnvelope } from '../devicePairing.ts';

/** Headers prin care dispozitivul pared se autentifică pe Local Server (FAZA 8C). */
export const DEVICE_ID_HEADER = 'x-servix-device-id';
export const DEVICE_CREDENTIAL_HEADER = 'x-servix-device-credential';

/** Cheia localStorage pe dispozitivul Angajat (persistența asocierii). */
export const ANGAJAT_PAIRING_STORAGE_KEY = 'servix_angajat_device';

/** Asocierea salvată local pe dispozitiv. */
export interface SavedAngajatPairing {
  deviceId: string;
  credential: string;
  serverAddress: string;
  serviceId: string;
  deviceName: string;
  pairedAt: string;
}

/** Rezultatul unei încercări de conectare prin QR / cod de bare / cod manual. */
export type PairingAttempt =
  | { kind: 'PAIRED'; saved: SavedAngajatPairing }
  | { kind: 'INVALID_PAYLOAD' }
  | { kind: 'NO_SERVER_ADDRESS' }
  | { kind: 'REVOKED' }
  | { kind: 'CREDENTIAL_INVALID' }
  | { kind: 'SERVER_UNREACHABLE'; message: string };

/** Rezultatul verificării asocierii salvate (la pornirea aplicației). */
export type PairingVerification =
  | { kind: 'PAIRED' }
  | { kind: 'REVOKED' }
  | { kind: 'SERVER_UNREACHABLE'; message: string };

export interface AngajatStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type FetchLike = typeof fetch;

function isSavedPairing(value: unknown): value is SavedAngajatPairing {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.deviceId === 'string' && v.deviceId.length > 0
    && typeof v.credential === 'string' && v.credential.length > 0
    && typeof v.serverAddress === 'string' && v.serverAddress.length > 0
    && typeof v.serviceId === 'string'
    && typeof v.deviceName === 'string'
    && typeof v.pairedAt === 'string';
}

/** Citește asocierea salvată; null = dispozitiv neperecheat (ecranul de conectare). */
export function loadAngajatPairing(storage: AngajatStorage): SavedAngajatPairing | null {
  try {
    const raw = storage.getItem(ANGAJAT_PAIRING_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSavedPairing(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Salvează asocierea local pe dispozitiv (persistă și după repornire). */
export function saveAngajatPairing(storage: AngajatStorage, saved: SavedAngajatPairing): void {
  storage.setItem(ANGAJAT_PAIRING_STORAGE_KEY, JSON.stringify(saved));
}

/** Șterge asocierea locală (după revocare/invalidare — reapare ecranul de conectare). */
export function clearAngajatPairing(storage: AngajatStorage): void {
  storage.removeItem(ANGAJAT_PAIRING_STORAGE_KEY);
}

/** Headers de autentificare pentru un dispozitiv pared (folosite pe apelurile de date). */
export function deviceAuthHeaders(saved: Pick<SavedAngajatPairing, 'deviceId' | 'credential'>): Record<string, string> {
  return { [DEVICE_ID_HEADER]: saved.deviceId, [DEVICE_CREDENTIAL_HEADER]: saved.credential };
}

/**
 * Conectează dispozitivul dintr-un payload scanat (QR / cod de bare / introdus manual).
 * Reutilizează endpoint-ul EXISTENT `/api/devices/pair/confirm` — nu adaugă API nou.
 */
export async function pairAngajatDevice(payloadText: string, fetchImpl: FetchLike): Promise<PairingAttempt> {
  const payload: DevicePairingEnvelope | null = parsePairingPayload(payloadText.trim());
  if (!payload) return { kind: 'INVALID_PAYLOAD' };
  if (!payload.serverAddress) {
    // SERVIX_LAN_ENABLED=false pe server → QR-ul nu conține adresă LAN accesibilă.
    return { kind: 'NO_SERVER_ADDRESS' };
  }
  const base = payload.serverAddress.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetchImpl(`${base}/api/devices/pair/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ deviceId: payload.deviceId, credential: payload.credential }),
    });
  } catch (err) {
    return { kind: 'SERVER_UNREACHABLE', message: err instanceof Error ? err.message : String(err) };
  }
  if (res.status === 403) return { kind: 'REVOKED' };
  if (res.status === 401 || !res.ok) return { kind: 'CREDENTIAL_INVALID' };
  const confirmedBody = await res.json().catch(() => null) as { device?: { deviceName?: string; pairedAt?: string } } | null;
  const saved: SavedAngajatPairing = {
    deviceId: payload.deviceId,
    credential: payload.credential,
    serverAddress: base,
    serviceId: payload.serviceId,
    deviceName: confirmedBody?.device?.deviceName ?? 'Dispozitiv SERVIX',
    pairedAt: confirmedBody?.device?.pairedAt ?? new Date().toISOString(),
  };
  return { kind: 'PAIRED', saved };
}

/**
 * Verifică asocierea salvată la pornire, prin heartbeat (endpoint existent).
 * REVOKED = asocierea nu mai e validă → apelantul o șterge și afișează ecranul
 * de conectare. SERVER_UNREACHABLE = asocierea RĂMÂNE salvată (reconectare mai târziu).
 */
export async function verifyAngajatPairing(saved: SavedAngajatPairing, fetchImpl: FetchLike): Promise<PairingVerification> {
  const base = saved.serverAddress.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetchImpl(`${base}/api/devices/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...deviceAuthHeaders(saved) },
      body: JSON.stringify({}),
    });
  } catch (err) {
    return { kind: 'SERVER_UNREACHABLE', message: err instanceof Error ? err.message : String(err) };
  }
  if (res.status === 401 || res.status === 403) return { kind: 'REVOKED' };
  if (!res.ok) return { kind: 'SERVER_UNREACHABLE', message: `Heartbeat HTTP ${res.status}` };
  return { kind: 'PAIRED' };
}

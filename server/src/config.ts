/**
 * SERVIX — Local Server configuration (FAZA 3).
 *
 * Totul este configurabil prin variabile de mediu, cu valori implicite
 * sigure: serverul ascultă pe localhost (NU pe LAN) și folosește un fișier
 * SQLite dedicat în server/data/.
 */
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

export interface ServerConfig {
  /** Host pe care ascultă serverul. Implicit: 127.0.0.1 (doar localhost). */
  host: string;
  /** Port. Implicit: 8787. */
  port: number;
  /** Calea fișierului SQLite local. Implicit: {PROJECT}/server/data/servix-local.db */
  dbPath: string;
  /** Dacă se inserează datele DEMO de test la inițializare. Implicit: true. */
  seedDemo: boolean;
  /** LAN access is opt-in; false keeps all data endpoints local-only. */
  lanEnabled: boolean;
  /** Reachable LAN URL advertised in pairing payloads only when LAN is enabled. */
  lanAddress: string | null;
  /**
   * FAZA 8F — directorul cu frontend-ul built servit static de Local Server
   * (production). Null în development: frontend-ul rămâne pe Vite dev server.
   */
  staticDir: string | null;
}

/** Calea absolută implicită a bazei SQLite (independentă de cwd). */
export function defaultDbPath(): string {
  return fileURLToPath(new URL('../data/servix-local.db', import.meta.url));
}

/**
 * FAZA 8F — detectează frontend-ul built (`app/frontend`) lângă instalarea
 * serverului. În development acest director nu există, deci se returnează null
 * și comportamentul rămâne identic (doar API, fără servire statică).
 */
export function defaultStaticDir(): string | null {
  const candidate = fileURLToPath(new URL('../../frontend', import.meta.url));
  return existsSync(candidate) ? candidate : null;
}


export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const portRaw = Number(env.SERVIX_PORT ?? 8787);
  const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw < 65536 ? portRaw : 8787;
  const lanEnabled = String(env.SERVIX_LAN_ENABLED ?? 'false').toLowerCase() === 'true';
  return {
    host: env.SERVIX_HOST ?? (lanEnabled ? '0.0.0.0' : '127.0.0.1'),
    port,
    dbPath: env.SERVIX_DB_PATH ? String(env.SERVIX_DB_PATH) : defaultDbPath(),
    seedDemo: String(env.SERVIX_SEED ?? 'true') !== 'false',
    lanEnabled,
    lanAddress: lanEnabled && env.SERVIX_LAN_ADDRESS ? String(env.SERVIX_LAN_ADDRESS).replace(/\/+$/, '') : null,
    staticDir: env.SERVIX_STATIC_DIR ? String(env.SERVIX_STATIC_DIR) : defaultStaticDir(),
  };
}
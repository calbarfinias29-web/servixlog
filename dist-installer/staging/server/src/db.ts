/**
 * SERVIX — Local Database (SQLite) (FAZA 3).
 *
 * Deschide/crează baza SQLite locală (fișier configurabil), aplică schema
 * și opțional inserează datele DEMO. Închide corect conexiunea.
 *
 * Folosește modulul nativ node:sqlite — zero dependențe externe.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createDatabaseBackup } from './backup.ts';
import { migrateSchema, SCHEMA_VERSION, SCHEMA_SQL } from './schema.ts';
import { seedIfEmpty } from './seed.ts';

export interface AppDatabase {
  db: DatabaseSync;
  dbPath: string;
  schemaVersion: number;
  close: () => void;
}

export function createDatabase(dbPath: string, opts: { seed?: boolean } = {}): AppDatabase {
  const existedBeforeOpen = existsSync(dbPath);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  // Integritate + performanță locală.
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  const currentSchemaVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (existedBeforeOpen && currentSchemaVersion < SCHEMA_VERSION) {
    createDatabaseBackup(db, dbPath, `pre-schema-v${SCHEMA_VERSION}`);
  }
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  if (opts.seed !== false) seedIfEmpty(db);
  return {
    db,
    dbPath,
    schemaVersion: SCHEMA_VERSION,
    close: () => {
      try {
        db.close();
      } catch {
        /* deja închis */
      }
    },
  };
}
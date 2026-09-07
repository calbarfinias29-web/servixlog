import { existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface BackupResult {
  path: string;
  sizeBytes: number;
  integrity: 'ok';
}

function timestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Creates a consistent SQLite snapshot without overwriting an existing backup. */
export function createDatabaseBackup(db: DatabaseSync, dbPath: string, reason: string, now = new Date()): BackupResult {
  const backupDirectory = join(dirname(dbPath), 'backups');
  mkdirSync(backupDirectory, { recursive: true });
  const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, '_') || 'manual';
  const backupPath = join(backupDirectory, `${basename(dbPath, '.db')}-${safeReason}-${timestamp(now)}.db`);
  if (existsSync(backupPath)) throw new Error(`Backup already exists: ${backupPath}`);

  db.exec(`VACUUM INTO ${sqlLiteral(backupPath)}`);
  if (!existsSync(backupPath) || statSync(backupPath).size === 0) {
    throw new Error('SQLite backup was not created or is empty.');
  }
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const check = backup.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
    if (check?.integrity_check !== 'ok') throw new Error(`SQLite backup integrity check failed: ${check?.integrity_check ?? 'unknown'}`);
  } finally {
    backup.close();
  }
  return { path: backupPath, sizeBytes: statSync(backupPath).size, integrity: 'ok' };
}

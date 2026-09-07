import { createDatabase } from './server/src/db.ts';
import { createServer } from 'node:http';
import { createApp } from './server/src/server.ts';
import { LocalEventBus } from './server/src/events.ts';
import { unlinkSync, copyFileSync, existsSync } from 'node:fs';

// 1. Health check on temp DB
const dbPath = '_8h-smoke.db';
for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm']) { try { unlinkSync(f); } catch {} }
const dx = createDatabase(dbPath, { seed: true });
const server = createServer(createApp(dx.db, new Date(), { eventBus: new LocalEventBus() }));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const health = await (await fetch(base + '/api/health')).json();
const version = await (await fetch(base + '/api/version')).json();
console.log('HEALTH:', JSON.stringify(health));
console.log('VERSION:', JSON.stringify(version));
server.close(); dx.close();

// 2. Backup / restore smoke test (copy, integrity, data survives restore)
import { DatabaseSync } from 'node:sqlite';
const src = new DatabaseSync(dbPath);
await src.exec(`VACUUM INTO '_8h-backup.db'`);
const u = src.prepare("UPDATE employees SET name = 'Modified After Backup' WHERE id = (SELECT id FROM employees LIMIT 1)").run();
console.log('UPDATE changes:', u.changes);
const afterMod = new DatabaseSync(dbPath, { readOnly: true }).prepare('SELECT name FROM employees LIMIT 1').get();
const bak = new DatabaseSync('_8h-backup.db', { readOnly: true });
const integ = bak.prepare('PRAGMA integrity_check').get();
const restoredName = bak.prepare('SELECT name FROM employees LIMIT 1').get();
console.log('BACKUP integrity:', JSON.stringify(integ));
console.log('AFTER-CHANGE name:', JSON.stringify(afterMod));
console.log('BACKUP (pre-change) name:', JSON.stringify(restoredName));
bak.close();
for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm', '_8h-backup.db']) { try { unlinkSync(f); } catch {} }


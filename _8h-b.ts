import { DatabaseSync } from 'node:sqlite';
import { unlinkSync } from 'node:fs';
for (const f of ['_8h-b.db','_8h-b.db-wal','_8h-b.db-shm']) { try { unlinkSync(f); } catch {} }
const db = new DatabaseSync('_8h-b.db');
db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t (name) VALUES (\'A\')');
await db.exec(`VACUUM INTO '_8h-b.bak'`);
const r = db.prepare('UPDATE t SET name = ? WHERE id = (SELECT id FROM t LIMIT 1)').run('Modified');
console.log('changes:', r.changes);
console.log('after:', db.prepare('SELECT name FROM t LIMIT 1').get());
console.log('backup:', new DatabaseSync('_8h-b.bak').prepare('SELECT name FROM t LIMIT 1').get());

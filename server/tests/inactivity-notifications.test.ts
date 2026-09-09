import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { createDatabase } from '../src/db.ts';
import { createApp } from '../src/server.ts';

let server: Server;
let baseUrl = '';
let database: ReturnType<typeof createDatabase>;
const firstEmployee = 'employee-inactivity-a';
const secondEmployee = 'employee-inactivity-b';

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'servix-inactivity-test-'));
  database = createDatabase(join(dir, 'inactivity.db'), { seed: true });
  for (const [id, name] of [[firstEmployee, 'Sami'], [secondEmployee, 'Mara']] as const) {
    database.db.prepare("INSERT INTO employees (id, name, role, active, created_at) VALUES (?, ?, 'employee', 1, ?)").run(id, name, new Date().toISOString());
  }
  server = createServer(createApp(database.db));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server?.close();
  database?.close();
});

async function observe(employeeIds: string[], observedAt: string): Promise<{ created: Array<Record<string, unknown>>; unread: Array<Record<string, unknown>> }> {
  const response = await fetch(`${baseUrl}/api/inactivity/observe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_ids: employeeIds, observed_at: observedAt }),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as { created: Array<Record<string, unknown>>; unread: Array<Record<string, unknown>> };
}

async function unread(): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${baseUrl}/api/inactivity-notifications`);
  assert.equal(response.status, 200);
  return ((await response.json()) as { notifications: Array<Record<string, unknown>> }).notifications;
}

const at = (minutes: number): string => new Date(Date.UTC(2026, 8, 4, 7, minutes)).toISOString();

test('thresholds stop at 30 minutes', async () => {
  const ten = await observe([firstEmployee], at(0));
  assert.equal(ten.created.length, 0);
  const thirty = await observe([firstEmployee], at(10));
  assert.deepEqual(thirty.created.map((row) => row.threshold_minutes), [10]);
  const forty = await observe([firstEmployee], at(20));
  assert.deepEqual(forty.created.map((row) => row.threshold_minutes), [20]);
  const fifty = await observe([firstEmployee], at(30));
  assert.deepEqual(fifty.created.map((row) => row.threshold_minutes), [30]);
  const afterThirty = await observe([firstEmployee], at(40));
  assert.equal(afterThirty.created.length, 0);
  assert.equal((await unread()).length, 3);
});

test('repeated refresh cannot duplicate a threshold', async () => {
  await observe([firstEmployee], at(10));
  await observe([firstEmployee], at(10));
  const count = database.db.prepare('SELECT COUNT(*) AS count FROM employee_inactivity_notifications WHERE employee_id = ? AND threshold_minutes = 10').get(firstEmployee) as { count: number };
  assert.equal(count.count, 1);
});

test('ending work starts a new independent inactivity period', async () => {
  await observe([], at(50));
  await observe([firstEmployee], at(60));
  await observe([firstEmployee], at(70));
  const periods = database.db.prepare('SELECT COUNT(*) AS count FROM employee_inactivity_periods WHERE employee_id = ?').get(firstEmployee) as { count: number };
  assert.equal(periods.count, 2);
  const thresholds = database.db.prepare('SELECT threshold_minutes FROM employee_inactivity_notifications WHERE employee_id = ? ORDER BY created_at').all(firstEmployee) as Array<{ threshold_minutes: number }>;
  assert.deepEqual(thresholds.map((row) => row.threshold_minutes), [10, 20, 30, 10]);
});

test('two employees have independent periods and thresholds', async () => {
  await observe([secondEmployee], at(0));
  const result = await observe([secondEmployee], at(10));
  assert.deepEqual(result.created.map((row) => row.employee_id), [secondEmployee]);
  assert.equal(result.created[0]?.threshold_minutes, 10);
});

test('read state removes a notification from unread results', async () => {
  const rows = await unread();
  const notification = rows.find((row) => row.employee_id === firstEmployee && row.threshold_minutes === 10);
  assert.ok(notification?.id);
  const response = await fetch(`${baseUrl}/api/inactivity/notifications/${notification.id}`, { method: 'PATCH' });
  assert.equal(response.status, 200);
  const remaining = await unread();
  assert.equal(remaining.some((row) => row.id === notification.id), false);
});

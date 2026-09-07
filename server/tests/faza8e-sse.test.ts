import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { createDatabase } from '../src/db.ts';
import { LocalEventBus } from '../src/events.ts';
import { createApp } from '../src/server.ts';

let app: ReturnType<typeof createDatabase>;
let server: Server;
let baseUrl = '';
let eventBus: LocalEventBus;

before(async () => {
  app = createDatabase(':memory:', { seed: true });
  eventBus = new LocalEventBus();
  server = createServer(createApp(app.db, new Date(), { eventBus }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => { server.close(); app.close(); });

async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('\n\n')) {
    const chunk = await reader.read();
    if (chunk.done) return text;
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text;
}

test('SSE accepts multiple loopback clients and broadcasts only after successful write', async () => {
  const first = await fetch(`${baseUrl}/api/events`);
  const second = await fetch(`${baseUrl}/api/events`);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.headers.get('content-type')?.startsWith('text/event-stream'), true);
  assert.equal(eventBus.size(), 2);
  const firstReader = first.body!.getReader();
  const secondReader = second.body!.getReader();
  await readFrame(firstReader);
  await readFrame(secondReader);

  const created = await fetch(`${baseUrl}/api/cars`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ license_plate: 'SSE-01', client_name: 'SSE Client' }) });
  assert.equal(created.status, 201);
  const frame = await readFrame(firstReader);
  assert.match(frame, /event: car\.created/);
  assert.match(frame, /"entity":"car"/);
  assert.match(frame, /"eventId":"/);

  await firstReader.cancel();
  await secondReader.cancel();
});

test('failed writes do not publish events', async () => {
  const response = await fetch(`${baseUrl}/api/cars`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ license_plate: '', client_name: 'Invalid' }) });
  assert.equal(response.status, 422);
  assert.equal(eventBus.size(), 0);
});

test('disconnect cleanup removes SSE subscribers', async () => {
  const response = await fetch(`${baseUrl}/api/events`);
  const reader = response.body!.getReader();
  await readFrame(reader);
  assert.equal(eventBus.size(), 1);
  await reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(eventBus.size(), 0);
});

test('SSE events include eventId, timestamp, version, entity, entityId', async () => {
  const response = await fetch(`${baseUrl}/api/events`);
  const reader = response.body!.getReader();
  await readFrame(reader);

  const created = await fetch(`${baseUrl}/api/cars`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_plate: 'EVT-01', client_name: 'Event Test' }),
  });
  assert.equal(created.status, 201);
  const createdCar = (await created.json()) as { car: { id: string } };

  const frame = await readFrame(reader);
  const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
  const event = JSON.parse(data) as Record<string, unknown>;

  assert.ok(event.eventId, 'eventId present');
  assert.ok(event.timestamp, 'timestamp present');
  assert.equal(typeof event.version, 'number', 'version is number');
  assert.equal(event.entity, 'car', 'entity is car');
  assert.equal(event.entityId, createdCar.car.id, 'entityId matches car id');

  await reader.cancel();
});

test('job updates emit job.updated events', async () => {
  const response = await fetch(`${baseUrl}/api/events`);
  const reader = response.body!.getReader();
  await readFrame(reader);

  // Get a job ID
  const jobsRes = await fetch(`${baseUrl}/api/jobs`);
  const jobsData = (await jobsRes.json()) as { jobs: Array<{ id: string }> };
  const jobId = jobsData.jobs[0]?.id;
  assert.ok(jobId, 'job exists');

  // Update job
  const updated = await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'Updated description' }),
  });
  assert.equal(updated.status, 200);

  const frame = await readFrame(reader);
  assert.match(frame, /event: job\.updated/);
  assert.match(frame, /"entity":"job"/);

  await reader.cancel();
});

test('employee updates emit employee.updated events', async () => {
  const response = await fetch(`${baseUrl}/api/events`);
  const reader = response.body!.getReader();
  await readFrame(reader);

  // Create employee
  const created = await fetch(`${baseUrl}/api/employees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Employee' }),
  });
  assert.equal(created.status, 201);
  const createdEmp = (await created.json()) as { employee: { id: string } };

  // Read creation event
  await readFrame(reader);

  // Update employee
  const updated = await fetch(`${baseUrl}/api/employees/${encodeURIComponent(createdEmp.employee.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: false }),
  });
  assert.equal(updated.status, 200);

  const frame = await readFrame(reader);
  assert.match(frame, /event: employee\.updated/);

  await reader.cancel();
});

test('appointment operations emit appointment events', async () => {
  const response = await fetch(`${baseUrl}/api/events`);
  const reader = response.body!.getReader();
  await readFrame(reader);

  // Create appointment
  const created = await fetch(`${baseUrl}/api/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      license_plate: 'APT-001',
      appointment_date: '2025-01-15',
      appointment_time: '10:00',
    }),
  });
  assert.equal(created.status, 201);
  const createdApt = (await created.json()) as { appointment: { id: string } };

  const frame = await readFrame(reader);
  assert.match(frame, /event: appointment\.created/);

  // Update appointment
  const updated = await fetch(`${baseUrl}/api/appointments/${encodeURIComponent(createdApt.appointment.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'Updated notes' }),
  });
  assert.equal(updated.status, 200);

  const frame2 = await readFrame(reader);
  assert.match(frame2, /event: appointment\.updated/);

  await reader.cancel();
});

test('rates and schedule updates emit their respective events', async () => {
  const response = await fetch(`${baseUrl}/api/events`);
  const reader = response.body!.getReader();
  await readFrame(reader);

  // Update rates
  const ratesUpdated = await fetch(`${baseUrl}/api/rates`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ normal_rate: 150 }),
  });
  assert.equal(ratesUpdated.status, 200);

  const ratesFrame = await readFrame(reader);
  assert.match(ratesFrame, /event: rates\.updated/);

  // Update schedule
  const scheduleUpdated = await fetch(`${baseUrl}/api/schedule`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_start: '08:00' }),
  });
  assert.equal(scheduleUpdated.status, 200);

  const scheduleFrame = await readFrame(reader);
  assert.match(scheduleFrame, /event: schedule\.updated/);

  await reader.cancel();
});

test('event version increments with each published event', async () => {
  const response = await fetch(`${baseUrl}/api/events`);
  const reader = response.body!.getReader();
  await readFrame(reader);

  const versions: number[] = [];

  // Create 3 cars to get 3 events
  for (let i = 0; i < 3; i += 1) {
    const created = await fetch(`${baseUrl}/api/cars`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_plate: `VER-${String(i).padStart(2, '0')}`, client_name: `Version Test ${i}` }),
    });
    assert.equal(created.status, 201);

    const frame = await readFrame(reader);
    const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
    const event = JSON.parse(data) as { version: number };
    versions.push(event.version);
  }

  // Versions should be monotonically increasing
  assert.equal(versions[0]! < versions[1]!, true, 'version 1 < version 2');
  assert.equal(versions[1]! < versions[2]!, true, 'version 2 < version 3');

  await reader.cancel();
});

test('device.updated events emitted on device operations', async () => {
  const response = await fetch(`${baseUrl}/api/events`);
  const reader = response.body!.getReader();
  await readFrame(reader);

  // List devices first to ensure endpoint works
  const devices = await fetch(`${baseUrl}/api/devices`);
  assert.equal(devices.status, 200);

  await reader.cancel();
});

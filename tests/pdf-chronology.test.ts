/** Dedicated regression tests for the final PDF chronology rows. */
import assert from 'node:assert/strict';
import { buildJobActivityPdfLines } from '../src/lib/pdfChronology';
import { deriveTimeSessionsFromActivityLog, type ActivityLogEventForPairing } from '../src/lib/sessionPairing';

process.env.TZ = 'UTC';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log('  PASS - ' + name); }
  catch (error) { failed++; console.error('  FAIL - ' + name); console.error(error); }
}

const event = (partial: Partial<ActivityLogEventForPairing> & { action: string; created_at: string }): ActivityLogEventForPairing => ({
  id: partial.id ?? partial.created_at + '-' + partial.action,
  employee_id: 'emp-ghita',
  job_id: 'job-pdf',
  car_id: 'car-pdf',
  ...partial,
});
const nameOf = (): string => 'Ghiță';
const dataRows = (lines: ReturnType<typeof buildJobActivityPdfLines>) => lines.filter((line) => line.table === 'crono' && !line.tableHead && line.cols?.length === 2);

function assertEveryClosedSessionIsChronological(events: ActivityLogEventForPairing[]): void {
  for (const session of deriveTimeSessionsFromActivityLog(events)) {
    if (session.end_time !== null) {
      assert.ok(new Date(session.start_time).getTime() < new Date(session.end_time).getTime(), `${session.start_time} !< ${session.end_time}`);
    }
  }
}

test('final PDF builder pairs the controlled chronology, never adjacent array items', () => {
  const events = [
    event({ action: 'in_lucru', created_at: '2026-09-01T09:12:00.000Z' }),
    event({ action: 'asteptare', created_at: '2026-09-01T10:03:00.000Z' }),
    event({ action: 'in_lucru', created_at: '2026-09-01T10:27:00.000Z' }),
    event({ action: 'finalizat', created_at: '2026-09-01T15:36:00.000Z' }),
  ];
  const rows = dataRows(buildJobActivityPdfLines(events, nameOf, 'job-pdf'));
  assert.deepEqual(rows.map((row) => [row.cols?.[0].text, row.cols?.[1].text]), [
    ['01.09.2026 09:12 - Ghiță', '01.09.2026 10:03 - Ghiță'],
    ['01.09.2026 10:27 - Ghiță', '01.09.2026 15:36 - Ghiță'],
  ]);
  assertEveryClosedSessionIsChronological(events);
  assert.equal(rows.some((row) => row.cols?.[0].text.includes('10:03') && row.cols?.[1].text.includes('10:27')), false);
  assert.equal(rows.some((row) => row.cols?.[0].text.includes('09:12') && row.cols?.[1].text.includes('15:36')), false);
});

test('sorts intentionally unordered activity_log events before pairing', () => {
  const events = [
    event({ action: 'asteptare', created_at: '2026-09-01T10:03:00.000Z' }),
    event({ action: 'finalizat', created_at: '2026-09-01T15:36:00.000Z' }),
    event({ action: 'in_lucru', created_at: '2026-09-01T09:12:00.000Z' }),
    event({ action: 'in_lucru', created_at: '2026-09-01T10:27:00.000Z' }),
  ];
  const rows = dataRows(buildJobActivityPdfLines(events, nameOf, 'job-pdf'));
  assert.equal(rows[0].cols?.[0].text.includes('09:12'), true);
  assert.equal(rows[0].cols?.[1].text.includes('10:03'), true);
  assert.equal(rows[1].cols?.[0].text.includes('10:27'), true);
  assert.equal(rows[1].cols?.[1].text.includes('15:36'), true);
  assertEveryClosedSessionIsChronological(events);
});

test('keeps the real stop date for an overnight session', () => {
  const lines = buildJobActivityPdfLines([
    event({ action: 'in_lucru', created_at: '2026-09-10T16:20:00.000Z' }),
    event({ action: 'finalizat', created_at: '2026-09-11T12:27:00.000Z' }),
  ], nameOf, 'job-pdf');
  const row = dataRows(lines)[0];
  assert.equal(row.text, '10.09.2026');
  assert.equal(row.cols?.[0].text, '10.09.2026 16:20 - Ghiță');
  assert.equal(row.cols?.[1].text, '11.09.2026 12:27 - Ghiță');
});

test('does not derive timestamps from started_at or worked_seconds', () => {
  const lines = buildJobActivityPdfLines([
    event({ action: 'in_lucru', created_at: '2026-09-01T09:12:00.000Z' }),
    event({ action: 'finalizat', created_at: '2026-09-01T10:03:00.000Z' }),
  ], nameOf, 'job-pdf');
  assert.equal(dataRows(lines)[0].cols?.[0].text.includes('09:12'), true);
  assert.equal(dataRows(lines)[0].cols?.[0].text.includes('08:00'), false);
});

test('does not invent a stop when a second start follows an incomplete session', () => {
  const events = [
    event({ action: 'in_lucru', created_at: '2026-09-01T09:12:00.000Z' }),
    event({ action: 'in_lucru', created_at: '2026-09-01T10:27:00.000Z' }),
    event({ action: 'finalizat', created_at: '2026-09-01T15:36:00.000Z' }),
  ];
  const rows = dataRows(buildJobActivityPdfLines(events, nameOf, 'job-pdf'));
  assert.equal(rows[0].cols?.[0].text.includes('09:12'), true);
  assert.equal(rows[0].cols?.[1].text, '');
  assert.equal(rows[1].cols?.[0].text.includes('10:27'), true);
  assert.equal(rows[1].cols?.[1].text.includes('15:36'), true);
  assertEveryClosedSessionIsChronological(events);
});

test('does not invent a 14:00 resume, but preserves a real 14:08 resume', () => {
  const paused = buildJobActivityPdfLines([
    event({ action: 'in_lucru', created_at: '2026-09-01T12:00:00.000Z' }),
    event({ action: 'asteptare', created_at: '2026-09-01T13:00:00.000Z' }),
  ], nameOf, 'job-pdf');
  assert.equal(dataRows(paused).length, 1);
  assert.equal(dataRows(paused)[0].cols?.[1].text, '01.09.2026 13:00 - Ghiță');
  assert.equal(JSON.stringify(paused).includes('14:00'), false);

  const resumed = buildJobActivityPdfLines([
    event({ action: 'in_lucru', created_at: '2026-09-01T12:00:00.000Z' }),
    event({ action: 'asteptare', created_at: '2026-09-01T13:00:00.000Z' }),
    event({ action: 'in_lucru', created_at: '2026-09-01T14:08:00.000Z' }),
    event({ action: 'finalizat', created_at: '2026-09-01T15:00:00.000Z' }),
  ], nameOf, 'job-pdf');
  assert.equal(dataRows(resumed)[1].cols?.[0].text.includes('14:08'), true);
});

test('pairs real overtime events exactly', () => {
  const events = [
    event({ action: 'overtime_start', created_at: '2026-09-01T18:00:00.000Z' }),
    event({ action: 'overtime_stop', created_at: '2026-09-01T19:15:00.000Z' }),
  ];
  const rows = dataRows(buildJobActivityPdfLines(events, nameOf, 'job-pdf'));
  assert.equal(rows[0].cols?.[0].text.includes('18:00'), true);
  assert.equal(rows[0].cols?.[1].text.includes('19:15'), true);
  assertEveryClosedSessionIsChronological(events);
});

test('PDF consumes real scheduled pause and workday-end STOP events', () => {
  const events = [
    event({ action: 'in_lucru', created_at: '2026-09-04T10:20:00.000Z' }),
    event({ action: 'schedule_pause', detail: 'Oprire automată - pauză programată', created_at: '2026-09-04T11:00:00.000Z' }),
    event({ action: 'in_lucru', detail: 'Reluare automată după pauza programată', created_at: '2026-09-04T12:00:00.000Z' }),
    event({ action: 'schedule_end', detail: 'Oprire automată - sfârșit program', created_at: '2026-09-04T15:00:00.000Z' }),
  ];
  const rows = dataRows(buildJobActivityPdfLines(events, nameOf, 'job-pdf'));
  assert.deepEqual(rows.map((row) => [row.cols?.[0].text, row.cols?.[1].text]), [
    ['04.09.2026 10:20 - Ghiță', '04.09.2026 11:00 - Ghiță'],
    ['04.09.2026 12:00 - Ghiță', '04.09.2026 15:00 - Ghiță'],
  ]);
  assertEveryClosedSessionIsChronological(events);
});

console.log('PDF CHRONOLOGY: ' + passed + ' pass, ' + failed + ' fail');
if (failed > 0) process.exit(1);

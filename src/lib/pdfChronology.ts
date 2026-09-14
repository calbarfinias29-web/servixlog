import { heading as pdfHeading, type PdfLine } from './pdf';
import { deriveTimeSessionsFromActivityLog, type ActivityLogEventForPairing } from './sessionPairing';

const SESSION_START_COL_X = 170;
const SESSION_END_COL_X = 350;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function sessionColumnText(iso: string | null, employeeId: string, empName: (id: string | null) => string): string {
  if (!iso) return '';
  return `${formatDate(iso)} ${formatClock(iso)} - ${empName(employeeId)}`;
}

/** Build the actual PDF chronology rows from real activity_log timestamps. */
export function buildJobActivityPdfLines(
  activity: ActivityLogEventForPairing[],
  empName: (id: string | null) => string,
  jobId?: string,
): PdfLine[] {
  const lines: PdfLine[] = [pdfHeading('Cronologie lucrare')];
  const events = activity.filter((event) => (jobId ? event.job_id === jobId : true));
  const sessions = deriveTimeSessionsFromActivityLog(events);
  if (sessions.length === 0) {
    lines.push({ text: 'Nu exista evenimente inregistrate (activity_log)', size: 10.5, bold: false, color: '#000000', table: 'crono' });
    return lines;
  }
  lines.push({
    text: 'DATA START', size: 9.5, bold: true, color: '#000000', gapBefore: 4,
    cols: [{ text: 'PORNIRE', x: SESSION_START_COL_X }, { text: 'OPRIRE', x: SESSION_END_COL_X }],
    table: 'crono', tableHead: true,
  });
  lines.push({ text: '', size: 2, bold: false, rule: true, gapBefore: 3, table: 'crono', tableHead: true });
  for (const session of sessions) {
    lines.push({
      text: formatDate(session.start_time),
      size: 10.5, bold: false, gapBefore: 5,
      cols: [
        { text: sessionColumnText(session.start_time, session.employee_id, empName), x: SESSION_START_COL_X },
        { text: sessionColumnText(session.end_time, session.employee_id, empName), x: SESSION_END_COL_X },
      ],
      table: 'crono',
    });
  }
  lines.push({ text: '', size: 2, bold: false, rule: true, gapBefore: 6, table: 'crono' });
  return lines;
}

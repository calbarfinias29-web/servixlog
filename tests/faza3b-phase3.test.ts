import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_WRITE_EXECUTION_ENABLED, parsePhase3Intent } from '@/agent/agent-phase3';
import { executeWrite } from '@/agent/agent-write';
import { resetFlow, handleAgentMessage } from '@/agent/agent-write-flow';

test('FAZA 3B: recunoaște intențiile administrative', () => {
  assert.equal(parsePhase3Intent('creează un angajat Ion Popescu')?.action, 'create_employee');
  assert.equal(parsePhase3Intent('modifică angajatul Ion Popescu')?.action, 'update_employee');
  assert.equal(parsePhase3Intent('dezactivează angajatul Ion Popescu')?.action, 'deactivate_employee');
  assert.equal(parsePhase3Intent('creează lucrare nouă schimb ulei')?.action, 'create_job');
  assert.equal(parsePhase3Intent('modifică lucrarea B123ABC')?.action, 'update_job');
  assert.equal(parsePhase3Intent('schimbă statusul lucrării B123ABC în finalizat')?.action, 'change_job_status');
  assert.equal(parsePhase3Intent('adaugă programare pe 10.09.2026 la 14:00')?.action, 'create_appointment');
  assert.equal(parsePhase3Intent('anulează programarea B123ABC')?.action, 'cancel_appointment');
  assert.equal(parsePhase3Intent('transferă mașina B123ABC la Maria')?.action, 'transfer_car');
  assert.equal(parsePhase3Intent('șterge lucrarea B123ABC')?.action, 'delete_job');
});

test('FAZA 3B: diacriticele și majusculele sunt suportate', () => {
  assert.equal(parsePhase3Intent('ȘTERGE PROGRAMAREA B123ABC')?.action, 'cancel_appointment');
  assert.equal(parsePhase3Intent('MUTĂ MAȘINA B123ABC LA MARIA')?.action, 'transfer_car');
});

test('FAZA 3B: ambiguitățile cer clarificare', () => {
  const errors = [
    parsePhase3Intent('șterge programarea'),
    parsePhase3Intent('schimbă statusul lucrării'),
    parsePhase3Intent('transferă mașina la Maria'),
    parsePhase3Intent('creează programare'),
  ].map((result) => result && 'error' in result ? result.error : '');
  assert.match(errors[0], /Spune exact/);
  assert.match(errors[1], /Spune exact/);
  assert.match(errors[2], /numărul exact/);
  assert.match(errors[3], /data și ora/);
});

test('FAZA 3B: statusurile sunt limitate la cele existente', () => {
  const invalid = parsePhase3Intent('schimbă statusul lucrării B123ABC în arhivat');
  assert.ok(invalid && 'error' in invalid);
  assert.match(invalid.error, /Status invalid/);
  const valid = parsePhase3Intent('schimbă statusul lucrării B123ABC în finalizat');
  assert.deepEqual(valid && 'error' in valid ? null : valid?.changes.status, 'finalizat');
});

test('FAZA 3B: preview-ul conține ținta, risc și confirmare', () => {
  const parsed = parsePhase3Intent('transferă mașina B123ABC la Maria');
  assert.ok(parsed && !('error' in parsed));
  assert.ok(parsed.preview.some((line) => line.includes('B123ABC')));
  assert.ok(parsed.preview.some((line) => line.includes('RISC: HIGH')));
  assert.ok(parsed.preview.some((line) => line.includes('CONFIRMARE: DA / NU')));
  assert.ok(parsed.preview.some((line) => line.includes('NU SE RESETEAZĂ')));
});

test('FAZA 3B: confirmation validă nu trece de execution gate', async () => {
  resetFlow();
  const preview = await handleAgentMessage('șterge lucrarea B123ABC', async () => ({ success: true, text: 'read' }));
  assert.equal(preview.success, true);
  const blocked = await handleAgentMessage('Da', async () => ({ success: true, text: 'read' }));
  assert.equal(blocked.success, false);
  assert.match(blocked.text, /execuția operațiilor administrative.*dezactivată/i);
});

test('FAZA 3B: executorul refuză phase3_admin și gate-ul este dezactivat', async () => {
  assert.equal(ADMIN_WRITE_EXECUTION_ENABLED, false);
  const result = await executeWrite({ kind: 'phase3_admin', description: 'delete_job', params: {} });
  assert.equal(result.success, false);
});

test('FAZA 3B: anularea nu execută nimic', async () => {
  resetFlow();
  await handleAgentMessage('șterge programarea B123ABC', async () => ({ success: true, text: 'read' }));
  const cancelled = await handleAgentMessage('Nu', async () => ({ success: true, text: 'read' }));
  assert.equal(cancelled.success, true);
  assert.match(cancelled.text, /nicio modificare/i);
});

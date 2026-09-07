import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseConfirmation,
  processConfirmation,
  isValidConfirmation,
  createPendingOperation,
  evaluatePendingConfirmation,
  nextWriteConfirmationState,
  WRITE_ARMED,
  ALLOWED_WRITE_ACTIONS,
} from '../src/agent/agent-security';

type Status = 'approved' | 'rejected' | 'ambiguous';

function statusOf(input: string): Status {
  return parseConfirmation(input).status;
}

const APPROVED: Array<[string, Status]> = [
  ['Da', 'approved'],
  ['Da, confirm', 'approved'],
  ['Confirm', 'approved'],
  ['Confirm modificarea', 'approved'],
  ['Execută', 'approved'],
];

const REJECTED: Array<[string, Status]> = [
  ['Nu', 'rejected'],
  ['Nu confirm', 'rejected'],
  ['Nu, nu confirma', 'rejected'],
  ['Nu modifica', 'rejected'],
  ['Anulează', 'rejected'],
  ['Renunță', 'rejected'],
];

const AMBIGUOUS: Array<[string, Status]> = [
  ['ok', 'ambiguous'],
  ['bine', 'ambiguous'],
  ['poate', 'ambiguous'],
  ['cred că da', 'ambiguous'],
  ['fă ce trebuie', 'ambiguous'],
];

for (const [input] of APPROVED) test(`CONFIRMARE EXPLICITA => APPROVED: ${input}`, () => assert.equal(statusOf(input), 'approved'));
for (const [input] of REJECTED) test(`REFUZ EXPLICIT => REJECTED: ${input}`, () => assert.equal(statusOf(input), 'rejected'));
for (const [input] of AMBIGUOUS) test(`AMBIGUU => AMBIGUOUS: ${input}`, () => assert.equal(statusOf(input), 'ambiguous'));

test('procesConfirmation: confirmed = true DOAR pentru aprobare explicita', () => {
  assert.equal(processConfirmation('Da').confirmed, true);
  assert.equal(processConfirmation('Da').status, 'approved');
  assert.equal(processConfirmation('Nu confirm').confirmed, false);
  assert.equal(processConfirmation('Nu confirm').status, 'rejected');
  assert.equal(processConfirmation('ok').confirmed, false);
  assert.equal(processConfirmation('ok').status, 'ambiguous');
});

test('isValidConfirmation: true doar pentru confirmare explicita', () => {
  assert.equal(isValidConfirmation('Confirm'), true);
  assert.equal(isValidConfirmation('Nu confirm'), false);
  assert.equal(isValidConfirmation('ok'), false);
});

test('WRITE mecanism ARMED, restrictionat prin allowlist (FAZA 2B)', () => {
  assert.equal(WRITE_ARMED, true);
  assert.deepEqual([...ALLOWED_WRITE_ACTIONS], ['update_rates', 'update_schedule', 'create_car', 'update_car', 'update_client']);
});

test('SECURITY: "Nu confirm" NU poate ajunge la executeWrite', () => {
  const pending = createPendingOperation('update_rates', { id: 'r1' }, { normal_rate: 120 });
  const approval = evaluatePendingConfirmation(pending, parseConfirmation('Nu confirm'));
  assert.equal(approval.canExecute, false);
});

test('SECURITY: "Nu modifica" NU poate ajunge la executeWrite', () => {
  const pending = createPendingOperation('update_rates', { id: 'r1' }, { normal_rate: 120 });
  const approval = evaluatePendingConfirmation(pending, parseConfirmation('Nu modifica'));
  assert.equal(approval.canExecute, false);
});

test('SECURITY: "Da" fara pending confirmation NU poate executa nimic', () => {
  const approval = evaluatePendingConfirmation(null, parseConfirmation('Da'));
  assert.equal(approval.canExecute, false);
  assert.equal(approval.reason, 'no-pending-operation');
});

test('SECURITY: "Confirm" fara pending confirmation NU poate executa nimic', () => {
  const approval = evaluatePendingConfirmation(null, parseConfirmation('Confirm'));
  assert.equal(approval.canExecute, false);
});

test('State machine: tranzitii pregatite (WRITE ne-armat)', () => {
  assert.equal(nextWriteConfirmationState('idle', null), 'idle');
  assert.equal(nextWriteConfirmationState('idle', parseConfirmation('Da')), 'awaiting_confirmation');
  assert.equal(nextWriteConfirmationState('awaiting_confirmation', parseConfirmation('Da')), 'executing');
  assert.equal(nextWriteConfirmationState('awaiting_confirmation', parseConfirmation('Nu')), 'cancelled');
  assert.equal(nextWriteConfirmationState('awaiting_confirmation', parseConfirmation('ok')), 'awaiting_confirmation');
});

test('Pending operation este legata de actiunea exacta', () => {
  const pending = createPendingOperation('update_rates', { id: 'r1' }, { normal_rate: 120 });
  assert.equal(pending.action, 'update_rates');
  assert.ok(pending.operationId.startsWith('update_rates-'));
  assert.deepEqual(pending.proposedChanges, { normal_rate: 120 });
});
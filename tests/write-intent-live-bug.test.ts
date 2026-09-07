import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWriteIntent } from '@/agent/agent-write-flow';
import { handleAgentMessage, getPendingOperation, resetFlow } from '@/agent/agent-write-flow';

test('rate range with lei/ora parses the proposed value', () => {
  const parsed = parseWriteIntent('Vreau să modific tariful normal de la 100 lei/oră la 101 lei/oră.');
  assert.ok(parsed && !('error' in parsed));
  assert.equal(parsed.action, 'update_rates');
  assert.deepEqual(parsed.changes, { normal_rate: 101 });
});

test('explicit rate WRITE creates preview and pending without executing', async () => {
  resetFlow();
  let fallbackCalled = false;
  const response = await handleAgentMessage('Vreau să modific tariful normal de la 100 lei/oră la 101 lei/oră.', async () => {
    fallbackCalled = true;
    return { success: true, text: 'READ' };
  });
  const pending = getPendingOperation();
  assert.equal(fallbackCalled, false);
  assert.equal(response.success, true);
  assert.equal(response.pending?.action, 'update_rates');
  assert.match(response.text, /101/);
  assert.ok(pending?.operationId);
  assert.equal(pending?.proposedChanges?.normal_rate, 101);
});

test('read-only tariff hypothetical does not create pending WRITE', async () => {
  resetFlow();
  let fallbackCalled = false;
  const response = await handleAgentMessage('Verifică dacă tariful normal este 100 lei/oră și analizează ce s-ar întâmpla dacă ar fi 101 lei/oră.', async () => {
    fallbackCalled = true;
    return { success: true, text: 'READ ONLY' };
  });
  assert.equal(response.text, 'READ ONLY');
  assert.equal(fallbackCalled, true);
  assert.equal(getPendingOperation(), null);
});

test('existing explicit WRITE forms remain update_rates', () => {
  for (const message of ['Schimb tariful normal la 101 lei.', 'Setează tariful normal la 101 lei.']) {
    const parsed = parseWriteIntent(message);
    assert.ok(parsed && !('error' in parsed));
    assert.equal(parsed.action, 'update_rates');
  }
});

test('restore wording remains explicit update_rates WRITE', () => {
  const cases = [
    'Vreau să readuc tariful normal la 100 lei/oră.',
    'Vreau să revin cu tariful normal la 100 lei/oră.',
    'Restabilește tariful normal la 100 lei/oră.',
    'Pune tariful normal înapoi la 100 lei/oră.',
    'Schimbă tariful normal înapoi la 100 lei/oră.',
    'Tariful normal trebuie să fie din nou 100 lei/oră.',
    'Vreau să modific tariful normal de la 101 lei/oră la 100 lei/oră.',
  ];
  for (const message of cases) {
    const parsed = parseWriteIntent(message);
    assert.ok(parsed && !('error' in parsed), message);
    assert.equal(parsed.action, 'update_rates', message);
    assert.equal(parsed.changes.normal_rate, 100, message);
  }
});

test('restore verification and negation remain read-only', async () => {
  for (const message of [
    'Verifică dacă trebuie readus tariful la 100 lei/oră.',
    'Nu modifica tariful normal, doar spune-mi valoarea.',
  ]) {
    resetFlow();
    let fallbackCalled = false;
    const response = await handleAgentMessage(message, async () => {
      fallbackCalled = true;
      return { success: true, text: 'READ ONLY' };
    });
    assert.equal(response.text, 'READ ONLY', message);
    assert.equal(fallbackCalled, true, message);
    assert.equal(getPendingOperation(), null, message);
  }
});

test('exact real UI message creates one WRITE preview and stops before execution', async () => {
  resetFlow();
  let fallbackCalled = false;
  const message = `Vreau să readuc tariful normal la 100 lei/oră.
Pregătește modificarea: 101 lei/oră → 100 lei/oră.
Arată preview-ul și cere-mi confirmarea explicită.
NU executa încă.`;
  const response = await handleAgentMessage(message, async () => {
    fallbackCalled = true;
    return { success: true, text: 'READ' };
  });
  const pending = getPendingOperation();
  assert.equal(fallbackCalled, false);
  assert.equal(response.pending?.action, 'update_rates');
  assert.equal(pending?.proposedChanges?.normal_rate, 100);
  assert.ok(pending?.operationId);
  assert.match(response.text, /100/);
  assert.match(response.text, /Confirmi modificarea/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { processMessageMulti } from '@/agent/agent-intent';
import { calculateCostSummary } from '@/lib/costs';
import { handleAgentMessage, resetFlow } from '@/agent/agent-write-flow';

test('duplicate intent produces one final section', async () => {
  const result = await processMessageMulti('Arată angajații și angajații.');
  const matches = result.formattedResponse.match(/Angajati:/g) ?? [];
  assert.ok(matches.length <= 1);
  assert.ok(result.formattedResponse.split('\n\n').length <= 1 || matches.length === 1);
});

test('legitimate multi-intent keeps one section per tool', async () => {
  const result = await processMessageMulti('Arată costurile și overtime-ul și costurile.');
  assert.equal((result.formattedResponse.match(/Costuri:/g) ?? []).length, 1);
  assert.equal((result.formattedResponse.match(/Overtime:/g) ?? []).length, 1);
});

test('audit response is aggregated once by the orchestrator', async () => {
  resetFlow();
  let fallbackCalls = 0;
  const result = await handleAgentMessage('Fă un audit complet. Nu modifica nimic, doar analizează și raportează.', async () => {
    fallbackCalls += 1;
    return { success: true, text: 'AUDIT SERVIX\nAngajați: o singură secțiune\nCosturi: o singură secțiune' };
  });
  assert.equal(fallbackCalls, 1);
  assert.equal((result.text.match(/Angajați:/g) ?? []).length, 1);
});

test('VAT totals use rounded subtotal as a single source', () => {
  assert.deepEqual(calculateCostSummary(14992.56, 21), { subtotal: 14992.56, vatAmount: 3148.44, totalWithVat: 18141 });
  assert.deepEqual(calculateCostSummary(100, 21), { subtotal: 100, vatAmount: 21, totalWithVat: 121 });
  assert.deepEqual(calculateCostSummary(99.99, 21), { subtotal: 99.99, vatAmount: 21, totalWithVat: 120.99 });
  assert.deepEqual(calculateCostSummary(1000.01, 21), { subtotal: 1000.01, vatAmount: 210, totalWithVat: 1210.01 });
  assert.deepEqual(calculateCostSummary(100.0050001, 21), { subtotal: 100.01, vatAmount: 21, totalWithVat: 121.01 });
});

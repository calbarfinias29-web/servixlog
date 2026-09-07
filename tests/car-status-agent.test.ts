import assert from 'node:assert/strict';
import test from 'node:test';
import { detectIntent } from '@/agent/agent-intent';

test('Agentul foloseste finalizata pentru filtrul car_status', () => {
  const intent = detectIntent('Arata-mi masinile finalizate');
  assert.equal(intent.category, 'CARS');
  assert.equal(intent.filters.status, 'finalizata');
  assert.notEqual(intent.filters.status, 'finalizat');
});

test('statusul finalizat ramane pentru lucrari', () => {
  const intent = detectIntent('Arata-mi lucrarile finalizate');
  assert.equal(intent.category, 'JOBS');
  assert.equal(intent.filters.status, 'finalizat');
});

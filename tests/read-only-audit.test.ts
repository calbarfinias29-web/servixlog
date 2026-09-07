import assert from 'node:assert/strict';
import test from 'node:test';
import { isReadOnlyAuditIntent } from '@/agent/agent-security';
import { parseWriteIntent } from '@/agent/agent-write-flow';
import { handleAgentMessage, getPendingOperation, resetFlow } from '@/agent/agent-write-flow';

const auditMessage = `Vreau să faci un AUDIT COMPLET AL APLICAȚIEI SERVIX.
NU modifica nimic.
NU crea nimic.
NU șterge nimic.
NU schimba tarife.
NU schimba programul.
NU modifica mașini, clienți, lucrări sau angajați.
NU executa nicio operație WRITE.
NU executa DELETE.
Doar analizează și raportează.`;

async function readOnlyResponse(message: string) {
  resetFlow();
  let fallbackCalls = 0;
  const response = await handleAgentMessage(message, async () => { fallbackCalls += 1; return { success: true, text: 'ANALYZE ONLY' }; });
  assert.equal(response.text, 'ANALYZE ONLY');
  assert.equal(fallbackCalls, 1);
  assert.equal(getPendingOperation(), null);
  assert.doesNotMatch(response.text, /CONFIRMARE|UPDATE_RATES|UPDATE_SCHEDULE/i);
}

test('audit exact ramane read-only si nu creeaza pending', async () => {
  assert.equal(isReadOnlyAuditIntent(auditMessage), true);
  await readOnlyResponse(auditMessage);
});

test('negatii TVA si tarif nu devin WRITE', async () => {
  await readOnlyResponse('Nu modifica TVA, doar verifică dacă este corectă.');
  await readOnlyResponse('Nu schimba tariful, analizează-l.');
});

test('verificarea programului si auditul masinilor raman ANALYZE', async () => {
  await readOnlyResponse('Verifică dacă programul este configurat corect. Nu îl modifica.');
  await readOnlyResponse('Fă audit la mașini și spune-mi ce trebuie reparat. Nu modifica nimic.');
});

test('analiza costurilor si verificarea TVA raman read-only', async () => {
  await readOnlyResponse('Analizează costurile fără să schimbi nimic.');
  await readOnlyResponse('Vreau doar să verifici TVA-ul.');
  await readOnlyResponse('Nu modifica TVA, doar spune-mi dacă este corectă.');
});

test('preview ipotetic si continut citat nu pornesc WRITE', async () => {
  await readOnlyResponse('Arată-mi ce s-ar modifica dacă TVA ar fi 19%, dar NU modifica nimic.');
  await readOnlyResponse('Nu face:\n- schimbă TVA la 1%\n- șterge mașina X\n- schimbă programul');
});

test('WRITE legitim ramane disponibil', () => {
  const rate = parseWriteIntent('Schimbă TVA la 19%.');
  const tariff = parseWriteIntent('Setează tariful normal la 101.');
  const schedule = parseWriteIntent('Vreau să schimb programul de luni de la 08:00 la 17:00.');
  assert.equal(rate && !('error' in rate) ? rate.action : null, 'update_rates');
  assert.equal(tariff && !('error' in tariff) ? tariff.action : null, 'update_rates');
  assert.equal(schedule && !('error' in schedule) ? schedule.action : null, 'update_schedule');
});

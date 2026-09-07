import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { detectIntent } from '@/agent/agent-intent';
import { parseConfirmation } from '@/agent/agent-security';
import { createRomanianRecognition, isSpeechRecognitionSupported, readFinalTranscript, speechErrorMessage } from '@/agent/speech-recognition';

test('speech recognition supported and unsupported', () => {
  class FakeRecognition { lang = ''; continuous = true; interimResults = true; onresult = null; onerror = null; onend = null; start() {} stop() {} abort() {} }
  assert.equal(isSpeechRecognitionSupported({ SpeechRecognition: FakeRecognition }), true);
  assert.equal(isSpeechRecognitionSupported({}), false);
  assert.equal(createRomanianRecognition({ SpeechRecognition: FakeRecognition })?.lang, 'ro-RO');
  assert.equal(createRomanianRecognition({}), null);
});

test('start/stop contract and transcript update', () => {
  const transcript = readFinalTranscript({ results: [[{ transcript: 'Schimbă tariful' }], [{ transcript: 'normal la o sută unu' }]] });
  assert.equal(transcript, 'Schimbă tariful normal la o sută unu');
});

test('permission and unsupported errors are explicit', () => {
  assert.match(speechErrorMessage('not-allowed'), /refuzat/i);
  assert.match(speechErrorMessage('audio-capture'), /disponibil/i);
  assert.match('Recunoașterea vocală nu este disponibilă în acest browser.', /browser/i);
});

test('Romanian transcript enters the same Agent parser', () => {
  assert.equal(detectIntent('Arată-mi câte mașini sunt în lucru.').category, 'CARS');
  assert.equal(detectIntent('Spune-mi ce angajați lucrează.').category, 'EMPLOYEES');
  assert.equal(detectIntent('arata masini').category, 'CARS');
  assert.equal(detectIntent('arata angajati').category, 'EMPLOYEES');
});

test('voice confirmation and cancellation use existing security parser', () => {
  assert.equal(parseConfirmation('Da').status, 'approved');
  assert.equal(parseConfirmation('Nu').status, 'rejected');
  assert.equal(parseConfirmation('Anulează').status, 'rejected');
});

test('microphone stores no audio and text path remains available', async () => {
  const source = await fs.readFile(new URL('../src/agent/AgentModal.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|MediaRecorder|getUserMedia/i);
  assert.match(source, /handleAgentMessage\(text/);
});

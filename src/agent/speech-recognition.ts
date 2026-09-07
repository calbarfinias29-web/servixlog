export type SpeechStatus = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'ERROR';

export interface SpeechResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface SpeechRecognitionHost {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

declare global {
  interface Window extends SpeechRecognitionHost {}
}

export function getSpeechRecognitionConstructor(host: SpeechRecognitionHost | undefined): (new () => SpeechRecognitionLike) | undefined {
  return host?.SpeechRecognition ?? host?.webkitSpeechRecognition;
}

export function isSpeechRecognitionSupported(host: SpeechRecognitionHost | undefined): boolean {
  return Boolean(getSpeechRecognitionConstructor(host));
}

export function createRomanianRecognition(host: SpeechRecognitionHost | undefined): SpeechRecognitionLike | null {
  const Constructor = getSpeechRecognitionConstructor(host);
  if (!Constructor) return null;
  const recognition = new Constructor();
  recognition.lang = 'ro-RO';
  recognition.continuous = false;
  recognition.interimResults = false;
  return recognition;
}

export function readFinalTranscript(event: SpeechResultEvent): string {
  const transcripts: string[] = [];
  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (result?.[0]?.transcript) transcripts.push(result[0].transcript);
  }
  return transcripts.join(' ').replace(/\s+/g, ' ').trim();
}

export function speechErrorMessage(error: string | undefined): string {
  if (error === 'not-allowed' || error === 'service-not-allowed') return 'Accesul la microfon a fost refuzat. Agentul text rămâne disponibil.';
  if (error === 'audio-capture') return 'Microfonul nu este disponibil. Agentul text rămâne disponibil.';
  return 'Recunoașterea vocală nu a putut porni. Agentul text rămâne disponibil.';
}

/**
 * SERVIX Angajat — Gate dispozitiv (UI).
 *
 * Singurul ecran NOU al fazei „Angajat Local Client”. Apare DOAR în entry-ul
 * `?mode=angajat` al clientului instalabil; Web/Supabase și Admin (`?mode=local`)
 * rămân 100% neschimbate.
 *
 * Flux (cerințele 3–6):
 *   - prima pornire → „Conectează dispozitivul” (scanare QR / cod de bare /
 *     introducere manuală a codului generat de SERVIX Admin);
 *   - după pairing → asocierea se salvează local; pornirile următoare se
 *     reconectează automat, fără QR;
 *   - revocarea accesului (Admin → Revocă) → detectată (heartbeat 401/403 la
 *     pornire, SSE live în timpul folosirii) → înapoi la ecranul de conectare;
 *   - server indisponibil → asocierea rămâne salvată, ecran de reconectare.
 * După conectare, fluxul EXISTENT rulează neschimbat:
 *   „Cine preia tableta?” → angajat → Panou Angajat (toți angajații pe același
 *   dispozitiv; timeout-ul de 1 minut rămâne exact ce era).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { dataAdapter, enableLocalMode } from '../data';
import {
  clearAngajatPairing, loadAngajatPairing, pairAngajatDevice, saveAngajatPairing,
  verifyAngajatPairing, type PairingAttempt, type SavedAngajatPairing,
} from './deviceGate';

type GateMode = 'checking' | 'pairing' | 'offline' | 'ready';
type SubscribeStatus = 'connecting' | 'online' | 'offline' | 'revoked';

function attemptMessage(attempt: PairingAttempt): string {
  switch (attempt.kind) {
    case 'INVALID_PAYLOAD': return 'Cod necunoscut. Scanează QR-ul/codul de bare afișat de SERVIX Admin.';
    case 'NO_SERVER_ADDRESS': return 'Serverul SERVIX nu are accesul LAN activat (SERVIX_LAN_ENABLED).';
    case 'REVOKED': return 'Dispozitivul a fost revocat. Cere un nou cod de pairing în SERVIX Admin.';
    case 'CREDENTIAL_INVALID': return 'Codul de conectare nu este valid.';
    case 'SERVER_UNREACHABLE': return `SERVIX Local Server nu răspunde (${attempt.message}).`;
    default: return '';
  }
}

/** Detectare barcode în stream de cameră (QR + Code128) — feature-detected, opțional. */
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> }
interface BarcodeDetectorCtor { new (options?: { formats?: string[] }): BarcodeDetectorLike }

function barcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

export function AngajatDeviceGate({ children }: { children: ReactNode }): JSX.Element {
  const [mode, setMode] = useState<GateMode>('checking');
  const [message, setMessage] = useState('');
  const [payloadInput, setPayloadInput] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const savedRef = useRef<SavedAngajatPairing | null>(null);
  const stopEventsRef = useRef<(() => void) | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activate = useCallback((saved: SavedAngajatPairing): void => {
    // Stratul de date trece pe serverul din pairing + credentialul dispozitivului.
    enableLocalMode(saved.serverAddress);
    dataAdapter.setDeviceCredentials?.(saved.deviceId, saved.credential);
    savedRef.current = saved;
    // Update live + detectare revocare în timpul folosirii (infrastructura SSE existentă).
    stopEventsRef.current?.();
    stopEventsRef.current = dataAdapter.subscribeToEvents?.(() => { /* evenimentele de date sunt consumate de UI */ }, {
      deviceId: saved.deviceId,
      credential: saved.credential,
      onStatus: (status: SubscribeStatus) => {
        if (status !== 'revoked') return;
        clearAngajatPairing(localStorage);
        dataAdapter.setDeviceCredentials?.(null, null);
        stopEventsRef.current?.();
        stopEventsRef.current = null;
        setMessage('Accesul dispozitivului a fost revocat de administrator.');
        setMode('pairing');
      },
    }) ?? null;
    setMode('ready');
  }, []);

  const check = useCallback(async (): Promise<void> => {
    setMode('checking');
    const saved = loadAngajatPairing(localStorage);
    if (!saved) { setMode('pairing'); return; }
    const verification = await verifyAngajatPairing(saved, fetch);
    if (verification.kind === 'PAIRED') { activate(saved); return; }
    if (verification.kind === 'REVOKED') {
      clearAngajatPairing(localStorage);
      setMessage('Accesul dispozitivului nu mai este valid. Conectează-l din nou cu QR/codul de bare.');
      setMode('pairing');
      return;
    }
    savedRef.current = saved; // server temporar indisponibil — asocierea rămâne salvată
    setMode('offline');
  }, [activate]);

  useEffect(() => {
    void check();
    return () => {
      stopEventsRef.current?.();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [check]);

  // Reconectare automată când serverul revine (5s, fără stergerea asocierii salvate).
  useEffect(() => {
    if (mode !== 'offline') return;
    retryTimerRef.current = setTimeout(() => { void check(); }, 5000);
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); };
  }, [mode, check]);

  const connect = useCallback(async (payloadText: string): Promise<void> => {
    if (!payloadText.trim() || pairingBusy) return;
    setPairingBusy(true);
    setMessage('');
    const attempt = await pairAngajatDevice(payloadText, fetch);
    setPairingBusy(false);
    if (attempt.kind === 'PAIRED') { saveAngajatPairing(localStorage, attempt.saved); activate(attempt.saved); return; }
    setMessage(attemptMessage(attempt));
  }, [activate, pairingBusy]);

  // Scanare QR / cod de bare cu camera (BarcodeDetector, unde este disponibil).
  const startCameraScan = useCallback(async (): Promise<void> => {
    setCameraError('');
    const Ctor = barcodeDetectorCtor();
    if (!Ctor) {
      setCameraError('Scanarea cu cameră nu este disponibilă pe acest dispozitiv. Folosește scanerul de coduri sau introdu codul manual.');
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();
      setCameraActive(true);
      const detector = new Ctor({ formats: ['qr_code', 'code_128'] });
      const stop = (): void => {
        setCameraActive(false);
        stream?.getTracks().forEach((track) => track.stop());
      };
      const scan = async (): Promise<void> => {
        while (stream && stream.getTracks().some((track) => track.readyState === 'live')) {
          try {
            const codes = await detector.detect(video);
            if (codes.length > 0 && codes[0].rawValue) { stop(); void connect(codes[0].rawValue); return; }
          } catch { /* cadru neregulat — reîncearcă */ }
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        setCameraActive(false);
      };
      void scan();
    } catch (err) {
      setCameraActive(false);
      stream?.getTracks().forEach((track) => track.stop());
      setCameraError(`Camera nu a putut fi accesată (${err instanceof Error ? err.message : String(err)}). Introdu codul manual.`);
    }
  }, [connect]);

  if (mode === 'ready') return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: 'var(--background)' }}>
      <div className="w-full max-w-md rounded-2xl border p-7 shadow-sm" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
        <h1 className="text-2xl font-extrabold" style={{ color: 'var(--text-primary)' }}>
          {mode === 'offline' ? 'Reconectare la SERVIX…' : 'Conectează dispozitivul'}
        </h1>
        {mode === 'checking' && (
          <p className="mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>Se verifică asocierea dispozitivului…</p>
        )}
        {mode === 'offline' && (
          <div className="mt-4 space-y-3">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Dispozitivul tău este perecheat, dar SERVIX Local Server nu răspunde acum.
              Reîncercăm automat conexiunea prin rețeaua locală.
            </p>
            <button onClick={() => void check()} className="h-11 w-full rounded-lg text-sm font-bold text-white" style={{ background: 'var(--button)' }}>
              Reîncearcă acum
            </button>
          </div>
        )}
        {mode === 'pairing' && (
          <div className="mt-4 space-y-4">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Scanează codul afișat de SERVIX Admin pe PC-ul principal pentru a conecta acest dispozitiv.
            </p>
            {message && <p className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{message}</p>}
            {cameraError && <p className="rounded-lg border p-3 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>{cameraError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => void startCameraScan()} disabled={cameraActive} className="h-12 rounded-lg text-sm font-bold text-white disabled:opacity-60" style={{ background: 'var(--button)' }}>
                {cameraActive ? 'Scanare…' : 'Scanare QR'}
              </button>
              <button onClick={() => void startCameraScan()} disabled={cameraActive} className="h-12 rounded-lg border text-sm font-bold disabled:opacity-60" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                Scanare cod de bare
              </button>
            </div>
            <div>
              <label className="text-xs font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>Cod (scanat sau introdus manual)</label>
              <textarea
                value={payloadInput}
                onChange={(event) => setPayloadInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void connect(payloadInput); } }}
                placeholder="Codul de pairing generat de SERVIX Admin (scanerul de coduri îl introduce automat aici)"
                className="mt-2 h-24 w-full rounded-lg border p-3 text-xs"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
              />
            </div>
            <button onClick={() => void connect(payloadInput)} disabled={pairingBusy} className="h-12 w-full rounded-lg text-sm font-bold text-white disabled:opacity-60" style={{ background: 'var(--button)' }}>
              {pairingBusy ? 'Se conectează…' : 'Conectare'}
            </button>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Scanerul de coduri de bare introduce automat codul în câmpul de mai sus. După conectare, dispozitivul rămâne perecheat.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

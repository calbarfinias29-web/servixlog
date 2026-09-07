import { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, User, Loader2, Check, Ban, Mic, Square, AlertCircle } from 'lucide-react';
import type { AgentMessage } from './agent-types';
import { processMessageMulti } from './agent-intent';
import { handleAgentMessage, confirmPendingOperation, cancelPendingOperation, type AgentFlowResponse } from './agent-write-flow';
import { createRomanianRecognition, isSpeechRecognitionSupported, readFinalTranscript, speechErrorMessage, type SpeechRecognitionLike, type SpeechStatus } from './speech-recognition';

export default function AgentModal({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<AgentMessage[]>([
    { id: '1', role: 'agent', content: 'Salut! Sunt Agentul SERVIX. Te pot ajuta cu informatii despre masini, lucrari, angajati, costuri. Pot crea/actualiza masini si datele clientilor asociati, plus tarifele/TVA si programul de lucru — dupa o confirmare explicita.', timestamp: Date.now() }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingOp, setPendingOp] = useState<AgentFlowResponse['pending'] | null>(null);
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>('IDLE');
  const [speechError, setSpeechError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, pendingOp]);
  useEffect(() => () => { recognitionRef.current?.abort(); }, []);

  const handleStartListening = () => {
    setSpeechError(null);
    if (!isSpeechRecognitionSupported(window)) {
      setSpeechStatus('ERROR');
      setSpeechError('Recunoașterea vocală nu este disponibilă în acest browser.');
      return;
    }
    const recognition = createRomanianRecognition(window);
    if (!recognition) return;
    recognition.onresult = event => {
      const transcript = readFinalTranscript(event);
      if (transcript) setInput(transcript);
      setSpeechStatus('PROCESSING');
    };
    recognition.onerror = event => {
      setSpeechStatus('ERROR');
      setSpeechError(speechErrorMessage(event.error));
    };
    recognition.onend = () => setSpeechStatus(current => current === 'ERROR' ? current : 'IDLE');
    recognitionRef.current = recognition;
    setSpeechStatus('LISTENING');
    try { recognition.start(); } catch { setSpeechStatus('ERROR'); setSpeechError('Recunoașterea vocală nu a putut porni. Agentul text rămâne disponibil.'); }
  };

  const handleStopListening = () => {
    recognitionRef.current?.stop();
    setSpeechStatus('PROCESSING');
  };

  function pushAgent(resp: AgentFlowResponse) {
    setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'agent', content: resp.text, timestamp: Date.now(), error: !resp.success }]);
    setPendingOp(resp.pending ?? null);
  }

  // Butoanele actioneaza DOAR asupra pending operation exact (operationId).
  const handleConfirm = async () => {
    if (!pendingOp || loading) return;
    setLoading(true);
    try { pushAgent(await confirmPendingOperation(pendingOp.operationId)); }
    finally { setLoading(false); }
  };

  const handleCancel = async () => {
    if (!pendingOp || loading) return;
    setLoading(true);
    try { pushAgent(await cancelPendingOperation(pendingOp.operationId)); }
    finally { setLoading(false); }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: input.trim(), timestamp: Date.now() }]);
    const text = input.trim();
    setInput('');
    setLoading(true);
    try {
      const resp = await handleAgentMessage(text, async () => {
        const result = await processMessageMulti(text);
        return { success: result.success, text: result.formattedResponse };
      });
      pushAgent(resp);
    } catch (err) {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'agent', content: 'A aparut o eroare. Incearca din nou.', timestamp: Date.now(), error: true }]);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[600px] w-full max-w-2xl flex-col rounded-2xl border shadow-2xl" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between border-b p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            <Bot size={24} style={{ color: 'var(--primary)' }} />
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Agent SERVIX</h2>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Citire + Scriere controlata (masini/clienti, tarife/TVA/program)</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 transition hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map(msg => (
            <div key={msg.id} className={'flex gap-3 ' + (msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              {msg.role === 'agent' && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)' }}>
                  <Bot size={16} style={{ color: 'var(--primary)' }} />
                </div>
              )}
              <div className={'max-w-[80%] rounded-2xl px-4 py-2 text-sm ' + (msg.error ? 'border' : '')} style={{ background: msg.role === 'user' ? 'var(--primary)' : 'var(--card)', color: msg.role === 'user' ? 'white' : 'var(--text-primary)', borderColor: msg.error ? 'var(--danger)' : 'var(--border)' }}>
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
              {msg.role === 'user' && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)' }}>
                  <User size={16} style={{ color: 'var(--primary)' }} />
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)' }}>
                <Bot size={16} style={{ color: 'var(--primary)' }} />
              </div>
              <div className="rounded-2xl px-4 py-2" style={{ background: 'var(--card)' }}>
                <Loader2 size={16} className="animate-spin" style={{ color: 'var(--primary)' }} />
              </div>
            </div>
          )}
          {pendingOp && (
            <div className="ml-11 rounded-2xl border p-3" style={{ borderColor: 'var(--warning)', background: 'color-mix(in srgb, var(--warning) 8%, transparent)' }}>
              <p className="mb-2 text-xs font-bold uppercase" style={{ color: 'var(--warning)' }}>Confirmare necesara: {pendingOp.action}</p>
              <div className="mb-3 space-y-1">
                {pendingOp.lines.filter(l => l && l !== 'Confirmi modificarea?').map((l, i) => (
                  <p key={i} className="text-sm" style={{ color: 'var(--text-primary)' }}>{l}</p>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={handleConfirm} disabled={loading} className="flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50" style={{ background: 'var(--success)' }}><Check size={15} /> Confirma</button>
                <button onClick={handleCancel} disabled={loading} className="flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50" style={{ background: 'var(--danger)' }}><Ban size={15} /> Anuleaza</button>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="border-t p-4" style={{ borderColor: 'var(--border)' }}>
          {speechError && <div className="mb-2 flex items-center gap-2 text-xs" style={{ color: 'var(--danger)' }}><AlertCircle size={14} />{speechError}</div>}
          <div className="flex gap-2">
            <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSend(); }} placeholder="Intreba despre masini, lucrari, angajati..." className="flex-1 rounded-xl border px-4 py-2 text-sm outline-none" style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
            {speechStatus === 'LISTENING' || speechStatus === 'PROCESSING' ? (
              <button onClick={handleStopListening} disabled={speechStatus === 'PROCESSING'} title="Oprește microfonul" aria-label="Oprește microfonul" className="flex h-10 w-10 items-center justify-center rounded-xl text-white transition hover:brightness-110 disabled:opacity-50" style={{ background: 'var(--danger)' }}><Square size={16} /></button>
            ) : (
              <button onClick={handleStartListening} disabled={loading} title="Pornește microfonul" aria-label="Pornește microfonul" className="flex h-10 w-10 items-center justify-center rounded-xl transition hover:brightness-110 disabled:opacity-50" style={{ background: speechStatus === 'ERROR' ? 'var(--danger)' : 'var(--card)', color: speechStatus === 'ERROR' ? 'white' : 'var(--text-primary)', border: '1px solid var(--border)' }}><Mic size={18} /></button>
            )}
            <button onClick={handleSend} disabled={loading || !input.trim()} className="flex h-10 w-10 items-center justify-center rounded-xl text-white transition hover:brightness-110 disabled:opacity-50" style={{ background: 'var(--primary)' }}>
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

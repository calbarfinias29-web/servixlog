import { X } from 'lucide-react';

// Componente extrase din App.tsx VERBATIM pentru reutilizare (Admin + Angajat).
// Comportamentul vizual este identic cu cel existent.
export function IconButton({ label, onClick, children, tone = 'default' }: { label: string; onClick?: () => void; children: React.ReactNode; tone?: 'default' | 'danger' }) {
  return <button aria-label={label} onClick={onClick} className={`rounded-lg p-2 transition-colors ${tone === 'danger' ? 'text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] hover:text-[var(--danger)]' : 'text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)]'}`}>{children}</button>;
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"><div className={`max-h-[90vh] ${wide ? 'max-w-4xl' : 'max-w-2xl'} w-full overflow-auto rounded-2xl bg-[var(--surface)] shadow-2xl`}><div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5"><div><p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--primary)' }}>SERVIX</p><h2 className="mt-1 text-xl font-bold text-[var(--text-primary)]">{title}</h2></div><IconButton label="Închide" onClick={onClose}><X size={20} /></IconButton></div>{children}</div></div>;
}

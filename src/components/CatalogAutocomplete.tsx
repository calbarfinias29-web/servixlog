import { useEffect, useRef, useState } from 'react';
import { normalizeSearch, searchIncludes } from '@/lib/search';

export interface CatalogOption {
  id: string;
  name: string;
  normalized_name: string;
  make_id?: string;
}

interface CatalogAutocompleteProps {
  label: string;
  value: string;
  options: CatalogOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function CatalogAutocomplete({ label, value, options, onChange, placeholder, disabled = false }: CatalogAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const query = normalizeSearch(value);
  const suggestions = options.filter((option) => !query || searchIncludes(option.name, query)).slice(0, 8);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  return <div ref={rootRef} className="relative">
    <label className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">{label}
      <input value={value} disabled={disabled} placeholder={placeholder} onFocus={() => setOpen(true)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} onChange={(event) => { onChange(event.target.value); setOpen(true); }} className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-60" />
    </label>
    {open && suggestions.length > 0 && <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border bg-[var(--surface)] shadow-lg" style={{ borderColor: 'var(--border)' }}>
      {suggestions.map((option) => <button type="button" key={option.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option.name); setOpen(false); }} className="block w-full px-3 py-2 text-left text-sm font-semibold transition hover:bg-[var(--surface-secondary)]" style={{ color: 'var(--text-primary)' }}>{option.name}</button>)}
    </div>}
  </div>;
}

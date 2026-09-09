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
  /** Fallback minim și controlat (distanță Levenshtein <=1), folosit DOAR când substring matching nu găsește nimic. */
  fuzzyFallback?: boolean;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** true dacă `query` se potrivește aproximativ (max. 1 diferență) cu o fereastră din `target`. */
function fuzzyIncludes(target: string, query: string): boolean {
  if (query.length < 4 || target.length < 3) return false;
  for (const winLen of [query.length - 1, query.length, query.length + 1]) {
    if (winLen < 2) continue;
    for (let start = 0; start + winLen <= target.length; start += 1) {
      if (levenshtein(target.slice(start, start + winLen), query) <= 1) return true;
    }
  }
  return false;
}

export function CatalogAutocomplete({ label, value, options, onChange, placeholder, disabled = false, fuzzyFallback = false }: CatalogAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const query = normalizeSearch(value);
  const substringMatches = options.filter((option) => !query || searchIncludes(option.name, query));
  // Fallback minim: doar dacă substring matching nu a găsit nimic ȘI query-ul are sens (nu e prea scurt).
  const suggestions = (substringMatches.length > 0 || !fuzzyFallback || !query
    ? substringMatches
    : options.filter((option) => fuzzyIncludes(option.normalized_name, query))
  ).slice(0, 8);

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

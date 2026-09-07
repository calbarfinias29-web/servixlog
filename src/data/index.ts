/**
 * SERVIX — Data Adapter (export public)
 *
 * Punct unic de acces la stratul de date.
 *
 * Default: SupabaseDataAdapter → Supabase.
 * LOCAL: opt-in, prin enableLocalMode() / disableLocalMode().
 *        LocalDataAdapter → Local Server → SQLite.
 *
 * SUPABASE RĂMÂNE IMPLICIT. Local Mode este OPT-IN.
 *
 * Notă: în modul LOCAL nu există fallback automat către Supabase — dacă
 * Local Server nu răspunde, se întoarce eroarea clară (vezi LocalDataAdapter).
 */
import { SupabaseDataAdapter } from './SupabaseDataAdapter';
import { LocalDataAdapter, DEFAULT_LOCAL_SERVER_URL } from './LocalDataAdapter';
import { DefaultAdapterRegistry } from './registry';

import type { DataAdapter, QueryResult, CarActivityEntry, EmployeeTimeEntry } from './DataAdapter';

export type { DataAdapter, QueryResult, CarActivityEntry, EmployeeTimeEntry } from './DataAdapter';
export { SupabaseDataAdapter } from './SupabaseDataAdapter';
export { LocalDataAdapter, DEFAULT_LOCAL_SERVER_URL } from './LocalDataAdapter';
export { DefaultAdapterRegistry, type AdapterRegistry, type AdapterKind } from './registry';

/** URL local configurabil prin VITE_SERVIX_LOCAL_URL (default localhost). */
function localServerUrl(): string {
  const envUrl = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SERVIX_LOCAL_URL;
  return envUrl && envUrl.trim() ? envUrl.trim() : DEFAULT_LOCAL_SERVER_URL;
}

/**
 * Registry-ul global al adapter-ului activ.
 * Default = Supabase; LOCAL se activează doar explicit.
 */
export const registry = new DefaultAdapterRegistry(
  {
    supabase: () => new SupabaseDataAdapter(),
    local: (baseUrl) => new LocalDataAdapter(baseUrl),
  },
  localServerUrl(),
);

/**
 * Instanța publică folosită de aplicație. Proxy către adapter-ul activ,
 * astfel încât switch-ul LOCAL/SUPABASE nu impune modificarea apelanților.
 */
export const dataAdapter: DataAdapter = new Proxy(registry, {
  get(target, prop) {
    const active = (target as unknown as { adapter: () => DataAdapter }).adapter() as unknown as Record<string, unknown>;
    const value = active[prop as string];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(active) : value;
  },
}) as unknown as DataAdapter;

/** Activează Local Mode (opt-in). Fără fallback automat către Supabase. */
export function enableLocalMode(baseUrl?: string): void {
  registry.enableLocal(baseUrl ?? localServerUrl());
}

/** Revine la Supabase (comportamentul implicit). */
export function disableLocalMode(): void {
  registry.enableSupabase();
}

/** Adapter-ul activ (pentru diagnostice/teste). */
export function getActiveAdapter(): DataAdapter {
  return registry.adapter();
}
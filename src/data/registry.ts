/**
 * SERVIX — Adapter Registry (FAZA 4)
 *
 * Mecanism controlat de selectare a adapter-ului activ.
 *
 * Default: SUPABASE.
 * LOCAL: opt-in, prin enableLocal(baseUrl).
 *
 * Acesta este un modul PUR (fără importuri de Supabase / env), ca să fie
 * testabil izolat. index.ts îl folosește cu fabrici reale (Supabase /
 * LocalDataAdapter) și expune selectorii către aplicație.
 */
import type { DataAdapter } from './DataAdapter';

export type AdapterKind = 'supabase' | 'local';

export interface AdapterRegistry {
  readonly kind: AdapterKind;
  adapter(): DataAdapter;
  enableLocal(baseUrl?: string): void;
  enableSupabase(): void;
}

export interface AdapterFactories {
  supabase: () => DataAdapter;
  local: (baseUrl: string) => DataAdapter;
}

export class DefaultAdapterRegistry implements AdapterRegistry {
  private _kind: AdapterKind = 'supabase';
  private current: DataAdapter;
  private readonly factories: AdapterFactories;
  private readonly defaultBaseUrl: string;

  constructor(factories: AdapterFactories, defaultBaseUrl: string) {
    this.factories = factories;
    this.defaultBaseUrl = defaultBaseUrl;
    this.current = factories.supabase();
  }

  get kind(): AdapterKind {
    return this._kind;
  }

  adapter(): DataAdapter {
    return this.current;
  }

  enableLocal(baseUrl?: string): void {
    this._kind = 'local';
    this.current = this.factories.local(baseUrl || this.defaultBaseUrl);
  }

  enableSupabase(): void {
    this._kind = 'supabase';
    this.current = this.factories.supabase();
  }
}
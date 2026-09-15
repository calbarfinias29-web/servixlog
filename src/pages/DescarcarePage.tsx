import { useState } from 'react';
import { Download, Monitor, Wrench, Info } from 'lucide-react';
import { SERVIX_VERSION } from '@/version';

export const DOWNLOAD_URLS = {
  admin: (import.meta.env?.VITE_SERVIX_ADMIN_DOWNLOAD_URL as string | undefined)?.trim() || '',
  angajat: (import.meta.env?.VITE_SERVIX_ANGAJAT_DOWNLOAD_URL as string | undefined)?.trim() || '',
  companion: (import.meta.env?.VITE_SERVIX_COMPANION_DOWNLOAD_URL as string | undefined)?.trim() || '',
} as const;

const products = [
  { key: 'admin', name: 'SERVIX Admin', description: 'Pentru PC-ul principal al atelierului', url: DOWNLOAD_URLS.admin },
  { key: 'angajat', name: 'SERVIX Angajat', description: 'Pentru tabletă/PC folosit de angajați', url: DOWNLOAD_URLS.angajat },
  { key: 'companion', name: 'SERVIX Companion', description: 'Pentru PC secundar', url: DOWNLOAD_URLS.companion },
] as const;

function downloadProduct(url: string): void {
  if (!url) return;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export default function DescarcarePage() {
  const [downloadError, setDownloadError] = useState(false);

  const steps: [string, string][] = [
    ['Alege installerul potrivit.', 'Admin se instalează pe PC-ul principal, Angajat pe tableta/PC-ul angajatului, iar Companion pe PC-ul secundar.'],
    ['Descarcă și rulează installerul.', 'Salvează fișierul pe dispozitivul potrivit și urmează pașii instalației Windows.'],
    ['Deschide SERVIX și finalizează configurarea.', 'La prima pornire, completează datele atelierului și creează conturile angajaților.'],
  ];

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)', color: 'var(--text-primary)', colorScheme: 'light' }}>
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-10 sm:px-6 sm:py-14">
        {/* Branding */}
        <header className="flex flex-col items-center text-center">
          <img src="/servix-logo.svg" alt="SERVIX" className="h-14 w-auto sm:h-16" />
          <h1 className="mt-5 text-2xl font-extrabold tracking-tight sm:text-3xl">SERVIX — Atelier Management</h1>
          <p className="mt-2 text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
            Sistem complet de management pentru atelier auto
          </p>
        </header>

        {/* Card download */}
        <section
          className="mt-8 rounded-2xl border p-6 shadow-sm sm:mt-10 sm:p-8"
          style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <span
              className="flex h-11 w-11 flex-none items-center justify-center rounded-xl text-white"
              style={{ background: 'var(--primary)' }}
            >
              <Monitor size={22} />
            </span>
            <div>
              <h2 className="text-lg font-bold sm:text-xl">SERVIX pentru Windows</h2>
              <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                Versiune {SERVIX_VERSION} · Windows 10/11 (64-bit)
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {products.map((product) => (
              <div key={product.key} className="rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-[16px] font-bold">{product.name}</h3>
                    <p className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{product.description}</p>
                  </div>
                  <button
                    type="button"
                    disabled={!product.url}
                    onClick={() => {
                      setDownloadError(false);
                      try { downloadProduct(product.url); } catch { setDownloadError(true); }
                    }}
                    className="flex min-h-[46px] shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[220px]"
                    style={{ background: 'var(--button)' }}
                    title={product.url ? undefined : 'URL-ul public nu este configurat încă.'}
                  >
                    <Download size={18} />
                    Descarcă {product.name}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            Versiunea {SERVIX_VERSION} — release de test.
          </p>
          {downloadError && (
            <p className="mt-3 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
              Descărcarea a eșuat. Încearcă din nou.
            </p>
          )}

        </section>

        {/* Instalare */}
        <section className="mt-8 sm:mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>
            Instalare
          </h2>
          <ol className="mt-3 space-y-3">
            {steps.map(([title, desc], i) => (
              <li
                key={title}
                className="flex items-start gap-3 rounded-xl border p-4 shadow-sm"
                style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
              >
                <span
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-[14px] font-bold"
                  style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' }}
                >
                  {i + 1}
                </span>
                <div>
                  <p className="text-[15px] font-semibold">{title}</p>
                  <p className="mt-1 text-[13px] leading-snug" style={{ color: 'var(--text-secondary)' }}>{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>


        {/* Dispozitive */}
        <section
          className="mt-8 flex items-start gap-3 rounded-xl border p-4 shadow-sm sm:mt-10"
          style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <span
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg"
            style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' }}
          >
            <Info size={16} />
          </span>
          <div>
            <p className="text-[15px] font-semibold">Alte dispozitive</p>
            <p className="mt-1 text-[13px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
              Tabletele și PC-urile secundare se conectează ulterior la SERVIX prin rețeaua locală.
            </p>
          </div>
        </section>

        <footer className="mt-10 flex items-center justify-center gap-2 pb-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          <Wrench size={13} /> SERVIX · Atelier Management · v{SERVIX_VERSION}
        </footer>
      </div>
    </div>
  );
}

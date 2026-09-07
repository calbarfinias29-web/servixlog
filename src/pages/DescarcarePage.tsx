import { useState } from 'react';
import { Download, Monitor, Wrench, ShieldCheck, Info } from 'lucide-react';
import { SERVIX_VERSION } from '@/version';

/**
 * Placeholder configurabil pentru URL-ul installerului Windows.
 * Se poate completa ulterior:
 *  - prin variabila de mediu VITE_SERVIX_DOWNLOAD_URL (ex. în .env sau la build),
 *  - sau direct aici, în DOWNLOAD_URL_FALLBACK.
 */
export const DOWNLOAD_URL_FALLBACK = '';

function downloadUrl(): string {
  const envUrl = import.meta.env?.VITE_SERVIX_DOWNLOAD_URL as string | undefined;
  return (envUrl && envUrl.trim()) || DOWNLOAD_URL_FALLBACK;
}

export default function DescarcarePage() {
  const url = downloadUrl();
  const [downloadError, setDownloadError] = useState(false);

  const handleDownload = () => {
    if (!url) return;
    setDownloadError(false);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setDownloadError(true);
    }
  };

  const steps: [string, string][] = [
    ['Descarcă installerul.', 'Apasă butonul de mai sus și salvează fișierul de instalare pe PC.'],
    ['Rulează installerul pe PC-ul principal al atelierului.', 'Deschide fișierul descărcat și urmează pașii instalației.'],
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

          {url ? (
            <button
              onClick={handleDownload}
              className="mt-6 flex h-[56px] w-full items-center justify-center gap-3 rounded-xl text-[16px] font-bold text-white transition hover:brightness-110 sm:text-[17px]"
              style={{ background: 'var(--button)' }}
            >
              <Download size={22} />
              Descarcă SERVIX pentru Windows
            </button>
          ) : (
            <div className="mt-6">
              <button
                disabled
                className="flex h-[56px] w-full cursor-not-allowed items-center justify-center gap-3 rounded-xl text-[16px] font-bold text-white opacity-60 sm:text-[17px]"
                style={{ background: 'var(--button)' }}
                title="Linkul de descărcare va fi disponibil în curând."
              >
                <Download size={22} />
                Descarcă SERVIX pentru Windows
              </button>
              <p className="mt-3 text-center text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                Linkul de descărcare va fi activat în curând.
              </p>
            </div>
          )}
          {downloadError && (
            <p className="mt-3 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
              Descărcarea a eșuat. Încearcă din nou.
            </p>
          )}

          <div className="mt-5 flex items-center justify-center gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <ShieldCheck size={14} style={{ color: 'var(--success)' }} />
            Installer oficial SERVIX, semnat și verificat.
          </div>
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

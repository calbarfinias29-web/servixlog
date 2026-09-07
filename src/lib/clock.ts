/**
 * Formatare ORĂ + DATĂ pentru ecranele mari (Panou Angajat + „Cine preia tableta?”).
 *
 * Folosește ora LOCALĂ a dispozitivului, format 24h, localizare română.
 * Helper pur, partajat de Web și Local — aceeași sursă pentru ambele moduri.

 */

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Ora locală a dispozitivului, format 24h „HH:MM” (e.g. „20:35”). */
export function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('ro-RO', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23', // 00–23 → „00:05″ nu „24:05″
  });
}

/** Data locală a dispozitivului în română, e.g. „Luni, 7 septembrie 2026”. */
export function formatClockDate(ms: number): string {
  const d = new Date(ms);
  const ro = d.toLocaleDateString('ro-RO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return capitalize(ro);
}
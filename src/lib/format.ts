// Mutat VERBATIM din App.tsx pentru reutilizare (Admin + Panou Angajat).
export function formatShortDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes.toString().padStart(2, '0')}m` : `${minutes}m`;
}

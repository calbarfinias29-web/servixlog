// Normalizare căutare SERVIX: case-insensitive + eliminare diacritice
// românești (ă/â/ș/ț/î și formele legacy ş/ţ) + eliminarea spațiilor.
// Folosită de TOATE căutările din aplicație (Admin + Panou Angajat) —
// un singur sistem de normalizare.
export function normalizeSearch(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ş/g, 's').replace(/ţ/g, 't')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/\s/g, '');
}

export function searchIncludes(value: string | null | undefined, query: string | null | undefined): boolean {
  return normalizeSearch(value).includes(normalizeSearch(query));
}

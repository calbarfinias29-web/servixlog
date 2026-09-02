export function normalizeSearch(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s/g, '');
}

export function searchIncludes(value: string | null | undefined, query: string | null | undefined): boolean {
  return normalizeSearch(value).includes(normalizeSearch(query));
}

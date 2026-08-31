// ============================================================
// SERVICEX — CATALOG VEHICULE: MARCĂ + MODEL → IMAGINE
//
// Sursă unică de adevăr pentru imaginea mașinii din dashboard.
// Fără VIN, fără upload obligatoriu, fără servicii externe.
//
// Convenție assets (documentată în public/vehicles/README.md):
//   public/vehicles/<marca>/<model>.png          — imagine model (3/4)
//   public/vehicles/<marca>/<model>/<an>.png     — varianta de generație (opțional)
//   public/vehicles/<marca>.svg                  — imagine marcă (fallback)
//   public/vehicles/placeholder.svg              — placeholder ServiceX (final)
// Fișierele de model lipsesc implicit — fallback-ul este automat
// (model → marcă → placeholder), niciodată imagine spartă.
// ============================================================

export interface VehicleModel {
  name: string;
  /** Alias-uri acceptate la potrivirea modelului introdus de utilizator. */
  aliases?: string[];
}

export interface VehicleBrand {
  make: string;
  /** Alias-uri pentru marcă (ex: „Mercedes-Benz”, „Mercedes Benz”). */
  aliases?: string[];
  models: VehicleModel[];
}

export const VEHICLE_CATALOG: VehicleBrand[] = [
  {
    make: 'Mercedes', aliases: ['mercedes-benz', 'mercedes benz', 'mercedesbenz', 'mb'],
    models: [
      { name: 'Clasa A', aliases: ['a-class', 'a class', 'aclas'] },
      { name: 'Clasa B', aliases: ['b-class', 'b class', 'bclas'] },
      { name: 'Clasa C', aliases: ['c-class', 'c class', 'cclas', 'c'] },
      { name: 'Clasa E', aliases: ['e-class', 'e class', 'eclas', 'e'] },
      { name: 'Clasa S', aliases: ['s-class', 's class', 'sclas', 's'] },
      { name: 'GLA' }, { name: 'GLC' }, { name: 'GLE' },
    ],
  },
  {
    make: 'BMW',
    models: [
      { name: 'Seria 1', aliases: ['serie 1', 'seria1', '1 series', '1series', '1er'] },
      { name: 'Seria 3', aliases: ['serie 3', 'seria3', '3 series', '3series', '3er'] },
      { name: 'Seria 5', aliases: ['serie 5', 'seria5', '5 series', '5series', '5er'] },
      { name: 'Seria 7', aliases: ['serie 7', 'seria7', '7 series', '7series', '7er'] },
      { name: 'X1' }, { name: 'X3' }, { name: 'X5' },
    ],
  },
  {
    make: 'Audi',
    models: [
      { name: 'A3' }, { name: 'A4' }, { name: 'A6' }, { name: 'A8' },
      { name: 'Q3' }, { name: 'Q5' }, { name: 'Q7' },
    ],
  },
];

/** Slug pentru căi de fișiere: „Clasa C” → „clasa-c”. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Normalizare tolerantă la variante: lowercase, fără diacritice,
 * separatori (spații, cratime, puncte) eliminați.
 * „Mercedes-Benz” / „ MB ” / „3 Series” → forme comparabile.
 * NU modifică valoarea originală din DB — doar căutarea.
 */
function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** Găsește marca din catalog după nume sau alias (case-insensitive, tolerant). */
export function findBrand(make: string | null | undefined): VehicleBrand | null {
  if (!make) return null;
  const m = normalizeKey(make.trim());
  if (!m) return null;
  return VEHICLE_CATALOG.find((b) => normalizeKey(b.make) === m || (b.aliases ?? []).some((a) => normalizeKey(a) === m)) ?? null;
}

/** Găsește modelul din catalog (case-insensitive, inclusiv alias-uri, tolerant). */
export function findModel(make: string | null | undefined, model: string | null | undefined): VehicleModel | null {
  const brand = findBrand(make);
  if (!brand || !model) return null;
  const mm = normalizeKey(model.trim());
  if (!mm) return null;
  return brand.models.find((mo) => normalizeKey(mo.name) === mm || (mo.aliases ?? []).some((a) => normalizeKey(a) === mm)) ?? null;
}

/** Liste pentru autocomplete în formulare (Marcă → Model). */
export const VEHICLE_MAKES: string[] = VEHICLE_CATALOG.map((b) => b.make);
export function modelsFor(make: string | null | undefined): string[] {
  return findBrand(make)?.models.map((m) => m.name) ?? [];
}

export interface VehicleImageChain {
  /** Lista de src-uri de încercat, în ordinea priorității. */
  sources: string[];
  /**
   * 0 = imagine încărcată de utilizator (photo_url) dacă există;
   * altfel primul src din catalog. Componenta pornește de aici.
   */
  startIndex: number;
}

/**
 * Prioritate: Marcă → Model → An (dacă există) → imagine.
 * Construită ca lanț de fallback-uri; componenta trece la următorul
 * src doar la onError, deci niciodată nu se afișează imagine spartă.
 *
 * Lanț complet per model:
 *   1. photo_url (dacă există — prioritate maximă, „fotografie încărcată")
 *   2. /vehicles/<marca>/<model>/<decada>.png   — generație (opțional)
 *   3. /vehicles/<marca>/<model>.png            — fotografie reală (dacă adminul a adăugat-o)
 *   4. /vehicles/<marca>/<model>.svg            — ilustrația vectorială inclusă în proiect
 *   5. /vehicles/<marca>.svg                    — fallback marcă
 *   6. /vehicles/placeholder.svg                — placeholder ServiceX
 */
export function exactVehicleAssetPath(make: string | null | undefined, model: string | null | undefined): string | null {
  const brand = findBrand(make);
  const mo = findModel(make, model);
  if (!brand || !mo) return null;

  const exactPaths: Record<string, string> = {
    'bmw|seria7': `/vehicles/${slug(brand.make)}/${slug(mo.name)}.svg`,
    'bmw|seria3': `/vehicles/${slug(brand.make)}/${slug(mo.name)}.svg`,
    'mercedes|clasac': `/vehicles/${slug(brand.make)}/${slug(mo.name)}.svg`,
    'mercedes|glc': `/vehicles/${slug(brand.make)}/${slug(mo.name)}.svg`,
    'audi|a4': `/vehicles/${slug(brand.make)}/${slug(mo.name)}.svg`,
    'audi|q5': `/vehicles/${slug(brand.make)}/${slug(mo.name)}.svg`,
  };

  const key = `${normalizeKey(brand.make)}|${normalizeKey(mo.name)}`;
  return exactPaths[key] ?? null;
}

export function vehicleImageSources(make: string | null | undefined, model: string | null | undefined, year?: number | null, photoUrl?: string | null): VehicleImageChain {
  const sources: string[] = [];
  // photo_url are prioritate DOAR dacă e un URL valid (http/https/data/blob).
  // Un string gol sau invalid este ignorat — nu produce „imagine spartă”.
  if (photoUrl && /^(https?:|data:|blob:)/i.test(photoUrl.trim())) sources.push(photoUrl.trim());

  const exactPath = exactVehicleAssetPath(make, model);
  if (exactPath) sources.push(exactPath);

  const brand = findBrand(make);
  const mo = findModel(make, model);
  if (brand && mo) {
    const dir = `/vehicles/${slug(brand.make)}/${slug(mo.name)}`;
    if (year && year > 1980) {
      // Varianta de generație pe decadă (dacă există în assets — altfel onError trece mai departe).
      const decade = Math.floor(year / 10) * 10;
      sources.push(`${dir}/${decade}.png`);
    }
    sources.push(`${dir}.png`);
    sources.push(`${dir}.svg`);
  }
  if (brand) sources.push(`/vehicles/${slug(brand.make)}.svg`);
  sources.push('/vehicles/placeholder.svg');
  return { sources: Array.from(new Set(sources.filter(Boolean))), startIndex: 0 };
}

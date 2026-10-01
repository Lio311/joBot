// Search criteria and city metadata shared by the scraper and the dashboard.

export const CRITERIA = {
  minRooms: 4,
  maxRooms: 5,
  minPrice: 2_000_000,
  maxPrice: 4_500_000,
} as const;

export type Priority = 1 | 2 | 3 | 4;

export const PRIORITY_LABEL: Record<Priority, string> = {
  1: "Top",
  2: "High",
  3: "Medium",
  4: "Low",
};

/** Keys of the built-in cities. Cities added from the dashboard use their own slugs. */
export type CityKey =
  | "tel-aviv"
  | "herzliya"
  | "givatayim"
  | "ramat-gan"
  | "savyon"
  | "kiryat-ono"
  | "raanana"
  | "ramat-hasharon"
  | "netanya";

export interface City {
  /** A CityKey for built-in cities, a slug for cities added from the dashboard. */
  key: string;
  name: string;
  he: string;
  priority: Priority;
  /** Yad2 numeric city code (the CBS settlement code). */
  yad2: string;
  /** City name as OnMap's API and Homeless' URL expect it. */
  onmap: string;
  homeless: string;
  /** Spellings seen in free text (Facebook posts, Madlan). */
  aliases: string[];
  /** Added from the dashboard (tracked_cities table) rather than built in. */
  custom?: boolean;
}

export const CITIES: City[] = [
  {
    key: "tel-aviv",
    name: "Tel Aviv",
    he: "תל אביב",
    priority: 1,
    yad2: "5000",
    onmap: "תל אביב יפו",
    homeless: "תל אביב",
    aliases: ["תל אביב", "תל-אביב", "ת\"א", "ת״א", "יפו", "tel aviv", "tel-aviv"],
  },
  {
    key: "herzliya",
    name: "Herzliya",
    he: "הרצליה",
    priority: 2,
    yad2: "6400",
    onmap: "הרצליה",
    homeless: "הרצליה",
    aliases: ["הרצליה", "הרצלייה", "herzliya", "herzeliya"],
  },
  {
    key: "givatayim",
    name: "Givatayim",
    he: "גבעתיים",
    priority: 3,
    yad2: "6300",
    onmap: "גבעתיים",
    homeless: "גבעתיים",
    aliases: ["גבעתיים", "גבעתים", "givatayim"],
  },
  {
    key: "ramat-gan",
    name: "Ramat Gan",
    he: "רמת גן",
    priority: 3,
    yad2: "8600",
    onmap: "רמת גן",
    homeless: "רמת גן",
    aliases: ["רמת גן", "רמת-גן", "ר\"ג", "ר״ג", "ramat gan", "ramat-gan"],
  },
  {
    key: "savyon",
    name: "Savyon",
    he: "סביון",
    priority: 3,
    yad2: "587",
    onmap: "סביון",
    homeless: "סביון",
    aliases: ["סביון", "savyon"],
  },
  {
    key: "kiryat-ono",
    name: "Kiryat Ono",
    he: "קרית אונו",
    priority: 3,
    yad2: "2620",
    onmap: "קרית אונו",
    homeless: "קרית אונו",
    aliases: ["קרית אונו", "קריית אונו", "kiryat ono"],
  },
  {
    key: "raanana",
    name: "Raanana",
    he: "רעננה",
    priority: 3,
    yad2: "8700",
    onmap: "רעננה",
    homeless: "רעננה",
    aliases: ["רעננה", "raanana", "ra'anana"],
  },
  {
    key: "ramat-hasharon",
    name: "Ramat HaSharon",
    he: "רמת השרון",
    priority: 3,
    yad2: "2650",
    onmap: "רמת השרון",
    homeless: "רמת השרון",
    aliases: ["רמת השרון", "רמת-השרון", "רמה\"ש", "רמה״ש", "ramat hasharon", "ramat ha-sharon"],
  },
  {
    key: "netanya",
    name: "Netanya",
    he: "נתניה",
    priority: 4,
    yad2: "7400",
    onmap: "נתניה",
    homeless: "נתניה",
    aliases: ["נתניה", "netanya"],
  },
];

export const CITY_BY_KEY = Object.fromEntries(CITIES.map((c) => [c.key, c])) as Record<CityKey, City>;

/** Most cities that can be added from the dashboard on top of the built-ins. */
export const MAX_CUSTOM_CITIES = 8;

/** "TEL AVIV - YAFO" → "Tel Aviv - Yafo"; letters after an apostrophe stay lowercase ("Ra'anana"). */
export const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s\-(/])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());

/**
 * Display name for a stored city key. Looks in `cities` (pass the merged list when you
 * have it), then the built-ins, and otherwise title-cases the key: custom city keys are
 * slugs of their English name.
 */
export function cityName(key: string, cities: readonly City[] = CITIES): string {
  return cities.find((c) => c.key === key)?.name ?? CITY_BY_KEY[key as CityKey]?.name ?? titleCase(key.replace(/-/g, " "));
}

/**
 * Built-in cities followed by the custom ones (skipping any that duplicate a built-in).
 * Built-ins keep their order so scraping them works exactly as before; with no custom
 * cities this returns CITIES itself.
 */
export function mergeCities(custom: readonly City[]): City[] {
  if (!custom.length) return CITIES;
  const taken = new Set(CITIES.flatMap((c) => [c.key, c.yad2]));
  const extra = custom
    .filter((c) => !taken.has(c.key) && !taken.has(c.yad2))
    .sort((a, b) => a.priority - b.priority);
  return [...CITIES, ...extra];
}

const normalizeText = (s: string) =>
  s.toLowerCase().replace(/[֑-ׇ]/g, "").replace(/\s+/g, " ").trim();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface AliasEntry {
  alias: string;
  city: City;
  /**
   * Custom cities match on word boundaries (allowing Hebrew prefix letters such as
   * ב/ל/מ), so a short name like "גת" doesn't fire inside "קרית גת". Built-ins keep
   * plain substring matching.
   */
  re: RegExp | null;
}

const aliasIndexes = new WeakMap<readonly City[], AliasEntry[]>();

function aliasIndex(cities: readonly City[]): AliasEntry[] {
  let index = aliasIndexes.get(cities);
  if (!index) {
    index = cities
      .flatMap((c) =>
        c.aliases.map((a) => {
          const alias = normalizeText(a);
          const re = c.custom
            ? new RegExp(`(?:^|[^\\p{L}\\p{N}])[ובכלמשה]{0,3}${escapeRe(alias)}(?![\\p{L}\\p{N}])`, "u")
            : null;
          return { alias, city: c, re };
        }),
      )
      .sort((a, b) => b.alias.length - a.alias.length);
    aliasIndexes.set(cities, index);
  }
  return index;
}

/** Resolve a free-text city name to a tracked city; longer aliases win. */
export function matchCity(text: string | null | undefined, cities: readonly City[] = CITIES): City | null {
  if (!text) return null;
  const t = normalizeText(text);
  for (const { alias, city, re } of aliasIndex(cities)) if (re ? re.test(t) : t.includes(alias)) return city;
  return null;
}

export function inCriteria(l: { rooms: number | null; price: number | null }): boolean {
  if (l.price == null || l.rooms == null) return false;
  return (
    l.rooms >= CRITERIA.minRooms &&
    l.rooms <= CRITERIA.maxRooms &&
    l.price >= CRITERIA.minPrice &&
    l.price <= CRITERIA.maxPrice
  );
}

export const SOURCES = {
  yad2: { name: "Yad2" },
  onmap: { name: "OnMap" },
  homeless: { name: "Homeless" },
  madlan: { name: "Madlan" },
  "fb-group": { name: "FB Group" },
  "fb-marketplace": { name: "Marketplace" },
} as const;

export type SourceKey = keyof typeof SOURCES;

// Resolves user input to an official settlement from the CBS list (רשימת ישובים בישראל)
// published on data.gov.il, and derives everything the scraper needs to search it.

import { titleCase } from "./config";

/** data.gov.il CKAN resource "רשימת ישובים בישראל - מתעדכן" (dataset citiesandsettelments). */
const RESOURCE_ID = "5c78e9fa-c2e2-4771-93ff-7f400a12f7ba";
const DATASTORE = "https://data.gov.il/api/3/action/datastore_search";
const F_CODE = "סמל_ישוב";
const F_HE = "שם_ישוב";
const F_EN = "שם_ישוב_לועזי";

/** One CBS settlement. The code is also Yad2's city code. */
export interface Settlement {
  code: string;
  he: string;
  /** Upper-case CBS transliteration, e.g. "RA'ANANA"; empty for a handful of rows. */
  en: string;
}

const TTL = 24 * 3600_000;
let cache: { at: number; list: Promise<Settlement[]> } | null = null;

/** The whole list (~1.3k rows, one request), kept in memory for a day. Failures aren't cached. */
export function settlements(): Promise<Settlement[]> {
  if (!cache || Date.now() - cache.at > TTL) {
    const list = fetchSettlements();
    cache = { at: Date.now(), list };
    list.catch(() => {
      if (cache?.list === list) cache = null;
    });
  }
  return cache.list;
}

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

async function fetchSettlements(): Promise<Settlement[]> {
  const out = new Map<string, Settlement>();
  for (let offset = 0, total = Infinity; offset < total; ) {
    const q = new URLSearchParams({
      resource_id: RESOURCE_ID,
      fields: [F_CODE, F_HE, F_EN].join(","),
      limit: "2000",
      offset: String(offset),
    });
    const res = await fetch(`${DATASTORE}?${q}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`data.gov.il HTTP ${res.status}`);
    const body = (await res.json()) as { success?: boolean; result?: { total?: number; records?: Record<string, unknown>[] } };
    const records = body.result?.records ?? [];
    if (!body.success || !records.length) break;
    for (const r of records) {
      // Values come padded with trailing spaces in some releases of the file.
      const code = clean(r[F_CODE]).replace(/^0+(?=\d)/, "");
      const he = clean(r[F_HE]);
      if (/^\d+$/.test(code) && code !== "0" && he) out.set(code, { code, he, en: clean(r[F_EN]) });
    }
    total = body.result?.total ?? 0;
    offset += records.length;
  }
  if (!out.size) throw new Error("data.gov.il returned no settlements");
  return [...out.values()];
}

/* ───────────── Matching ───────────── */

/** Folds the spelling differences people type: niqqud, quotes, dashes, double yod / vav. */
export function fold(s: string) {
  return s
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "")
    .replace(/["'`׳״]/g, "")
    .replace(/[-–־_.,()]/g, " ")
    .replace(/יי/g, "י")
    .replace(/וו/g, "ו")
    .replace(/\s+/g, " ")
    .trim();
}

function score(q: string, name: string): number {
  if (!name) return Infinity;
  if (name === q) return 0;
  if (name.startsWith(`${q} `)) return 0.5; // whole first word: "פתח" → פתח תקווה before פתחיה
  if (name.startsWith(q)) return 1;
  if (name.includes(` ${q}`)) return 2;
  if (name.includes(q)) return 3;
  return Infinity;
}

/** Best CBS matches for free text, Hebrew or English. */
export function searchSettlements(list: Settlement[], query: string, limit = 6): Settlement[] {
  const q = fold(query);
  if (!q) return [];
  return list
    .map((s) => ({ s, rank: Math.min(score(q, fold(s.he)), score(q, fold(s.en)) + 0.5) }))
    .filter((x) => x.rank < Infinity)
    .sort((a, b) => a.rank - b.rank || a.s.he.length - b.s.he.length || a.s.he.localeCompare(b.s.he, "he"))
    .slice(0, limit)
    .map((x) => x.s);
}

/** An exact (folded) Hebrew or English name match. */
export function findExact(list: Settlement[], query: string): Settlement | null {
  const q = fold(query);
  return (q && list.find((s) => fold(s.he) === q || fold(s.en) === q)) || null;
}

/* ───────────── Deriving the city record ───────────── */

/** "תל אביב - יפו" → "תל אביב יפו": OnMap takes compound names with spaces, never " - ". */
const dashToSpace = (s: string) => s.replace(/\s*[-–־]\s*/g, " ").replace(/\s+/g, " ").trim();

/** Spellings of the same name seen across sites: קרית/קריית, double yod/vav, הרצליה/הרצלייה. */
function spellings(name: string): string[] {
  const out = new Set([name]);
  const add = (s: string) => out.add(s.replace(/\s+/g, " ").trim());
  add(dashToSpace(name));
  add(name.replace(/\s*[-–־]\s*/g, "-"));
  for (const n of [...out]) {
    add(n.replace(/(^|\s)קרית(?=\s|$)/g, "$1קריית"));
    add(n.replace(/(^|\s)קריית(?=\s|$)/g, "$1קרית"));
    add(n.replace(/יי/g, "י"));
    add(n.replace(/וו/g, "ו"));
    add(n.replace(/([^\sי])יה(?=\s|$)/g, "$1ייה"));
    add(n.replace(/ייה(?=\s|$)/g, "יה"));
  }
  return [...out].filter(Boolean);
}

const ONMAP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** Whether OnMap knows a city by this exact name (it matches names verbatim and returns nothing otherwise). */
async function onmapKnows(name: string): Promise<boolean | null> {
  const q = new URLSearchParams({ option: "buy", section: "residence", is_mobile: "false", $limit: "1", city: name });
  try {
    const res = await fetch(`https://phoenix.onmap.co.il/v1/properties/mixed_search?${q}`, {
      headers: { "User-Agent": ONMAP_UA, Accept: "application/json", Origin: "https://www.onmap.co.il", Referer: "https://www.onmap.co.il/" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: unknown[] };
    return (body.data?.length ?? 0) > 0;
  } catch {
    return null;
  }
}

/**
 * OnMap spells some cities differently from the CBS (קריית ביאליק vs קרית ביאליק) and
 * rejects "X - Y". Try the likely spellings, compound names with spaces first, and keep
 * the first one that returns listings; if none does (or OnMap is unreachable), use the
 * dash-free CBS name.
 */
async function resolveOnmapName(he: string): Promise<string> {
  const primary = dashToSpace(he);
  const candidates = [primary, ...spellings(he).filter((s) => s !== primary)].slice(0, 6);
  for (const name of candidates) {
    const known = await onmapKnows(name);
    if (known) return name;
    if (known === null) break; // blocked or down: don't burn time on the rest
  }
  return primary;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/['`’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export interface DerivedCity {
  key: string;
  name: string;
  he: string;
  yad2Code: string;
  onmap: string;
  homeless: string;
  aliases: string[];
}

/**
 * Title-cased CBS transliteration ("RA'ANANA" → "Ra'anana"), or "" when there is none.
 * The column is cut at 20 characters ("MODI'IN-MAKKABBIM-RE"), so a cut-off last word is dropped.
 */
export const englishName = (s: Settlement) => titleCase(s.en.length >= 20 ? s.en.replace(/[\s-]+[^\s-]*$/, "") : s.en);

export async function deriveCity(s: Settlement): Promise<DerivedCity> {
  const onmap = await resolveOnmapName(s.he);
  const homeless = dashToSpace(s.he);
  const en = englishName(s);
  const enAliases = en ? [en.toLowerCase(), en.toLowerCase().replace(/['`’]/g, ""), dashToSpace(en.toLowerCase())] : [];
  return {
    key: slugify(en) || `city-${s.code}`,
    name: en || s.he,
    he: s.he,
    yad2Code: s.code,
    onmap,
    homeless,
    aliases: [...new Set([...spellings(s.he), ...spellings(onmap), ...enAliases])],
  };
}

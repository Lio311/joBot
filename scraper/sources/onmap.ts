import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { listings, type FeatureKey } from "../../src/db/schema";
import { inCriteria } from "../../src/lib/config";
import { jitter, userAgent } from "../lib/browser";
import { parseFeatures } from "../lib/hebrew";
import { BlockedError, type Features, type RawListing, type Source } from "../types";

// OnMap's web app talks to a public JSON API. It accepts city and room filters;
// price filtering happens on our side.

interface OnmapItem {
  id?: string;
  slug?: string;
  price?: number | null;
  currency?: string;
  property_type?: string;
  created_at?: string;
  address?: {
    he?: { city_name?: string; neighborhood?: string; street_name?: string; house_number?: string | number | null };
    location?: { lat?: number; lon?: number };
  };
  additional_info?: { rooms?: number | null; area?: { base?: number | null }; floor?: { on_the?: number | null }; parking?: OnmapParking };
  images?: { gallery?: string; full?: string }[];
  thumbnail?: string;
}

const HEADERS = {
  "User-Agent": userAgent,
  Accept: "application/json",
  Origin: "https://www.onmap.co.il",
  Referer: "https://www.onmap.co.il/",
};

/** Spots per kind: "1", "2", … or "none". */
type OnmapParking = { aboveground?: string | number | null; underground?: string | number | null };

/** The single-property endpoint adds what the search results leave out. */
interface OnmapDetail {
  description?: string | null;
  additional_info?: { elevators?: number | null; balconies?: number | null; parking?: OnmapParking };
  /** The "תוספות" checklist, e.g. ["shelter", "warehouse", "air_conditioner"]. */
  commodities?: string[];
}

/** OnMap's commodity keys, labelled in its UI as ממ״ד, מחסן, מיזוג, גישה לנכים, משופצת, מעלית. */
const COMMODITY: Record<string, FeatureKey> = {
  shelter: "safeRoom",
  warehouse: "storage",
  air_conditioner: "airConditioning",
  accessible: "accessible",
  renovation: "renovated",
  elevator: "elevator",
};

function parkingFeature(p: OnmapParking | undefined): Features {
  const spots = [p?.aboveground, p?.underground].filter((v) => v != null && v !== "");
  return spots.length ? { parking: spots.some((v) => Number(v) > 0) } : {};
}

const count = (n: number | null | undefined) => (n == null ? undefined : n > 0);

function detailFeatures(d: OnmapDetail): Features {
  const out: Features = { ...parseFeatures(d.description), ...parkingFeature(d.additional_info?.parking) };
  const elevator = count(d.additional_info?.elevators);
  const balcony = count(d.additional_info?.balconies);
  if (elevator !== undefined) out.elevator = elevator;
  if (balcony !== undefined) out.balcony = balcony;
  // The checklist is opt-in: an unticked item means "not stated", so it only ever adds `true`.
  for (const c of d.commodities ?? []) if (COMMODITY[c]) out[COMMODITY[c]] = true;
  return out;
}

const DETAIL_ONLY: FeatureKey[] = ["elevator", "balcony", "safeRoom", "airConditioning", "storage", "accessible", "renovated"];

/** OnMap ids we've already enriched from the detail endpoint (they carry more than parking). */
async function alreadyDetailed(): Promise<Set<string>> {
  if (!process.env.DATABASE_URL) return new Set();
  try {
    const rows = await getDb()
      .select({ id: listings.externalId })
      .from(listings)
      .where(and(eq(listings.source, "onmap"), sql`${listings.features} ?| ${sql.raw(`array[${DETAIL_ONLY.map((k) => `'${k}'`).join(",")}]`)}`));
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}

/**
 * Search results only state parking. For listings we keep (in criteria) and haven't enriched yet,
 * read the single-property endpoint, capped per run and paced like the search pages.
 */
async function addDetailFeatures(found: RawListing[], warnings: string[]) {
  const max = Number(process.env.ONMAP_DETAILS_MAX ?? 60);
  if (max <= 0) return;
  const done = await alreadyDetailed();
  const todo = found.filter((l) => inCriteria({ rooms: l.rooms, price: l.price }) && !done.has(l.externalId)).slice(0, max);
  for (const l of todo) {
    const res = await fetch(`https://phoenix.onmap.co.il/v1/properties/${encodeURIComponent(l.externalId)}`, { headers: HEADERS });
    if (res.status === 403 || res.status === 429) {
      warnings.push(`details: HTTP ${res.status}, stopped after ${todo.indexOf(l)}`);
      return;
    }
    if (res.ok) l.features = { ...l.features, ...detailFeatures((await res.json()) as OnmapDetail) };
    await jitter(700, 1_800);
  }
}

const TYPE_HE: Record<string, string> = {
  apartment: "דירה",
  garden_apartment: "דירת גן",
  duplex: "דופלקס",
  rooftop_apartment: "דירת גג",
  penthouse: "פנטהאוז",
  cottage: "קוטג'",
  triplex: "טריפלקס",
};

async function fetchPage(cityName: string, skip: number) {
  const q = new URLSearchParams({
    option: "buy",
    section: "residence",
    is_mobile: "false",
    $sort: "-search_date",
    $limit: "50",
    $skip: String(skip),
    city: cityName,
  });
  q.append("rooms[]", "4");
  q.append("rooms[]", "5");
  const res = await fetch(`https://phoenix.onmap.co.il/v1/properties/mixed_search?${q}`, {
    headers: HEADERS,
  });
  if (res.status === 403 || res.status === 429) throw new BlockedError(`OnMap HTTP ${res.status}`);
  if (!res.ok) throw new Error(`OnMap HTTP ${res.status}`);
  return (await res.json()) as { data: OnmapItem[]; meta?: { hasNextPage?: boolean } };
}

export const onmap: Source = {
  key: "onmap",
  async run({ cities }) {
    const listings: RawListing[] = [];
    const warnings: string[] = [];

    for (const city of cities) {
      try {
        for (let skip = 0; skip < 200; skip += 50) {
          const { data, meta } = await fetchPage(city.onmap, skip);
          for (const i of data) {
            if (!i.id || !i.slug || i.currency && i.currency !== "ILS") continue;
            const a = i.address?.he;
            const street = [a?.street_name, a?.house_number].filter(Boolean).join(" ") || null;
            const type = i.property_type ? TYPE_HE[i.property_type] ?? i.property_type : null;
            listings.push({
              source: "onmap",
              externalId: i.id,
              url: `https://www.onmap.co.il/search/homes/buy?property=${i.slug}`,
              cityText: a?.city_name ?? city.onmap,
              neighborhood: a?.neighborhood ?? null,
              street,
              propertyType: type,
              rooms: i.additional_info?.rooms ?? null,
              sqm: i.additional_info?.area?.base ?? null,
              floor: i.additional_info?.floor?.on_the ?? null,
              price: i.price ?? null,
              lat: i.address?.location?.lat ?? null,
              lng: i.address?.location?.lon ?? null,
              images: (i.images ?? []).map((im) => im.gallery ?? im.full).filter((x): x is string => !!x),
              postedAt: i.created_at ? new Date(i.created_at) : null,
              features: parkingFeature(i.additional_info?.parking),
              title: [type, street].filter(Boolean).join(" · ") || null,
            });
          }
          if (!meta?.hasNextPage) break;
          await jitter(1_200, 3_000);
        }
      } catch (e) {
        if (e instanceof BlockedError) throw e;
        warnings.push(`${city.name}: ${(e as Error).message}`);
      }
      await jitter(1_500, 4_000);
    }
    await addDetailFeatures(listings, warnings);
    return { listings, warnings };
  },
};

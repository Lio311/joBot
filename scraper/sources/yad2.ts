import { CRITERIA, type City } from "../../src/lib/config";
import { newContext, jitter } from "../lib/browser";
import { ApifyBudgetError, apifyFeatures, apifySkipReason, runActor } from "../lib/apify";
import { parseFeatures } from "../lib/hebrew";
import { BlockedError, type RawListing, type Source } from "../types";

// Yad2 renders its feed server-side into __NEXT_DATA__ (React Query dehydrated state),
// so one page load gives ~40 structured listings without touching the DOM layout.

const FEED_BUCKETS = ["private", "agency", "platinum", "kingOfTheHar", "trio", "booster", "leadingBroker"];

interface Yad2Item {
  token?: string;
  adType?: string;
  price?: number;
  /** The earlier asking price Yad2 shows struck through after a cut (e.g. price 3,950,000, priceBeforeTag 4,500,000). Undated. */
  priceBeforeTag?: number | null;
  address?: {
    city?: { text?: string };
    neighborhood?: { text?: string };
    street?: { text?: string };
    house?: { number?: number; floor?: number };
    coords?: { lat?: number; lon?: number };
  };
  additionalDetails?: { property?: { text?: string }; roomsCount?: number; squareMeter?: number };
  metaData?: { coverImage?: string; images?: string[]; squareMeterBuild?: number };
  /**
   * Up to 3 highlight tags the advertiser picked, e.g. "חניה", "ממ\"ד", "2 מרפסות", "נוף פתוח לעיר".
   * (additionalDetails.propertyCondition is a bare numeric id with no label in the feed, so it's not used.)
   */
  tags?: { name?: string }[];
}

function feedUrl(cityCode: string, page: number) {
  const q = new URLSearchParams({
    city: cityCode,
    minRooms: String(CRITERIA.minRooms),
    maxRooms: String(CRITERIA.maxRooms),
    minPrice: String(CRITERIA.minPrice),
    maxPrice: String(CRITERIA.maxPrice),
  });
  if (page > 1) q.set("page", String(page));
  return `https://www.yad2.co.il/realestate/forsale?${q}`;
}

function toListing(i: Yad2Item): RawListing | null {
  if (!i.token || !i.address?.city?.text) return null;
  const street = [i.address.street?.text, i.address.house?.number].filter(Boolean).join(" ") || null;
  return {
    source: "yad2",
    externalId: i.token,
    url: `https://www.yad2.co.il/realestate/item/${i.token}`,
    cityText: i.address.city.text,
    neighborhood: i.address.neighborhood?.text ?? null,
    street,
    propertyType: i.additionalDetails?.property?.text ?? null,
    rooms: i.additionalDetails?.roomsCount ?? null,
    sqm: i.additionalDetails?.squareMeter ?? i.metaData?.squareMeterBuild ?? null,
    floor: i.address.house?.floor ?? null,
    price: i.price ?? null,
    lat: i.address.coords?.lat ?? null,
    lng: i.address.coords?.lon ?? null,
    images: i.metaData?.images?.length ? i.metaData.images : i.metaData?.coverImage ? [i.metaData.coverImage] : [],
    isAgency: i.adType ? i.adType !== "private" : null,
    // Tags are highlights, not a full checklist: a missing tag means unknown, never "no".
    features: parseFeatures(i.tags?.map((t) => t.name).join(", ")),
    title: [i.additionalDetails?.property?.text, street].filter(Boolean).join(" · ") || null,
    ...(i.priceBeforeTag && i.price && i.priceBeforeTag !== i.price && { priceHistory: [{ price: i.priceBeforeTag, at: null }] }),
  };
}

interface ApifyYad2Item {
  listingId?: string;
  url?: string;
  adType?: string;
  hasAgent?: boolean;
  propertyType?: string;
  cityHebrew?: string;
  city?: string;
  neighbourhood?: string;
  address?: string;
  price?: number;
  rooms?: number;
  floor?: string | number;
  areaSqm?: number;
  coverImage?: string;
  publishedAt?: string;
  latitude?: number;
  longitude?: number;
}

// When Radware challenges us, fall back to a managed Apify actor (paid per listing).
async function viaApify(cities: City[]): Promise<RawListing[]> {
  const items = await runActor<ApifyYad2Item>(process.env.YAD2_ACTOR ?? "parsebird/yad2-real-estate-scraper", {
    // The paid fallback covers only the top-priority cities (Tel Aviv, Herzliya by default).
    city: cities.filter((c) => c.priority <= Number(process.env.YAD2_APIFY_MAX_PRIORITY ?? 2))
      .map((c) => c.he)
      .join(","),
    dealType: "buy",
    maxItems: Number(process.env.YAD2_APIFY_PER_CITY ?? 10),
    minPrice: CRITERIA.minPrice,
    maxPrice: CRITERIA.maxPrice,
    minRooms: CRITERIA.minRooms,
    maxRooms: CRITERIA.maxRooms,
    enrichListings: true,
  });
  return items
    .filter((i) => i.listingId)
    .map((i) => ({
      source: "yad2" as const,
      externalId: i.listingId!,
      url: `https://www.yad2.co.il/realestate/item/${i.listingId}`,
      cityText: i.cityHebrew ?? i.city ?? null,
      neighborhood: i.neighbourhood ?? null,
      street: i.address ?? null,
      propertyType: i.propertyType ?? null,
      rooms: i.rooms ?? null,
      sqm: i.areaSqm ?? null,
      floor: i.floor != null && /^\d+$/.test(String(i.floor)) ? Number(i.floor) : null,
      price: i.price ?? null,
      images: i.coverImage ? [i.coverImage] : [],
      lat: i.latitude ?? null,
      lng: i.longitude ?? null,
      isAgency: i.hasAgent ?? (i.adType ? i.adType !== "private" : null),
      features: apifyFeatures(i),
      postedAt: i.publishedAt ? new Date(i.publishedAt) : null,
      title: i.address ?? null,
    }));
}

export const yad2: Source = {
  key: "yad2",
  async run({ cities }) {
    try {
      return await direct(cities);
    } catch (e) {
      const skip = apifySkipReason();
      if (!(e instanceof BlockedError) || skip) throw e;
      try {
        return { listings: await viaApify(cities), warnings: ["direct access challenged; used Apify fallback"] };
      } catch (err) {
        if (err instanceof ApifyBudgetError) throw new ApifyBudgetError(`Yad2 blocks direct access; ${err.message}`);
        throw err;
      }
    }
  },
};

async function direct(cities: City[]) {
  const maxPages = Number(process.env.YAD2_MAX_PAGES ?? 2);
  const ctx = await newContext();
  const page = await ctx.newPage();
  const listings: RawListing[] = [];
  const warnings: string[] = [];

  try {
    for (const city of cities) {
      for (let p = 1; p <= maxPages; p++) {
        try {
          await page.goto(feedUrl(city.yad2, p), { waitUntil: "domcontentloaded", timeout: 45_000 });
          // Radware may serve an interstitial before redirecting to the real page, and the
          // __NEXT_DATA__ script streams in, so wait until it holds complete JSON.
          await page.waitForFunction(
            () => {
              try {
                return !!JSON.parse(document.getElementById("__NEXT_DATA__")?.textContent ?? "").props;
              } catch {
                return false;
              }
            },
            undefined,
            { timeout: 25_000, polling: 500 },
          );
        } catch {
          const html = await page.content().catch(() => "");
          if (/captcha|perfdrive|Radware/i.test(html) || page.url().includes("perfdrive")) {
            // Once challenged, more requests only deepen the block: stop here.
            if (!listings.length) throw new BlockedError("Radware challenge");
            warnings.push(`${city.name}: bot challenge on page ${p}, stopped early`);
            return { listings, warnings };
          }
          warnings.push(`${city.name}: page ${p} did not load`);
          break;
        }

        const raw = await page.evaluate(() => document.getElementById("__NEXT_DATA__")!.textContent!);
        const feed = JSON.parse(raw)?.props?.pageProps?.dehydratedState?.queries?.find(
          (q: { queryKey?: unknown[] }) => q.queryKey?.[0] === "realestate-forsale-feed",
        )?.state?.data;
        if (!feed) {
          warnings.push(`${city.name}: feed data missing on page ${p}`);
          break;
        }

        for (const bucket of FEED_BUCKETS) {
          for (const item of (feed[bucket] ?? []) as Yad2Item[]) {
            const l = toListing(item);
            if (l) listings.push(l);
          }
        }

        if (p >= (feed.pagination?.totalPages ?? 1)) break;
        await jitter(3_500, 8_000);
      }
      await jitter(5_000, 11_000);
    }
  } finally {
    await ctx.close();
  }
  return { listings, warnings };
}

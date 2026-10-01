import { matchCity } from "../../src/lib/config";
import { apifySkipReason, everyNDaysSkipReason, runActor } from "../lib/apify";
import { firstLine, isSalePost, parseFeatures, parsePrice, parseRooms, parseSqm, textFingerprint } from "../lib/hebrew";
import type { RawListing, Source } from "../types";

// Facebook content is only readable when logged in. Rather than automating the user's
// own account (and risking it), we use Apify actors that read public groups and
// Marketplace from their own infrastructure. Posts are free text, so fields are parsed.

const GROUPS_ACTOR = process.env.FB_GROUPS_ACTOR ?? "apify/facebook-groups-scraper";
const MARKETPLACE_ACTOR = process.env.FB_MARKETPLACE_ACTOR ?? "swerve/fb-marketplace-scraper";

interface GroupPost {
  id?: string;
  url?: string;
  facebookUrl?: string;
  time?: string;
  text?: string;
  groupTitle?: string;
  /** Set on Facebook "sell" posts, e.g. "₪3,690,000". */
  price?: string | number;
  attachments?: { thumbnail?: string; photo_image?: { uri?: string }; image?: { uri?: string } }[];
  recordType?: string;
  code?: string;
  inputUrl?: string;
}

interface MarketplaceItem {
  id?: string;
  url?: string;
  price?: number;
  currency?: string;
  locationText?: string;
  marketplace_listing_title?: string;
  description?: string;
  image?: string;
  dealType?: string;
}

const groupUrls = () =>
  (process.env.FB_GROUP_URLS ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("http"));

export const facebookGroups: Source = {
  key: "fb-group",
  skip: () =>
    apifySkipReason() ??
    (groupUrls().length ? null : "FB_GROUP_URLS is empty") ??
    everyNDaysSkipReason(Number(process.env.FB_EVERY_DAYS ?? 3)),
  async run({ cities }) {
    // resultsLimit applies per group, not per run. No onlyPostsNewerThan: the actor bills an
    // extra event per post when it's set, and CHRONOLOGICAL + (source, id) dedupe covers it.
    const posts = await runActor<GroupPost>(GROUPS_ACTOR, {
      startUrls: groupUrls().map((url) => ({ url })),
      resultsLimit: Number(process.env.FB_POSTS_PER_GROUP ?? 3),
      viewOption: "CHRONOLOGICAL",
    });

    const listings: RawListing[] = [];
    const warnings: string[] = [];
    for (const p of posts) {
      // Private groups / temporary Facebook refusals come back as free diagnostic rows.
      if (p.recordType === "diagnostic") {
        warnings.push(`${p.inputUrl?.match(/groups\/([^/]+)/)?.[1] ?? "group"}: ${p.code}`);
        continue;
      }
      const text = p.text ?? "";
      if (!p.id || !text || !isSalePost(text)) continue;
      // Only trust a city named in the post itself: regional groups carry ads from
      // neighbouring towns we don't track.
      const city = matchCity(text, cities);
      const listedPrice = typeof p.price === "number" ? p.price : p.price ? parseInt(p.price.replace(/[^\d]/g, ""), 10) || null : null;
      const image = p.attachments?.map((a) => a.photo_image?.uri ?? a.image?.uri ?? a.thumbnail).find(Boolean);
      listings.push({
        source: "fb-group",
        externalId: p.id,
        url: p.url ?? p.facebookUrl ?? `https://www.facebook.com/${p.id}`,
        cityText: city?.he ?? null,
        title: firstLine(text),
        description: text.slice(0, 2000),
        rooms: parseRooms(text),
        sqm: parseSqm(text),
        price: listedPrice ?? parsePrice(text),
        images: image ? [image] : [],
        postedAt: p.time ? new Date(p.time) : null,
        features: parseFeatures(text),
        lenientRooms: true,
        fingerprint: textFingerprint(text),
      });
    }
    return { listings, warnings };
  },
};

// Marketplace is the priciest actor (~$10 / 1k items) so it's opt-in.
export const facebookMarketplace: Source = {
  key: "fb-marketplace",
  skip: () => apifySkipReason() ?? (process.env.FB_MARKETPLACE === "1" ? null : "FB_MARKETPLACE not enabled"),
  async run({ cities }) {
    const items = await runActor<MarketplaceItem>(MARKETPLACE_ACTOR, {
      dealType: "BUY",
      // The actor takes its own city slugs, which match our built-in keys but not the
      // CBS-derived keys of added cities ("petah-tiqwa" vs "petah-tikva"), so those are left out.
      cities: cities.filter((c) => !c.custom).map((c) => c.key),
      matchCityOnly: true,
      fetchDetails: true,
      maxPerCoord: Number(process.env.FB_MARKETPLACE_PER_CITY ?? 20),
    });

    const listings: RawListing[] = [];
    for (const i of items) {
      if (!i.id || (i.currency && i.currency !== "ILS")) continue;
      const text = `${i.marketplace_listing_title ?? ""}\n${i.description ?? ""}`;
      listings.push({
        source: "fb-marketplace",
        externalId: i.id,
        url: i.url ?? `https://www.facebook.com/marketplace/item/${i.id}`,
        cityText: i.locationText ?? null,
        title: i.marketplace_listing_title ?? firstLine(text),
        description: i.description?.slice(0, 2000) ?? null,
        rooms: parseRooms(text),
        sqm: parseSqm(text),
        price: i.price ?? parsePrice(text),
        images: i.image ? [i.image] : [],
        features: parseFeatures(text),
        lenientRooms: true,
        fingerprint: textFingerprint(text),
      });
    }
    return { listings, warnings: [] };
  },
};

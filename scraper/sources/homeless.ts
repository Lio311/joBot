import type { City } from "../../src/lib/config";
import { newContext } from "../lib/browser";
import { parseFeatures } from "../lib/hebrew";
import { BlockedError, type RawListing, type Source } from "../types";

// Homeless is a classic server-rendered board behind Cloudflare. The first page view of
// a session loads normally, later ones get a challenge we don't try to solve. So each run
// reads a single city board, rotating by 8-hour slot, with Tel Aviv in every other slot.
// Each row is a <tr id="ad_{id}"> with fixed-order cells.

const BUILT_IN_ROTATION = ["herzliya", "ramat-gan", "givatayim", "kiryat-ono", "netanya", "savyon", "raanana", "ramat-hasharon"];

/** Tel Aviv, then the next city, alternating; cities added from the dashboard join the cycle. */
function rotation(cities: City[]) {
  const others = [...BUILT_IN_ROTATION, ...cities.filter((c) => c.custom).map((c) => c.key)];
  return others.flatMap((key) => ["tel-aviv", key]);
}

function parsePrice(s: string) {
  const n = parseInt(s.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDate(s: string) {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00+03:00`) : null;
}

export const homeless: Source = {
  key: "homeless",
  async run({ cities }) {
    const slot = Math.floor(Date.now() / (8 * 3600_000));
    const order = rotation(cities);
    const cityKey = process.env.HOMELESS_CITY ?? order[slot % order.length];
    const city = cities.find((c) => c.key === cityKey);
    if (!city) return { listings: [], warnings: [`unknown city "${cityKey}"`] };
    const ctx = await newContext();
    const page = await ctx.newPage();

    try {
      const url = `https://www.homeless.co.il/sale/city=${encodeURIComponent(city.homeless)}`;
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
      const ok = await page.waitForSelector('tr[id^="ad_"]', { timeout: 20_000 }).then(() => true, () => false);
      if (!ok) {
        const html = await page.content().catch(() => "");
        if (res?.status() === 403 || /cf-challenge|captcha|Just a moment|רק רגע/i.test(html)) {
          throw new BlockedError(`Cloudflare challenge on ${city.name}`);
        }
        return { listings: [], warnings: [`${city.name}: no rows`] };
      }

      const rows = await page.$$eval('tr[id^="ad_"]', (trs) =>
        trs.map((tr) => ({
          id: tr.id.replace("ad_", ""),
          img: tr.querySelector("img.PictureDisplayOnBoard")?.getAttribute("src") ?? null,
          summary: tr.querySelector("a[title]")?.getAttribute("title") ?? "",
          cells: [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim()),
        })),
      );

      // cells: [select, image, type, city, neighborhood, street, rooms, floor, price, entry, date, link]
      const listings: RawListing[] = rows.map((r) => {
        const [, , type, cityText, hood, street, rooms, floor, price, , date] = r.cells;
        return {
          source: "homeless",
          externalId: r.id,
          url: `https://www.homeless.co.il/sale/viewad,${r.id}.aspx`,
          cityText,
          neighborhood: hood || null,
          street: street || null,
          propertyType: type || null,
          rooms: rooms ? parseFloat(rooms) || null : null,
          floor: /^\d+$/.test(floor ?? "") ? parseInt(floor, 10) : floor === "קרקע" ? 0 : null,
          price: parsePrice(price ?? ""),
          images: r.img && !r.img.includes("nopic") ? [r.img] : [],
          postedAt: parseDate(date ?? ""),
          // The board has no amenity columns; the link's one-line summary occasionally names some.
          features: parseFeatures(r.summary),
          title: [type, street].filter(Boolean).join(" · ") || null,
        };
      });
      return { listings, warnings: [] };
    } finally {
      await ctx.close();
    }
  },
};

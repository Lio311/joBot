import { hasTerm } from "../../src/lib/match";
import { BlockedError, type RawJob, type Source } from "../types";
import { clean, get, jitter, load } from "../lib/http";

// GotFriends (high-tech placement agency): no free-text search, so the profile's roles are matched
// against the job-lobby's category names and the matching category pages are read.

const BASE = "https://www.gotfriends.co.il";
const MAX_CATEGORIES = Number(process.env.GOTFRIENDS_CATEGORIES ?? 6);

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}+#]+/u).filter((w) => w.length > 2 && !/^(developer|engineer|jobs|דרושים|מפתח|מהנדס)$/.test(w));

export const gotfriends: Source = {
  key: "gotfriends",
  async run({ queries }) {
    const jobs: RawJob[] = [];
    const warnings: string[] = [];
    const lobby = load(await get(`${BASE}/jobslobby/`));
    const categories = new Map<string, string>();
    lobby('a[href^="/jobslobby/"]').each((_, a) => {
      const href = lobby(a).attr("href")!.trim();
      if (/^\/jobslobby\/[^/]+\/[^/]+\/$/.test(href)) categories.set(href, clean(lobby(a).text()));
    });
    // A category matches a query when its name contains the query or shares a meaningful word with it.
    const scored = [...categories].map(([href, name]) => {
      const n = name.toLowerCase();
      const s = Math.max(0, ...queries.map((q) => (hasTerm(n, q) ? 3 : words(q).filter((w) => hasTerm(n, w)).length)));
      return { href, name, s };
    });
    const picked = scored.filter((c) => c.s > 0).sort((a, b) => b.s - a.s).slice(0, MAX_CATEGORIES);
    if (!picked.length) return { jobs, warnings: ["no GotFriends category matches the profile roles"] };

    for (const cat of picked) {
      await jitter(1500, 3500);
      let html: string;
      try {
        html = await get(BASE + cat.href, { referer: `${BASE}/jobslobby/` });
      } catch (e) {
        if (e instanceof BlockedError) throw e;
        warnings.push(`${cat.name}: ${(e as Error).message}`);
        continue;
      }
      const $ = load(html);
      $(".jobs_list .item").each((_, el) => {
        const item = $(el);
        const href = item.find("a.position").attr("href");
        const id = href?.match(/\/(\d+)\/?$/)?.[1];
        const title = clean(item.find("h2.title").text());
        if (!href || !id || !title) return;
        const desc = item.find(".desc").map((_, d) => clean($(d).text())).get().join("\n");
        jobs.push({
          source: "gotfriends",
          externalId: id,
          url: BASE + href,
          title,
          company: null, // the agency doesn't name the client company
          location: clean(item.find(".info-data").first().text()) || null,
          description: desc || null,
          query: cat.name,
        });
      });
    }
    return { jobs, warnings };
  },
};

import { createHash } from "node:crypto";
import { facebookGroupsFor } from "../../src/lib/config";
import { apifySkipReason, everyNDaysSkipReason, runActor } from "../lib/apify";
import { clean, workModelOf } from "../lib/http";
import type { RawJob, Source } from "../types";

// Public Facebook job groups through Apify's groups scraper (never the owner's own account).
// Billed per post, and `resultsLimit` applies per group, so a few newest posts per group, every 3 days.

const ACTOR = "apify/facebook-groups-scraper";
const PER_GROUP = Number(process.env.FB_POSTS_PER_GROUP ?? 3);
const EVERY_DAYS = Number(process.env.FB_EVERY_DAYS ?? 3);

interface Post {
  url?: string;
  facebookUrl?: string;
  postId?: string;
  id?: string;
  text?: string;
  time?: string;
  groupTitle?: string;
  user?: { name?: string };
}

const HIRING = /דרוש|דרושה|דרושים|מגייס|מגייסת|מגייסים|מחפשים|גיוס|משרה|hiring|we'?re looking|looking for an?|join our|open position|job opening|#job|apply/i;
const SEEKING = /מחפש(?:ת)? עבודה|מחפש(?:ת)? משרה|open to work|looking for (?:a )?(?:new )?(?:job|position|role)\b/i;

/** The post's first meaningful line, as a title. */
function titleOf(text: string): string {
  const line = text
    .split(/\n+/)
    .map((l) => clean(l.replace(/[#*_~]+/g, " ")))
    .find((l) => l.length >= 6) ?? clean(text);
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

export const facebook: Source = {
  key: "facebook",
  skip: () => apifySkipReason() ?? everyNDaysSkipReason(EVERY_DAYS),
  async run({ profile }) {
    const groups = facebookGroupsFor(profile).map((g) => g.url);
    const posts = await runActor<Post>(ACTOR, {
      startUrls: [...new Set(groups)].map((url) => ({ url })),
      resultsLimit: PER_GROUP,
      viewOption: "CHRONOLOGICAL",
    });
    const jobs: RawJob[] = [];
    for (const p of posts) {
      const text = (p.text ?? "").trim();
      if (text.length < 40 || !HIRING.test(text) || SEEKING.test(text)) continue;
      const url = p.url ?? p.facebookUrl;
      if (!url) continue;
      const id = p.postId ?? p.id ?? createHash("sha1").update(url).digest("hex").slice(0, 16);
      jobs.push({
        source: "facebook",
        externalId: id,
        url,
        title: titleOf(text),
        company: null,
        location: null,
        description: text.slice(0, 4000),
        workModel: workModelOf(text),
        postedAt: p.time ? new Date(p.time) : null,
        query: p.groupTitle ?? null,
      });
    }
    return { jobs, warnings: [] };
  },
};

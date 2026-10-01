import { XRAY_SITES } from "../../src/lib/config";
import { boardOf } from "../../src/lib/boards";
import { apifySkipReason, runActor } from "../lib/apify";
import { clean, workModelOf } from "../lib/http";
import type { RawJob, Source } from "../types";

// Google "X-ray" search through Apify's Google Search actor (Google blocks plain scraping).
// One query per role: "<role>" (site:comeet.com/jobs OR site:jobs.lever.co …) (Israel OR "Tel Aviv" …),
// past week only. Results on company ATS boards register the company for the `ats` source (which reads
// the full posting); results on other hosts (Workable, SmartRecruiters, LinkedIn) are stored directly.

const ACTOR = "apify/google-search-scraper";
const MAX_ROLES = Number(process.env.GOOGLE_MAX_QUERIES ?? 6);
const PAGES = Number(process.env.GOOGLE_PAGES ?? 2);

interface SerpPage {
  searchQuery?: { term?: string };
  organicResults?: { title?: string; url?: string; description?: string; date?: string }[];
}

/** "Data Analyst - Acme | LinkedIn" → { title, company }. */
function splitTitle(raw: string, host: string): { title: string; company: string | null } {
  let t = clean(raw).replace(/\s*[|\-–]\s*(LinkedIn|Workable|SmartRecruiters|Comeet)\s*$/i, "");
  const at = t.match(/^(.*?)\s+(?:at|@|ב-?)\s+(.+?)$/i);
  if (host.includes("linkedin") && /hiring/i.test(t)) {
    const m = t.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
    if (m) return { title: m[2], company: m[1] };
  }
  if (at) return { title: at[1], company: at[2] };
  const dash = t.split(/\s+[-–|]\s+/);
  if (dash.length >= 2) return { title: dash[0], company: dash[1] };
  t = t.slice(0, 160);
  return { title: t, company: null };
}

export const google: Source = {
  key: "google",
  skip: apifySkipReason,
  async run({ profile, discover }) {
    const roles = [...new Set([...profile.roles, ...profile.keywords])].slice(0, MAX_ROLES);
    if (!roles.length) return { jobs: [], warnings: ["no roles in the profile yet"] };
    const sites = XRAY_SITES.map((s) => `site:${s}`).join(" OR ");
    const queries = roles.map((r) => `"${r.replace(/"/g, "")}" (${sites}) (Israel OR "Tel Aviv" OR Herzliya OR ישראל)`);
    const pages = await runActor<SerpPage>(ACTOR, {
      queries: queries.join("\n"),
      maxPagesPerQuery: PAGES,
      countryCode: "il",
      quickDateRange: process.env.GOOGLE_DATE_RANGE ?? "d7",
      mobileResults: false,
      includeUnfilteredResults: false,
      saveHtml: false,
      saveHtmlToKeyValueStore: false,
    });

    const jobs: RawJob[] = [];
    const warnings: string[] = [];
    let boards = 0;
    for (const page of pages) {
      const role = roles[queries.indexOf(page.searchQuery?.term ?? "")] ?? page.searchQuery?.term ?? null;
      for (const r of page.organicResults ?? []) {
        if (!r.url || !r.title) continue;
        const board = boardOf(r.url);
        const host = new URL(r.url).hostname;
        const { title, company } = splitTitle(r.title, host);
        if (board) {
          boards++;
          discover({ ...board, name: company ?? board.slug.split("/")[0] });
          continue; // the ats source reads the full posting from the board
        }
        if (!/workable\.com|smartrecruiters\.com|linkedin\.com\/jobs\/view/.test(r.url)) continue;
        const liId = r.url.match(/linkedin\.com\/jobs\/view\/(?:[^/?]*-)?(\d{6,})/)?.[1];
        jobs.push({
          // LinkedIn hits share the linkedin source's ids, so they merge with the LinkedIn scrape.
          source: liId ? "linkedin" : "google",
          externalId: liId ?? r.url.replace(/[?#].*$/, ""),
          url: r.url.replace(/[?#].*$/, ""),
          title,
          company,
          location: null,
          description: clean(r.description) || null,
          workModel: workModelOf(r.description),
          postedAt: null,
          query: role,
        });
      }
    }
    if (boards) warnings.push(`${boards} results on company boards (read by the ats source)`);
    return { jobs, warnings };
  },
};

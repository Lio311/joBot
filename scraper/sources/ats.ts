import type { Company } from "../../src/db/schema";
import { locate } from "../../src/lib/match";
import type { RawJob, Source } from "../types";
import { clean, get, getJson, htmlToText, jitter, load, workModelOf } from "../lib/http";

// Company career boards read straight from their applicant-tracking system's public API:
// Greenhouse, Lever, Ashby (JSON) and Comeet (positions JSON embedded in the careers page).
// Openings show up here first, often days before job sites. Only Israel-based (or remote) roles are kept.

const MAX_PER_RUN = Number(process.env.ATS_MAX_COMPANIES ?? 80);

const inIsrael = (location: string | null, country?: string | null) => {
  if (country && /^(IL|ISR|Israel)$/i.test(country)) return true;
  const where = locate(location);
  return where.regions.length > 0 || /israel|ישראל/i.test(location ?? "") || (where.remote && !where.abroad);
};

async function greenhouse(c: Company): Promise<RawJob[]> {
  type GH = { jobs: { id: number; title: string; absolute_url: string; location?: { name?: string }; content?: string; first_published?: string; updated_at?: string; offices?: { location?: string; name?: string }[] }[] };
  const data = await getJson<GH>(`https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs?content=true`);
  return data.jobs
    .map((j) => {
      const location = [j.location?.name, ...(j.offices ?? []).map((o) => o.location ?? o.name)].filter(Boolean).join(" · ");
      // `content` is HTML escaped once more (&lt;p&gt;…).
      const html = j.content ? load(`<div>${j.content}</div>`)("div").text() : "";
      return {
        source: "ats" as const,
        externalId: `gh:${j.id}`,
        url: j.absolute_url,
        title: clean(j.title),
        company: c.name,
        location,
        description: htmlToText(html) || null,
        workModel: workModelOf(`${location} ${j.title}`),
        postedAt: j.first_published ? new Date(j.first_published) : j.updated_at ? new Date(j.updated_at) : null,
        query: c.name,
      };
    })
    .filter((j) => inIsrael(j.location));
}

async function lever(c: Company): Promise<RawJob[]> {
  type LV = { id: string; text: string; hostedUrl: string; country?: string; workplaceType?: string; createdAt?: number; categories?: { location?: string; allLocations?: string[]; commitment?: string }; descriptionPlain?: string; additionalPlain?: string; lists?: { text: string; content: string }[] }[];
  const data = await getJson<LV>(`https://api.lever.co/v0/postings/${c.slug}?mode=json`);
  return data
    .map((j) => {
      const location = [j.categories?.location, ...(j.categories?.allLocations ?? [])].filter(Boolean).join(" · ");
      const lists = (j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n");
      return {
        raw: j,
        job: {
          source: "ats" as const,
          externalId: `lv:${j.id}`,
          url: j.hostedUrl,
          title: clean(j.text),
          company: c.name,
          location,
          description: [j.descriptionPlain, lists].filter(Boolean).join("\n").trim() || null,
          employmentType: j.categories?.commitment ?? null,
          workModel: (j.workplaceType === "remote" || j.workplaceType === "hybrid" || j.workplaceType === "onsite" ? j.workplaceType : null) as RawJob["workModel"],
          postedAt: j.createdAt ? new Date(j.createdAt) : null,
          query: c.name,
        },
      };
    })
    .filter(({ raw, job }) => inIsrael(job.location, raw.country))
    .map(({ job }) => job);
}

async function ashby(c: Company): Promise<RawJob[]> {
  type AB = { jobs: { id: string; title: string; jobUrl: string; location?: string; secondaryLocations?: { location?: string }[]; isRemote?: boolean | null; workplaceType?: string | null; employmentType?: string; publishedAt?: string; descriptionPlain?: string; address?: { postalAddress?: { addressCountry?: string } } }[] };
  const data = await getJson<AB>(`https://api.ashbyhq.com/posting-api/job-board/${c.slug}`);
  return data.jobs
    .filter((j) => inIsrael([j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].join(" · "), j.address?.postalAddress?.addressCountry))
    .map((j) => {
      const wp = (j.workplaceType ?? "").toLowerCase();
      return {
        source: "ats" as const,
        externalId: `ab:${j.id}`,
        url: j.jobUrl,
        title: clean(j.title),
        company: c.name,
        location: [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean).join(" · "),
        description: j.descriptionPlain ?? null,
        employmentType: j.employmentType ?? null,
        workModel: j.isRemote || wp === "remote" ? "remote" : wp === "hybrid" ? "hybrid" : wp === "onsite" ? "onsite" : null,
        postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
        query: c.name,
      };
    });
}

async function comeet(c: Company): Promise<RawJob[]> {
  type CM = { uid: string; name: string; location?: { name?: string; country?: string; city?: string } | null; url_comeet_hosted_page?: string; url_active_page?: string; employment_type?: string; workplace_type?: string; time_updated?: string; company_name?: string; custom_fields?: { details?: { name: string; value: string }[] } };
  const html = await get(`https://www.comeet.com/jobs/${c.slug}`);
  const m = html.match(/COMPANY_POSITIONS_DATA\s*=\s*(\[[\s\S]*?\]);\s*\n/);
  if (!m) throw new Error(`no positions data on comeet.com/jobs/${c.slug}`);
  const positions = JSON.parse(m[1]) as CM[];
  return positions
    .filter((p) => inIsrael([p.location?.name, p.location?.city].filter(Boolean).join(" "), p.location?.country))
    .map((p) => {
      const wp = (p.workplace_type ?? "").toLowerCase();
      return {
        source: "ats" as const,
        externalId: `cm:${p.uid}`,
        url: p.url_comeet_hosted_page ?? p.url_active_page ?? `https://www.comeet.com/jobs/${c.slug}`,
        title: clean(p.name),
        company: p.company_name ?? c.name,
        location: [p.location?.city, p.location?.name].filter(Boolean).join(" · ") || null,
        description: (p.custom_fields?.details ?? []).map((d) => `${d.name}\n${htmlToText(d.value)}`).join("\n") || null,
        employmentType: p.employment_type ?? null,
        workModel: wp.includes("remote") ? "remote" : wp.includes("hybrid") ? "hybrid" : wp ? "onsite" : null,
        postedAt: p.time_updated ? new Date(p.time_updated) : null,
        query: c.name,
      };
    });
}

const READERS = { greenhouse, lever, ashby, comeet } as const;

/** Per-company job counts from the last run, written back to the companies table by run.ts. */
export const atsCounts = new Map<number, number>();

export const ats: Source = {
  key: "ats",
  async run({ companies }) {
    const jobs: RawJob[] = [];
    const warnings: string[] = [];
    // Least recently checked first, so a capped run still rotates through every board.
    const due = companies
      .filter((c) => c.active)
      .sort((a, b) => (a.lastCheckedAt?.getTime() ?? 0) - (b.lastCheckedAt?.getTime() ?? 0))
      .slice(0, MAX_PER_RUN);
    for (const c of due) {
      try {
        const found = await READERS[c.ats](c);
        atsCounts.set(c.id, found.length);
        jobs.push(...found);
      } catch (e) {
        atsCounts.set(c.id, -1);
        warnings.push(`${c.name} (${c.ats}): ${(e as Error).message.slice(0, 120)}`);
      }
      await jitter(400, 1200);
    }
    return { jobs, warnings };
  },
};

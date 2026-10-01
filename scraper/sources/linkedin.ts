import { BlockedError, type RawJob, type Source } from "../types";
import { clean, get, htmlToText, jitter, load, workModelOf } from "../lib/http";

// LinkedIn's public "guest" job search: the endpoint its logged-out search page calls for more results.
// No login, plain HTTP. Location = Israel, posted in the last 24h (r86400) or week (r604800).

const SEARCH = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
const POSTING = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/";
const PAGES = Number(process.env.LINKEDIN_PAGES ?? 2); // 10 cards per page

export const linkedin: Source = {
  key: "linkedin",
  async run({ queries }) {
    const jobs: RawJob[] = [];
    const warnings: string[] = [];
    const window = process.env.LINKEDIN_WINDOW ?? "r86400";
    for (const q of queries) {
      for (let page = 0; page < PAGES; page++) {
        const url = `${SEARCH}?keywords=${encodeURIComponent(q)}&location=Israel&geoId=101620260&f_TPR=${window}&sortBy=DD&start=${page * 10}`;
        let html: string;
        try {
          html = await get(url, { referer: "https://www.linkedin.com/jobs/search" });
        } catch (e) {
          if (e instanceof BlockedError && !jobs.length) throw e;
          warnings.push(`"${q}" p${page + 1}: ${(e as Error).message}`);
          break;
        }
        const $ = load(html);
        const cards = $("div.base-search-card, div.job-search-card");
        cards.each((_, el) => {
          const c = $(el);
          const id = c.attr("data-entity-urn")?.match(/\d+$/)?.[0];
          const title = clean(c.find(".base-search-card__title").text());
          if (!id || !title) return;
          const href = c.find("a.base-card__full-link").attr("href") ?? `https://www.linkedin.com/jobs/view/${id}`;
          const location = clean(c.find(".job-search-card__location").text());
          const date = c.find("time").attr("datetime");
          jobs.push({
            source: "linkedin",
            externalId: id,
            url: href.split("?")[0],
            title,
            company: clean(c.find(".base-search-card__subtitle").text()) || null,
            location: location || null,
            workModel: workModelOf(location),
            postedAt: date ? new Date(date) : null,
            query: q,
          });
        });
        if (cards.length < 10) break;
        await jitter(1500, 3500);
      }
      await jitter(2000, 4500);
    }
    return { jobs, warnings };
  },
  async describe(job) {
    const html = await get(POSTING + job.externalId, { referer: job.url });
    const $ = load(html);
    const description = htmlToText($(".show-more-less-html__markup").first().html());
    const criteria: Record<string, string> = {};
    $(".description__job-criteria-item").each((_, el) => {
      criteria[clean($(el).find("h3").text()).toLowerCase()] = clean($(el).find("span").text());
    });
    return {
      description: description || null,
      employmentType: criteria["employment type"] ?? null,
      workModel: job.workModel ?? workModelOf(description.slice(0, 600)),
    };
  },
};

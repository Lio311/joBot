import { BlockedError, type RawJob, type Source } from "../types";
import { clean, get, jitter, load, relativeDate, workModelOf } from "../lib/http";

// Drushim search page: server-rendered job cards (CSS-module class names, so match on the stable part).
// Drushim sits behind Radware Bot Manager, which challenges after a few page loads in a row. So each
// run reads only a couple of search terms, rotating through the profile's roles from run to run.

const BASE = "https://www.drushim.co.il";
const PER_RUN = Number(process.env.DRUSHIM_QUERIES_PER_RUN ?? 2);

/** The terms for this run: a window over the list that moves forward every 6 hours (one cron slot). */
function rotation(queries: string[]): string[] {
  if (queries.length <= PER_RUN) return queries;
  const slot = Math.floor(Date.now() / (6 * 3_600_000));
  const start = (slot * PER_RUN) % queries.length;
  return [...queries, ...queries].slice(start, start + PER_RUN);
}

export const drushim: Source = {
  key: "drushim",
  async run(ctx) {
    const queries = rotation(ctx.queries);
    const jobs: RawJob[] = [];
    const warnings: string[] = [];
    for (const q of queries) {
      let html: string;
      try {
        html = await get(`${BASE}/jobs/search/${encodeURIComponent(q)}/`, { referer: `${BASE}/` });
      } catch (e) {
        // Stop at the first challenge (retrying deepens the block); keep what this run already read.
        if (e instanceof BlockedError) {
          if (!jobs.length) throw e;
          warnings.push(`blocked after ${jobs.length} jobs`);
          break;
        }
        warnings.push(`"${q}": ${(e as Error).message}`);
        continue;
      }
      const $ = load(html);
      $('article[data-nagish="job-card-item"]').each((_, el) => {
        const card = $(el);
        const href = card.find('a[href^="/job/"]').first().attr("href");
        const id = href?.match(/^\/job\/(\d+)/)?.[1];
        const title = clean(card.find('[data-nagish="job-card-title"], h3').first().text());
        if (!id || !href || !title) return;
        // Meta line order: location, experience, job type, posted ("לפני 17 שעות").
        const meta = card.find('[class*="job-card-meta"][class*="__text"]').map((_, m) => clean($(m).text())).get();
        const posted = meta.find((m) => /לפני|היום|אתמול/.test(m));
        const type = meta.find((m) => /משרה|משמרות|פרילנס/.test(m));
        const experience = meta.find((m) => /שנ(ים|ה)|ניסיון/.test(m));
        const location = meta.find((m) => m !== posted && m !== type && m !== experience) ?? null;
        const description = clean(card.find('p[class*="__description"]').first().text());
        jobs.push({
          source: "drushim",
          externalId: id,
          url: BASE + href,
          title,
          company: clean(card.find('[class*="__companyName"]').first().text()) || null,
          location,
          description: [experience ? `ניסיון: ${experience}` : null, description].filter(Boolean).join("\n") || null,
          employmentType: type ?? null,
          workModel: workModelOf(`${meta.join(" ")} ${description.slice(0, 300)}`),
          postedAt: relativeDate(posted),
          query: q,
        });
      });
      await jitter(6000, 12000);
    }
    return { jobs, warnings };
  },
};

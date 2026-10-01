import { BlockedError, type RawJob, type Source } from "../types";
import { clean, get, jitter, load, relativeDate, workModelOf } from "../lib/http";

// JobMaster search: /jobs/?q=… redirects to /jobs/q-<term>/, server-rendered <article class="JobItem"> cards.

const BASE = "https://www.jobmaster.co.il";

export const jobmaster: Source = {
  key: "jobmaster",
  async run({ queries }) {
    const jobs: RawJob[] = [];
    const warnings: string[] = [];
    for (const q of queries) {
      let html: string;
      try {
        html = await get(`${BASE}/jobs/?q=${encodeURIComponent(q)}`, { referer: `${BASE}/` });
      } catch (e) {
        if (e instanceof BlockedError) throw e;
        warnings.push(`"${q}": ${(e as Error).message}`);
        continue;
      }
      const $ = load(html);
      $("article.JobItem[id^=misra]").each((_, el) => {
        const card = $(el);
        const id = card.attr("id")!.replace("misra", "");
        const title = clean(card.find("a.CardHeader").first().text());
        if (!id || !title) return;
        const attrs = clean(card.find("li.jobAttributes").text());
        const location = clean(card.find("li.jobLocation").text());
        jobs.push({
          source: "jobmaster",
          externalId: id,
          url: `${BASE}/jobs/checknum.asp?key=${id}`,
          title,
          company: clean(card.find(".CompanyNameLink").first().text()) || null,
          location: location || null,
          description: clean(card.find(".jobShortDescription").text()) || null,
          employmentType: clean(card.find("li.jobType").text()) || null,
          workModel: workModelOf(attrs),
          postedAt: relativeDate(card.find(".paddingTop10px .Gray").first().text()),
          query: q,
        });
      });
      await jitter(2000, 4500);
    }
    return { jobs, warnings };
  },
};

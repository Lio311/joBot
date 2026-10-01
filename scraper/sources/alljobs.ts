import { BlockedError, type RawJob, type Source } from "../types";
import { clean, get, jitter, load, relativeDate, workModelOf } from "../lib/http";

// AllJobs guest search results: server-rendered HTML cards ("open-board" boxes), newest first.

const BASE = "https://www.alljobs.co.il";

export const alljobs: Source = {
  key: "alljobs",
  async run({ queries }) {
    const jobs: RawJob[] = [];
    const warnings: string[] = [];
    for (const q of queries) {
      const url = `${BASE}/SearchResultsGuest.aspx?page=1&position=&type=&freetxt=${encodeURIComponent(q)}&city=&region=`;
      let html: string;
      try {
        html = await get(url, { referer: `${BASE}/` });
      } catch (e) {
        if (e instanceof BlockedError) throw e;
        warnings.push(`"${q}": ${(e as Error).message}`);
        continue;
      }
      const $ = load(html);
      $("div.open-board[id^=job-box-container]").each((_, el) => {
        const box = $(el);
        const id = box.attr("id")!.replace("job-box-container", "");
        const titleBox = box.find("[class^=job-content-top-title]").first();
        const title = clean(titleBox.find("h2").first().text());
        if (!id || !title) return;
        const location = clean(box.find("[class^=job-content-top-location]").first().text().replace(/^(מיקום|Location)\s*:?/i, ""));
        const description = clean(box.find(".job-content-top-desc").first().text());
        const type = clean(box.find("[class^=job-content-top-type]").first().text());
        jobs.push({
          source: "alljobs",
          externalId: id,
          url: `${BASE}/Search/UploadSingle.aspx?JobID=${id}`,
          title,
          company: clean(titleBox.find(".T14 a, .T14").first().text()) || null,
          location: location.slice(0, 200) || null,
          description: description || null,
          employmentType: type || null,
          workModel: workModelOf(`${location} ${description.slice(0, 300)}`),
          postedAt: relativeDate(box.find(".job-content-top-date").first().text()),
          query: q,
        });
      });
      await jitter(2000, 4500);
    }
    return { jobs, warnings };
  },
};

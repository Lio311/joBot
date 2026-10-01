import { and, eq, inArray, isNull } from "drizzle-orm";
import type { getDb } from "../../src/db/client";
import { jobs, type NewJob } from "../../src/db/schema";
import { fingerprint, scoreLocally } from "../../src/lib/match";
import type { ProfileAnswers } from "../../src/lib/profile";
import type { RawJob } from "../types";

type Db = ReturnType<typeof getDb>;

/** Jobs scoring below this against the profile aren't stored at all (company boards list every role). */
const STORE_MIN = Number(process.env.STORE_MIN_SCORE ?? 12);

export type Scored = NewJob & { excluded: boolean };

export const passes = (j: Scored) => (j.score ?? 0) >= STORE_MIN;

/**
 * Sources that list everything (all of a company's openings, a whole category, group posts):
 * their jobs must match a role or keyword in the title, not just mention a skill.
 */
const BROAD = new Set(["ats", "gotfriends", "facebook"]);

/**
 * Cleans a raw job and scores it against the profile. Null = not worth keeping.
 * `min` lowers the bar before a full description is fetched (list-only sources).
 */
export function normalize(raw: RawJob, profile: ProfileAnswers, version: number, min = STORE_MIN): Scored | null {
  const title = raw.title.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!title || !raw.url.startsWith("http")) return null;
  const description = raw.description?.trim().slice(0, 4000) || null;
  const local = scoreLocally({ ...raw, title, description }, profile);
  if (local.excluded || local.score < min) return null;
  if (BROAD.has(raw.source) && local.titleFit < 0.5) return null;
  const posted = raw.postedAt && !Number.isNaN(raw.postedAt.getTime()) && raw.postedAt.getTime() <= Date.now() + 864e5 ? raw.postedAt : null;
  return {
    source: raw.source,
    externalId: raw.externalId.slice(0, 300),
    url: raw.url,
    title,
    company: raw.company?.trim().slice(0, 200) || null,
    location: raw.location?.trim().slice(0, 300) || null,
    description,
    workModel: raw.workModel ?? null,
    employmentType: raw.employmentType?.trim().slice(0, 100) || null,
    query: raw.query?.slice(0, 200) ?? null,
    postedAt: posted,
    fingerprint: fingerprint(title, raw.company),
    score: local.score,
    match: local.match,
    scoredVersion: version,
    excluded: false,
  };
}

/**
 * Upserts by (source, externalId). New rows that share a fingerprint with an existing original
 * (same company + title on another site) are stored as duplicates of it.
 */
export async function saveJobs(db: Db, batch: Scored[]): Promise<{ inserted: number[] }> {
  const unique = [...new Map(batch.map((j) => [`${j.source}:${j.externalId}`, j])).values()];
  const inserted: number[] = [];
  const bySource = new Map<string, Scored[]>();
  for (const j of unique) bySource.set(j.source, [...(bySource.get(j.source) ?? []), j]);
  for (const [source, rows] of bySource) {
    const existing = await db
      .select({ id: jobs.id, externalId: jobs.externalId, description: jobs.description, aiScored: jobs.aiScored })
      .from(jobs)
      .where(and(eq(jobs.source, source), inArray(jobs.externalId, rows.map((r) => r.externalId))));
    const known = new Map(existing.map((e) => [e.externalId, e]));

    const fps = rows.map((r) => r.fingerprint).filter((f): f is string => !!f);
    const originals = fps.length
      ? await db
          .select({ id: jobs.id, fingerprint: jobs.fingerprint, source: jobs.source })
          .from(jobs)
          .where(and(inArray(jobs.fingerprint, fps), isNull(jobs.duplicateOf)))
      : [];
    const originalOf = new Map(originals.filter((o) => o.source !== source).map((o) => [o.fingerprint!, o.id]));

    for (const row of rows) {
      const { excluded: _excluded, ...values } = row;
      const prev = known.get(row.externalId);
      if (prev) {
        // Seen again: refresh what the site shows now, keep owner status and AI score.
        await db
          .update(jobs)
          .set({
            lastSeenAt: new Date(),
            url: values.url,
            title: values.title,
            location: values.location ?? undefined,
            // List pages carry a snippet; never overwrite a fuller description fetched earlier.
            description: (values.description?.length ?? 0) > (prev.description?.length ?? 0) ? values.description : undefined,
            ...(prev.aiScored ? {} : { score: values.score, match: values.match, scoredVersion: values.scoredVersion }),
          })
          .where(eq(jobs.id, prev.id));
        continue;
      }
      const dupOf = row.fingerprint ? originalOf.get(row.fingerprint) : undefined;
      const res = await db
        .insert(jobs)
        .values({ ...values, duplicateOf: dupOf ?? null })
        .onConflictDoNothing()
        .returning({ id: jobs.id });
      if (res[0] && !dupOf) {
        inserted.push(res[0].id);
        if (row.fingerprint) originalOf.set(row.fingerprint, res[0].id);
      }
    }
  }
  return { inserted };
}

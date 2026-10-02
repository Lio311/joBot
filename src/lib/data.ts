import "server-only";
import { and, desc, gte, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, jobs, scrapeRuns, type JobStatus, type MatchInfo } from "@/db/schema";
import { aiConfigured } from "./ai";
import { draftLocally } from "./cv-draft";
import { completeness, type ProfileAnswers } from "./profile";
import { placeOf, type PlaceKey } from "./places";
import { loadProfile } from "./profile-store";

export interface JobView {
  id: number;
  source: string;
  url: string;
  title: string;
  company: string | null;
  location: string | null;
  /** City (or region) the location resolves to, for the map. Null = remote / unknown. */
  place: PlaceKey | null;
  description: string | null;
  workModel: string | null;
  employmentType: string | null;
  score: number | null;
  match: MatchInfo | null;
  status: JobStatus;
  postedAt: string | null;
  firstSeenAt: string;
  notified: boolean;
  /** Other sites listing the same job. */
  alsoOn: string[];
}

export interface RunView {
  source: string;
  status: string;
  finishedAt: string | null;
  found: number;
  inserted: number;
  message: string | null;
}

const DAYS = 45;

export async function getBoardData() {
  const db = getDb();
  const since = new Date(Date.now() - DAYS * 864e5);
  const [rows, dups, runs, prof] = await Promise.all([
    db
      .select()
      .from(jobs)
      .where(and(isNull(jobs.duplicateOf), gte(jobs.firstSeenAt, since)))
      .orderBy(desc(jobs.score), desc(jobs.firstSeenAt))
      .limit(2500),
    db.select({ of: jobs.duplicateOf, source: jobs.source }).from(jobs).where(and(isNotNull(jobs.duplicateOf), gte(jobs.firstSeenAt, since))),
    db
      .selectDistinctOn([scrapeRuns.source])
      .from(scrapeRuns)
      .where(isNotNull(scrapeRuns.finishedAt))
      .orderBy(scrapeRuns.source, desc(scrapeRuns.startedAt)),
    loadProfile(db),
  ]);
  const alsoOn = new Map<number, Set<string>>();
  for (const d of dups) if (d.of) alsoOn.set(d.of, (alsoOn.get(d.of) ?? new Set()).add(d.source));

  const view: JobView[] = rows.map((j) => ({
    id: j.id,
    source: j.source,
    url: j.url,
    title: j.title,
    company: j.company,
    location: j.location,
    place: placeOf(j.location),
    description: j.description,
    workModel: j.workModel,
    employmentType: j.employmentType,
    score: j.score,
    match: j.match,
    status: j.status,
    postedAt: j.postedAt?.toISOString() ?? null,
    firstSeenAt: j.firstSeenAt.toISOString(),
    notified: !!j.notifiedAt,
    alsoOn: [...(alsoOn.get(j.id) ?? [])].filter((s) => s !== j.source),
  }));
  return {
    jobs: view,
    runs: runs.map<RunView>((r) => ({
      source: r.source,
      status: r.status,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      found: r.found,
      inserted: r.inserted,
      message: r.message,
    })),
    profile: summarize(prof.answers, !!prof.cvText),
    now: Date.now(),
  };
}

function summarize(p: ProfileAnswers, hasCv: boolean) {
  return { hasCv, roles: p.roles, minScore: p.minScore, completeness: completeness(p, hasCv), ai: aiConfigured() };
}

export async function getProfileData() {
  const db = getDb();
  const [prof, boards] = await Promise.all([
    loadProfile(db),
    db
      .select()
      .from(companies)
      .where(ne(companies.origin, "probe-miss")) // names tried by board guessing that had no board
      .orderBy(sql`${companies.active} desc`, companies.name),
  ]);
  const fromCv = prof.cvText ? draftLocally(prof.cvText) : null;
  return {
    answers: prof.answers,
    version: prof.version,
    /** Titles and skills found in the CV text, offered first as one-tap suggestions. */
    cvSuggestions: { roles: fromCv?.roles ?? [], skills: [...(fromCv?.skills ?? []), ...(fromCv?.niceSkills ?? [])] },
    cv: prof.cvText ? { fileName: prof.cvFileName, chars: prof.cvText.length, updatedAt: prof.cvUpdatedAt?.toISOString() ?? null, preview: prof.cvText.slice(0, 600) } : null,
    companies: boards.map((c) => ({ id: c.id, ats: c.ats, slug: c.slug, name: c.name, origin: c.origin, active: c.active, lastJobCount: c.lastJobCount, lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null })),
    ai: aiConfigured(),
    now: Date.now(),
  };
}

export type BoardData = Awaited<ReturnType<typeof getBoardData>>;
export type ProfileData = Awaited<ReturnType<typeof getProfileData>>;

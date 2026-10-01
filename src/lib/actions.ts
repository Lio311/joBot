"use server";

import { and, eq, gte, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { companies, JOB_STATUSES, jobs, type AtsKind, type JobStatus } from "@/db/schema";
import { aiConfigured, draftProfileFromCv } from "./ai";
import { AuthError, requireAuth } from "./auth";
import { boardOf } from "./boards";
import { pdfToText } from "./cv";
import { scoreLocally } from "./match";
import { INDUSTRIES, normalizeAnswers, type ProfileAnswers } from "./profile";
import { loadProfile, saveProfile } from "./profile-store";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Runs an action behind the session check; never throws to the client. */
async function guarded<T extends object>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    await requireAuth();
    return await fn();
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: "צריך להתחבר מחדש" };
    console.error("[action]", e);
    return { ok: false, error: "משהו השתבש, נסה שוב" };
  }
}

export async function setJobStatus(id: number, status: JobStatus): Promise<Result> {
  return guarded(async () => {
    if (!Number.isSafeInteger(id) || !JOB_STATUSES.includes(status)) return { ok: false, error: "invalid" };
    await getDb().update(jobs).set({ status, statusAt: new Date() }).where(eq(jobs.id, id));
    revalidatePath("/");
    return { ok: true };
  });
}

/**
 * Saves the questionnaire and rescores recent jobs locally right away. AI scores are marked stale,
 * so the next scraper run re-scores the best candidates against the new answers.
 */
export async function saveAnswers(raw: unknown): Promise<Result<{ rescored: number }>> {
  return guarded<{ rescored: number }>(async () => {
    const answers = normalizeAnswers(raw);
    const db = getDb();
    const version = await saveProfile(db, { answers });
    const rescored = await rescoreRecent(answers, version);
    revalidatePath("/");
    revalidatePath("/profile");
    return { ok: true, rescored };
  });
}

async function rescoreRecent(answers: ProfileAnswers, version: number) {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 864e5);
  const rows = await db
    .select({ id: jobs.id, title: jobs.title, company: jobs.company, location: jobs.location, description: jobs.description, workModel: jobs.workModel, employmentType: jobs.employmentType })
    .from(jobs)
    .where(and(isNull(jobs.duplicateOf), ne(jobs.status, "hidden"), gte(jobs.firstSeenAt, since)));
  for (let i = 0; i < rows.length; i += 25) {
    await Promise.all(
      rows.slice(i, i + 25).map((r) => {
        const s = scoreLocally(r, answers);
        return db.update(jobs).set({ score: s.score, match: s.match, scoredVersion: version, aiScored: false }).where(eq(jobs.id, r.id));
      }),
    );
  }
  return rows.length;
}

const MAX_CV_BYTES = 4 * 1024 * 1024;

export async function uploadCv(form: FormData): Promise<Result<{ chars: number }>> {
  return guarded<{ chars: number }>(async () => {
    const file = form.get("cv");
    if (!(file instanceof File) || !file.size) return { ok: false, error: "לא נבחר קובץ" };
    if (file.size > MAX_CV_BYTES) return { ok: false, error: "הקובץ גדול מ-4MB" };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return { ok: false, error: "צריך קובץ PDF" };
    const text = await pdfToText(bytes);
    if (text.length < 200) return { ok: false, error: "לא הצלחתי לקרוא טקסט מה-PDF (אולי זו תמונה סרוקה?)" };
    await saveProfile(getDb(), { cvText: text, cvFileName: file.name.slice(0, 200) });
    revalidatePath("/profile");
    revalidatePath("/");
    return { ok: true, chars: text.length };
  });
}

/** Claude reads the CV and drafts answers; the form merges them for the owner to review. */
export async function draftFromCv(): Promise<Result<{ draft: Partial<ProfileAnswers> }>> {
  return guarded<{ draft: Partial<ProfileAnswers> }>(async () => {
    if (!aiConfigured()) return { ok: false, error: "צריך להגדיר ANTHROPIC_API_KEY כדי למלא אוטומטית" };
    const prof = await loadProfile(getDb());
    if (!prof.cvText) return { ok: false, error: "קודם להעלות קורות חיים" };
    const draft = await draftProfileFromCv(prof.cvText, INDUSTRIES);
    return { ok: true, draft };
  });
}

/** Adds a company board from a careers-page URL (Comeet, Greenhouse, Lever, Ashby), after checking it answers. */
export async function addCompany(input: string, name: string): Promise<Result<{ name: string; jobs: number }>> {
  return guarded<{ name: string; jobs: number }>(async () => {
    const board = boardOf(input.trim());
    if (!board) return { ok: false, error: "קישור לא מזוהה. צריך קישור ללוח משרות ב-Comeet / Greenhouse / Lever / Ashby" };
    const count = await probeBoard(board.ats, board.slug);
    if (count === null) return { ok: false, error: "לא הצלחתי לקרוא את הלוח הזה" };
    const label = name.trim().slice(0, 80) || board.slug.split("/")[0];
    await getDb()
      .insert(companies)
      .values({ ats: board.ats, slug: board.slug, name: label, origin: "user", lastJobCount: count })
      .onConflictDoUpdate({ target: [companies.ats, companies.slug], set: { active: true, name: label } });
    revalidatePath("/profile");
    return { ok: true, name: label, jobs: count };
  });
}

async function probeBoard(ats: AtsKind, slug: string): Promise<number | null> {
  const url = {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    lever: `https://api.lever.co/v0/postings/${slug}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    comeet: `https://www.comeet.com/jobs/${slug}`,
  }[ats];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 joBot" } });
    if (!res.ok) return null;
    if (ats === "comeet") {
      const m = (await res.text()).match(/COMPANY_POSITIONS_DATA\s*=\s*(\[[\s\S]*?\]);\s*\n/);
      return m ? (JSON.parse(m[1]) as unknown[]).length : null;
    }
    const data = (await res.json()) as { jobs?: unknown[] } | unknown[];
    return Array.isArray(data) ? data.length : (data.jobs?.length ?? null);
  } catch {
    return null;
  }
}

export async function setCompanyActive(id: number, active: boolean): Promise<Result> {
  return guarded(async () => {
    if (!Number.isSafeInteger(id)) return { ok: false, error: "invalid" };
    await getDb().update(companies).set({ active }).where(eq(companies.id, id));
    revalidatePath("/profile");
    return { ok: true };
  });
}

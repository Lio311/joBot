import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { writeFileSync } from "node:fs";
import { and, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "../src/db/client";
import { companies, jobs, scrapeRuns, type Company } from "../src/db/schema";
import { aiConfigured, scoreWithAi } from "../src/lib/ai";
import { searchQueries } from "../src/lib/profile";
import { atsLinks } from "../src/lib/boards";
import { ensureSeedCompanies, loadProfile } from "../src/lib/profile-store";
import { ApifyBudgetError } from "./lib/apify";
import { renderEmail, sendEmail } from "./lib/email";
import { jitter } from "./lib/http";
import { normalize, passes, saveJobs, type Scored } from "./lib/store";
import { alljobs } from "./sources/alljobs";
import { ats, atsCounts } from "./sources/ats";
import { drushim } from "./sources/drushim";
import { facebook } from "./sources/facebook";
import { gotfriends } from "./sources/gotfriends";
import { google } from "./sources/google";
import { jobmaster } from "./sources/jobmaster";
import { linkedin } from "./sources/linkedin";
import { BlockedError, type RawJob, type Source } from "./types";

// Google runs first: the company boards it discovers are read by `ats` in the same run.
const ALL: Source[] = [google, linkedin, alljobs, drushim, jobmaster, gotfriends, ats, facebook];

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const only = flag("only")?.split("=")[1]?.split(",");
const dry = !!flag("dry");
const noEmail = !!flag("no-email");
const noAi = !!flag("no-ai");

const DETAILS_PER_SOURCE = Number(process.env.DETAILS_PER_SOURCE ?? 25);
const AI_MAX_PER_RUN = Number(process.env.AI_MAX_PER_RUN ?? 40);
const AI_MIN_LOCAL = Number(process.env.AI_MIN_LOCAL_SCORE ?? 25);
const AI_BATCH = 8;
const EMAIL_WINDOW_DAYS = 7;

const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...m);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (the profile lives in the database)");
  const db = getDb();
  await migrate(db, { migrationsFolder: "drizzle" });
  await ensureSeedCompanies(db);

  const profile = await loadProfile(db);
  const queries = searchQueries(profile.answers);
  if (!queries.length) {
    log("profile has no roles yet: fill in the questionnaire on the dashboard first");
    if (!dry) await db.insert(scrapeRuns).values({ source: "profile", status: "skipped", message: "no roles in the profile yet", finishedAt: new Date() });
    return true;
  }
  log(`profile v${profile.version}: ${queries.length} queries (${queries.join(", ")}), CV ${profile.cvText ? `${profile.cvText.length} chars` : "missing"}`);

  let boards: Company[] = await db.select().from(companies);
  const discovered = new Map<string, { ats: Company["ats"]; slug: string; name: string }>();

  const sources = only ? ALL.filter((s) => only.includes(s.key)) : ALL;
  const warnings: string[] = [];
  const dryRows: Scored[] = [];
  let anySucceeded = false;

  for (const source of sources) {
    const skip = source.skip?.();
    if (skip) {
      log(`${source.key}: skipped (${skip})`);
      if (!dry) await db.insert(scrapeRuns).values({ source: source.key, status: "skipped", message: skip, finishedAt: new Date() });
      continue;
    }
    // Boards discovered earlier in this run (Google, links inside postings) are read in this same run.
    if (source.key === "ats" && discovered.size && !dry) {
      const added = await db
        .insert(companies)
        .values([...discovered.values()].map((c) => ({ ...c, origin: "discovered" })))
        .onConflictDoNothing()
        .returning();
      if (added.length) log(`ats: ${added.length} new company boards discovered (${added.map((c) => c.name).join(", ")})`);
      boards = await db.select().from(companies);
    }

    log(`${source.key}: start`);
    const [run] = dry ? [] : await db.insert(scrapeRuns).values({ source: source.key, status: "running" }).returning();
    try {
      const res = await source.run({
        profile: profile.answers,
        queries,
        companies: boards,
        discover: (c) => discovered.set(`${c.ats}:${c.slug}`, c),
      });
      res.warnings.forEach((w) => log(`  ⚠ ${w}`));
      // Postings often link the company's own ATS board: register it for the ats source (free discovery).
      for (const j of res.jobs) for (const b of atsLinks(`${j.url} ${j.description ?? ""}`)) discovered.set(`${b.ats}:${b.slug}`, { ...b, name: j.company ?? b.slug.split("/")[0] });
      warnings.push(...res.warnings.filter((w) => !/read by the ats source/.test(w)).map((w) => `${source.key}: ${w}`));

      // List-only sources keep everything for now: the full posting decides once it's fetched.
      let kept = res.jobs.map((j) => normalize(j, profile.answers, profile.version, source.describe ? 0 : undefined)).filter((j): j is Scored => j !== null);
      if (source.describe) kept = (await enrich(source, res.jobs, kept, profile, res.warnings)).filter(passes);
      log(`${source.key}: ${res.jobs.length} scraped, ${kept.length} relevant`);

      let inserted = 0;
      if (dry) dryRows.push(...kept);
      else inserted = (await saveJobs(db, kept)).inserted.length;

      if (source.key === "ats" && !dry) {
        for (const [id, n] of atsCounts) await db.update(companies).set({ lastCheckedAt: new Date(), lastJobCount: n }).where(eq(companies.id, id));
      }
      if (run)
        await db
          .update(scrapeRuns)
          .set({ status: "ok", found: kept.length, inserted, finishedAt: new Date(), message: res.warnings.slice(0, 4).join(" · ").slice(0, 500) || null })
          .where(eq(scrapeRuns.id, run.id));
      log(`${source.key}: ${inserted} new`);
      anySucceeded = true;
    } catch (e) {
      const status = e instanceof ApifyBudgetError ? "paused" : e instanceof BlockedError ? "blocked" : "error";
      const msg = (e as Error).message;
      log(`${source.key}: ${status.toUpperCase()} ${msg}`);
      if (status !== "paused") warnings.push(`${source.key} ${status === "blocked" ? "blocked" : "failed"}`);
      if (run) await db.update(scrapeRuns).set({ status, message: msg.slice(0, 500), finishedAt: new Date() }).where(eq(scrapeRuns.id, run.id));
    }
  }

  if (dry) {
    writeFileSync("dry-run.json", JSON.stringify(dryRows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)), null, 2));
    log(`dry run: ${dryRows.length} jobs written to dry-run.json`);
    return anySucceeded;
  }

  if (!noAi) await aiPass(db, profile);
  if (!noEmail) await emailPass(db, profile.answers.minScore, warnings);
  return anySucceeded;
}

/**
 * List-only sources (LinkedIn) give a title and company, no description. Fetch the full posting for
 * the most promising ones (by title score), politely and capped, then rescore them.
 */
async function enrich(source: Source, raw: RawJob[], kept: Scored[], profile: Awaited<ReturnType<typeof loadProfile>>, warnings: string[]) {
  const rawById = new Map(raw.map((r) => [r.externalId, r]));
  const candidates = kept
    .filter((k) => !k.description)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, DETAILS_PER_SOURCE);
  // Skip postings we already hold a description for.
  const db = getDb();
  const have = candidates.length
    ? await db
        .select({ externalId: jobs.externalId })
        .from(jobs)
        .where(and(eq(jobs.source, source.key), inArray(jobs.externalId, candidates.map((c) => c.externalId)), sql`${jobs.description} is not null`))
    : [];
  const skip = new Set(have.map((h) => h.externalId));
  const out = new Map(kept.map((k) => [k.externalId, k]));
  let fetched = 0;
  for (const c of candidates) {
    if (skip.has(c.externalId)) continue;
    const r = rawById.get(c.externalId);
    if (!r) continue;
    try {
      const extra = await source.describe!(r);
      const again = normalize({ ...r, ...extra }, profile.answers, profile.version);
      if (again) out.set(c.externalId, again);
      else out.delete(c.externalId); // the full text shows it doesn't fit (e.g. an exclude keyword)
      fetched++;
    } catch (e) {
      warnings.push(`details: ${(e as Error).message}`);
      if (e instanceof BlockedError) break;
    }
    await jitter(1200, 2800);
  }
  if (fetched) log(`${source.key}: fetched ${fetched} full postings`);
  return [...out.values()];
}

/** Claude scores the most promising unscored jobs against the CV + questionnaire. */
async function aiPass(db: ReturnType<typeof getDb>, profile: Awaited<ReturnType<typeof loadProfile>>) {
  if (!aiConfigured()) {
    log("ai: skipped (ANTHROPIC_API_KEY not set), keeping keyword scores");
    return;
  }
  const since = new Date(Date.now() - 21 * 864e5);
  const todo = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.aiScored, false), isNull(jobs.duplicateOf), ne(jobs.status, "hidden"), gte(jobs.firstSeenAt, since), gte(jobs.score, AI_MIN_LOCAL)))
    .orderBy(desc(jobs.score), desc(jobs.firstSeenAt))
    .limit(AI_MAX_PER_RUN);
  if (!todo.length) return log("ai: nothing to score");
  const [run] = await db.insert(scrapeRuns).values({ source: "ai", status: "running" }).returning();
  let done = 0;
  const errors: string[] = [];
  for (let i = 0; i < todo.length; i += AI_BATCH) {
    const batch = todo.slice(i, i + AI_BATCH);
    try {
      const verdicts = await scoreWithAi(batch, profile.cvText, profile.answers);
      for (const v of verdicts) {
        await db.update(jobs).set({ score: v.score, match: v.match, aiScored: true, scoredVersion: profile.version }).where(eq(jobs.id, v.id));
        done++;
      }
    } catch (e) {
      errors.push((e as Error).message.slice(0, 200));
      log(`ai: batch failed: ${(e as Error).message}`);
      if (errors.length >= 2) break;
    }
  }
  log(`ai: scored ${done}/${todo.length}`);
  await db
    .update(scrapeRuns)
    .set({ status: done ? "ok" : "error", found: todo.length, inserted: done, finishedAt: new Date(), message: errors[0] ?? null })
    .where(eq(scrapeRuns.id, run.id));
}

/** Emails jobs not yet sent that clear the owner's minimum score (AI-scored when AI is on). */
async function emailPass(db: ReturnType<typeof getDb>, minScore: number, warnings: string[]) {
  const since = new Date(Date.now() - EMAIL_WINDOW_DAYS * 864e5);
  const fresh = await db
    .select()
    .from(jobs)
    .where(
      and(
        isNull(jobs.notifiedAt),
        isNull(jobs.duplicateOf),
        eq(jobs.status, "new"),
        gte(jobs.firstSeenAt, since),
        gte(jobs.score, minScore),
        ...(aiConfigured() ? [eq(jobs.aiScored, true)] : []),
      ),
    );
  if (!fresh.length) return log(`email: nothing new at ${minScore}+`);
  try {
    const { subject, html } = renderEmail(fresh, warnings);
    await sendEmail(subject, html);
    log(`email sent: ${subject}`);
    await db.update(jobs).set({ notifiedAt: new Date() }).where(inArray(jobs.id, fresh.map((j) => j.id)));
  } catch (e) {
    log(`email not sent: ${(e as Error).message}`);
  }
}

main()
  .then(async (ok) => {
    await closeDb();
    process.exit(ok ? 0 : 1);
  })
  .catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });

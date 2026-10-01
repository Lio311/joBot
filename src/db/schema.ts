import type { ProfileAnswers } from "../lib/profile";
import { pgTable, serial, text, integer, timestamp, jsonb, uniqueIndex, index, boolean } from "drizzle-orm/pg-core";

/** Where the owner is with a job. "new" until they act on it. */
export const JOB_STATUSES = ["new", "saved", "applied", "interview", "rejected", "hidden"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Why a job got its score: shown on the card and in the email. */
export interface MatchInfo {
  /** One line, in Hebrew, written by the AI (or built from the keyword match). */
  reason: string;
  matched: string[];
  missing: string[];
  /** "ai" = scored by Claude against the CV; "keywords" = local scoring only. */
  by: "ai" | "keywords";
  /** Seniority the posting asks for, when it says (e.g. "3+ years"). */
  yearsRequired?: number | null;
}

export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    company: text("company"),
    location: text("location"),
    /** Trimmed to 4000 characters. */
    description: text("description"),
    /** onsite | hybrid | remote, when the source says. */
    workModel: text("work_model"),
    /** Full-time, part-time, student… as the source words it. */
    employmentType: text("employment_type"),
    /** Search keyword (or company board) that found it. */
    query: text("query"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    /** company + title, normalized; the same job on two sites shares it. */
    fingerprint: text("fingerprint"),
    duplicateOf: integer("duplicate_of"),
    /** 0–100 fit against the profile and CV. Null = not scored yet. */
    score: integer("score"),
    match: jsonb("match").$type<MatchInfo>(),
    /** profile.version the score was computed against; rescored when the profile changes. */
    scoredVersion: integer("scored_version"),
    /** True once Claude scored it (keyword scores can be upgraded later). */
    aiScored: boolean("ai_scored").notNull().default(false),
    status: text("status").$type<JobStatus>().notNull().default("new"),
    statusAt: timestamp("status_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("jobs_source_external_idx").on(t.source, t.externalId),
    index("jobs_fingerprint_idx").on(t.fingerprint),
    index("jobs_first_seen_idx").on(t.firstSeenAt),
    index("jobs_score_idx").on(t.score),
  ],
);

/** The owner's search profile ("איפיון"): one row, id = 1, edited from the dashboard. */
export const profile = pgTable("profile", {
  id: integer("id").primaryKey(),
  /** Bumped on every save so jobs get rescored against the new answers. */
  version: integer("version").notNull().default(1),
  cvText: text("cv_text"),
  cvFileName: text("cv_file_name"),
  cvUpdatedAt: timestamp("cv_updated_at", { withTimezone: true }),
  /** Everything from the questionnaire (see src/lib/profile.ts). */
  answers: jsonb("answers").$type<Partial<ProfileAnswers>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ATS_KINDS = ["greenhouse", "lever", "ashby", "comeet"] as const;
export type AtsKind = (typeof ATS_KINDS)[number];

/** Company career boards read directly through their ATS's public API. */
export const companies = pgTable(
  "companies",
  {
    id: serial("id").primaryKey(),
    ats: text("ats").$type<AtsKind>().notNull(),
    /** Board token: "riskified" (Greenhouse), "oligosecurity/5A.00B" (Comeet). */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** seed | google | user */
    origin: text("origin").notNull().default("user"),
    active: boolean("active").notNull().default(true),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastJobCount: integer("last_job_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("companies_ats_slug_idx").on(t.ats, t.slug)],
);

export const scrapeRuns = pgTable("scrape_runs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(), // running | ok | blocked | paused | skipped | error
  found: integer("found").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  message: text("message"),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Profile = typeof profile.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type ScrapeRun = typeof scrapeRuns.$inferSelect;

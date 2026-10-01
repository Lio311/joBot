// Reading/writing the single profile row and the company boards list. Server and scraper only.

import { eq, sql } from "drizzle-orm";
import type { getDb } from "@/db/client";
import { companies, profile } from "@/db/schema";
import { SEED_COMPANIES } from "./config";
import { normalizeAnswers, type ProfileAnswers } from "./profile";

type Db = ReturnType<typeof getDb>;

export interface LoadedProfile {
  answers: ProfileAnswers;
  version: number;
  cvText: string;
  cvFileName: string | null;
  cvUpdatedAt: Date | null;
  updatedAt: Date | null;
}

export async function loadProfile(db: Db): Promise<LoadedProfile> {
  const [row] = await db.select().from(profile).where(eq(profile.id, 1));
  return {
    answers: normalizeAnswers(row?.answers ?? {}),
    version: row?.version ?? 0,
    cvText: row?.cvText ?? "",
    cvFileName: row?.cvFileName ?? null,
    cvUpdatedAt: row?.cvUpdatedAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Saves answers and/or the CV; bumps the version so jobs get rescored. Returns the new version. */
export async function saveProfile(db: Db, patch: { answers?: ProfileAnswers; cvText?: string; cvFileName?: string }): Promise<number> {
  const now = new Date();
  const cv = patch.cvText !== undefined ? { cvText: patch.cvText, cvFileName: patch.cvFileName ?? null, cvUpdatedAt: now } : {};
  const [row] = await db
    .insert(profile)
    .values({ id: 1, version: 1, answers: patch.answers ?? {}, updatedAt: now, ...cv })
    .onConflictDoUpdate({
      target: profile.id,
      set: { version: sql`${profile.version} + 1`, updatedAt: now, ...(patch.answers ? { answers: patch.answers } : {}), ...cv },
    })
    .returning({ version: profile.version });
  return row.version;
}

/** Inserts the seed company boards once (existing rows, including deactivated ones, are left alone). */
export async function ensureSeedCompanies(db: Db) {
  await db
    .insert(companies)
    .values(SEED_COMPANIES.map((c) => ({ ...c, origin: "seed" })))
    .onConflictDoNothing();
}

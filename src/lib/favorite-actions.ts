"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { listings } from "@/db/schema";
import { passcodeOk } from "./passcode";

export type ToggleStarResult =
  | { ok: true; starredAt: string | null }
  | { ok: false; reason: "passcode" | "invalid" | "not-found" | "error" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stars or unstars a listing (the owner's favorites, kept in the DB so they sync across devices).
 * Needs ADMIN_PASSCODE when one is configured. Never throws: failures come back as `{ ok: false, reason }`.
 */
export async function toggleStar(listingId: number, starred: boolean, passcode?: string): Promise<ToggleStarResult> {
  if (!passcodeOk(passcode)) {
    await sleep(400); // slows down guessing
    return { ok: false, reason: "passcode" };
  }
  if (typeof listingId !== "number" || !Number.isSafeInteger(listingId) || listingId <= 0 || typeof starred !== "boolean") {
    return { ok: false, reason: "invalid" };
  }
  let rows: { starredAt: Date | null }[];
  try {
    rows = await getDb()
      .update(listings)
      // Starring twice keeps the original time.
      .set({ starredAt: starred ? sql`coalesce(${listings.starredAt}, now())` : null })
      .where(eq(listings.id, listingId))
      .returning({ starredAt: listings.starredAt });
  } catch (e) {
    console.error("[toggleStar]", e);
    return { ok: false, reason: "error" };
  }
  if (!rows.length) return { ok: false, reason: "not-found" };
  revalidatePath("/");
  return { ok: true, starredAt: rows[0].starredAt?.toISOString() ?? null };
}

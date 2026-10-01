"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { trackedCities } from "@/db/schema";
import { deriveCity, englishName, findExact, searchSettlements, settlements, type Settlement } from "./cbs";
import { CITIES, MAX_CUSTOM_CITIES, PRIORITY_LABEL, type Priority } from "./config";
import { passcodeOk, passcodeRequired } from "./passcode";

export interface CitySuggestion {
  code: string;
  he: string;
  name: string;
  /** Already a built-in or custom city. */
  tracked: boolean;
}

export type CityActionResult =
  | { ok: true; city: { key: string; name: string; he: string; priority: Priority } }
  | { ok: false; error: string; field?: "query" | "priority" | "passcode" };

const MAX_QUERY = 60;
const BUILT_IN_CODES = new Set(CITIES.map((c) => c.yad2));
const BUILT_IN_KEYS = new Set(CITIES.map((c) => c.key));

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function denied(): Promise<CityActionResult> {
  await sleep(400); // slows down guessing
  return { ok: false, error: "Wrong passcode", field: "passcode" };
}

export async function isPasscodeRequired(): Promise<boolean> {
  return passcodeRequired();
}

/** Top CBS settlement matches for the add-city typeahead. */
export async function searchCities(q: unknown): Promise<{ results: CitySuggestion[]; error?: string }> {
  const query = text(q, MAX_QUERY);
  if (!query) return { results: [] };
  let list: Settlement[];
  try {
    list = await settlements();
  } catch {
    return { results: [], error: "Couldn't reach the settlements list. Try again in a moment." };
  }
  const custom = await getDb().select({ code: trackedCities.yad2Code }).from(trackedCities);
  const tracked = new Set([...BUILT_IN_CODES, ...custom.map((c) => c.code)]);
  return {
    results: searchSettlements(list, query).map((s) => ({
      code: s.code,
      he: s.he,
      name: englishName(s) || s.he,
      tracked: tracked.has(s.code),
    })),
  };
}

/** Adds a CBS settlement as a tracked city. Pass the `code` of a suggestion, or free text in `query`. */
export async function addCity(input: { code?: unknown; query?: unknown; priority?: unknown; passcode?: unknown }): Promise<CityActionResult> {
  const priority = Number(input?.priority);
  if (!Number.isInteger(priority) || !(priority in PRIORITY_LABEL)) return { ok: false, error: "Pick a priority", field: "priority" };
  if (!passcodeOk(input?.passcode)) return denied();

  const code = text(input?.code, 6);
  const query = text(input?.query, MAX_QUERY);
  if (code && !/^\d{1,5}$/.test(code)) return { ok: false, error: "Unknown city", field: "query" };
  if (!code && !query) return { ok: false, error: "Type a city name", field: "query" };

  let list: Settlement[];
  try {
    list = await settlements();
  } catch {
    return { ok: false, error: "Couldn't reach the settlements list. Try again in a moment." };
  }
  let settlement = code ? list.find((s) => s.code === code) : findExact(list, query);
  if (!settlement && !code) {
    const matches = searchSettlements(list, query, 2);
    if (matches.length === 1) settlement = matches[0];
  }
  if (!settlement) {
    return { ok: false, error: code ? "Unknown city" : `No single settlement matches "${query}". Pick one from the list.`, field: "query" };
  }
  if (BUILT_IN_CODES.has(settlement.code)) return { ok: false, error: `${settlement.he} is already tracked`, field: "query" };

  const db = getDb();
  const existing = await db.select({ key: trackedCities.key, code: trackedCities.yad2Code }).from(trackedCities);
  if (existing.some((c) => c.code === settlement.code)) return { ok: false, error: `${settlement.he} is already tracked`, field: "query" };
  if (existing.length >= MAX_CUSTOM_CITIES) {
    return { ok: false, error: `You can track up to ${MAX_CUSTOM_CITIES} added cities. Remove one first.` };
  }

  const city = await deriveCity(settlement);
  const taken = new Set([...BUILT_IN_KEYS, ...existing.map((c) => c.key)]);
  if (taken.has(city.key)) city.key = `${city.key}-${settlement.code}`;

  try {
    await db.insert(trackedCities).values({ ...city, priority });
  } catch (e) {
    const unique = (e as { code?: string; cause?: { code?: string } }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505";
    if (unique) return { ok: false, error: `${settlement.he} is already tracked`, field: "query" };
    throw e;
  }
  revalidatePath("/");
  return { ok: true, city: { key: city.key, name: city.name, he: city.he, priority: priority as Priority } };
}

/** Stops tracking a city added from the dashboard. Listings already collected stay until they age out. */
export async function removeCity(input: { key?: unknown; passcode?: unknown }): Promise<{ ok: true } | { ok: false; error: string; field?: "passcode" }> {
  const key = text(input?.key, 80);
  if (!/^[a-z0-9-]+$/.test(key)) return { ok: false, error: "Unknown city" };
  if (BUILT_IN_KEYS.has(key)) return { ok: false, error: "Built-in cities can't be removed" };
  if (!passcodeOk(input?.passcode)) {
    await sleep(400);
    return { ok: false, error: "Wrong passcode", field: "passcode" };
  }
  const removed = await getDb().delete(trackedCities).where(eq(trackedCities.key, key)).returning({ id: trackedCities.id });
  revalidatePath("/");
  return removed.length ? { ok: true } : { ok: false, error: "That city was already removed" };
}

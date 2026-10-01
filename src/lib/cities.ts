// The tracked city list: built-ins plus the ones added from the dashboard.
// Shared by the scraper and the Next server, so no "server-only" here.

import { asc } from "drizzle-orm";
import { getDb } from "../db/client";
import { trackedCities, type TrackedCity } from "../db/schema";
import { CITIES, mergeCities, type City, type Priority } from "./config";

export function toCity(row: TrackedCity): City {
  return {
    key: row.key,
    name: row.name,
    he: row.he,
    priority: Math.min(4, Math.max(1, row.priority)) as Priority,
    yad2: row.yad2Code,
    onmap: row.onmap,
    homeless: row.homeless,
    aliases: row.aliases.length ? row.aliases : [row.he],
    custom: true,
  };
}

/**
 * Built-in cities followed by the custom ones from the tracked_cities table. If the
 * table can't be read the built-ins are returned, so scraping them never depends on it.
 */
export async function getCities(db?: ReturnType<typeof getDb>): Promise<City[]> {
  try {
    const rows = await (db ?? getDb())
      .select()
      .from(trackedCities)
      .orderBy(asc(trackedCities.priority), asc(trackedCities.createdAt));
    return mergeCities(rows.map(toCity));
  } catch (e) {
    console.warn(`tracked cities unavailable, using built-ins: ${(e as Error).message}`);
    return CITIES;
  }
}

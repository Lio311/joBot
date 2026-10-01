import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { writeFileSync } from "node:fs";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "../src/db/client";
import { listings, scrapeRuns, type NewListing } from "../src/db/schema";
import { getCities } from "../src/lib/cities";
import { CITIES } from "../src/lib/config";
import { closeBrowser } from "./lib/browser";
import { renderEmail, sendEmail } from "./lib/email";
import { normalize, saveListings, type Normalized, type PriceChange } from "./lib/store";
import { sendToSubscribers } from "./lib/subscribers";
import { verifyRemoved } from "./lib/verify-removed";
import { yad2 } from "./sources/yad2";
import { onmap } from "./sources/onmap";
import { homeless } from "./sources/homeless";
import { madlan } from "./sources/madlan";
import { facebookGroups, facebookMarketplace } from "./sources/facebook";
import { BlockedError, type Source } from "./types";
import { ApifyBudgetError } from "./lib/apify";

const ALL: Source[] = [yad2, onmap, homeless, madlan, facebookGroups, facebookMarketplace];

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const only = flag("only")?.split("=")[1]?.split(",");
const dry = !!flag("dry");
const noEmail = !!flag("no-email");
const noVerify = !!flag("no-verify");

const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...m);

async function main() {
  const sources = only ? ALL.filter((s) => only.includes(s.key)) : ALL;
  const db = dry ? null : getDb();
  if (db) await migrate(db, { migrationsFolder: "drizzle" });
  // Dry runs read the added cities too when a database is configured (read-only).
  const cities = process.env.DATABASE_URL ? await getCities(db ?? undefined) : CITIES;
  const custom = cities.filter((c) => c.custom);
  if (custom.length) log(`cities: ${cities.length} (added from the dashboard: ${custom.map((c) => c.name).join(", ")})`);

  const warnings: string[] = [];
  const drops: PriceChange[] = [];
  const rises: PriceChange[] = [];
  const dryRows: NewListing[] = [];
  let anySucceeded = false;

  for (const source of sources) {
    const skip = source.skip?.();
    if (skip) {
      log(`${source.key}: skipped (${skip})`);
      if (db) await db.insert(scrapeRuns).values({ source: source.key, status: "skipped", message: skip, finishedAt: new Date() });
      continue;
    }

    log(`${source.key}: start`);
    const [run] = db ? await db.insert(scrapeRuns).values({ source: source.key, status: "running" }).returning() : [];
    try {
      const res = await source.run({ cities });
      const kept = res.listings.map((l) => normalize(l, cities)).filter((l): l is Normalized => l !== null);
      log(`${source.key}: ${res.listings.length} scraped, ${kept.length} match criteria`);
      res.warnings.forEach((w) => log(`  ⚠ ${w}`));
      warnings.push(...res.warnings.map((w) => `${source.key}: ${w}`));

      let inserted = 0;
      if (db) {
        const saved = await saveListings(db, kept);
        inserted = saved.inserted.length;
        drops.push(...saved.priceDrops);
        rises.push(...saved.priceRises);
      } else dryRows.push(...kept);

      if (db && run)
        await db
          .update(scrapeRuns)
          .set({
            status: "ok",
            found: kept.length,
            inserted,
            finishedAt: new Date(),
            message: res.warnings.slice(0, 5).join(" · ") || null,
          })
          .where(eq(scrapeRuns.id, run.id));
      log(`${source.key}: ${inserted} new`);
      anySucceeded = true;
    } catch (e) {
      const status = e instanceof ApifyBudgetError ? "paused" : e instanceof BlockedError ? "blocked" : "error";
      const msg = (e as Error).message;
      log(`${source.key}: ${status.toUpperCase()} ${msg}`);
      if (status !== "paused") warnings.push(`${source.key} ${status === "blocked" ? "blocked" : "failed"}`);
      if (db && run)
        await db
          .update(scrapeRuns)
          .set({ status, message: msg.slice(0, 500), finishedAt: new Date() })
          .where(eq(scrapeRuns.id, run.id));
    }
  }
  // Confirm take-downs of listings the scrapes stopped seeing (their own pages, gently).
  if (db && !noVerify) await verifyRemoved(db, sources.map((s) => s.key));
  await closeBrowser();

  if (dry) {
    writeFileSync("dry-run.json", JSON.stringify(dryRows, null, 2));
    log(`dry run: ${dryRows.length} listings written to dry-run.json`);
    return anySucceeded;
  }

  // Everything not yet emailed, excluding cross-site duplicates and ads already taken down.
  const fresh = await db!
    .select()
    .from(listings)
    .where(and(isNull(listings.notifiedAt), isNull(listings.duplicateOf), isNull(listings.removedAt)));
  if (noEmail || (!fresh.length && !drops.length && !rises.length)) {
    log(noEmail ? "email disabled for this run" : "nothing new to email");
  } else {
    try {
      const { subject, html } = renderEmail(fresh, drops, warnings, { cities, rises });
      await sendEmail(subject, html);
      log(`email sent: ${subject}`);
      await db!
        .update(listings)
        .set({ notifiedAt: new Date() })
        .where(inArray(listings.id, fresh.map((l) => l.id)));
      await sendToSubscribers(db!, fresh, drops, log, cities, rises);
    } catch (e) {
      log(`email not sent: ${(e as Error).message}`);
    }
  }
  // Duplicates never get their own email; mark them so they don't pile up.
  await db!
    .update(listings)
    .set({ notifiedAt: new Date() })
    .where(and(isNull(listings.notifiedAt), isNotNull(listings.duplicateOf)));
  return anySucceeded;
}

main()
  .then(async (ok) => {
    await closeDb();
    process.exit(ok ? 0 : 1);
  })
  .catch(async (e) => {
    console.error(e);
    await closeBrowser();
    await closeDb();
    process.exit(1);
  });

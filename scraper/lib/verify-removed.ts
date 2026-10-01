import { and, asc, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { BrowserContext, Page } from "playwright";
import type { getDb } from "../../src/db/client";
import { listings, scrapeRuns } from "../../src/db/schema";
import type { SourceKey } from "../../src/lib/config";
import { jitter, newContext, userAgent } from "./browser";

// Absence from a scrape proves nothing: each run reads only the newest pages of each site.
// So a listing is marked removed only after its own page (or API record) says the ad is gone.
// Candidates are active listings not seen for a few days, oldest first, a handful per source
// per run, checked slowly. A bot challenge ends that source's checks for the run and records
// nothing. Facebook posts are never auto-removed.

type Db = ReturnType<typeof getDb>;

const DAY = 86_400_000;
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

const PER_SOURCE = num(process.env.VERIFY_PER_SOURCE, 15);
/** Only listings no scrape has seen for this long are candidates. */
const STALE_DAYS = num(process.env.VERIFY_STALE_DAYS, 3);
/** Don't re-check a listing more often than this. */
const RECHECK_DAYS = num(process.env.VERIFY_RECHECK_DAYS, 2);
/** Madlan can't be checked directly (PerimeterX), so a long absence is the (weaker) signal. */
const MADLAN_GONE_DAYS = num(process.env.MADLAN_GONE_DAYS, 21);

/**
 * alive / removed: conclusive, `checkedAt` is set.
 * unknown: the page loaded without a challenge but showed no clear signal; `checkedAt` is set so
 *   the listing waits RECHECK_DAYS instead of hogging the front of the queue.
 * blocked: bot challenge; nothing is recorded and the source stops for this run.
 * error: network failure / timeout; nothing is recorded.
 */
type Verdict = "alive" | "removed" | "unknown" | "blocked" | "error";
interface Check {
  verdict: Verdict;
  why: string;
}
interface Candidate {
  id: number;
  externalId: string;
  url: string;
}

interface Verifier {
  /** Checks one listing. Gets a lazily created browser page if `browser` is set. */
  check(c: Candidate, page: Page | null): Promise<Check>;
  browser?: boolean;
  /** Pause between checks, ms. */
  delay: [number, number];
  /** Check a just-seen listing first and stop unless it reads as alive (guards against a site change marking everything removed). */
  canary?: boolean;
}

/* ───────────────────────── OnMap ───────────────────────── */

// GET phoenix.onmap.co.il/v1/properties/<id> returns the full record, including for ads
// taken down long ago: those come back 200 with is_active:false. Unknown ids get
// 404 {"name":"NotFoundError","message":"No project page data for specified id …"}.
async function checkOnmap(c: Candidate): Promise<Check> {
  let res: Response;
  try {
    res = await fetch(`https://phoenix.onmap.co.il/v1/properties/${encodeURIComponent(c.externalId)}`, {
      headers: { "User-Agent": userAgent, Accept: "application/json", Origin: "https://www.onmap.co.il", Referer: "https://www.onmap.co.il/" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return { verdict: "error", why: (e as Error).message };
  }
  if (res.status === 403 || res.status === 429) return { verdict: "blocked", why: `HTTP ${res.status}` };
  const body = (await res.json().catch(() => null)) as {
    name?: string;
    id?: string;
    is_active?: boolean;
    is_deleted?: boolean;
    is_suspended?: boolean;
    search_option?: string;
  } | null;
  if (res.status === 404 && body?.name === "NotFoundError") return { verdict: "removed", why: "404 not found" };
  if (!res.ok || !body) return { verdict: res.status >= 500 ? "error" : "unknown", why: `HTTP ${res.status}` };
  if (body.is_deleted === true) return { verdict: "removed", why: "is_deleted" };
  if (body.is_suspended === true) return { verdict: "removed", why: "is_suspended" };
  if (body.is_active === false) return { verdict: "removed", why: "is_active:false" };
  if (body.search_option && body.search_option !== "buy") return { verdict: "removed", why: `now ${body.search_option}` };
  if (body.is_active === true) return { verdict: "alive", why: "is_active" };
  return { verdict: "unknown", why: "no is_active field" };
}

/* ───────────────────────── Yad2 ───────────────────────── */

const YAD2_CHALLENGE = /perfdrive|shieldsquare|captcha|radware/i;
// Yad2's own "this ad is gone" wording.
const YAD2_GONE_TEXT = /המודעה (?:הוסרה|לא נמצאה|אינה קיימת|אינה זמינה|כבר לא זמינה|לא קיימת)|מודעה זו (?:הוסרה|אינה)/;

// Item pages are Next.js; a live ad redirects to /realestate/item/<area>/<token> and embeds the
// token in __NEXT_DATA__. Removed: HTTP 404/410, the Next 404 page, Yad2's "ad removed" text,
// or a redirect off the item URL. Radware sends us to validate.perfdrive.com: stop.
async function checkYad2(c: Candidate, page: Page | null): Promise<Check> {
  const p = page!;
  const res = await p.goto(c.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
  if (!res) return { verdict: "error", why: "navigation failed" };
  await p
    .waitForFunction(
      () => !!document.getElementById("__NEXT_DATA__")?.textContent?.endsWith("}") || /perfdrive|captcha/i.test(location.href + document.title),
      undefined,
      { timeout: 25_000, polling: 500 },
    )
    .catch(() => {});

  const url = p.url();
  const title = await p.title().catch(() => "");
  const html = await p.content().catch(() => "");
  if (YAD2_CHALLENGE.test(url) || YAD2_CHALLENGE.test(title) || /validate\.perfdrive\.com|Bot Manager/i.test(html)) {
    return { verdict: "blocked", why: "Radware challenge" };
  }
  if (res.status() === 404 || res.status() === 410) return { verdict: "removed", why: `HTTP ${res.status()}` };

  const nextData = await p.evaluate(() => document.getElementById("__NEXT_DATA__")?.textContent ?? "").catch(() => "");
  let nextPage = "";
  try {
    nextPage = JSON.parse(nextData).page ?? "";
  } catch {}
  if (nextPage === "/404" || nextPage === "/_error") return { verdict: "removed", why: `next page ${nextPage}` };

  const text = await p.evaluate(() => document.body?.innerText ?? "").catch(() => "");
  if (YAD2_GONE_TEXT.test(text)) return { verdict: "removed", why: "removed notice" };

  const onItem = new URL(url).pathname.startsWith("/realestate/item/") && url.includes(c.externalId);
  if (url.includes("yad2.co.il") && !onItem) return { verdict: "removed", why: `redirected to ${new URL(url).pathname}` };
  if (onItem && nextData.includes(c.externalId)) return { verdict: "alive", why: "item page" };
  return { verdict: "unknown", why: `HTTP ${res.status()}, no item data` };
}

/* ───────────────────────── Homeless ───────────────────────── */

const HOMELESS_CLOSED = /עסקה זו כבר נסגרה/;

// viewad,<id>.aspx: a live ad renders normally. A closed one still renders but says
// "נראה שעסקה זו כבר נסגרה" ("looks like this deal is already closed"); a purged one 302s
// to the home page. Cloudflare challenges with 403 "רק רגע..." (usually from the second page
// view in a session), which ends the checks for this run.
async function checkHomeless(c: Candidate, page: Page | null): Promise<Check> {
  const p = page!;
  const res = await p.goto(c.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
  if (!res) return { verdict: "error", why: "navigation failed" };
  await p.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
  const title = await p.title().catch(() => "");
  const html = await p.content().catch(() => "");
  if (res.status() === 403 || res.status() === 503 || /Just a moment|רק רגע/i.test(title) || /cf-chl|challenges\.cloudflare\.com/i.test(html)) {
    return { verdict: "blocked", why: "Cloudflare challenge" };
  }
  const url = new URL(p.url());
  if (url.hostname.endsWith("homeless.co.il") && url.pathname === "/") return { verdict: "removed", why: "redirected to home page" };
  if (!url.pathname.includes(`viewad,${c.externalId}`)) return { verdict: "unknown", why: `landed on ${url.pathname}` };
  const text = await p.evaluate(() => document.body?.innerText ?? "").catch(() => "");
  if (HOMELESS_CLOSED.test(text)) return { verdict: "removed", why: "deal closed notice" };
  if (res.status() === 200 && /למכירה/.test(title)) return { verdict: "alive", why: "ad page" };
  return { verdict: "unknown", why: `HTTP ${res.status()}` };
}

/* ───────────────────────── Runner ───────────────────────── */

const VERIFIERS: Partial<Record<SourceKey, Verifier>> = {
  onmap: { check: checkOnmap, delay: [1_500, 4_000], canary: true },
  yad2: { check: checkYad2, browser: true, delay: [6_000, 12_000], canary: true },
  // No canary: Cloudflare usually allows a single page view per session, so it goes to a real candidate.
  homeless: { check: checkHomeless, browser: true, delay: [6_000, 12_000] },
};

interface Summary {
  source: string;
  checked: number;
  removed: number;
  blocked: boolean;
  note?: string;
}

const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...m);

async function verifySource(db: Db, source: SourceKey, v: Verifier): Promise<Summary> {
  const now = Date.now();
  const sum: Summary = { source, checked: 0, removed: 0, blocked: false };
  const candidates = await db
    .select({ id: listings.id, externalId: listings.externalId, url: listings.url })
    .from(listings)
    .where(
      and(
        eq(listings.source, source),
        isNull(listings.removedAt),
        isNull(listings.duplicateOf),
        lt(listings.lastSeenAt, new Date(now - STALE_DAYS * DAY)),
        or(isNull(listings.checkedAt), lt(listings.checkedAt, new Date(now - RECHECK_DAYS * DAY))),
      ),
    )
    .orderBy(asc(listings.lastSeenAt))
    .limit(PER_SOURCE);
  if (!candidates.length) return { ...sum, note: "no candidates" };

  let ctx: BrowserContext | null = null;
  try {
    let page: Page | null = null;
    if (v.browser) {
      ctx = await newContext();
      page = await ctx.newPage();
    }

    if (v.canary) {
      const [fresh] = await db
        .select({ id: listings.id, externalId: listings.externalId, url: listings.url })
        .from(listings)
        .where(and(eq(listings.source, source), isNull(listings.removedAt), gt(listings.lastSeenAt, new Date(now - DAY))))
        .orderBy(desc(listings.lastSeenAt))
        .limit(1);
      // No listing seen in the last day means the scrape itself is failing: don't trust checks either.
      if (!fresh) return { ...sum, note: "no listing seen in 24h to sanity-check against, skipped" };
      const r = await v.check(fresh, page);
      if (r.verdict !== "alive") return { ...sum, blocked: r.verdict === "blocked", note: `canary ${r.verdict}: ${r.why}` };
      await jitter(...v.delay);
    }

    let errors = 0;
    for (const [i, c] of candidates.entries()) {
      if (i > 0) await jitter(...v.delay);
      const r = await v.check(c, page);
      if (r.verdict === "blocked") {
        sum.blocked = true;
        sum.note = `${r.why} after ${sum.checked}`;
        break;
      }
      if (r.verdict === "error") {
        log(`  verify ${source} #${c.id}: error ${r.why}`);
        if (++errors >= 3) {
          sum.note = "stopped after 3 errors";
          break;
        }
        continue;
      }
      const at = new Date();
      await db
        .update(listings)
        .set(r.verdict === "removed" ? { removedAt: at, checkedAt: at } : { checkedAt: at })
        .where(eq(listings.id, c.id));
      sum.checked++;
      if (r.verdict === "removed") sum.removed++;
      if (r.verdict !== "alive") log(`  verify ${source} #${c.id} ${c.externalId}: ${r.verdict} (${r.why})`);
    }
  } finally {
    await ctx?.close().catch(() => {});
  }
  return sum;
}

/** Madlan: no direct check. A listing absent from every scrape for MADLAN_GONE_DAYS counts as removed (weaker signal). */
async function retireMadlan(db: Db): Promise<Summary> {
  const at = new Date();
  // Absence only means something while the Madlan scrape itself keeps working.
  const [recent] = await db
    .select({ id: scrapeRuns.id })
    .from(scrapeRuns)
    .where(and(eq(scrapeRuns.source, "madlan"), eq(scrapeRuns.status, "ok"), gt(scrapeRuns.found, 0), gt(scrapeRuns.startedAt, new Date(at.getTime() - 3 * DAY))))
    .limit(1);
  if (!recent) return { source: "madlan", checked: 0, removed: 0, blocked: false, note: "no successful Madlan scrape in 3 days, skipped" };
  const rows = await db
    .update(listings)
    .set({ removedAt: at, checkedAt: at })
    .where(
      and(
        eq(listings.source, "madlan"),
        isNull(listings.removedAt),
        isNull(listings.duplicateOf),
        lt(listings.lastSeenAt, new Date(at.getTime() - MADLAN_GONE_DAYS * DAY)),
      ),
    )
    .returning({ id: listings.id });
  return { source: "madlan", checked: rows.length, removed: rows.length, blocked: false, note: `not seen ${MADLAN_GONE_DAYS}d+, weak signal` };
}

/**
 * Checks stale listings of the given sources and marks confirmed take-downs with `removedAt`.
 * Records one `scrape_runs` row with source "verify". Never throws.
 */
export async function verifyRemoved(db: Db, sources: SourceKey[]) {
  const [run] = await db.insert(scrapeRuns).values({ source: "verify", status: "running" }).returning();
  const sums: Summary[] = [];
  try {
    for (const source of sources) {
      const v = VERIFIERS[source];
      try {
        const s = source === "madlan" ? await retireMadlan(db) : v ? await verifySource(db, source, v) : null;
        if (!s) continue; // Facebook: posts are never auto-removed.
        sums.push(s);
        log(`verify ${source}: ${s.checked} checked, ${s.removed} removed${s.blocked ? ", BLOCKED" : ""}${s.note ? ` (${s.note})` : ""}`);
      } catch (e) {
        sums.push({ source, checked: 0, removed: 0, blocked: false, note: `error: ${(e as Error).message.slice(0, 120)}` });
        log(`verify ${source}: ERROR ${(e as Error).message}`);
      }
    }
    const checked = sums.reduce((n, s) => n + s.checked, 0);
    const removed = sums.reduce((n, s) => n + s.removed, 0);
    const message = sums
      .map((s) => `${s.source}: ${s.checked} checked, ${s.removed} removed${s.blocked ? ", blocked" : ""}${s.note ? ` (${s.note})` : ""}`)
      .join(" · ");
    await db
      .update(scrapeRuns)
      .set({
        status: sums.some((s) => s.blocked) ? "blocked" : "ok",
        found: checked,
        inserted: removed,
        message: message.slice(0, 500) || null,
        finishedAt: new Date(),
      })
      .where(eq(scrapeRuns.id, run.id));
  } catch (e) {
    log(`verify: ERROR ${(e as Error).message}`);
    await db
      .update(scrapeRuns)
      .set({ status: "error", message: (e as Error).message.slice(0, 500), finishedAt: new Date() })
      .where(eq(scrapeRuns.id, run.id))
      .catch(() => {});
  }
}

import * as cheerio from "cheerio";
import { BlockedError } from "../types";

// Plain-HTTP fetching for sources that don't need a browser. One consistent desktop Chrome
// identity per run, Hebrew-first Accept-Language, and slow, irregular pacing.

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
];
export const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Random pause in [min, max] ms. */
export const jitter = (min: number, max: number) => sleep(min + Math.random() * (max - min));

const CHALLENGE = /captcha-delivery|perfdrive|cf-chl|Just a moment\.\.\.|unusual traffic|רק רגע|press (?:&|and) hold/i;

export async function get(url: string, opts: { referer?: string; accept?: string; timeoutMs?: number } = {}): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: opts.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
      ...(opts.referer ? { Referer: opts.referer } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  if (res.status === 403 || res.status === 429 || res.status === 999) throw new BlockedError(`HTTP ${res.status} ${new URL(url).host}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 120)}`);
  const body = await res.text();
  if (CHALLENGE.test(body.slice(0, 20_000)) && body.length < 60_000) throw new BlockedError(`bot challenge on ${new URL(url).host}`);
  return body;
}

export async function getJson<T>(url: string, opts: { referer?: string } = {}): Promise<T> {
  return JSON.parse(await get(url, { ...opts, accept: "application/json" })) as T;
}

export const load = (html: string) => cheerio.load(html);

/** Collapses whitespace and strips bidi marks. */
export const clean = (s: string | null | undefined) =>
  (s ?? "").replace(/[‎‏‪-‮]/g, "").replace(/\s+/g, " ").trim();

/** HTML fragment → readable plain text (keeps line breaks between blocks). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const $ = cheerio.load(`<div id="x">${html}</div>`);
  $("br").replaceWith("\n");
  $("p,li,div,h1,h2,h3,h4,tr").each((_, el) => {
    $(el).append("\n");
  });
  return $("#x")
    .text()
    .replace(/[‎‏‪-‮]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** "remote" / "hybrid" / "onsite" from free text (English and Hebrew). */
export function workModelOf(text: string | null | undefined): "onsite" | "hybrid" | "remote" | null {
  const t = (text ?? "").toLowerCase();
  if (/hybrid|היברידי/.test(t)) return "hybrid";
  if (/\bremote\b|מהבית|עבודה מרחוק/.test(t)) return "remote";
  if (/on-?site|in office|מהמשרד/.test(t)) return "onsite";
  return null;
}

/** "לפני 3 שעות" / "3 days ago" / "1 ימים" → Date. */
export function relativeDate(text: string | null | undefined, now = new Date()): Date | null {
  const t = clean(text);
  if (!t) return null;
  const n = Number(t.match(/\d+/)?.[0] ?? (/(?:^|\s)(?:יום|שעה|דקה|שבוע|חודש|an?|one)\b/i.test(t) ? 1 : NaN));
  if (!Number.isFinite(n)) return /היום|today|just now/i.test(t) ? now : /אתמול|yesterday/i.test(t) ? new Date(now.getTime() - 864e5) : null;
  const unit = /דק|min/i.test(t) ? 6e4 : /שע|hour/i.test(t) ? 36e5 : /שבוע|week/i.test(t) ? 7 * 864e5 : /חודש|month/i.test(t) ? 30 * 864e5 : /יום|ימים|day/i.test(t) ? 864e5 : null;
  return unit ? new Date(now.getTime() - n * unit) : null;
}

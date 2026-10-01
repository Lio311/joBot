import { chromium, type Browser, type BrowserContext } from "playwright";

// A small pool of current desktop Chrome user agents; one is picked per run so a
// single run looks like one consistent visitor rather than a rotating crowd.
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
];

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

export const userAgent = pick(USER_AGENTS);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Random pause in [min, max] ms — keeps request pacing irregular and slow. */
export const jitter = (min: number, max: number) => sleep(min + Math.random() * (max - min));

let browser: Browser | null = null;

export async function newContext(): Promise<BrowserContext> {
  browser ??= await chromium.launch({ headless: process.env.HEADFUL !== "1" });
  return browser.newContext({
    userAgent,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    viewport: pick(VIEWPORTS),
    extraHTTPHeaders: { "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7" },
  });
}

export async function closeBrowser() {
  await browser?.close();
  browser = null;
}

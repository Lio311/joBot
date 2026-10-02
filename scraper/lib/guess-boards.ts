import type { getDb } from "../../src/db/client";
import { companies, type AtsKind } from "../../src/db/schema";
import { locate } from "../../src/lib/match";
import { jitter } from "./http";

// Free board discovery: for companies seen in this run's postings that we don't track yet, try the
// public JSON endpoints of Greenhouse, Lever and Ashby under a few slug spellings of the name.
// (Comeet needs a company uid in the URL, so it can't be guessed.) Hits with Israeli openings are
// added as boards; misses are remembered (inactive, origin "probe-miss") so they're never retried.

type Db = ReturnType<typeof getDb>;

const MAX_NAMES = Number(process.env.GUESS_BOARDS_PER_RUN ?? 15);

const NOISE = /\b(ltd|inc|llc|bv|gmbh|israel|technologies|technology|tech|labs?|group|software|systems|solutions|io|ai|hq|global|בע"?מ)\b/gi;

/** "Lightricks Ltd." → ["lightricks"]; "Moon Active" → ["moonactive", "moon-active"]. */
export function slugCandidates(name: string): string[] {
  const base = name.toLowerCase().replace(/[^\p{L}\p{N}\s&.-]/gu, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim();
  if (!base || /[֐-׿]/.test(base)) return []; // Hebrew names have no ATS slug to guess
  const words = base.split(/[\s.&-]+/).filter(Boolean);
  const joined = words.join("");
  const out = new Set([joined, words.join("-")]);
  if (words.length > 1 && words[0].length >= 5) out.add(words[0]); // short first words ("moon") match strangers
  return [...out].filter((s) => s.length >= 3 && s.length <= 40);
}

const israeli = (locations: string[]) => locations.some((l) => locate(l).regions.length > 0 || /israel|ישראל/i.test(l));

async function probe(ats: Exclude<AtsKind, "comeet">, slug: string): Promise<boolean> {
  const url = {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    lever: `https://api.lever.co/v0/postings/${slug}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
  }[ats];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 joBot" } });
    if (!res.ok) return false;
    const data = (await res.json()) as unknown;
    if (ats === "greenhouse") return israeli(((data as { jobs?: { location?: { name?: string } }[] }).jobs ?? []).map((j) => j.location?.name ?? ""));
    if (ats === "lever") return Array.isArray(data) && israeli((data as { categories?: { location?: string }; country?: string }[]).map((j) => `${j.categories?.location ?? ""} ${j.country === "IL" ? "Israel" : ""}`));
    return israeli(((data as { jobs?: { location?: string }[] }).jobs ?? []).map((j) => j.location ?? ""));
  } catch {
    return false;
  }
}

/** Returns the boards found. `names` are company names from this run's postings. */
export async function guessBoards(db: Db, names: (string | null | undefined)[], log: (...m: unknown[]) => void) {
  const counts = new Map<string, { name: string; n: number }>();
  for (const raw of names) {
    const name = raw?.trim();
    if (!name || name.length > 60) continue;
    const key = name.toLowerCase();
    counts.set(key, { name, n: (counts.get(key)?.n ?? 0) + 1 });
  }
  // Most-seen companies first: they're the likeliest to be real tech employers.
  const ranked = [...counts.values()].sort((a, b) => b.n - a.n);
  const known = await db.select({ slug: companies.slug, name: companies.name }).from(companies);
  const knownSlugs = new Set(known.map((k) => k.slug.toLowerCase().split("/")[0]));
  const knownNames = new Set(known.map((k) => k.name.toLowerCase()));

  const todo = ranked
    .filter((c) => !knownNames.has(c.name.toLowerCase()))
    .map((c) => ({ ...c, slugs: slugCandidates(c.name).filter((s) => !knownSlugs.has(s)) }))
    .filter((c) => c.slugs.length)
    .slice(0, MAX_NAMES);

  const found: { ats: AtsKind; slug: string; name: string }[] = [];
  for (const c of todo) {
    let hit: { ats: AtsKind; slug: string } | null = null;
    for (const slug of c.slugs) {
      for (const ats of ["greenhouse", "ashby", "lever"] as const) {
        if (await probe(ats, slug)) {
          hit = { ats, slug };
          break;
        }
      }
      if (hit) break;
      await jitter(150, 400);
    }
    if (hit) found.push({ ...hit, name: c.name });
    // Remember the miss (inactive) so the name isn't probed again; a hit becomes an active board.
    await db
      .insert(companies)
      .values(hit ? { ...hit, name: c.name, origin: "guessed" } : { ats: "greenhouse", slug: `miss:${c.slugs[0]}`, name: c.name, origin: "probe-miss", active: false })
      .onConflictDoNothing();
  }
  if (todo.length) log(`boards: probed ${todo.length} companies, found ${found.length}${found.length ? ` (${found.map((f) => `${f.name} → ${f.ats}`).join(", ")})` : ""}`);
  return found;
}

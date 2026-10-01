// Heuristics for pulling structured fields out of free-text Hebrew listing posts
// (Facebook groups / Marketplace descriptions).

import type { FeatureKey } from "../../src/db/schema";
import type { Features } from "../types";

const WORD_ROOMS: Record<string, number> = {
  "ארבעה": 4,
  "ארבע": 4,
  "חמישה": 5,
  "חמש": 5,
  "ארבעה וחצי": 4.5,
  "ארבע וחצי": 4.5,
};

const clean = (s: string) => s.replace(/[‎‏‪-‮]/g, "");

export function parseRooms(text: string): number | null {
  const t = clean(text);
  const m = t.match(/(\d(?:[.,]5)?)\s*(?:חדרים|חדר|חד['׳"]?|rooms?)(?![א-ת])/i);
  if (m) return parseFloat(m[1].replace(",", "."));
  const w = t.match(/(ארבעה וחצי|ארבע וחצי|ארבעה|ארבע|חמישה|חמש)\s+חדרים/);
  if (w) return WORD_ROOMS[w[1]];
  return null;
}

export function parseSqm(text: string): number | null {
  const m = clean(text).match(/(\d{2,3})\s*(?:מ["״']?ר|מטר(?:ים)?|מ״ר|sqm|m²|מר)(?![א-ת])/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 30 && n <= 600 ? n : null;
}

/**
 * Finds the asking price. Accepts "3,450,000", "3.450.000 ₪", "₪3450000",
 * "3.45 מיליון", "3.4M", "3,450 אלף". Values outside a plausible sale range are ignored,
 * which also filters out monthly rents and phone numbers.
 */
export function parsePrice(text: string): number | null {
  const t = clean(text);
  const candidates: number[] = [];

  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:מיליון|מליון|מיל['׳]|M\b)/g)) {
    candidates.push(Math.round(parseFloat(m[1].replace(",", ".")) * 1_000_000));
  }
  for (const m of t.matchAll(/(\d{1,2}[.,]?\d{3})\s*(?:אלף|K\b)/gi)) {
    candidates.push(parseInt(m[1].replace(/[.,]/g, ""), 10) * 1000);
  }
  // "3,450,000" / "3.450.000" read as prices on their own. Not preceded by a digit or
  // dash, so the tail of "054-3450000" never matches.
  for (const m of t.matchAll(/(?<![\d\-–])(\d{1,2}[.,]\d{3}[.,]\d{3})(?![\d])/g)) {
    candidates.push(parseInt(m[1].replace(/[.,]/g, ""), 10));
  }
  // A bare 7-digit number is only a price next to a currency sign or the word "מחיר";
  // otherwise it's almost always a phone number.
  const CUR = String.raw`(?:₪|ש["״]ח|שח|nis|ils|שקל)`;
  const bare = new RegExp(String.raw`(?:${CUR}|מחיר[^\d\n]{0,12})\s*(?<![\d\-–])(\d{7})(?!\d)|(?<![\d\-–])(\d{7})(?!\d)\s*${CUR}`, "gi");
  for (const m of t.matchAll(bare)) candidates.push(parseInt(m[1] ?? m[2], 10));

  const plausible = candidates.filter((n) => n >= 500_000 && n <= 30_000_000);
  return plausible[0] ?? null;
}

const RENT = /להשכרה|שכירות|לשכירות|לחודש|שכ["״]ד|סאבלט|sublet|for rent/i;
const SALE = /למכירה|מוכר(?:ים|ת)?|מכירה|for sale|ללא תיווך|בבלעדיות/i;

export function isSalePost(text: string): boolean {
  const t = clean(text);
  if (RENT.test(t) && !SALE.test(t)) return false;
  return SALE.test(t) || parsePrice(t) != null;
}

/** Stable signature of a post's wording, so the same ad cross-posted to several groups dedupes. */
export function textFingerprint(text: string): string {
  const norm = clean(text).replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 160);
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) | 0;
  return `txt|${(h >>> 0).toString(36)}`;
}

/**
 * Amenity mentions. Each pattern is matched as a whole word, optionally behind one or two
 * Hebrew prefix letters ("וחניה", "הממ״ד", "במעלית").
 */
const FEATURE_TERMS: [FeatureKey, string][] = [
  ["parking", "חני(?:יה|ה|ות|יות|ית|יית)"],
  ["elevator", "מעלי(?:ת|ות)"],
  ["balcony", "מרפס(?:ת|ות)"],
  ["safeRoom", "ממ[\"״'׳]?ד|מרחב\\s+מוגן|חדר\\s+ביטחון"],
  ["airConditioning", "מזג(?:ן|נים)|מיזוג|ממוזג(?:ת)?"],
  ["storage", "מחס(?:ן|נים)"],
  // "נגישות לצירי תנועה" is about transport, so the word alone isn't enough.
  ["accessible", "(?:נגיש(?:ה|ות)?|גישה)\\s+(?:ל)?(?:נכים|כיסא\\s+גלגלים|כסא\\s+גלגלים)|(?:דירה|בניין|בנין|כניסה)\\s+נגיש(?:ה)?"],
  ["renovated", "משופצ(?:ת|ים)|משופץ|שופצה|שופץ|(?:לאחר|אחרי|עברה)\\s+שיפוץ|שיפוץ\\s+(?:מלא|כללי|יסודי|קומפלט)"],
];
const FEATURE_RES = FEATURE_TERMS.map(([key, src]) => [key, new RegExp(`(?<![א-ת])[ובהלשמכ]{0,2}(?:${src})(?![א-ת])`, "g")] as const);

const NEGATION = /(?:^|[^א-ת])ו?(?:ללא|אין|בלי|לא|אינה|אינו)[\s\-–]*$/;
/** "ללא חניה ומעלית": the negation carries over to the next "ו"-joined item. */
const NEGATION_CHAIN = /(?:^|[^א-ת])ו?(?:ללא|אין|בלי)\s+\S+[\s,]*$/;
const NEEDS_RENOVATION = /(?:דרוש|דורש|דורשת|דרושה|טעונ\S*|זקוק\S*|מצריכ\S*|צריכה)\s+(?:ל)?שיפוץ|(?<![א-ת])לשיפוץ(?![א-ת])/;

/**
 * Amenities stated in free text. A plain mention sets `true`, a negated one ("ללא מעלית",
 * "אין חניה") sets `false`; anything not mentioned stays unknown. A positive mention wins
 * over a negative one for the same amenity.
 */
export function parseFeatures(text: string | null | undefined): Features {
  const out: Features = {};
  if (!text) return out;
  const t = clean(text);
  for (const [key, re] of FEATURE_RES) {
    let pos = false;
    let neg = false;
    for (const m of t.matchAll(re)) {
      const before = t.slice(Math.max(0, m.index - 30), m.index);
      // "בניין משופץ" describes the building, not the flat.
      if (key === "renovated" && /בני?ין\s*$/.test(before)) continue;
      if (NEGATION.test(before) || (m[0].startsWith("ו") && NEGATION_CHAIN.test(before))) neg = true;
      else {
        pos = true;
        break;
      }
    }
    if (pos) out[key] = true;
    else if (neg) out[key] = false;
  }
  if (out.renovated === undefined && NEEDS_RENOVATION.test(t)) out.renovated = false;
  return out;
}

export function firstLine(text: string, max = 90): string {
  const line = clean(text).split(/\n/).map((s) => s.trim()).find(Boolean) ?? "";
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

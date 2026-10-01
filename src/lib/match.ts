// Local (free) scoring of a job against the profile. Used for every job; the AI pass in
// scraper/lib/ai-score.ts refines the most promising ones. Pure functions, shared by the
// scraper and the dashboard (rescoring after the profile changes).

import type { MatchInfo } from "@/db/schema";
import { REGIONS, type ProfileAnswers, type RegionKey } from "./profile";

export interface Scorable {
  title: string;
  company?: string | null;
  location?: string | null;
  description?: string | null;
  workModel?: string | null;
  employmentType?: string | null;
}

export interface LocalScore {
  score: number;
  match: MatchInfo;
  /** Excluded by a hard rule (exclude keyword/company, abroad and not remote). */
  excluded: boolean;
  /** How well the title alone matches the roles/keywords, 0..1. */
  titleFit: number;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‎‏‪-‮]/g, "")
    .replace(/[/\\|,.;:()[\]{}"'`’״׳!?+*#]/g, (c) => (c === "+" || c === "#" ? c : " "))
    .replace(/\s+/g, " ")
    .trim();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word (or whole-phrase) match that also works for Hebrew and for tokens like "c++" / "c#" / ".net". */
export function hasTerm(haystack: string, term: string): boolean {
  const t = norm(term);
  if (!t) return false;
  // Hebrew words take one-letter prefixes (ו, ב, ל, ה, מ, ש, כ).
  const re = new RegExp(`(^|[^\\p{L}\\p{N}+#])(?:[ובלהמשכ]{0,2})${escapeRe(t)}(?=$|[^\\p{L}\\p{N}+#])`, "u");
  return re.test(haystack);
}

const SENIOR_TITLE = /\b(senior|sr|staff|principal|lead|head|director|vp|chief|architect|manager)\b|בכיר|ראש צוות|מנהל|ניהול/i;
const JUNIOR_TITLE = /\b(junior|jr|entry|graduate|intern|internship|student)\b|ג'וניור|גוניור|סטודנט|ללא ניסיון|מתחיל/i;
const STUDENT_TITLE = /\b(intern|internship|student)\b|סטודנט/i;

/** "3+ years", "at least 4 years", "3-5 years", "3 שנות ניסיון", "ניסיון של 2 שנים". Returns the minimum asked. */
export function yearsRequired(text: string): number | null {
  const found: number[] = [];
  const en = /(\d{1,2})\s*(?:\+|-\s*\d{1,2}|–\s*\d{1,2}|to\s*\d{1,2})?\s*(?:\+\s*)?years?/gi;
  for (const m of text.matchAll(en)) {
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 40).toLowerCase();
    const before = text.slice(Math.max(0, m.index! - 30), m.index!).toLowerCase();
    if (/experience|exp\b|hands-on|working|industry|background|of\s/.test(after) || /least|minimum|min\.?|over|\bof\b/.test(before)) found.push(+m[1]);
  }
  const he = /(\d{1,2})\s*(?:\+|-\s*\d{1,2})?\s*(?:שנות|שנים|שנ'|שנה)/g;
  for (const m of text.matchAll(he)) {
    const ctx = text.slice(Math.max(0, m.index! - 25), m.index! + m[0].length + 25);
    if (/ניסיון|נסיון/.test(ctx)) found.push(+m[1]);
  }
  const plausible = found.filter((n) => n >= 1 && n <= 15);
  return plausible.length ? Math.min(...plausible) : null;
}

/** Regions mentioned in a location string, plus whether it's clearly outside Israel. */
export function locate(location: string | null | undefined): { regions: RegionKey[]; abroad: boolean; remote: boolean } {
  const l = norm(location ?? "");
  const regions = REGIONS.filter((r) => r.aliases.some((a) => hasTerm(l, a))).map((r) => r.key);
  const remote = /remote|מהבית|from home|wfh|anywhere/.test(l);
  const israel = /israel|ישראל|\bil\b/.test(l) || regions.length > 0;
  const abroad =
    !israel &&
    /\b(usa|united states|us|uk|united kingdom|london|new york|ny|san francisco|ca|tx|germany|berlin|france|paris|india|bangalore|poland|warsaw|spain|madrid|portugal|lisbon|canada|toronto|singapore|australia|japan|tokyo|netherlands|amsterdam|ireland|dublin|emea|apac|latam|europe|americas|brazil|mexico|ukraine|romania|bulgaria|serbia|cyprus|dubai|uae)\b/.test(
      l,
    );
  return { regions, abroad, remote };
}

/** Best match between the profile's roles and the job title, 0..1. */
function roleFit(title: string, roles: string[]): { fit: number; role: string | null } {
  let best = { fit: 0, role: null as string | null };
  for (const role of roles) {
    const r = norm(role);
    if (!r) continue;
    if (hasTerm(title, r)) return { fit: 1, role };
    const words = r.split(" ").filter((w) => w.length > 1 && !/^(of|and|the|ל|של|ו)$/.test(w));
    if (!words.length) continue;
    const hit = words.filter((w) => hasTerm(title, w)).length / words.length;
    if (hit > best.fit) best = { fit: hit, role };
  }
  return best;
}

export function scoreLocally(job: Scorable, p: ProfileAnswers): LocalScore {
  const title = norm(job.title);
  const body = norm(`${job.title} ${job.description ?? ""}`);
  const company = norm(job.company ?? "");
  const matched: string[] = [];
  const missing: string[] = [];
  const notes: string[] = [];

  // Hard exclusions first.
  const badWord = p.excludeKeywords.find((k) => hasTerm(title, k));
  const badCompany = p.excludeCompanies.find((c) => company && (company === norm(c) || hasTerm(company, c)));
  const where = locate(`${job.location ?? ""} ${job.workModel ?? ""}`);
  const remoteOk = p.workModels.includes("remote") && (where.remote || job.workModel === "remote");
  if (badWord || badCompany || (where.abroad && !remoteOk)) {
    const why = badWord ? `מוחרג: "${badWord}" בכותרת` : badCompany ? `חברה מוחרגת: ${badCompany}` : `מיקום מחוץ לישראל (${job.location})`;
    return { score: 0, excluded: true, titleFit: 0, match: { reason: why, matched, missing, by: "keywords" } };
  }

  // 1. Title vs the roles I'm after (0–45), with extra keywords as a weaker signal.
  const { fit, role } = roleFit(title, p.roles);
  let score = Math.round(fit * 45);
  if (fit === 1 && role) notes.push(`תואם לתפקיד "${role}"`);
  const kw = p.keywords.filter((k) => hasTerm(body, k));
  if (fit < 1 && kw.length) score += Math.min(15, kw.length * 6);

  // 2. Skills found in the posting (0–30); nice-to-have skills add a little.
  for (const s of p.skills) (hasTerm(body, s) ? matched : missing).push(s);
  const nice = p.niceSkills.filter((s) => hasTerm(body, s));
  matched.push(...nice);
  const descLen = (job.description ?? "").length;
  // Short listings (title only) can't show skills; don't punish them for it.
  if (descLen > 200) score += Math.min(30, Math.round((matched.length - nice.length) * 6 + nice.length * 2));
  else score += Math.min(15, (matched.length - nice.length) * 5) + (fit > 0 ? 8 : 0);

  // 3. Seniority: what the posting asks vs what I have.
  const yrs = yearsRequired(`${job.title}\n${job.description ?? ""}`);
  const mine = p.yearsExperience;
  if (mine != null && yrs != null) {
    if (yrs > mine + 2) {
      score -= 25;
      notes.push(`דורש ${yrs}+ שנות ניסיון`);
    } else if (yrs > mine) score -= 8;
    else score += 10;
  }
  if (SENIOR_TITLE.test(job.title) && mine != null && mine < 3 && !p.seniority.includes("lead") && !p.seniority.includes("senior")) {
    score -= 15;
    notes.push("משרה בכירה");
  }
  if (JUNIOR_TITLE.test(job.title)) {
    if (STUDENT_TITLE.test(job.title) && !p.seniority.includes("student") && !p.employmentTypes.includes("student")) score -= 20;
    else if (mine != null && mine >= 5) score -= 10;
  }

  // 4. Location and work model.
  if (where.regions.some((r) => p.regions.includes(r))) score += 8;
  else if (where.regions.length && p.regions.length) {
    score -= 12;
    notes.push(`מיקום: ${job.location}`);
  }
  if (job.workModel && p.workModels.includes(job.workModel as never)) score += 4;
  else if (job.workModel && p.workModels.length && !p.workModels.includes(job.workModel as never)) score -= 10;

  score = Math.max(0, Math.min(100, score));
  const reason =
    [notes[0], matched.length ? `כישורים: ${matched.slice(0, 5).join(", ")}` : null, notes[1]].filter(Boolean).join(" · ") ||
    (score > 0 ? "התאמה חלקית לפי מילות מפתח" : "לא נמצאה התאמה לפרופיל");
  const titleFit = Math.max(fit, p.keywords.some((k) => hasTerm(title, k)) ? 0.5 : 0);
  return { score, excluded: false, titleFit, match: { reason, matched, missing: missing.slice(0, 8), by: "keywords", yearsRequired: yrs } };
}

/** Same job on two sites: company + title with punctuation, seniority noise and gender suffixes stripped. */
export function fingerprint(title: string, company: string | null | undefined): string | null {
  if (!company) return null;
  const t = norm(title)
    .replace(/\(?\s*[mfדנ]\s*\/\s*[fmנ]\s*\)?/g, " ")
    .replace(/\/ית|\/ה|\/ת/g, "")
    .replace(/\b(hybrid|remote|tel aviv|israel)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const c = norm(company)
    .replace(/\b(ltd|inc|בע"?מ|limited|technologies|technology|group|io)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t && c ? `${c}|${t}`.slice(0, 200) : null;
}

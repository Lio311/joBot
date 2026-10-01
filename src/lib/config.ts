// Sources and seed data shared by the scraper and the dashboard.

export const SOURCES = {
  linkedin: { name: "LinkedIn", color: "#0a66c2", cadence: "every run" },
  alljobs: { name: "AllJobs", color: "#e4572e", cadence: "every run" },
  drushim: { name: "Drushim", color: "#7b2cbf", cadence: "every run" },
  jobmaster: { name: "JobMaster", color: "#f59e0b", cadence: "every run" },
  gotfriends: { name: "GotFriends", color: "#ef4444", cadence: "every run" },
  ats: { name: "Company boards", color: "#0f766e", cadence: "every run" },
  google: { name: "Google X-ray", color: "#4285f4", cadence: "daily (Apify)" },
  facebook: { name: "Facebook", color: "#1877f2", cadence: "every 3 days (Apify)" },
} as const;

export type SourceKey = keyof typeof SOURCES;

export const sourceName = (key: string) => SOURCES[key as SourceKey]?.name ?? key;

/**
 * Israeli tech companies whose ATS board answered with Israeli openings when the project was set up
 * (Oct 2026). Google X-ray adds more on its own; the owner can add boards from the profile page.
 */
export const SEED_COMPANIES: { ats: "greenhouse" | "lever" | "ashby" | "comeet"; slug: string; name: string }[] = [
  { ats: "greenhouse", slug: "appsflyer", name: "AppsFlyer" },
  { ats: "greenhouse", slug: "axonius", name: "Axonius" },
  { ats: "greenhouse", slug: "catonetworks", name: "Cato Networks" },
  { ats: "greenhouse", slug: "fireblocks", name: "Fireblocks" },
  { ats: "greenhouse", slug: "forter", name: "Forter" },
  { ats: "greenhouse", slug: "gongio", name: "Gong" },
  { ats: "greenhouse", slug: "jfrog", name: "JFrog" },
  { ats: "greenhouse", slug: "melio", name: "Melio" },
  { ats: "greenhouse", slug: "nice", name: "NICE" },
  { ats: "greenhouse", slug: "optimove", name: "Optimove" },
  { ats: "greenhouse", slug: "orcasecurity", name: "Orca Security" },
  { ats: "greenhouse", slug: "payoneer", name: "Payoneer" },
  { ats: "greenhouse", slug: "riskified", name: "Riskified" },
  { ats: "greenhouse", slug: "similarweb", name: "Similarweb" },
  { ats: "greenhouse", slug: "taboola", name: "Taboola" },
  { ats: "greenhouse", slug: "torq", name: "Torq" },
  { ats: "greenhouse", slug: "transmitsecurity", name: "Transmit Security" },
  { ats: "greenhouse", slug: "via", name: "Via" },
  { ats: "greenhouse", slug: "yotpo", name: "Yotpo" },
  { ats: "greenhouse", slug: "innovid", name: "Innovid" },
  { ats: "greenhouse", slug: "island", name: "Island" },
  { ats: "greenhouse", slug: "lightrun", name: "Lightrun" },
  { ats: "ashby", slug: "lemonade", name: "Lemonade" },
  { ats: "ashby", slug: "moonactive", name: "Moon Active" },
  { ats: "ashby", slug: "honeybook", name: "HoneyBook" },
  { ats: "ashby", slug: "finout", name: "Finout" },
  { ats: "lever", slug: "walkme", name: "WalkMe" },
  { ats: "comeet", slug: "oligosecurity/5A.00B", name: "Oligo Security" },
];

/**
 * Google X-ray targets: ATS hosts where Israeli tech companies post openings. Each profile query
 * becomes `site:<host> "<role>" (Israel OR "Tel Aviv")`, limited to the past week.
 */
export const XRAY_SITES = [
  "comeet.com/jobs",
  "job-boards.greenhouse.io",
  "boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
  "apply.workable.com",
  "jobs.smartrecruiters.com",
  "linkedin.com/jobs/view",
] as const;

/**
 * Public Facebook job groups for Israeli tech (found via startuping.co.il's group directory, Oct 2026).
 * General groups are always read; a group with `tags` is read only when a profile role, keyword or
 * skill mentions one of them. Apify bills per post, so the list read per run is capped (FB_MAX_GROUPS).
 */
export const FACEBOOK_GROUPS: { url: string; name: string; tags?: string[] }[] = [
  { url: "https://www.facebook.com/groups/innovationisrael", name: "משרות הייטק ושיווק ללא ניסיון" },
  { url: "https://www.facebook.com/groups/israel.hightech", name: "משרות הייטק בין חברים" },
  { url: "https://www.facebook.com/groups/israel.hitech.jobs", name: "משרות מחברות היי-טק בישראל" },
  { url: "https://www.facebook.com/groups/mikeljobs", name: "משרות הייטק ישירות ללא מתווכים" },
  { url: "https://www.facebook.com/groups/1395694997362633", name: "משרות היי טק מפה לאוזן בשכר גבוה" },
  { url: "https://www.facebook.com/groups/Geek.Only.Israel", name: "לגיקים בלבד: משרות בסטארטאפים" },
  { url: "https://www.facebook.com/groups/140353736108906", name: "משרות חמות בסטארט אפים" },
  { url: "https://www.facebook.com/groups/Good.people.Good.jobs", name: "משרות עילאיות ומתנשאות" },
  { url: "https://www.facebook.com/groups/BarakNahari.jobs", name: "הצעות עבודה – הייטק" },
  { url: "https://www.facebook.com/groups/hjobm", name: "השמה בהייטק" },
  { url: "https://www.facebook.com/groups/290433027763", name: "עובד הייטק שפר משרתך!" },
  { url: "https://www.facebook.com/groups/177799695754671", name: "משרות הייטק בשרון", tags: ["sharon"] },
  { url: "https://www.facebook.com/groups/DevJobsJLM", name: "Jobs for Devs JLM", tags: ["jerusalem"] },
  { url: "https://www.facebook.com/groups/676381365752971", name: "Python Jobs (Israel)", tags: ["python", "data", "backend", "machine learning", "ml"] },
  { url: "https://www.facebook.com/groups/webJobsIsrael", name: "משרות WEB", tags: ["frontend", "front end", "web", "full stack", "fullstack", "react", "javascript"] },
  { url: "https://www.facebook.com/groups/111444215533299", name: "Web Developers in Israel", tags: ["frontend", "front end", "web", "full stack", "fullstack", "react", "javascript"] },
  { url: "https://www.facebook.com/groups/fullstack.developers.israel", name: "Fullstack Developers Israel", tags: ["full stack", "fullstack", "backend", "node.js", "frontend"] },
  { url: "https://www.facebook.com/groups/396641690362272", name: "מפתחים ומתכנתים בארץ", tags: ["developer", "engineer", "מפתח", "software", "backend", "frontend"] },
  { url: "https://www.facebook.com/groups/123583351120353", name: "QA Engineers in Israel", tags: ["qa", "automation", "test"] },
  { url: "https://www.facebook.com/groups/173550059325786", name: "QA Israel", tags: ["qa", "automation", "test"] },
  { url: "https://www.facebook.com/groups/IsraeliProductManagers", name: "Israeli Product Managers", tags: ["product manager", "product owner", "מנהל מוצר"] },
  { url: "https://www.facebook.com/groups/1595221374057822", name: "דרושים חוויית משתמש UX UI", tags: ["ux", "ui", "designer", "מעצב"] },
  { url: "https://www.facebook.com/groups/ops.il.jobs", name: "Operations Israel Jobs", tags: ["operations", "תפעול"] },
  { url: "https://www.facebook.com/groups/salesjobsisrael", name: "Sales Jobs Israel Hi-Tech", tags: ["sales", "account executive", "sdr", "bdr", "מכירות"] },
  { url: "https://www.facebook.com/groups/socialmediajobsisrael", name: "משרות דיגיטל ומדיה חברתית", tags: ["marketing", "digital", "שיווק", "social media"] },
  { url: "https://www.facebook.com/groups/224781113801", name: "Android Developers Israel", tags: ["android", "mobile", "kotlin"] },
  { url: "https://www.facebook.com/groups/iosdevil", name: "iOS Developers in Israel", tags: ["ios", "swift", "mobile"] },
  { url: "https://www.facebook.com/groups/multilingual", name: "Jobs for multilinguals in Israel", tags: ["русский", "russian", "français", "french", "español", "spanish", "العربية"] },
];

/** The groups the bot reads for this profile: general ones plus those whose tags match it. */
export function facebookGroupsFor(p: { roles: string[]; keywords: string[]; skills: string[]; regions: string[]; languages?: string[]; facebookGroups?: string[] }) {
  const words = ` ${[...p.roles, ...p.keywords, ...p.skills, ...p.regions, ...(p.languages ?? [])].join(" ").toLowerCase()} `;
  // Whole words only: "ui" must not match "builder", "ml" must not match "html".
  const has = (t: string) => new RegExp(`[^\\p{L}]${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\p{L}]`, "u").test(words);
  const picked = FACEBOOK_GROUPS.filter((g) => !g.tags || g.tags.some(has));
  // Topic groups first (most relevant), then the general ones.
  picked.sort((a, b) => Number(!a.tags) - Number(!b.tags));
  const extra = (p.facebookGroups ?? []).filter((u) => !picked.some((g) => g.url === u.replace(/\/$/, ""))).map((url) => ({ url, name: url }));
  return [...extra, ...picked].slice(0, Number(process.env.FB_MAX_GROUPS ?? 10));
}

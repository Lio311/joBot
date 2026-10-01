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

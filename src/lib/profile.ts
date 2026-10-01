// The search profile ("איפיון"): the questionnaire answers the matcher and the scrapers read.
// Shared by the dashboard (server and client) and the scraper, so no server-only imports here.

export const SENIORITY = [
  { key: "student", label: "סטודנט/ית" },
  { key: "junior", label: "ג'וניור (0–2)" },
  { key: "mid", label: "מיד (2–5)" },
  { key: "senior", label: "סניור (5+)" },
  { key: "lead", label: "ליד / ניהול" },
] as const;
export type Seniority = (typeof SENIORITY)[number]["key"];

export const WORK_MODELS = [
  { key: "onsite", label: "מהמשרד" },
  { key: "hybrid", label: "היברידי" },
  { key: "remote", label: "מהבית" },
] as const;
export type WorkModel = (typeof WORK_MODELS)[number]["key"];

export const EMPLOYMENT_TYPES = [
  { key: "full", label: "משרה מלאה" },
  { key: "part", label: "משרה חלקית" },
  { key: "student", label: "משרת סטודנט" },
  { key: "freelance", label: "פרילנס / פרויקט" },
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]["key"];

export const COMPANY_TYPES = [
  { key: "startup", label: "סטארטאפ" },
  { key: "scaleup", label: "חברה צומחת" },
  { key: "enterprise", label: "חברה גדולה / תאגיד" },
] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number]["key"];

export const INDUSTRIES = [
  "סייבר",
  "פינטק",
  "AI / ML",
  "SaaS / B2B",
  "דאטה",
  "בריאות דיגיטלית",
  "גיימינג",
  "אדטק / מרקטק",
  "סמיקונדקטור / חומרה",
  "אוטומוטיב",
  "אינסורטק",
  "ממשלה / ביטחון",
  "איקומרס",
] as const;

/** Israeli regions. Aliases are matched against free-text job locations (Hebrew and English). */
export const REGIONS = [
  { key: "tel-aviv", label: "תל אביב", aliases: ["tel aviv", "tel-aviv", "tlv", "תל אביב", "תל-אביב", "ת\"א", "תא", "יפו", "jaffa"] },
  {
    key: "center",
    label: "מרכז",
    aliases: [
      "center", "central", "מרכז", "ramat gan", "רמת גן", "givatayim", "גבעתיים", "petah tikva", "petach tikva", "פתח תקווה", "פתח תקוה",
      "bnei brak", "בני ברק", "holon", "חולון", "bat yam", "בת ים", "rishon", "ראשון לציון", "or yehuda", "אור יהודה", "airport city",
      "איירפורט סיטי", "yehud", "יהוד", "rosh ha'ayin", "rosh haayin", "ראש העין", "rehovot", "רחובות", "ness ziona", "נס ציונה",
      "modiin", "modi'in", "מודיעין", "lod", "לוד", "ramla", "רמלה", "kiryat ono", "קריית אונו", "shoham", "שוהם",
    ],
  },
  {
    key: "sharon",
    label: "השרון",
    aliases: [
      "sharon", "שרון", "herzliya", "herzelia", "הרצליה", "ra'anana", "raanana", "רעננה", "kfar saba", "כפר סבא", "hod hasharon",
      "הוד השרון", "netanya", "נתניה", "even yehuda", "אבן יהודה", "kfar yona", "כפר יונה",
    ],
  },
  { key: "jerusalem", label: "ירושלים", aliases: ["jerusalem", "ירושלים", "beit shemesh", "בית שמש", "mevaseret", "מבשרת"] },
  {
    key: "north",
    label: "חיפה והצפון",
    aliases: [
      "haifa", "חיפה", "yokneam", "yoqneam", "יקנעם", "caesarea", "קיסריה", "nazareth", "נצרת", "migdal haemek", "מגדל העמק",
      "karmiel", "כרמיאל", "north", "צפון", "tefen", "תפן", "hadera", "חדרה", "zichron", "זכרון", "misgav", "משגב",
    ],
  },
  { key: "south", label: "באר שבע והדרום", aliases: ["beer sheva", "be'er sheva", "beersheba", "באר שבע", "south", "דרום", "ashdod", "אשדוד", "ashkelon", "אשקלון"] },
] as const;
export type RegionKey = (typeof REGIONS)[number]["key"];

export interface ProfileAnswers {
  /** Job titles to search for, in the words job sites use ("Data Analyst", "מפתח/ת Backend"). */
  roles: string[];
  /** More search terms: technologies or domains worth a search of their own ("dbt", "Fraud"). */
  keywords: string[];
  /** Core skills: the matcher looks for these in every posting. */
  skills: string[];
  /** Skills that are a plus but not central. */
  niceSkills: string[];
  yearsExperience: number | null;
  seniority: Seniority[];
  regions: RegionKey[];
  workModels: WorkModel[];
  employmentTypes: EmploymentType[];
  companyTypes: CompanyType[];
  industries: string[];
  languages: string[];
  education: string;
  /** Military service / unit, which Israeli tech postings often ask about. */
  military: string;
  /** Hide jobs whose title contains any of these ("Sales", "Night shifts"). */
  excludeKeywords: string[];
  excludeCompanies: string[];
  /** Expected monthly gross in ₪ (optional; used only as context for the AI). */
  salaryExpectation: number | null;
  /** Free text: what makes a job right for me. Given to the AI as-is. */
  about: string;
  /** Email only jobs at or above this score. */
  minScore: number;
  /** Public Facebook job groups to read (via Apify). */
  facebookGroups: string[];
}

export const EMPTY_PROFILE: ProfileAnswers = {
  roles: [],
  keywords: [],
  skills: [],
  niceSkills: [],
  yearsExperience: null,
  seniority: [],
  regions: ["tel-aviv", "center", "sharon"],
  workModels: ["onsite", "hybrid", "remote"],
  employmentTypes: ["full"],
  companyTypes: [],
  industries: [],
  languages: ["עברית", "English"],
  education: "",
  military: "",
  excludeKeywords: [],
  excludeCompanies: [],
  salaryExpectation: null,
  about: "",
  minScore: 55,
  facebookGroups: [],
};

const strList = (v: unknown, max = 40, maxLen = 80): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, maxLen)).filter(Boolean))].slice(0, max)
    : [];

const pickKeys = <K extends string>(v: unknown, allowed: readonly { key: K }[]): K[] =>
  strList(v).filter((x): x is K => allowed.some((a) => a.key === x));

const num = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

/** Validates whatever is stored (or posted from the form) into a complete ProfileAnswers. */
export function normalizeAnswers(raw: unknown): ProfileAnswers {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const has = (k: string) => k in r;
  return {
    roles: strList(r.roles, 12),
    keywords: strList(r.keywords, 12),
    skills: strList(r.skills, 40),
    niceSkills: strList(r.niceSkills, 40),
    yearsExperience: num(r.yearsExperience, 0, 50),
    seniority: pickKeys(r.seniority, SENIORITY),
    regions: has("regions") ? pickKeys(r.regions, REGIONS) : EMPTY_PROFILE.regions,
    workModels: has("workModels") ? pickKeys(r.workModels, WORK_MODELS) : EMPTY_PROFILE.workModels,
    employmentTypes: has("employmentTypes") ? pickKeys(r.employmentTypes, EMPLOYMENT_TYPES) : EMPTY_PROFILE.employmentTypes,
    companyTypes: pickKeys(r.companyTypes, COMPANY_TYPES),
    industries: strList(r.industries, 20),
    languages: has("languages") ? strList(r.languages, 10) : EMPTY_PROFILE.languages,
    education: typeof r.education === "string" ? r.education.trim().slice(0, 300) : "",
    military: typeof r.military === "string" ? r.military.trim().slice(0, 200) : "",
    excludeKeywords: strList(r.excludeKeywords, 40),
    excludeCompanies: strList(r.excludeCompanies, 60),
    salaryExpectation: num(r.salaryExpectation, 0, 200_000),
    about: typeof r.about === "string" ? r.about.trim().slice(0, 2000) : "",
    minScore: num(r.minScore, 0, 100) ?? EMPTY_PROFILE.minScore,
    facebookGroups: strList(r.facebookGroups, 30, 200).filter((u) => /^https:\/\/(www\.|m\.)?facebook\.com\/groups\/[\w.-]+\/?$/.test(u)),
  };
}

/** The search terms every keyword-based source runs: roles first, then extra keywords. */
export function searchQueries(p: ProfileAnswers, max = Number(process.env.MAX_QUERIES ?? 8)): string[] {
  return [...new Set([...p.roles, ...p.keywords].map((q) => q.trim()).filter(Boolean))].slice(0, max);
}

/** How complete the questionnaire is, for the progress ring on the profile page. */
export function completeness(p: ProfileAnswers, hasCv: boolean): number {
  const checks = [
    hasCv,
    p.roles.length > 0,
    p.skills.length >= 3,
    p.yearsExperience != null,
    p.seniority.length > 0,
    p.regions.length > 0,
    p.workModels.length > 0,
    p.industries.length > 0 || p.companyTypes.length > 0,
    p.about.length > 20,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

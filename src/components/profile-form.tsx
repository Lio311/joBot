"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { addCompany, draftFromCv, saveAnswers, setCompanyActive, uploadCv } from "@/lib/actions";
import { facebookGroupsFor } from "@/lib/config";
import type { ProfileData } from "@/lib/data";
import { relativeTime } from "@/lib/format";
import {
  COMPANY_TYPES,
  completeness,
  EMPLOYMENT_TYPES,
  INDUSTRIES,
  normalizeAnswers,
  REGIONS,
  SENIORITY,
  WORK_MODELS,
  type ProfileAnswers,
} from "@/lib/profile";
import { Chip, Segmented } from "./controls";
import { TagInput } from "./tag-input";

const ROLE_SUGGESTIONS = ["Data Analyst", "Data Scientist", "Data Engineer", "BI Developer", "Backend Developer", "Frontend Developer", "Full Stack Developer", "DevOps Engineer", "Product Manager", "Product Analyst", "QA Automation Engineer", "Software Engineer", "ML Engineer", "Security Researcher", "Customer Success Manager", "Solutions Engineer"];
const SKILL_SUGGESTIONS = ["SQL", "Python", "Excel", "Tableau", "Power BI", "Looker", "dbt", "Airflow", "Spark", "Snowflake", "BigQuery", "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Node.js", "TypeScript", "React", "Java", "Go", "C#", "Git", "Machine Learning", "Statistics", "A/B Testing"];
const LANG_SUGGESTIONS = ["עברית", "English", "Русский", "العربية", "Français", "Español"];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-card)] sm:p-6">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
      {hint && <p className="mt-1 text-[13px] text-muted">{hint}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2">
        <span className="text-[14px] font-medium text-fg">{label}</span>
        {hint && <span className="ms-2 text-[12px] text-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function MultiChips<K extends string>({ options, value, onChange }: { options: readonly { key: K; label: string }[]; value: K[]; onChange: (v: K[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <Chip key={o.key} active={value.includes(o.key)} onClick={() => onChange(value.includes(o.key) ? value.filter((v) => v !== o.key) : [...value, o.key])}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

const inputCls = "h-11 w-full text-right rounded-xl border border-border bg-surface px-3 text-[14px] outline-none transition-colors placeholder:text-faint focus:border-accent";

export function ProfileForm({ data }: { data: ProfileData }) {
  const router = useRouter();
  const [a, setA] = useState<ProfileAnswers>(data.answers);
  const [saved, setSaved] = useState(JSON.stringify(data.answers));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [cvBusy, setCvBusy] = useState<"upload" | "draft" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [companyUrl, setCompanyUrl] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyMsg, setCompanyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof ProfileAnswers>(k: K, v: ProfileAnswers[K]) => setA((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(a) !== saved;
  const pct = completeness(a, !!data.cv);
  const fbGroups = facebookGroupsFor(a);

  const save = () =>
    start(async () => {
      const res = await saveAnswers(a);
      if (res.ok) {
        setSaved(JSON.stringify(a));
        setMsg({ ok: true, text: `נשמר · ${res.rescored} משרות דורגו מחדש` });
      } else setMsg({ ok: false, text: res.error });
    });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setCvBusy("upload");
    setMsg(null);
    const fd = new FormData();
    fd.set("cv", file);
    const res = await uploadCv(fd);
    setCvBusy(null);
    if (fileRef.current) fileRef.current.value = "";
    setMsg(res.ok ? { ok: true, text: `קורות החיים נטענו (${res.chars.toLocaleString("he-IL")} תווים)` } : { ok: false, text: res.error });
    if (res.ok) router.refresh(); // show the new CV card and the "fill from CV" button
  };

  const draft = async () => {
    setCvBusy("draft");
    setMsg(null);
    const res = await draftFromCv();
    setCvBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    // Merge: keep what's already filled, add what the CV suggests. Review, then save.
    setA((x) => {
      const d = res.draft;
      const merge = (cur: string[], add?: string[]) => [...new Set([...cur, ...(add ?? [])])];
      return normalizeAnswers({
        ...x,
        roles: merge(x.roles, d.roles),
        keywords: merge(x.keywords, d.keywords),
        skills: merge(x.skills, d.skills),
        niceSkills: merge(x.niceSkills, d.niceSkills),
        yearsExperience: x.yearsExperience ?? d.yearsExperience ?? null,
        seniority: x.seniority.length ? x.seniority : d.seniority,
        industries: merge(x.industries, d.industries),
        languages: merge(x.languages, d.languages),
        education: x.education || d.education || "",
        military: x.military || d.military || "",
      });
    });
    setMsg({ ok: true, text: "מילאתי טיוטה מהקורות חיים. עבור עליה ולחץ שמור." });
  };

  const onAddCompany = async () => {
    setCompanyMsg(null);
    const res = await addCompany(companyUrl, companyName);
    if (res.ok) {
      setCompanyMsg({ ok: true, text: `נוסף: ${res.name} (${res.jobs} משרות בלוח)` });
      setCompanyUrl("");
      setCompanyName("");
      router.refresh();
    } else setCompanyMsg({ ok: false, text: res.error });
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-32 sm:px-6">
      <section className="flex items-end justify-between gap-4 pt-6 pb-6 sm:pt-10 sm:pb-8">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[36px]">האיפיון שלי</h1>
          <p className="mt-2 max-w-xl text-[15px] text-muted">הבוט מחפש לפי התפקידים שכאן ומדרג כל משרה מול קורות החיים והתשובות. אפשר לשנות בכל זמן.</p>
        </div>
        <div className="shrink-0 text-center">
          <div className="text-[28px] font-semibold tabular text-accent">{pct}%</div>
          <div className="text-[12px] text-muted">הושלם</div>
        </div>
      </section>

      <div className="space-y-4">
        <Section title="קורות חיים" hint="PDF עם טקסט (לא סריקה). נשמר רק אצלך, באתר הפרטי.">
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={!!cvBusy} className="h-11 w-full rounded-xl bg-fg px-4 text-[14px] font-semibold text-bg active:scale-[0.97] disabled:opacity-60 sm:h-10 sm:w-auto">
              {cvBusy === "upload" ? "טוען…" : data.cv ? "החלף קורות חיים" : "העלה קורות חיים"}
            </button>
            {data.cv && (
              <button type="button" onClick={draft} disabled={!!cvBusy} className="h-11 w-full rounded-xl border border-border px-4 text-[14px] font-medium text-fg hover:border-accent disabled:opacity-50 sm:h-10 sm:w-auto">
                {cvBusy === "draft" ? "קורא את הקורות חיים…" : "מלא אוטומטית מהקורות חיים"}
              </button>
            )}
          </div>
          {data.cv ? (
            <p className="text-[13px] text-muted">
              <bdi>{data.cv.fileName}</bdi> · {data.cv.chars.toLocaleString("he-IL")} תווים · עודכן {relativeTime(data.cv.updatedAt, data.now)}
            </p>
          ) : (
            <p className="hidden text-[13px] text-muted sm:block">אפשר גם לשים את הקובץ בתיקייה cv/ בפרויקט ולהריץ npm run cv.</p>
          )}
        </Section>

        <Section title="מה אני מחפש" hint="כל תפקיד הוא חיפוש נפרד בכל אתר. כתוב אותם כמו שהם מופיעים במודעות.">
          <Field label="תפקידים" hint={data.cvSuggestions.roles.length ? "ההצעות הראשונות נמצאו בקורות החיים שלך" : "עד 12"}>
            <TagInput value={a.roles} onChange={(v) => set("roles", v)} placeholder="למשל Data Analyst" suggestions={[...new Set([...data.cvSuggestions.roles, ...ROLE_SUGGESTIONS])]} max={12} />
          </Field>
          <Field label="מילות חיפוש נוספות" hint="טכנולוגיה או תחום שכדאי לחפש בנפרד">
            <TagInput value={a.keywords} onChange={(v) => set("keywords", v)} placeholder="למשל Fraud, dbt" max={12} />
          </Field>
          <Field label="במילים שלך: מה הופך משרה למתאימה?" hint="אופציונלי">
            <textarea value={a.about} onChange={(e) => set("about", e.target.value)} rows={4} placeholder="למשל: רוצה תפקיד עם הרבה עבודה עם מוצר, צוות קטן, לא תפקידי מכירה…" className={`${inputCls} h-auto py-2.5 leading-relaxed`} />
          </Field>
        </Section>

        <Section title="ניסיון וכישורים">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="שנות ניסיון רלוונטי">
              <input type="number" min={0} max={50} inputMode="numeric" value={a.yearsExperience ?? ""} onChange={(e) => set("yearsExperience", e.target.value === "" ? null : Math.max(0, Number(e.target.value)))} className={inputCls} />
            </Field>
            <Field label="ציפיות שכר (ברוטו לחודש)" hint="אופציונלי">
              <input type="number" min={0} inputMode="numeric" value={a.salaryExpectation ?? ""} onChange={(e) => set("salaryExpectation", e.target.value === "" ? null : Number(e.target.value))} placeholder="₪" className={inputCls} />
            </Field>
          </div>
          <Field label="רמות בכירות שמתאימות לי">
            <MultiChips options={SENIORITY} value={a.seniority} onChange={(v) => set("seniority", v)} />
          </Field>
          <Field label="כישורים מרכזיים" hint="הבוט מחפש אותם בכל מודעה">
            <TagInput value={a.skills} onChange={(v) => set("skills", v)} placeholder="SQL, Python…" suggestions={[...new Set([...data.cvSuggestions.skills, ...SKILL_SUGGESTIONS])]} />
          </Field>
          <Field label="כישורים משניים" hint="יתרון">
            <TagInput value={a.niceSkills} onChange={(v) => set("niceSkills", v)} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="השכלה">
              <input value={a.education} onChange={(e) => set("education", e.target.value)} placeholder="למשל B.Sc הנדסת תעשייה וניהול" className={inputCls} />
            </Field>
            <Field label="שירות צבאי / יחידה">
              <input value={a.military} onChange={(e) => set("military", e.target.value)} placeholder="אופציונלי" className={inputCls} />
            </Field>
          </div>
          <Field label="שפות">
            <TagInput value={a.languages} onChange={(v) => set("languages", v)} suggestions={LANG_SUGGESTIONS} max={10} />
          </Field>
        </Section>

        <Section title="איפה ואיך">
          <Field label="אזורים">
            <MultiChips options={REGIONS} value={a.regions} onChange={(v) => set("regions", v)} />
          </Field>
          <Field label="מודל עבודה">
            <MultiChips options={WORK_MODELS} value={a.workModels} onChange={(v) => set("workModels", v)} />
          </Field>
          <Field label="סוג משרה">
            <MultiChips options={EMPLOYMENT_TYPES} value={a.employmentTypes} onChange={(v) => set("employmentTypes", v)} />
          </Field>
        </Section>

        <Section title="חברות ותחומים">
          <Field label="סוג חברה">
            <MultiChips options={COMPANY_TYPES} value={a.companyTypes} onChange={(v) => set("companyTypes", v)} />
          </Field>
          <Field label="תחומים שמעניינים אותי">
            <MultiChips options={INDUSTRIES.map((i) => ({ key: i, label: i }))} value={a.industries} onChange={(v) => set("industries", v)} />
          </Field>
          <Field label="חברות שלא מעניינות אותי">
            <TagInput value={a.excludeCompanies} onChange={(v) => set("excludeCompanies", v)} max={60} />
          </Field>
        </Section>

        <Section title="סינון והתראות">
          <Field label="להסתיר משרות שהכותרת שלהן כוללת" hint="למשל Sales, משמרות">
            <TagInput value={a.excludeKeywords} onChange={(v) => set("excludeKeywords", v)} />
          </Field>
          <Field label="לשלוח במייל רק משרות עם ציון של לפחות">
            <div className="sm:max-w-sm">
              <Segmented id="minScore" full value={a.minScore} onChange={(v) => set("minScore", v)} label="ציון מינימלי למייל" options={[45, 55, 65, 75, 85].map((n) => ({ value: n, label: `${n}+` }))} />
            </div>
          </Field>
        </Section>

        <Section title="מקורות נוספים" hint="קבוצות פייסבוק ולוחות משרות של חברות. Google X-ray מוסיף חברות חדשות לבד.">
          <Field label="קבוצות פייסבוק" hint="נבחרות אוטומטית לפי התפקידים שלך · כל 3 ימים">
            <ul className="flex flex-wrap gap-1.5">
              {fbGroups.map((g) => (
                <li key={g.url}>
                  <a href={g.url} target="_blank" rel="noopener noreferrer" dir="auto" className="inline-flex h-7 items-center rounded-lg bg-surface-2 px-2.5 text-[12px] font-medium text-muted hover:text-fg">
                    {g.name}
                  </a>
                </li>
              ))}
            </ul>
          </Field>
          <Field label="הוספת לוח משרות של חברה" hint="קישור ל-Comeet / Greenhouse / Lever / Ashby">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input dir="ltr" value={companyUrl} style={{ textAlign: "right" }} onChange={(e) => setCompanyUrl(e.target.value)} placeholder="https://www.comeet.com/jobs/…" className={inputCls} />
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="שם החברה" className={`${inputCls} sm:w-40`} />
              <button type="button" onClick={onAddCompany} disabled={!companyUrl.trim()} className="h-11 w-full shrink-0 rounded-xl bg-fg px-4 sm:w-auto text-[14px] font-semibold text-bg disabled:opacity-50">
                הוסף
              </button>
            </div>
            {companyMsg && <p className={`mt-2 text-[13px] ${companyMsg.ok ? "text-accent" : "text-danger"}`}>{companyMsg.text}</p>}
          </Field>
          <div className="max-h-[60dvh] overflow-y-auto overscroll-contain rounded-xl border border-border sm:max-h-80">
            {data.companies.map((c) => (
              <label key={c.id} className="flex min-h-11 items-center gap-3 border-b border-border px-3 py-2 text-[13px] last:border-0 sm:min-h-0">
                <input type="checkbox" defaultChecked={c.active} onChange={(e) => void setCompanyActive(c.id, e.target.checked)} className="size-4 accent-[var(--accent)]" />
                <span className="font-medium text-fg">{c.name}</span>
                <span className="text-faint" dir="ltr">{c.ats}</span>
                <span className="ms-auto tabular text-muted">{c.lastJobCount != null && c.lastJobCount >= 0 ? `${c.lastJobCount} בישראל` : c.lastJobCount === -1 ? "שגיאה" : "—"}</span>
              </label>
            ))}
          </div>
        </Section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/85 backdrop-blur-xl" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <p className={`min-w-0 flex-1 truncate text-[13px] ${msg ? (msg.ok ? "text-accent" : "text-danger") : "text-muted"}`}>{msg?.text ?? (dirty ? "יש שינויים שלא נשמרו" : "הכל שמור")}</p>
          <button type="button" onClick={save} disabled={pending || !dirty} className="h-10 rounded-xl bg-accent px-5 text-[14px] font-semibold text-accent-fg transition-[opacity,transform] active:scale-[0.97] disabled:opacity-50">
            {pending ? "שומר…" : "שמור"}
          </button>
        </div>
      </div>
    </div>
  );
}

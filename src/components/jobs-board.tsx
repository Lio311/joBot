"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useMemo, useState, useTransition } from "react";
import type { JobStatus } from "@/db/schema";
import { setJobStatus } from "@/lib/actions";
import { SOURCES, sourceName, type SourceKey } from "@/lib/config";
import type { BoardData, JobView } from "@/lib/data";
import { Chip, Segmented, Select } from "./controls";
import { JobCard } from "./job-card";

type View = "inbox" | "saved" | "applied" | "hidden";
const VIEW_STATUSES: Record<View, JobStatus[]> = {
  inbox: ["new"],
  saved: ["saved"],
  applied: ["applied", "interview", "rejected"],
  hidden: ["hidden"],
};
const WITHIN = { "1": 1, "3": 3, "7": 7, "30": 30, all: 0 } as const;
type Within = keyof typeof WITHIN;
const PAGE = 40;

export function JobsBoard({ data }: { data: BoardData }) {
  const { now, profile } = data;
  const [overrides, setOverrides] = useState<Record<number, JobStatus>>({});
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>("inbox");
  const [minScore, setMinScore] = useState<number>(45);
  const [sources, setSources] = useState<string[]>([]);
  const [within, setWithin] = useState<Within>("7");
  const [sort, setSort] = useState<"score" | "new">("score");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const q = useDeferredValue(query.trim().toLowerCase());

  const jobs = useMemo(() => data.jobs.map((j) => (overrides[j.id] ? { ...j, status: overrides[j.id] } : j)), [data.jobs, overrides]);

  const onStatus = useCallback((id: number, status: JobStatus) => {
    setOverrides((o) => ({ ...o, [id]: status }));
    setError(null);
    startTransition(async () => {
      const res = await setJobStatus(id, status);
      if (!res.ok) {
        setOverrides((o) => {
          const { [id]: _drop, ...rest } = o;
          return rest;
        });
        setError(res.error);
      }
    });
  }, []);

  const counts = useMemo(() => {
    const c: Record<View, number> = { inbox: 0, saved: 0, applied: 0, hidden: 0 };
    for (const j of jobs) for (const v of Object.keys(VIEW_STATUSES) as View[]) if (VIEW_STATUSES[v].includes(j.status)) c[v]++;
    return c;
  }, [jobs]);

  const presentSources = useMemo(() => [...new Set(jobs.map((j) => j.source))], [jobs]);

  const filtered = useMemo(() => {
    const days = WITHIN[within];
    const statuses = VIEW_STATUSES[view];
    const out = jobs.filter((j) => {
      if (!statuses.includes(j.status)) return false;
      // Score and age filters apply to the inbox; saved/applied lists show everything in them.
      if (view === "inbox") {
        if ((j.score ?? 0) < minScore) return false;
        if (days && now - new Date(j.postedAt ?? j.firstSeenAt).getTime() > days * 864e5) return false;
      }
      if (sources.length && !sources.includes(j.source)) return false;
      if (q && !`${j.title} ${j.company ?? ""} ${j.location ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const t = (j: JobView) => new Date(j.postedAt ?? j.firstSeenAt).getTime();
    return out.sort((a, b) => (sort === "score" ? (b.score ?? 0) - (a.score ?? 0) || t(b) - t(a) : t(b) - t(a)));
  }, [jobs, view, minScore, within, sources, q, sort, now]);

  const inbox = jobs.filter((j) => j.status === "new");
  const stats = [
    { label: "משרות פתוחות", value: inbox.length },
    { label: "חדשות ב-24 שעות", value: inbox.filter((j) => now - new Date(j.firstSeenAt).getTime() < 864e5).length },
    { label: "התאמה גבוהה (80+)", value: inbox.filter((j) => (j.score ?? 0) >= 80).length },
    { label: "הגשתי", value: counts.applied },
  ];
  const needsSetup = !profile.roles.length || !profile.hasCv;
  const shown = filtered.slice(0, limit);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
      <section className="pt-10 pb-8">
        <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.03em] sm:text-[38px]">
          משרות שמתאימות לך. <span className="text-muted">ממוינות לפי התאמה.</span>
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] text-muted">
          לינקדאין, אתרי הדרושים, לוחות המשרות של חברות הייטק, גוגל ופייסבוק. כל משרה מקבלת ציון התאמה מול קורות החיים והאיפיון שלך
          {profile.ai ? " (בעזרת AI)" : ""}.
        </p>

        {needsSetup && (
          <Link
            href="/profile"
            className="mt-6 flex items-center gap-4 rounded-2xl border border-accent/30 bg-accent-soft p-4 transition-transform active:scale-[0.99]"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg">
              <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden>
                <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-fg">{!profile.hasCv ? "העלה קורות חיים ומלא את האיפיון" : "השלם את האיפיון"}</span>
              <span className="block text-[13px] text-muted">
                הבוט מחפש לפי התפקידים שתגדיר, ומדרג לפי קורות החיים. האיפיון מולא ב-{profile.completeness}%.
              </span>
            </span>
            <span className="ms-auto text-accent">←</span>
          </Link>
        )}

        <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-surface px-4 py-3.5">
              <div className="text-[24px] font-semibold tabular tracking-[-0.02em]">{s.value}</div>
              <div className="text-[12px] text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="sticky top-14 z-30 -mx-4 border-b border-border bg-bg/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            id="view"
            value={view}
            onChange={(v) => {
              setView(v);
              setLimit(PAGE);
            }}
            label="תצוגה"
            options={[
              { value: "inbox", label: <span>חדשות <span className="tabular text-faint">{counts.inbox}</span></span> },
              { value: "saved", label: <span>שמורות <span className="tabular text-faint">{counts.saved}</span></span> },
              { value: "applied", label: <span>הגשתי <span className="tabular text-faint">{counts.applied}</span></span> },
              { value: "hidden", label: "הוסתרו" },
            ]}
          />
          <label className="relative flex h-9 min-w-[160px] flex-1 items-center">
            <svg viewBox="0 0 20 20" className="pointer-events-none absolute start-3 size-4 text-faint" fill="none" aria-hidden>
              <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="m13.5 13.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש תפקיד, חברה, עיר"
              aria-label="חיפוש"
              className="h-full w-full rounded-[10px] border border-border bg-surface ps-9 pe-3 text-[14px] outline-none transition-colors placeholder:text-faint focus:border-accent"
            />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {view === "inbox" && (
            <>
              <Segmented
                id="score"
                value={minScore}
                onChange={setMinScore}
                label="ציון מינימלי"
                options={[
                  { value: 0, label: "הכל" },
                  { value: 45, label: "45+" },
                  { value: 65, label: "65+" },
                  { value: 80, label: "80+" },
                ]}
              />
              <Select
                label="פורסם"
                value={within}
                onChange={setWithin}
                options={[
                  { value: "1", label: "24 שעות" },
                  { value: "3", label: "3 ימים" },
                  { value: "7", label: "שבוע" },
                  { value: "30", label: "חודש" },
                  { value: "all", label: "הכל" },
                ]}
              />
            </>
          )}
          <Select
            label="מיון"
            value={sort}
            onChange={setSort}
            options={[
              { value: "score", label: "התאמה" },
              { value: "new", label: "הכי חדשות" },
            ]}
          />
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(SOURCES) as SourceKey[])
              .filter((s) => presentSources.includes(s))
              .map((s) => (
                <Chip key={s} active={sources.includes(s)} onClick={() => setSources((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]))} dotColor={SOURCES[s].color}>
                  {sourceName(s)}
                </Chip>
              ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between py-4 text-[13px] text-muted">
        <span>
          <span className="font-semibold tabular text-fg">{filtered.length}</span> משרות
        </span>
        {error && <span className="text-danger">{error}</span>}
      </div>

      {shown.length === 0 ? (
        <div className="blueprint flex flex-col items-center justify-center rounded-2xl border border-border px-6 py-16 text-center">
          <p className="text-[15px] font-medium text-fg">{data.jobs.length ? "אין משרות שמתאימות לסינון" : "עוד אין משרות"}</p>
          <p className="mt-1 max-w-sm text-[13px] text-muted">
            {data.jobs.length ? "נסה להוריד את הציון המינימלי או להרחיב את טווח הזמן." : "אחרי שתמלא את האיפיון, הסורק ירוץ ויתחיל למלא כאן משרות."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {shown.map((j) => (
            <JobCard key={j.id} job={j} now={now} onStatus={onStatus} />
          ))}
        </div>
      )}
      {filtered.length > limit && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE)}
            className="h-10 rounded-xl border border-border bg-surface px-5 text-[14px] font-medium text-fg transition-[transform,border-color] hover:border-border-strong active:scale-[0.97]"
          >
            עוד {Math.min(PAGE, filtered.length - limit)} משרות
          </button>
        </div>
      )}
    </div>
  );
}

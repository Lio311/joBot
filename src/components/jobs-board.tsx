"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import type { JobStatus } from "@/db/schema";
import { setJobStatus } from "@/lib/actions";
import { SOURCES, sourceName, type SourceKey } from "@/lib/config";
import type { BoardData, JobView } from "@/lib/data";
import { PLACES, type PlaceKey } from "@/lib/places";
import { BottomSheet } from "./bottom-sheet";
import { Chip, Segmented, Select } from "./controls";
import { JobCard } from "./job-card";

// MapLibre touches window/WebGL at import time, so the map only loads in the browser.
const JobsMap = dynamic(() => import("./jobs-map"), {
  ssr: false,
  loading: () => <div className="blueprint size-full" />,
});

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

const SCORE_OPTIONS = [
  { value: 0, label: "הכל" },
  { value: 45, label: "45+" },
  { value: 65, label: "65+" },
  { value: 80, label: "80+" },
];
const WITHIN_OPTIONS: { value: Within; label: string }[] = [
  { value: "1", label: "24 שעות" },
  { value: "3", label: "3 ימים" },
  { value: "7", label: "שבוע" },
  { value: "30", label: "חודש" },
  { value: "all", label: "הכל" },
];
const WITHIN_OPTIONS_SHORT: { value: Within; label: string }[] = [
  { value: "1", label: "יום" },
  { value: "3", label: "3 ימים" },
  { value: "7", label: "שבוע" },
  { value: "30", label: "חודש" },
  { value: "all", label: "הכל" },
];
const SORT_OPTIONS: { value: "score" | "new"; label: string }[] = [
  { value: "score", label: "התאמה" },
  { value: "new", label: "הכי חדשות" },
];

function SheetGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">{label}</p>
      {children}
    </div>
  );
}

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
  const [layout, setLayout] = useState<"map" | "list">("map");
  const [place, setPlace] = useState<PlaceKey | null>(null);
  const [hoveredPlace, setHoveredPlace] = useState<PlaceKey | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  // Publish the sticky filter bar's height so the map panel can stick right below it.
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  // Why jobs in this view are missing from the list and the map; each filter counted on its own.
  const hiddenReasons = useMemo(() => {
    const days = WITHIN[within];
    let low = 0;
    let old = 0;
    let other = 0;
    for (const j of jobs) {
      if (!VIEW_STATUSES[view].includes(j.status)) continue;
      const isLow = view === "inbox" && (j.score ?? 0) < minScore;
      const isOld = view === "inbox" && !!days && now - new Date(j.postedAt ?? j.firstSeenAt).getTime() > days * 864e5;
      if (isLow) low++;
      if (isOld) old++;
      if (!isLow && !isOld && ((sources.length && !sources.includes(j.source)) || (q && !`${j.title} ${j.company ?? ""} ${j.location ?? ""}`.toLowerCase().includes(q)))) other++;
    }
    const age = WITHIN_OPTIONS.find((o) => o.value === within)?.label;
    return [
      low ? `${low} עם ציון מתחת ל-${minScore}` : null,
      old ? `${old} פורסמו לפני יותר מ${age === "שבוע" || age === "חודש" ? age : `-${age}`}` : null,
      other ? `${other} לפי מקור או חיפוש` : null,
    ].filter((x): x is string => x != null);
  }, [jobs, view, minScore, within, sources, q, now]);
  const showAll = useCallback(() => {
    setMinScore(0);
    setWithin("all");
    setSources([]);
    setQuery("");
    setLimit(PAGE);
  }, []);

  // The city picked on the map narrows the list; it lapses once no filtered job is there.
  const activePlace = layout === "map" && place && filtered.some((j) => j.place === place) ? place : null;
  const listed = activePlace ? filtered.filter((j) => j.place === activePlace) : filtered;
  const selectPlace = useCallback((p: PlaceKey | null) => {
    setPlace(p);
    setLimit(PAGE);
  }, []);

  const inbox = jobs.filter((j) => j.status === "new");
  const stats = [
    { label: "משרות פתוחות", value: inbox.length },
    { label: "חדשות ב-24 שעות", value: inbox.filter((j) => now - new Date(j.firstSeenAt).getTime() < 864e5).length },
    { label: "התאמה גבוהה (80+)", value: inbox.filter((j) => (j.score ?? 0) >= 80).length },
    { label: "הגשתי", value: counts.applied },
  ];
  // Filters changed from their defaults (badge on the phone "סינון" button).
  const activeFilters =
    (view === "inbox" && minScore !== 45 ? 1 : 0) +
    (view === "inbox" && within !== "7" ? 1 : 0) +
    (sort !== "score" ? 1 : 0) +
    (sources.length ? 1 : 0) +
    (activePlace ? 1 : 0);
  const clearFilters = () => {
    setMinScore(45);
    setWithin("7");
    setSort("score");
    setSources([]);
    selectPlace(null);
  };

  const viewTabs = (id: string, full = false) => (
    <Segmented
      id={id}
      full={full}
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
  );
  const layoutToggle = (id: string, full = false) => (
    <Segmented
      id={id}
      full={full}
      value={layout}
      onChange={setLayout}
      label="פריסה"
      options={[
        { value: "map", label: full ? <span className="inline-flex items-center gap-1.5"><MapIcon />מפה ורשימה</span> : <MapIcon />, ariaLabel: "רשימה ומפה" },
        { value: "list", label: full ? <span className="inline-flex items-center gap-1.5"><ListIcon />רשימה בלבד</span> : <ListIcon />, ariaLabel: "רשימה בלבד" },
      ]}
    />
  );
  const sourceChips = (Object.keys(SOURCES) as SourceKey[])
    .filter((s) => presentSources.includes(s))
    .map((s) => (
      <Chip key={s} active={sources.includes(s)} onClick={() => setSources((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]))} dotColor={SOURCES[s].color}>
        {sourceName(s)}
      </Chip>
    ));

  const needsSetup = !profile.roles.length || !profile.hasCv;
  const shown = listed.slice(0, limit);

  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6"
      style={{ "--map-top": `${56 + barHeight + 16}px` } as CSSProperties}
    >
      <section className="pt-6 pb-6 sm:pt-10 sm:pb-8">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] sm:text-[38px]">
          משרות שמתאימות לך. <span className="text-muted">ממוינות לפי התאמה.</span>
        </h1>
        <p className="mt-2 max-w-2xl text-[14px] text-muted sm:mt-3 sm:text-[15px]">
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

      <div ref={barRef} className="sticky top-14 z-30 -mx-4 border-b border-border bg-bg/85 px-4 py-2.5 backdrop-blur-xl sm:-mx-6 sm:px-6 sm:py-3">
        <div className="flex items-center gap-2">
          <div className="hidden sm:block">{viewTabs("view")}</div>
          <label className="relative flex h-10 min-w-0 flex-1 items-center sm:h-9">
            <svg viewBox="0 0 20 20" className="pointer-events-none absolute start-3 size-4 text-faint" fill="none" aria-hidden>
              <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="m13.5 13.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש תפקיד, חברה, עיר"
              aria-label="חיפוש"
              className="h-full w-full rounded-[10px] border border-border bg-surface ps-9 pe-3 text-[14px] outline-none transition-colors placeholder:text-faint focus:border-accent"
            />
          </label>
          {/* Phones: everything except search and the view tabs lives in a bottom sheet. */}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border border-border bg-surface px-3 text-[14px] font-medium text-fg active:scale-[0.97] sm:hidden"
          >
            <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden>
              <path d="M3.5 6h13M6 10h8M8.5 14h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            סינון
            {activeFilters > 0 && (
              <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg tabular">{activeFilters}</span>
            )}
          </button>
        </div>
        <div className="mt-2 sm:hidden">{viewTabs("view-m", true)}</div>
        <div className="mt-2 hidden flex-wrap items-center gap-2 sm:flex">
          {view === "inbox" && (
            <>
              <Segmented id="score" value={minScore} onChange={setMinScore} label="ציון מינימלי" options={SCORE_OPTIONS} />
              <Select label="פורסם" value={within} onChange={setWithin} options={WITHIN_OPTIONS} />
            </>
          )}
          <Select label="מיון" value={sort} onChange={setSort} options={SORT_OPTIONS} />
          <div className="flex flex-wrap gap-1.5">{sourceChips}</div>
          <div className="ms-auto">{layoutToggle("layout")}</div>
        </div>
      </div>

      <BottomSheet
        open={sheetOpen}
        onClose={closeSheet}
        title="סינון משרות"
        footer={
          <div className="flex gap-2">
            <button type="button" onClick={clearFilters} className="h-12 rounded-xl px-4 text-[15px] font-medium text-muted active:scale-[0.97]">
              נקה
            </button>
            <button type="button" onClick={closeSheet} className="h-12 flex-1 rounded-xl bg-fg text-[15px] font-semibold text-bg active:scale-[0.98]">
              הצג {listed.length} משרות
            </button>
          </div>
        }
      >
        <div className="space-y-6 pt-1">
          {view === "inbox" && (
            <>
              <SheetGroup label="ציון התאמה מינימלי">
                <Segmented id="score-sheet" full value={minScore} onChange={setMinScore} label="ציון מינימלי" options={SCORE_OPTIONS} />
              </SheetGroup>
              <SheetGroup label="פורסם ב">
                <Segmented id="within-sheet" full value={within} onChange={setWithin} label="פורסם" options={WITHIN_OPTIONS_SHORT} />
              </SheetGroup>
            </>
          )}
          <SheetGroup label="מיון">
            <Segmented id="sort-sheet" full value={sort} onChange={setSort} label="מיון" options={SORT_OPTIONS} />
          </SheetGroup>
          <SheetGroup label="מקורות">
            <div className="flex flex-wrap gap-1.5">{sourceChips}</div>
          </SheetGroup>
          <SheetGroup label="תצוגה">{layoutToggle("layout-sheet", true)}</SheetGroup>
        </div>
      </BottomSheet>

      {layout === "map" ? (
        <div className="mt-4 flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-6">
          {/* First in the DOM so it sits above the list on small screens; the left-hand sticky column on lg+. */}
          <div className="h-[45dvh] lg:sticky lg:top-[var(--map-top)] lg:order-last lg:h-[calc(100dvh_-_var(--map-top)_-_16px)]">
            <div className="size-full overflow-hidden rounded-2xl border border-border">
              <JobsMap jobs={filtered} total={counts[view]} hiddenReasons={hiddenReasons} onShowAll={showAll} hoveredPlace={hoveredPlace} selectedPlace={activePlace} onHover={setHoveredPlace} onSelect={selectPlace} />
            </div>
          </div>
          <div className="min-w-0">{renderList()}</div>
        </div>
      ) : (
        renderList()
      )}
    </div>
  );

  function renderList() {
    return (
      <>
      <div className="flex items-center justify-between gap-3 py-4 text-[13px] text-muted">
        <span className="flex items-center gap-2">
          <span>
            <span className="font-semibold tabular text-fg">{listed.length}</span> משרות
          </span>
          {activePlace && (
            <button
              type="button"
              onClick={() => selectPlace(null)}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft ps-2.5 pe-2 text-[12.5px] font-medium text-accent transition-transform active:scale-[0.97]"
              aria-label={`הסר סינון לפי ${PLACES[activePlace].name}`}
            >
              <PinIcon />
              {PLACES[activePlace].name}
              <svg viewBox="0 0 20 20" className="size-3.5" fill="none" aria-hidden>
                <path d="m6 6 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          )}
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
          {shown.map((j) =>
            layout === "map" ? (
              <div key={j.id} onPointerEnter={(e) => e.pointerType !== "touch" && setHoveredPlace(j.place)} onPointerLeave={() => setHoveredPlace(null)}>
                <JobCard job={j} now={now} onStatus={onStatus} />
              </div>
            ) : (
              <JobCard key={j.id} job={j} now={now} onStatus={onStatus} />
            ),
          )}
        </div>
      )}
      {listed.length > limit && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE)}
            className="h-10 rounded-xl border border-border bg-surface px-5 text-[14px] font-medium text-fg transition-[transform,border-color] hover:border-border-strong active:scale-[0.97]"
          >
            עוד {Math.min(PAGE, listed.length - limit)} משרות
          </button>
        </div>
      )}
      </>
    );
  }
}

function MapIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden>
      <path d="M7.5 4 3 5.6v10.4l4.5-1.6 5 1.6 4.5-1.6V4l-4.5 1.6-5-1.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7.5 4v10.4M12.5 5.6V16" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden>
      <path d="M4 5.5h12M4 10h12M4 14.5h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-3.5" fill="none" aria-hidden>
      <path d="M10 17s5-4.6 5-8.6A5 5 0 0 0 5 8.4C5 12.4 10 17 10 17Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="10" cy="8.5" r="1.8" fill="currentColor" />
    </svg>
  );
}

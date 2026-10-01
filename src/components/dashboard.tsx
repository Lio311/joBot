"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "motion/react";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import type { FeatureKey } from "@/db/schema";
import { CRITERIA, SOURCES, type SourceKey } from "@/lib/config";
import type { CityView, ListingView, SourceStatus } from "@/lib/data";
import { ilsShort, isFresh, relativeTime } from "@/lib/format";
import { AddCityButton } from "./add-city";
import { AMENITIES, AmenityIcon, amenityTitle } from "./amenities";
import { buildHistogram, Chip, RangeSlider, Segmented, Select, Toggle, ToggleGroup } from "./controls";
import { StarredFilter, useStarredListings } from "./favorites";
import { ListingCard, ListingRow } from "./listing-card";
import { Logo } from "./logo";
import { SubscribeForm } from "./subscribe-form";

// MapLibre touches window/WebGL at import time, so the map only loads in the browser.
const ListingsMap = dynamic(() => import("./listings-map"), {
  ssr: false,
  loading: () => <div className="blueprint size-full" />,
});

const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];
const LG = "(min-width: 1024px)";
const PAGE = 48;

/* ───────────────────────── Sorting ───────────────────────── */

type Sort =
  | "priority"
  | "newest"
  | "price-asc"
  | "price-desc"
  | "sqm-price"
  | "size-desc"
  | "size-asc"
  | "floor-asc"
  | "floor-desc"
  | "drop"
  | "starred"
  | "changed";

const SORTS: { value: Sort; label: string }[] = [
  { value: "priority", label: "Priority" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price ↑" },
  { value: "price-desc", label: "Price ↓" },
  { value: "sqm-price", label: "₪/m² ↑" },
  { value: "size-desc", label: "Size ↓" },
  { value: "size-asc", label: "Size ↑" },
  { value: "floor-asc", label: "Floor ↑" },
  { value: "floor-desc", label: "Floor ↓" },
  { value: "drop", label: "Biggest price drop" },
  { value: "starred", label: "Starred first" },
  { value: "changed", label: "Recently changed" },
];

const postedTime = (l: ListingView) => new Date(l.postedAt ?? l.firstSeenAt).getTime();
/** Total drop vs the first known price. */
const dropOf = (l: ListingView) => (l.priceChange != null && l.priceChange < 0 ? -l.priceChange : null);
/** Latest change first; changes with no known date (a site's undated "price before") after dated ones. */
const changedOf = (l: ListingView) => (l.priceChangedAt ? new Date(l.priceChangedAt).getTime() : l.priceChange != null ? 0 : null);
const perSqmOf = (l: ListingView) => (l.price && l.sqm ? l.price / l.sqm : null);

function sortListings(list: ListingView[], sort: Sort) {
  const byNewest = (a: ListingView, b: ListingView) => postedTime(b) - postedTime(a);
  const priceOr = (l: ListingView, fallback: number) => l.price ?? fallback;
  const perSqm = (l: ListingView) => (l.price && l.sqm ? l.price / l.sqm : Infinity);
  /** Orders by a numeric field; listings without it go last, ties newest first. */
  const by = (get: (l: ListingView) => number | null, dir: 1 | -1) => (a: ListingView, b: ListingView) => {
    const x = get(a);
    const y = get(b);
    if (x == null || y == null) return x == null ? (y == null ? byNewest(a, b) : 1) : -1;
    return (x - y) * dir || byNewest(a, b);
  };
  const sorted = [...list];
  switch (sort) {
    case "priority":
      return sorted.sort((a, b) => a.priority - b.priority || byNewest(a, b));
    case "newest":
      return sorted.sort(byNewest);
    case "price-asc":
      return sorted.sort((a, b) => priceOr(a, Infinity) - priceOr(b, Infinity));
    case "price-desc":
      return sorted.sort((a, b) => priceOr(b, 0) - priceOr(a, 0));
    case "sqm-price":
      return sorted.sort((a, b) => perSqm(a) - perSqm(b));
    case "size-desc":
      return sorted.sort(by((l) => l.sqm, -1));
    case "size-asc":
      return sorted.sort(by((l) => l.sqm, 1));
    case "floor-asc":
      return sorted.sort(by((l) => l.floor, 1));
    case "floor-desc":
      return sorted.sort(by((l) => l.floor, -1));
    case "drop":
      return sorted.sort(by(dropOf, -1));
    case "starred": // most recently starred first, then the rest by priority
      return sorted.sort((a, b) => (b.starredAt ?? "").localeCompare(a.starredAt ?? "") || a.priority - b.priority || byNewest(a, b));
    case "changed":
      return sorted.sort(by(changedOf, -1));
  }
}

/* ───────────────────────── Filters ───────────────────────── */

type Range = [number, number];
type RangeKey = "price" | "sqm" | "floor" | "ppsqm";
type Bounds = { min: number; max: number; openEnd: boolean };

/** Numeric range filters, in display order. A thumb at either end of the scale means "no limit on that side". */
const RANGES: {
  key: RangeKey;
  label: string;
  /** For the "N listings have no … and are hidden" hint. */
  noun: string;
  step: number;
  get: (l: ListingView) => number | null;
  format: (v: number, open: boolean) => string;
}[] = [
  { key: "price", label: "Price", noun: "price", step: 50_000, get: (l) => l.price, format: (v, open) => `${ilsShort(v)}${open ? "+" : ""}` },
  { key: "sqm", label: "Size", noun: "size", step: 5, get: (l) => l.sqm, format: (v, open) => `${v}${open ? "+" : ""} m²` },
  { key: "floor", label: "Floor", noun: "floor", step: 1, get: (l) => l.floor, format: (v, open) => (v === 0 ? "Ground" : `${v}${open ? "+" : ""}`) },
  { key: "ppsqm", label: "₪/m²", noun: "₪/m² figure", step: 1_000, get: perSqmOf, format: (v, open) => `${ilsShort(v)}${open ? "+" : ""}` },
];

/** Boolean filters: add an entry and it gets a toggle, a filter test and a place in the active count. */
const FLAGS = {
  withPhotos: { label: "With photos", test: (l: ListingView) => !!l.image },
  onlyNew: { label: "New in 24h", test: (l: ListingView, now: number) => isFresh(l.firstSeenAt, 24, now) },
  onlyPrivate: { label: "No agents", test: (l: ListingView) => l.isAgency === false },
} satisfies Record<string, { label: string; test: (l: ListingView, now: number) => boolean }>;
type FlagKey = keyof typeof FLAGS;
const FLAG_KEYS = Object.keys(FLAGS) as FlagKey[];

/** Posted within N days (0 = any time). */
type Posted = 0 | 1 | 3 | 7 | 30;

/** Price changed vs the first known price. */
type PriceMove = "any" | "down" | "up";
const movedOf = (l: ListingView): PriceMove | null => (l.priceChange == null || l.priceChange === 0 ? null : l.priceChange < 0 ? "down" : "up");

type Filters = {
  priority: number; // 0 = all
  cities: string[];
  source: SourceKey | "all";
  rooms: number[];
  types: string[];
  posted: Posted;
  priceMove: PriceMove;
  /** Every selected amenity must be stated by the listing (unknown counts as no). */
  amenities: FeatureKey[];
  /** Only listings the owner starred. */
  starred: boolean;
} & Record<RangeKey, Range | null> & // null = full extent
  Record<FlagKey, boolean>;

const flagsOff = Object.fromEntries(FLAG_KEYS.map((k) => [k, false])) as Record<FlagKey, boolean>;
/** Everything behind "More filters" on desktop. */
const ADVANCED_OFF = { price: null, sqm: null, floor: null, ppsqm: null, types: [], posted: 0, priceMove: "any", amenities: [], ...flagsOff } satisfies Partial<Filters>;
const NO_FILTERS: Filters = { priority: 0, cities: [], source: "all", rooms: [], starred: false, ...ADVANCED_OFF };

const ROOMS = [4, 4.5, 5];

/** Groups the sources' Hebrew property types into a few filterable kinds. */
const TYPE_KINDS: { key: string; label: string; match: RegExp }[] = [
  { key: "apartment", label: "Apartment", match: /^דירה$|^apartment$/i },
  { key: "garden", label: "Garden", match: /גן|garden/i },
  { key: "penthouse", label: "Penthouse / roof", match: /פנטהאוז|גג|penthouse|roof/i },
  { key: "duplex", label: "Duplex", match: /דופלקס|טריפלקס|duplex|triplex/i },
  { key: "house", label: "House", match: /בית|קוטג|משפחתי|cottage|house|villa/i },
];
function typeOf(l: ListingView): string | null {
  const raw = l.propertyType?.trim();
  if (!raw) return null;
  return TYPE_KINDS.find((k) => k.match.test(raw))?.key ?? raw;
}
const typeLabel = (key: string) => TYPE_KINDS.find((k) => k.key === key)?.label ?? key;

function countAdvanced(f: Filters) {
  return (
    RANGES.filter((d) => f[d.key]).length +
    f.types.length +
    (f.posted ? 1 : 0) +
    (f.priceMove !== "any" ? 1 : 0) +
    f.amenities.length +
    FLAG_KEYS.filter((k) => f[k]).length
  );
}
/** Active filters, excluding the search text. */
function countFilters(f: Filters) {
  return (f.priority ? 1 : 0) + f.cities.length + (f.source !== "all" ? 1 : 0) + f.rooms.length + (f.starred ? 1 : 0) + countAdvanced(f);
}

const quantile = (sorted: number[], q: number) => sorted[Math.round(q * (sorted.length - 1))];

/** Slider scale from the data: 1st percentile up to the max (or 99th percentile), snapped to the step, optionally capped. */
function dataBounds(xs: number[], step: number, fallback: Range, cap?: number): Bounds {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length < 2) return { min: fallback[0], max: fallback[1], openEnd: true };
  const min = Math.floor(quantile(s, 0.01) / step) * step;
  const top = cap != null ? s[s.length - 1] : quantile(s, 0.99);
  const max = Math.max(min + step * 2, Math.min(cap ?? Infinity, Math.ceil(top / step) * step));
  return { min, max, openEnd: s[s.length - 1] > max };
}

const inRange = (v: number | null, r: Range, b: Bounds) =>
  v != null && (r[0] <= b.min || v >= r[0]) && (r[1] >= b.max || v <= r[1]);

/** Returns a predicate; `skip` ignores one filter (used to draw each slider's histogram against the other filters). */
function buildMatcher(f: Filters, q: string, now: number, bounds: Record<RangeKey, Bounds>) {
  const tests: [string, (l: ListingView) => boolean][] = [];
  if (f.starred) tests.push(["starred", (l) => l.starredAt != null]);
  if (f.priority) tests.push(["priority", (l) => l.priority === f.priority]);
  if (f.cities.length) tests.push(["cities", (l) => f.cities.includes(l.city)]);
  if (f.source !== "all") tests.push(["source", (l) => l.source === f.source]);
  if (f.rooms.length) tests.push(["rooms", (l) => l.rooms != null && f.rooms.includes(l.rooms)]);
  if (f.types.length) tests.push(["types", (l) => f.types.includes(typeOf(l) ?? "")]);
  for (const d of RANGES) {
    const r = f[d.key];
    if (r) tests.push([d.key, (l) => inRange(d.get(l), r, bounds[d.key])]);
  }
  if (f.posted) tests.push(["posted", (l) => now - postedTime(l) < f.posted * 86_400_000]);
  if (f.priceMove !== "any") tests.push(["priceMove", (l) => movedOf(l) === f.priceMove]);
  if (f.amenities.length) tests.push(["amenities", (l) => f.amenities.every((k) => l.features[k] === true)]);
  for (const k of FLAG_KEYS) if (f[k]) tests.push([k, (l) => FLAGS[k].test(l, now)]);
  if (q) tests.push(["q", (l) => [l.street, l.neighborhood, l.title, l.description].some((x) => x?.toLowerCase().includes(q))]);
  return (l: ListingView, skip?: string) => tests.every(([k, t]) => k === skip || t(l));
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/* ───────────────────────── Dashboard ───────────────────────── */

type View = "grid" | "list" | "map";
/** "removed" = ads confirmed taken down, shown apart as "Not relevant". */
type Scope = "active" | "removed";

export function Dashboard({
  listings: serverListings,
  status,
  cities,
  passcodeRequired,
  now,
}: {
  listings: ListingView[];
  status: SourceStatus[];
  cities: CityView[];
  passcodeRequired: boolean;
  now: number;
}) {
  // Stars being saved show right away (rolled back if the save fails).
  const all = useStarredListings(serverListings);
  // Everything below (results, counts, stats, map) works on the chosen scope only.
  const [scope, setScope] = useState<Scope>("active");
  const removedCount = useMemo(() => all.filter((l) => l.removedAt).length, [all]);
  const listings = useMemo(() => all.filter((l) => !!l.removedAt === (scope === "removed")), [all, scope]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("priority");
  const [view, setView] = useState<View>("map");
  const [limit, setLimit] = useState(PAGE);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Map integration: pin ⇄ card linking.
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Controls update instantly; filtering the list trails behind so sliders stay smooth while dragging.
  const f = useDeferredValue(filters);
  const q = useDeferredValue(query.trim().toLowerCase());

  const update = useCallback((patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setLimit(PAGE);
  }, []);

  const presentSources = useMemo(
    () => (Object.keys(SOURCES) as SourceKey[]).filter((s) => listings.some((l) => l.source === s)),
    [listings],
  );

  const bounds = useMemo<Record<RangeKey, Bounds>>(() => {
    const vals = (get: (l: ListingView) => number | null) => listings.flatMap((l) => (get(l) != null ? [get(l)!] : []));
    return {
      price: { min: CRITERIA.minPrice, max: CRITERIA.maxPrice, openEnd: false },
      sqm: dataBounds(vals((l) => l.sqm), 5, [50, 250], 250),
      floor: { min: 0, max: 20, openEnd: true },
      ppsqm: dataBounds(vals(perSqmOf), 1_000, [10_000, 60_000]),
    };
  }, [listings]);

  const match = useMemo(() => buildMatcher(f, q, now, bounds), [f, q, now, bounds]);
  const filtered = useMemo(() => sortListings(listings.filter((l) => match(l)), sort), [listings, match, sort]);

  // Slider histograms + "no value" counts, each against every *other* active filter. Only while a panel is open.
  const panelOpen = sheetOpen || moreOpen;
  const rangeStats = useMemo(() => {
    if (!panelOpen) return null;
    return Object.fromEntries(
      RANGES.map((d) => {
        const b = bounds[d.key];
        const values: number[] = [];
        let missing = 0;
        for (const l of listings) {
          if (!match(l, d.key)) continue;
          const v = d.get(l);
          if (v == null) missing++;
          else values.push(v);
        }
        const bins = Math.min(32, Math.round((b.max - b.min) / d.step) + 1);
        return [d.key, { histogram: buildHistogram(values, b.min, b.max, bins), missing }];
      }),
    ) as Record<RangeKey, { histogram: number[]; missing: number }>;
  }, [panelOpen, listings, match, bounds]);

  // Per amenity: how many listings would show if it were (also) selected, against every other filter.
  const amenityCounts = useMemo(() => {
    const out = new Map<FeatureKey, number>();
    for (const l of listings) {
      if (!match(l, "amenities") || !f.amenities.every((k) => l.features[k] === true)) continue;
      for (const { key } of AMENITIES) if (l.features[key] === true) out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
  }, [listings, match, f.amenities]);

  const stats = useMemo(() => {
    const fresh = listings.filter((l) => isFresh(l.removedAt ?? l.firstSeenAt, 24, now)).length;
    const changedThisWeek = listings.filter((l) => l.priceChangedAt && now - new Date(l.priceChangedAt).getTime() < 7 * 86_400_000).length;
    const perSqm = median(filtered.filter((l) => l.price && l.sqm).map((l) => l.price! / l.sqm!));
    return { fresh, changedThisWeek, perSqm, medianPrice: median(filtered.flatMap((l) => (l.price ? [l.price] : []))) };
  }, [listings, filtered, now]);

  const counts = useMemo(() => {
    const cities = new Map<string, number>();
    const rooms = new Map<number, number>();
    const types = new Map<string, number>();
    let starred = 0;
    const moves: Record<PriceMove, number> = { any: listings.length, down: 0, up: 0 };
    for (const l of listings) {
      if (l.starredAt) starred++;
      const m = movedOf(l);
      if (m) moves[m]++;
      cities.set(l.city, (cities.get(l.city) ?? 0) + 1);
      if (l.rooms != null) rooms.set(l.rooms, (rooms.get(l.rooms) ?? 0) + 1);
      const t = typeOf(l);
      if (t) types.set(t, (types.get(t) ?? 0) + 1);
    }
    return { cities, rooms, starred, moves, types: [...types].sort((a, b) => b[1] - a[1]) };
  }, [listings]);

  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const filterCount = countFilters(filters);
  const advancedCount = countAdvanced(filters);
  const activeFilters = filterCount + (query.trim() ? 1 : 0);

  const reset = () => {
    setFilters(NO_FILTERS);
    setQuery("");
    setLimit(PAGE);
  };

  const changeScope = (s: Scope) => {
    setScope(s);
    setLimit(PAGE);
    setSelectedId(null);
  };

  const onQuery = (v: string) => {
    setQuery(v);
    setLimit(PAGE);
  };

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);
  const lastRun = status.reduce<string | null>((max, s) => (s.finishedAt && (!max || s.finishedAt > max) ? s.finishedAt : max), null);

  // Publish the sticky filter bar's height so the map panel can stick right below it.
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const bar = barRef.current;
    if (!root || !bar) return;
    const ro = new ResizeObserver(() => root.style.setProperty("--filter-bar-h", `${bar.offsetHeight}px`));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  /** Map pin click (lg+): select it and make sure its card is rendered so it can be scrolled into view. */
  const selectListing = useCallback(
    (id: number | null) => {
      setSelectedId(id);
      if (id == null || !window.matchMedia(LG).matches) return;
      const idx = filtered.findIndex((l) => l.id === id);
      if (idx >= 0) setLimit((n) => (idx < n ? n : Math.ceil((idx + 1) / PAGE) * PAGE));
    },
    [filtered],
  );
  useEffect(() => {
    if (selectedId == null || !window.matchMedia(LG).matches) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`l-${selectedId}`)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [selectedId]);

  const filtersBtnRef = useRef<HTMLButtonElement>(null);
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    filtersBtnRef.current?.focus({ preventScroll: true });
  }, []);

  const viewOptions = [
    { value: "grid" as const, label: <GridIcon />, ariaLabel: "Grid view" },
    { value: "list" as const, label: <ListIcon />, ariaLabel: "List view" },
    { value: "map" as const, label: <MapIcon />, ariaLabel: "Map view" },
  ];
  const priorityOptions = [
    { value: 0, label: "All" },
    { value: 1, label: "Top" },
    { value: 2, label: "High" },
    { value: 3, label: "Medium" },
    { value: 4, label: "Low" },
  ];
  const sourceOptions = [{ value: "all", label: "All" }, ...presentSources.map((s) => ({ value: s, label: SOURCES[s].name }))];

  const cityChips = cities.map((c) => (
    <Chip key={c.key} active={filters.cities.includes(c.key)} dotColor={`var(--p${c.priority})`} onClick={() => update({ cities: toggleIn(filters.cities, c.key) })}>
      {c.name}
      <span className="tabular opacity-60">{counts.cities.get(c.key) ?? 0}</span>
    </Chip>
  ));

  /** Sliders, types, recency and toggles — the desktop "More filters" popover and part of the mobile sheet. */
  const advanced = (idPrefix: string, withRooms: boolean) => (
    <>
      {RANGES.map((d) => {
        const b = bounds[d.key];
        const r = filters[d.key];
        const hidden = r ? (rangeStats?.[d.key].missing ?? 0) : 0;
        return (
          <FilterSection key={d.key}>
            <RangeSlider
              label={d.label}
              min={b.min}
              max={b.max}
              step={d.step}
              openEnd={b.openEnd}
              value={r ?? [b.min, b.max]}
              format={d.format}
              histogram={rangeStats?.[d.key].histogram}
              onChange={(v) => update({ [d.key]: v[0] <= b.min && v[1] >= b.max ? null : v })}
            />
            {hidden > 0 && (
              <p className="mt-2 text-[12px] text-faint">
                {plural(hidden, "listing")} {hidden === 1 ? "has" : "have"} no {d.noun} and {hidden === 1 ? "is" : "are"} hidden
              </p>
            )}
          </FilterSection>
        );
      })}
      {withRooms && (
        <FilterSection title="Rooms">
          <div className="flex flex-wrap gap-2">
            {ROOMS.map((n) => (
              <Chip key={n} active={filters.rooms.includes(n)} onClick={() => update({ rooms: toggleIn(filters.rooms, n) })}>
                {n} rooms
                <span className="tabular opacity-60">{counts.rooms.get(n) ?? 0}</span>
              </Chip>
            ))}
          </div>
        </FilterSection>
      )}
      {counts.types.length > 0 && (
        <FilterSection title="Type">
          <div className="flex flex-wrap gap-2">
            {counts.types.map(([t, n]) => (
              <Chip key={t} active={filters.types.includes(t)} onClick={() => update({ types: toggleIn(filters.types, t) })}>
                <bdi>{typeLabel(t)}</bdi>
                <span className="tabular opacity-60">{n}</span>
              </Chip>
            ))}
          </div>
        </FilterSection>
      )}
      <FilterSection title="Posted">
        <Segmented
          id={`${idPrefix}-posted`}
          full
          label="Posted within"
          value={filters.posted}
          onChange={(v) => update({ posted: v })}
          options={[
            { value: 0, label: "Any time" },
            { value: 1, label: "24h" },
            { value: 3, label: "3 days" },
            { value: 7, label: "7 days" },
            { value: 30, label: "30 days" },
          ]}
        />
      </FilterSection>
      <FilterSection title="Price changed">
        <Segmented
          id={`${idPrefix}-price-move`}
          full
          label="Price changed"
          value={filters.priceMove}
          onChange={(v) => update({ priceMove: v })}
          options={(
            [
              ["any", "Any"],
              ["down", "Dropped"],
              ["up", "Increased"],
            ] as const
          ).map(([value, label]) => ({
            value,
            label: (
              <>
                {label}
                {value !== "any" && <span className="ml-1 tabular opacity-60">{counts.moves[value]}</span>}
              </>
            ),
          }))}
        />
      </FilterSection>
      <FilterSection title="Amenities">
        <div className="flex flex-wrap gap-2">
          {AMENITIES.map((a) => (
            <Chip key={a.key} active={filters.amenities.includes(a.key)} onClick={() => update({ amenities: toggleIn(filters.amenities, a.key) })}>
              <AmenityIcon k={a.key} />
              <span title={amenityTitle(a)}>{a.label}</span>
              <span className="tabular opacity-60">{amenityCounts.get(a.key) ?? 0}</span>
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-faint">Only listings that state it are shown. Many ads don’t list amenities.</p>
      </FilterSection>
      <FilterSection title="More">
        <div className="-mx-2 grid grid-cols-2 gap-x-2 gap-y-1">
          {FLAG_KEYS.map((k) => (
            <Toggle key={k} on={filters[k]} onChange={(v) => update({ [k]: v })}>
              {FLAGS[k].label}
            </Toggle>
          ))}
        </div>
      </FilterSection>
    </>
  );

  return (
    <div
      ref={rootRef}
      className="flex min-h-full flex-col"
      style={{ "--map-top": "calc(56px + var(--filter-bar-h, 0px) + 16px)" } as CSSProperties}
    >
      <header className="sticky top-0 z-30 border-b border-border/80 bg-bg/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-[1320px] items-center justify-between px-4 sm:px-6">
          <Logo />
          <StatusPill status={status} lastRun={lastRun} now={now} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-24 sm:px-6">
        <section className="pt-10 pb-8 sm:pt-14">
          <h1 className="max-w-2xl text-[32px] font-semibold leading-[1.1] tracking-[-0.035em] text-balance sm:text-[40px]">
            Every 4–5 room flat between ₪2M and ₪4.5M, <span className="text-muted">in one place.</span>
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
            Collected from Yad2, Madlan, OnMap, Homeless and Facebook groups every 8 hours, ranked by where you want to live.
          </p>

          <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
            <Stat label={scope === "removed" ? "Not relevant" : "Tracked listings"} value={listings.length.toLocaleString("en-US")} />
            <Stat label={scope === "removed" ? "Taken down in 24h" : "New in 24h"} value={stats.fresh.toLocaleString("en-US")} accent={stats.fresh > 0} />
            <Stat label="Median price" value={ilsShort(stats.medianPrice)} hint="current filter" />
            <Stat label="Median ₪/m²" value={stats.perSqm ? `₪${Math.round(stats.perSqm).toLocaleString("en-US")}` : "—"} hint="current filter" />
          </dl>
          <SubscribeForm />
        </section>

        {/* Filters */}
        <div ref={barRef} className="sticky top-14 z-20 -mx-4 border-b border-border/70 bg-bg/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
          {/* Below lg: one row — search, Filters (opens the sheet), view. */}
          <div className="flex items-center gap-2 lg:hidden">
            <SearchField value={query} onChange={onQuery} placeholder="Search" className="min-w-0 flex-1" />
            <FilterButton ref={filtersBtnRef} label="Filters" count={filterCount} open={sheetOpen} onClick={() => setSheetOpen(true)} />
            <Segmented id="view-mobile" label="View" value={view} onChange={setView} options={viewOptions} />
          </div>

          {/* lg+: two wrapping rows of quick controls; the rest lives in "More filters". */}
          <div className="hidden lg:block">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented id="priority" label="Priority" value={filters.priority} onChange={(v) => update({ priority: v })} options={priorityOptions} />
              <div className="mx-1 h-5 w-px shrink-0 bg-border" />
              {cityChips}
              <AddCityButton cities={cities} passcodeRequired={passcodeRequired} />
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <SearchField value={query} onChange={onQuery} placeholder="Street or neighborhood" className="w-56 shrink-0" />
              <StarredFilter on={filters.starred} count={counts.starred} onChange={(starred) => update({ starred })} />
              <ToggleGroup
                label="Rooms"
                values={filters.rooms}
                onChange={(rooms) => update({ rooms })}
                options={ROOMS.map((n) => ({ value: n, label: n }))}
              />
              <Select label="Source" value={filters.source} onChange={(v) => update({ source: v as SourceKey | "all" })} options={sourceOptions} />
              <MoreFilters
                open={moreOpen}
                onOpenChange={setMoreOpen}
                count={advancedCount}
                onReset={() => update(ADVANCED_OFF)}
              >
                {advanced("pop", false)}
              </MoreFilters>
              <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
                <Select label="Sort" value={sort} onChange={setSort} options={SORTS} align="end" />
                <Segmented id="view" label="View" value={view} onChange={setView} options={viewOptions} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 py-5 text-[13px] text-muted">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            {(removedCount > 0 || scope === "removed") && (
              <Segmented
                id="scope"
                label="Listing status"
                value={scope}
                onChange={changeScope}
                options={[
                  { value: "active", label: "Active" },
                  {
                    value: "removed",
                    label: (
                      <>
                        Not relevant <span className="ml-1 tabular opacity-60">{removedCount}</span>
                      </>
                    ),
                  },
                ]}
              />
            )}
            <span className="tabular">
              <span className="font-medium text-fg">{filtered.length.toLocaleString("en-US")}</span> {scope === "removed" ? "taken down" : `listing${filtered.length === 1 ? "" : "s"}`}
              {stats.changedThisWeek > 0 && scope === "active" && (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => setSort("changed")}
                    title="Sort by recently changed"
                    className="underline-offset-4 transition-[color,scale] duration-150 hover:text-fg hover:underline active:scale-[0.97]"
                  >
                    {plural(stats.changedThisWeek, "price change")} this week
                  </button>
                </>
              )}
            </span>
          </div>
          <AnimatePresence>
            {activeFilters > 0 && (
              <motion.button
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                transition={{ duration: 0.16, ease: EASE }}
                onClick={reset}
                className="shrink-0 whitespace-nowrap font-medium text-muted transition-colors hover:text-fg active:scale-[0.97]"
              >
                Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {view === "map" ? (
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-6">
            {/* First in the DOM so it sits above the list on small screens; right-hand sticky column on lg+. */}
            <div className="h-[52dvh] lg:sticky lg:top-[var(--map-top)] lg:order-last lg:h-[calc(100dvh_-_var(--map-top)_-_16px)]">
              <div className="size-full overflow-hidden rounded-2xl border border-border">
                <ListingsMap
                  listings={filtered}
                  hoveredId={hoveredId}
                  selectedId={selectedId}
                  onHover={setHoveredId}
                  onSelect={selectListing}
                />
              </div>
            </div>
            <div className="min-w-0">
              <Results
                items={visible}
                view="map"
                now={now}
                hasData={listings.length > 0}
                onReset={reset}
                hoveredId={hoveredId}
                selectedId={selectedId}
                onHover={setHoveredId}
              />
              <Pager shown={limit} total={filtered.length} onMore={() => setLimit((n) => n + PAGE)} />
            </div>
          </div>
        ) : (
          <>
            <Results items={visible} view={view} now={now} hasData={listings.length > 0} onReset={reset} />
            <Pager shown={limit} total={filtered.length} onMore={() => setLimit((n) => n + PAGE)} />
          </>
        )}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between px-4 py-6 text-[12px] text-faint sm:px-6">
          <span>diraBot · runs every 8 hours</span>
          <span>Last update {relativeTime(lastRun, now)}</span>
        </div>
      </footer>

      {/* Outside the sticky bar: its backdrop-filter would otherwise become the containing block for `position: fixed`. */}
      <BottomSheet
        open={sheetOpen}
        onClose={closeSheet}
        title="Filters"
        footer={
          <div className="flex items-center gap-3">
            <button
              onClick={() => update(NO_FILTERS)}
              disabled={filterCount === 0}
              className="h-11 shrink-0 rounded-xl px-3 text-[14px] font-medium text-fg underline-offset-4 transition-[color,scale] duration-150 hover:underline active:scale-[0.97] disabled:pointer-events-none disabled:text-faint"
            >
              Clear
            </button>
            <button
              onClick={closeSheet}
              className="h-11 flex-1 rounded-xl bg-fg px-4 text-[14px] font-semibold text-bg tabular transition-[scale,opacity] duration-150 active:scale-[0.98]"
            >
              Show {plural(filtered.length, "listing")}
            </button>
          </div>
        }
      >
        <FilterSection>
          <StarredFilter full on={filters.starred} count={counts.starred} onChange={(starred) => update({ starred })} />
        </FilterSection>
        <FilterSection title="Priority">
          <Segmented id="priority-sheet" full label="Priority" value={filters.priority} onChange={(v) => update({ priority: v })} options={priorityOptions} />
        </FilterSection>
        <FilterSection title="Cities">
          <div className="flex flex-wrap gap-2">
            {cityChips}
            <AddCityButton cities={cities} passcodeRequired={passcodeRequired} />
          </div>
        </FilterSection>
        <FilterSection>
          <div className="grid grid-cols-2 gap-2">
            <Select label="Sort" value={sort} onChange={setSort} options={SORTS} className="w-full" />
            <Select label="Source" value={filters.source} onChange={(v) => update({ source: v as SourceKey | "all" })} options={sourceOptions} className="w-full" />
          </div>
        </FilterSection>
        {advanced("sheet", true)}
      </BottomSheet>
    </div>
  );
}

/* ───────────────────────── Results ───────────────────────── */

/** Memoized so dragging a slider (which re-renders the dashboard on every step) doesn't re-render the list until the deferred filter catches up. */
const Results = memo(function Results({
  items,
  view,
  now,
  hasData,
  onReset,
  hoveredId,
  selectedId,
  onHover,
}: {
  items: ListingView[];
  view: View;
  now: number;
  hasData: boolean;
  onReset: () => void;
  hoveredId?: number | null;
  selectedId?: number | null;
  onHover?: (id: number | null) => void;
}) {
  if (items.length === 0) return <EmptyState hasData={hasData} onReset={onReset} />;
  if (view === "list") {
    return (
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {items.map((l) => (
          <ListingRow key={l.id} l={l} now={now} />
        ))}
      </div>
    );
  }
  return (
    <motion.ul
      layout
      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${view === "grid" ? "lg:grid-cols-3 xl:grid-cols-4" : ""}`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {items.map((l, i) => (
          <motion.li
            key={l.id}
            id={`l-${l.id}`}
            layout="position"
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.28, ease: EASE, delay: Math.min(i % PAGE, 12) * 0.018 }}
            className="scroll-mt-[var(--map-top)] scroll-mb-4"
          >
            <ListingCard l={l} now={now} onHover={onHover} highlighted={l.id === hoveredId || l.id === selectedId} />
          </motion.li>
        ))}
      </AnimatePresence>
    </motion.ul>
  );
});

function Pager({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (total <= shown) return null;
  return (
    <div className="mt-10 flex justify-center">
      <button
        onClick={onMore}
        className="h-10 rounded-full border border-border bg-surface px-5 text-[13px] font-medium text-fg shadow-[var(--shadow-card)] transition-[scale,border-color] duration-150 hover:border-border-strong active:scale-[0.97]"
      >
        Show {Math.min(PAGE, total - shown)} more
        <span className="ml-1.5 text-muted tabular">of {total - shown}</span>
      </button>
    </div>
  );
}

/* ───────────────────────── Filter chrome ───────────────────────── */

function FilterSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="border-b border-border py-5 last:border-b-0">
      {title && <h3 className="mb-3 text-[13px] font-semibold text-fg">{title}</h3>}
      {children}
    </section>
  );
}

function SearchField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className: string;
}) {
  return (
    <label
      className={`relative flex h-9 items-center rounded-[10px] border border-border bg-surface transition-colors focus-within:border-accent hover:border-border-strong ${className}`}
    >
      <svg className="pointer-events-none absolute left-3 size-3.5 text-faint" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search by street or neighborhood"
        enterKeyHint="search"
        dir="auto"
        // 16px on phones so iOS doesn't zoom the page on focus.
        className="size-full min-w-0 bg-transparent pl-8 pr-3 text-[16px] outline-none placeholder:text-faint sm:text-[13px]"
      />
    </label>
  );
}

function FilterButton({
  ref,
  label,
  count,
  open,
  onClick,
}: {
  ref?: RefObject<HTMLButtonElement | null>;
  label: string;
  count: number;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={count ? `${label}, ${count} active` : label}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border bg-surface px-3 text-[13px] font-medium transition-[border-color,color,scale] duration-150 ease-out active:scale-[0.97] ${
        count || open ? "border-border-strong text-fg" : "border-border text-muted hover:border-border-strong hover:text-fg"
      }`}
    >
      <FiltersIcon />
      {label}
      <AnimatePresence initial={false}>
        {count > 0 && (
          <motion.span
            key="badge"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.16, ease: EASE }}
            className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold leading-none text-accent-fg tabular"
          >
            {count}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

/** Desktop "More filters": an anchored popover. Closes on outside press and Escape. */
function MoreFilters({
  open,
  onOpenChange,
  count,
  onReset,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onReset: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenChange(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className="relative shrink-0">
      <FilterButton label="More filters" count={count} open={open} onClick={() => onOpenChange(!open)} />
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="More filters"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.18, ease: EASE }}
            style={{ transformOrigin: "top left" }}
            className="absolute left-0 top-[calc(100%+8px)] z-40 flex max-h-[calc(100dvh_-_var(--map-top)_-_8px)] w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-lift)]"
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">{children}</div>
            <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
              <button
                onClick={onReset}
                disabled={count === 0}
                className="h-9 rounded-lg px-1 text-[13px] font-medium text-fg underline-offset-4 transition-[color,scale] duration-150 hover:underline active:scale-[0.97] disabled:pointer-events-none disabled:text-faint"
              >
                Reset
              </button>
              <button
                onClick={() => onOpenChange(false)}
                className="h-9 rounded-full bg-fg px-4 text-[13px] font-medium text-bg transition-[scale] duration-150 active:scale-[0.97]"
              >
                Done
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Mobile bottom sheet: slides up over a dimmed backdrop, drag the handle/header down to dismiss
 * (> 90px or a fast flick), Escape or a backdrop tap closes. Locks page scroll while open.
 */
function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const controls = useDragControls();
  const reduce = useReducedMotion();
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    sheetRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // The sheet is a small-screen affordance; close it if the viewport grows past lg.
    const mq = window.matchMedia(LG);
    const onMq = () => mq.matches && onClose();
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          aria-hidden
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="fixed inset-0 z-50 bg-black/40 lg:hidden"
        />
      )}
      {open && (
        <motion.div
          key="sheet"
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          initial={reduce ? { opacity: 0 } : { y: "100%" }}
          animate={reduce ? { opacity: 1 } : { y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: "100%" }}
          transition={{ type: "tween", duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
          drag={reduce ? false : "y"}
          dragListener={false}
          dragControls={controls}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.04, bottom: 1 }}
          dragTransition={{ bounceStiffness: 500, bounceDamping: 40 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 90 || info.velocity.y > 500) onClose();
          }}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-[20px] border-t border-border bg-surface shadow-[0_-16px_48px_-16px_rgb(0_0_0/0.3)] outline-none lg:hidden"
        >
          <div
            onPointerDown={(e) => {
              if (!(e.target as HTMLElement).closest("button")) controls.start(e);
            }}
            className="shrink-0 cursor-grab touch-none px-4 pb-1 pt-2 active:cursor-grabbing"
          >
            <div className="mx-auto h-1 w-9 rounded-full bg-border-strong" />
            <div className="mt-2 flex h-9 items-center justify-between">
              <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="-mr-1.5 grid size-9 place-items-center rounded-full text-muted transition-[background-color,color,scale] duration-150 hover:bg-surface-2 hover:text-fg active:scale-[0.94]"
              >
                <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
                  <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border px-4">{children}</div>
          <div className="shrink-0 border-t border-border px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">{footer}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────── Misc ───────────────────────── */

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-[12px] font-medium text-muted">
        {label}
        {hint && <span className="ml-1 font-normal text-faint">· {hint}</span>}
      </dt>
      <dd className={`mt-1 text-[24px] font-semibold tracking-[-0.03em] tabular ${accent ? "text-accent" : ""}`}>{value}</dd>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  ok: "var(--p1)",
  skipped: "var(--faint)",
  paused: "var(--faint)",
  blocked: "#d97706",
  error: "#dc2626",
};

function StatusPill({ status, lastRun, now }: { status: SourceStatus[]; lastRun: string | null; now: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Intentionally skipped sources (e.g. Facebook Marketplace) aren't failures, so they don't count against health.
  // Paused = the Apify credit ran out; it resumes by itself next cycle.
  const tracked = status.filter((s) => s.status !== "skipped" && s.status !== "paused");
  const healthy = tracked.filter((s) => s.status === "ok").length;
  const problems = status.some((s) => s.status === "blocked" || s.status === "error");

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-surface px-3 text-[12px] font-medium text-muted transition-[border-color,color,scale] duration-150 hover:border-border-strong hover:text-fg active:scale-[0.97]"
      >
        <span className="relative flex size-2">
          <span
            className="absolute inset-0 animate-ping rounded-full opacity-40"
            style={{ background: problems ? STATUS_COLOR.blocked : STATUS_COLOR.ok }}
          />
          <span className="relative size-2 rounded-full" style={{ background: problems ? STATUS_COLOR.blocked : STATUS_COLOR.ok }} />
        </span>
        <span className="hidden sm:inline">Updated</span> {relativeTime(lastRun, now)}
        <span className="text-faint tabular">
          · {healthy}/{tracked.length}
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.16, ease: EASE }}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-10 w-[320px] rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-lift)]"
          >
            <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Sources · last run</div>
            {status.length === 0 && <div className="px-2.5 py-2 text-[13px] text-muted">No runs yet.</div>}
            {status.map((s) => (
              <div key={s.source} className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-surface-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[s.status] ?? "var(--faint)" }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="font-medium">{s.source === "verify" ? "Removal check" : (SOURCES[s.source as SourceKey]?.name ?? s.source)}</span>
                    <span className="text-[12px] text-faint">{relativeTime(s.finishedAt, now)}</span>
                  </div>
                  <div className="truncate text-[12px] text-muted" title={s.message ?? undefined}>
                    {s.status === "ok"
                      ? s.source === "verify"
                        ? `${s.found} checked · ${s.inserted} taken down`
                        : `${s.found} matching · ${s.inserted} new`
                      : s.status === "skipped" || s.status === "paused"
                        ? s.message
                        : `${s.status}: ${s.message ?? ""}`}
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EmptyState({ hasData, onReset }: { hasData: boolean; onReset: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong px-6 py-20 text-center">
      <div className="blueprint mb-5 grid size-14 place-items-center rounded-2xl text-faint">
        <svg viewBox="0 0 24 24" className="size-6" fill="none">
          <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="text-[15px] font-semibold">{hasData ? "Nothing matches these filters" : "No listings yet"}</h2>
      <p className="mt-1 max-w-sm text-[13px] text-muted">
        {hasData ? "Try widening the price range or clearing a city." : "The first scrape runs on the next 8-hour slot. Listings will appear here."}
      </p>
      {hasData && (
        <button onClick={onReset} className="mt-5 h-9 rounded-full bg-fg px-4 text-[13px] font-medium text-bg transition-[scale] active:scale-[0.97]">
          Clear filters
        </button>
      )}
    </div>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden>
      <rect x="2" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden>
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden>
      <path d="M8 14.2s4.6-4 4.6-7.6a4.6 4.6 0 0 0-9.2 0C3.4 10.2 8 14.2 8 14.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="8" cy="6.6" r="1.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function FiltersIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden>
      <path d="M2.5 5h6.2M11.8 5h1.7M2.5 11h1.7M7.3 11h6.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10.2" cy="5" r="1.6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5.8" cy="11" r="1.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

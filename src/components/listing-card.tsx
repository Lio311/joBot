"use client";

import { memo, useState } from "react";
import { cityName, PRIORITY_LABEL, SOURCES, type Priority, type SourceKey } from "@/lib/config";
import type { ListingView } from "@/lib/data";
import { ils, ilsShort, isFresh, relativeTime } from "@/lib/format";
import { AmenityList } from "./amenities";
import { StarButton } from "./favorites";
import { LogoMark } from "./logo";
import { PriceChangeBadge } from "./price-history";

export const priorityVars = (p: number) => ({
  color: `var(--p${p})`,
  background: `var(--p${p}-soft)`,
});

export function PriorityBadge({ p, withCity, size = "md" }: { p: number; withCity?: string; size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center justify-self-start whitespace-nowrap rounded-full font-semibold tracking-[0.01em] ${
        size === "sm" ? "h-5 gap-[5px] px-1.5 text-[10.5px]" : "h-[22px] gap-1 px-2 text-[11px]"
      }`}
      style={priorityVars(p)}
    >
      <span className={`${size === "sm" ? "size-[5px]" : "size-1.5"} rounded-full bg-current`} />
      {PRIORITY_LABEL[p as Priority]}
      {withCity && <span className="font-medium opacity-80">· {withCity}</span>}
    </span>
  );
}

const sourceName = (s: string) => SOURCES[s as SourceKey]?.name ?? s;

function facts(l: ListingView) {
  return [
    l.rooms != null ? `${l.rooms} rooms` : null,
    l.sqm ? `${l.sqm} m²` : null,
    l.floor != null ? (l.floor === 0 ? "ground floor" : `floor ${l.floor}`) : null,
  ].filter(Boolean) as string[];
}

function placeLine(l: ListingView) {
  return [l.street, l.neighborhood].filter(Boolean).join(", ") || l.title || "";
}

/** Madlan can't be checked directly, so its removals rest on a long absence: a weaker signal. */
function removedLabel(l: ListingView, now: number) {
  return `${l.source === "madlan" ? "Likely removed" : "Removed"} · ${relativeTime(l.removedAt, now)}`;
}
const removedHint = (l: ListingView) =>
  l.source === "madlan" ? "Not seen on Madlan for 3+ weeks" : `The ad's page on ${sourceName(l.source)} says it was taken down`;

/** Memoized: the grid re-renders on every hover/filter tick, cards only when their own props change. */
export const ListingCard = memo(function ListingCard({
  l,
  now,
  onHover,
  highlighted = false,
}: {
  l: ListingView;
  now: number;
  /** Reports pointer enter/leave (id / null), e.g. to light up the matching map pin. */
  onHover?: (id: number | null) => void;
  /** Accent ring, e.g. when the listing's map pin is hovered or selected. */
  highlighted?: boolean;
}) {
  const [imgOk, setImgOk] = useState(!!l.image);
  const perSqm = l.price && l.sqm ? Math.round(l.price / l.sqm) : null;
  const place = placeLine(l);
  const fresh = isFresh(l.firstSeenAt, 24, now);
  const removed = !!l.removedAt;

  // The wrapper owns hover and lift so the buttons over the photo (siblings: a button can't live inside the link) move with the card.
  return (
    <div
      onMouseEnter={onHover && (() => onHover(l.id))}
      onMouseLeave={onHover && (() => onHover(null))}
      className={`group relative h-full transition-[translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-0.5 ${highlighted ? "-translate-y-0.5" : ""}`}
    >
      <a
        href={l.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex h-full flex-col overflow-hidden rounded-2xl border bg-surface outline-none transition-[scale,box-shadow,border-color,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:shadow-[var(--shadow-lift)] focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.99] ${
          highlighted
            ? "border-accent shadow-[var(--shadow-lift)] ring-1 ring-accent"
            : "border-border shadow-[var(--shadow-card)] group-hover:border-border-strong"
        } ${removed ? "opacity-70 group-hover:opacity-100 focus-visible:opacity-100" : ""}`}
      >
        <div className="relative aspect-[16/10] overflow-hidden">
          {imgOk ? (
            // Remote images come from many CDNs; a plain img avoids per-host config.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={l.image!}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImgOk(false)}
              className={`size-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.03] ${removed ? "grayscale" : ""}`}
            />
          ) : (
            <div className="blueprint grid size-full place-items-center text-faint">
              <LogoMark size={34} className="opacity-50" />
            </div>
          )}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between p-2.5">
            <PriorityBadge p={l.priority} withCity={cityName(l.city)} />
            <span className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md">
              {sourceName(l.source)}
            </span>
          </div>
          {removed ? (
            <span
              title={removedHint(l)}
              className="absolute bottom-2.5 left-2.5 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-md"
            >
              {removedLabel(l, now)}
            </span>
          ) : fresh && (
            <span className="absolute bottom-2.5 left-2.5 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg shadow-sm">
              New
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[20px] font-semibold tracking-[-0.02em] tabular">{ils(l.price)}</span>
            {perSqm && <span className="text-[12px] text-muted tabular">{ilsShort(perSqm)}/m²</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
            {facts(l).map((f, i) => (
              <span key={f} className="inline-flex items-center gap-2">
                {i > 0 && <span className="size-[3px] rounded-full bg-faint" />}
                {f}
              </span>
            ))}
          </div>
          {place && (
            <p dir="auto" className="line-clamp-1 text-[13px] text-fg/80">
              {place}
            </p>
          )}
          <AmenityList features={l.features} className="pt-0.5" />
          <div className="mt-auto flex items-center justify-between pt-3 text-[12px] text-faint">
            <span>
              {l.postedAt ? `Posted ${relativeTime(l.postedAt, now)}` : `Found ${relativeTime(l.firstSeenAt, now)}`}
              {l.isAgency === false && <span className="ml-1.5 text-muted">· Private</span>}
              {l.alsoOn.length > 0 && (
                <span className="ml-1.5 text-muted">· also on {[...new Set(l.alsoOn.map((a) => sourceName(a.source)))].join(", ")}</span>
              )}
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-muted transition-colors group-hover:text-accent">
              Open
              <svg className="size-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" viewBox="0 0 12 12" fill="none">
                <path d="M3.5 8.5 8.5 3.5M4.5 3.5h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>
      </a>
      {/* Same box as the photo (inside the link's 1px border), so the price badge and star sit in its bottom-right corner. */}
      <div className="pointer-events-none absolute inset-x-px top-px aspect-[16/10]">
        <div className="pointer-events-auto absolute right-2 bottom-2 flex items-center gap-1.5">
          <PriceChangeBadge l={l} now={now} />
          <StarButton id={l.id} starred={l.starredAt != null} variant="overlay" />
        </div>
      </div>
    </div>
  );
});

export function ListingRow({ l, now }: { l: ListingView; now: number }) {
  const perSqm = l.price && l.sqm ? Math.round(l.price / l.sqm) : null;
  const removed = !!l.removedAt;
  // No button inside a link: the star is the link's sibling, and the link is stretched over the grid (last child,
  // above the text) so the price badge can be a button in the price cell. Bits with hover titles sit above it too.
  return (
    <div className="group flex items-center border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-surface-2">
      <div
        className={`relative grid min-w-0 flex-1 grid-cols-[68px_1fr_auto] items-center gap-x-4 gap-y-1 py-3 pr-2 pl-4 transition-opacity duration-150 md:grid-cols-[68px_130px_150px_1fr_110px_90px_20px] lg:grid-cols-[68px_190px_150px_1fr_110px_90px_20px] ${
          removed ? "opacity-70 focus-within:opacity-100 group-hover:opacity-100" : ""
        }`}
      >
        <PriorityBadge p={l.priority} size="sm" />
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[15px] font-semibold tracking-[-0.01em] tabular">{ils(l.price)}</span>
          <PriceChangeBadge l={l} now={now} size="sm" className="relative z-[2]" />
        </span>
        {removed && (
          <span title={removedHint(l)} className="relative z-[2] whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted md:hidden">
            {removedLabel(l, now)}
          </span>
        )}
        <span className="hidden text-[13px] text-muted tabular md:block">
          {[l.rooms != null ? `${l.rooms} r` : null, l.sqm ? `${l.sqm} m²` : null, perSqm ? `${ilsShort(perSqm)}/m²` : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <div className="col-span-3 flex min-w-0 items-center gap-3 md:col-span-1">
          <span className="line-clamp-1 min-w-0 flex-1 text-[13px] text-fg/80">
            <span className="font-medium text-fg">{cityName(l.city)}</span>
            {placeLine(l) && (
              <span className="text-muted">
                {" · "}
                <bdi>{placeLine(l)}</bdi>
              </span>
            )}
          </span>
          <AmenityList features={l.features} compact className="relative z-[2] shrink-0 max-md:hidden" />
        </div>
        <span className="hidden text-[12px] text-muted md:block">{sourceName(l.source)}</span>
        {removed ? (
          <span className="relative z-[2] hidden text-[12px] leading-tight text-faint md:block" title={removedHint(l)}>
            <span className="block font-medium text-muted">{l.source === "madlan" ? "Likely removed" : "Removed"}</span>
            {relativeTime(l.removedAt, now)}
          </span>
        ) : (
          <span className="hidden text-[12px] text-faint md:block">{relativeTime(l.postedAt ?? l.firstSeenAt, now)}</span>
        )}
        <svg className="hidden size-3.5 text-faint transition-colors group-hover:text-accent md:block" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3.5 8.5 8.5 3.5M4.5 3.5h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <a
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={[ils(l.price), cityName(l.city), placeLine(l)].filter(Boolean).join(", ")}
          className="absolute inset-0 z-[1] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        />
      </div>
      <StarButton id={l.id} starred={l.starredAt != null} className="mr-2" />
    </div>
  );
}

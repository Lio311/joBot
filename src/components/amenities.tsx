import type { ReactNode } from "react";
import type { FeatureKey } from "@/db/schema";

type Features = Partial<Record<FeatureKey, boolean>>;

/** 16×16 stroke glyphs, drawn in currentColor. */
const GLYPHS: Record<FeatureKey, ReactNode> = {
  parking: (
    <>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="3" />
      <path d="M6.5 11.25v-6.5h2.1a1.9 1.9 0 0 1 0 3.8H6.5" />
    </>
  ),
  elevator: (
    <>
      <rect x="3" y="1.75" width="10" height="12.5" rx="1.75" />
      <path d="m6 6.5 2-2 2 2M6 9.5l2 2 2-2" />
    </>
  ),
  balcony: <path d="M5 8.5V2.75h6V8.5M2.25 8.5h11.5M2.75 13.5h10.5M4.25 8.5v5M8 8.5v5M11.75 8.5v5" />,
  safeRoom: <path d="M8 1.75 13 3.6v3.9c0 3.1-2.1 5.3-5 6.75-2.9-1.45-5-3.65-5-6.75V3.6L8 1.75Z" />,
  airConditioning: <path d="M8 1.75v12.5M2.6 4.9l10.8 6.2M2.6 11.1l10.8-6.2M6.4 2.9 8 4.3l1.6-1.4M6.4 13.1 8 11.7l1.6 1.4" />,
  storage: (
    <>
      <rect x="1.75" y="2.5" width="12.5" height="3" rx="1" />
      <path d="M2.75 5.5v7a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-7M6.5 8.25h3" />
    </>
  ),
  accessible: (
    <>
      <circle cx="7.5" cy="2.75" r="1.25" />
      <path d="M7.25 5.5v3.75h3.5l1.5 3.75M5.25 7.4a3.75 3.75 0 1 0 5.2 4.85" />
    </>
  ),
  renovated: <path d="M8 1.75 9.4 5.6 13.25 7 9.4 8.4 8 12.25 6.6 8.4 2.75 7 6.6 5.6 8 1.75ZM12.5 11v3M11 12.5h3" />,
};

/** Display order: also decides which three make it onto a card. */
export const AMENITIES: { key: FeatureKey; label: string }[] = [
  { key: "safeRoom", label: "Safe room" },
  { key: "parking", label: "Parking" },
  { key: "elevator", label: "Elevator" },
  { key: "balcony", label: "Balcony" },
  { key: "storage", label: "Storage" },
  { key: "airConditioning", label: "A/C" },
  { key: "renovated", label: "Renovated" },
  { key: "accessible", label: "Accessible" },
];

const TITLE: Partial<Record<FeatureKey, string>> = { safeRoom: "Safe room (ממ״ד)", airConditioning: "Air conditioning" };
export const amenityTitle = (a: { key: FeatureKey; label: string }) => TITLE[a.key] ?? a.label;

export function AmenityIcon({ k, label, className = "size-3.5" }: { k: FeatureKey; label?: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {GLYPHS[k]}
    </svg>
  );
}

/** Up to `max` amenities the listing is known to have, in display order. */
export function knownAmenities(f: Features, max = 3) {
  return AMENITIES.filter((a) => f[a.key] === true).slice(0, max);
}

/** Card: muted icon + word. Row: icons only, labelled for screen readers and on hover. */
export function AmenityList({ features, compact = false, className = "" }: { features: Features; compact?: boolean; className?: string }) {
  const items = knownAmenities(features);
  if (!items.length) return null;
  return (
    <ul aria-label="Amenities" className={`flex items-center text-muted ${compact ? "gap-2" : "flex-wrap gap-x-3 gap-y-1 text-[12px]"} ${className}`}>
      {items.map((a) => (
        <li key={a.key} title={amenityTitle(a)} className="inline-flex items-center gap-1">
          {compact ? <AmenityIcon k={a.key} label={amenityTitle(a)} /> : <AmenityIcon k={a.key} className="size-3.5 opacity-80" />}
          {!compact && a.label}
        </li>
      ))}
    </ul>
  );
}

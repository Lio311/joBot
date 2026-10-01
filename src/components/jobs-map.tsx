"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import "./jobs-map.css";

import {
  AttributionControl,
  getRTLTextPluginStatus,
  getVersion,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setRTLTextPlugin,
  setWorkerUrl,
} from "maplibre-gl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { JobView } from "@/lib/data";
import { scoreTone } from "@/lib/format";
import { PLACES, type PlaceKey } from "@/lib/places";

export interface JobsMapProps {
  jobs: JobView[]; // the currently filtered jobs (some have no place: remote / "Israel")
  total: number; // jobs in the current view before the score / date / source / search filters
  hiddenReasons: string[]; // "89 עם ציון מתחת ל-45", one per filter that hides jobs
  onShowAll: () => void; // drop those filters
  hoveredPlace: PlaceKey | null; // card hovered in the list → highlight its city
  selectedPlace: PlaceKey | null; // city filter → open its popup + highlight
  onHover: (place: PlaceKey | null) => void;
  onSelect: (place: PlaceKey | null) => void;
}

const STYLES = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
} as const;

// CARTO styles switch to local (Hebrew) names at street zoom; without the
// RTL plugin those labels render with reversed letters.
const RTL_PLUGIN_URL = "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js";

const INITIAL_CENTER: [number, number] = [34.85, 32.08];
const INITIAL_ZOOM = 9.4;
const FIT_MAX_ZOOM = 12;
const FIT_PADDING = 56;
/** Jobs listed in a city's popup; short (phone) maps get fewer so the card fits. */
const popupJobs = (mapHeight: number) => (mapHeight < 520 ? 3 : 5);

/* ------------------------------------------------------------------ */
/* Worker                                                              */
/* ------------------------------------------------------------------ */

// MapLibre v6 ships its worker as an ES module (maplibre-gl-worker.mjs) that
// imports "./maplibre-gl-shared.mjs", and finds it via import.meta.url. Under
// Turbopack that resolves to nothing and the worker loads the page's HTML.
// Instead: emit both files as static assets, point the worker's relative
// import at the hashed shared asset, and hand MapLibre a same-origin blob URL.
const SHARED_IMPORT = "./maplibre-gl-shared.mjs";
let workerReady: Promise<void> | null = null;

function prepareWorker(): Promise<void> {
  workerReady ??= (async () => {
    const abs = (u: URL) => new URL(u.href, window.location.href).href;
    const workerAsset = abs(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url));
    const sharedAsset = abs(new URL("maplibre-gl/dist/maplibre-gl-shared.mjs", import.meta.url));
    const res = await fetch(workerAsset);
    if (!res.ok) throw new Error(`worker asset: HTTP ${res.status}`);
    const source = await res.text();
    if (!source.includes(SHARED_IMPORT)) throw new Error("worker asset: shared import not found");
    const patched = source.replaceAll(SHARED_IMPORT, sharedAsset);
    setWorkerUrl(URL.createObjectURL(new Blob([patched], { type: "text/javascript" })));
  })().catch((err) => {
    // Same files from a CDN, pinned to the bundled version.
    console.warn("[jobs-map] self-hosted MapLibre worker unavailable, using CDN", err);
    setWorkerUrl(`https://cdn.jsdelivr.net/npm/maplibre-gl@${getVersion()}/dist/maplibre-gl-worker.mjs`);
  });
  return workerReady;
}

/* ------------------------------------------------------------------ */
/* Color scheme                                                        */
/* ------------------------------------------------------------------ */

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeScheme(onChange: () => void) {
  const mql = window.matchMedia(DARK_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
const isDark = () => window.matchMedia(DARK_QUERY).matches;
const isDarkOnServer = () => false;

const styleFor = (dark: boolean) => (dark ? STYLES.dark : STYLES.light);

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

interface Group {
  key: PlaceKey;
  /** Best match first. */
  jobs: JobView[];
  best: number | null;
}

function groupByPlace(jobs: JobView[]): Map<PlaceKey, Group> {
  const out = new Map<PlaceKey, Group>();
  for (const j of jobs) {
    if (!j.place) continue;
    const g = out.get(j.place) ?? { key: j.place, jobs: [], best: null };
    g.jobs.push(j);
    out.set(j.place, g);
  }
  for (const g of out.values()) {
    g.jobs.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    g.best = g.jobs[0]?.score ?? null;
  }
  return out;
}

const countLabel = (n: number) => (n === 1 ? "משרה אחת" : `${n.toLocaleString("he-IL")} משרות`);

/** Scraped URLs go straight into DOM attributes; only allow http(s). */
function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, window.location.href);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/* ------------------------------------------------------------------ */
/* Markers                                                             */
/* ------------------------------------------------------------------ */

interface MarkerEntry {
  marker: Marker;
  /** Outer element owned by MapLibre (it writes `transform` on it). */
  el: HTMLDivElement;
  /** Inner pill: safe to scale/transition. */
  pill: HTMLButtonElement;
  count: HTMLSpanElement;
  name: HTMLSpanElement;
  /** Width the city name adds to the pill (measured once). */
  nameWidth: number;
  jobs: number;
  /** Signature of the fields the marker renders, to detect in-place updates. */
  sig: string;
}

const markerSig = (g: Group) => `${g.jobs.length},${g.best}`;

function paintMarker(entry: MarkerEntry, g: Group) {
  const name = PLACES[g.key].name;
  entry.pill.style.setProperty("--jm-dot", scoreTone(g.best).ring);
  entry.count.textContent = g.jobs.length.toLocaleString("he-IL");
  entry.jobs = g.jobs.length;
  // Busier cities stack on top of their neighbours.
  entry.el.style.zIndex = String(10 + Math.min(g.jobs.length, 989));
  entry.pill.setAttribute("aria-label", `${name}: ${countLabel(g.jobs.length)}${g.best != null ? `, ציון גבוה ${g.best}` : ""}`);
  entry.sig = markerSig(g);
}

const PILL_H = 26;
const GAP = 4;

/**
 * Every pill shows its city name, unless it would overlap a busier city's pill
 * (Tel Aviv / Ramat Gan when zoomed out): then it shrinks to the count alone.
 */
function declutter(map: MapLibreMap, markers: Map<PlaceKey, MarkerEntry>) {
  const placed: { x: number; y: number; w: number }[] = [];
  const hits = (x: number, y: number, w: number) =>
    placed.some((r) => Math.abs(r.x - x) < (r.w + w) / 2 + GAP && Math.abs(r.y - y) < PILL_H + GAP);
  for (const e of [...markers.values()].sort((a, b) => b.jobs - a.jobs)) {
    const { x, y } = map.project(e.marker.getLngLat());
    // Hidden when compact, but hover / selection can show it again.
    const bare = e.pill.offsetWidth - (e.name.offsetWidth ? e.nameWidth : 0);
    const full = bare + e.nameWidth;
    const fits = !hits(x, y, full);
    e.el.classList.toggle("is-compact", !fits);
    placed.push({ x, y, w: fits ? full : bare });
  }
}

function setMarkerActive(entry: MarkerEntry | undefined, active: boolean, selected: boolean) {
  if (!entry) return;
  entry.el.classList.toggle("is-active", active);
  entry.el.classList.toggle("is-selected", active && selected);
  entry.pill.classList.toggle("is-active", active);
  entry.pill.setAttribute("aria-pressed", String(active && selected));
}

/* ------------------------------------------------------------------ */
/* Popup                                                               */
/* ------------------------------------------------------------------ */

// Built with DOM APIs only: every string here is scraped third-party text.
function buildPopupContent(g: Group, mapWidth: number, shown: number): HTMLElement {
  const card = h("div", "jm-card");
  card.dir = "rtl";
  card.style.width = `${Math.min(288, mapWidth - 32)}px`;

  const head = h("div", "jm-card-head");
  head.append(h("span", "jm-card-place", PLACES[g.key].name), h("span", "jm-card-count", countLabel(g.jobs.length)));
  card.append(head);

  const list = h("ul", "jm-card-list");
  for (const j of g.jobs.slice(0, shown)) {
    const li = h("li");
    const href = safeHttpUrl(j.url);
    const row = href ? h("a", "jm-job") : h("div", "jm-job");
    if (row instanceof HTMLAnchorElement && href) {
      row.href = href;
      row.target = "_blank";
      row.rel = "noopener noreferrer";
    }
    const tone = scoreTone(j.score);
    const score = h("span", "jm-job-score", j.score == null ? "–" : String(j.score));
    score.style.setProperty("--jm-dot", tone.ring);
    score.title = tone.label;
    const text = h("span", "jm-job-text");
    // Titles mix scripts ("Cyber Data Analyst במרכז מחקר"): lay them out RTL like the cards do.
    const title = h("span", "jm-job-title", j.title);
    title.dir = "rtl";
    text.append(title);
    if (j.company) {
      const company = h("span", "jm-job-company", j.company);
      company.dir = "auto";
      text.append(company);
    }
    row.append(score, text);
    li.append(row);
    list.append(li);
  }
  card.append(list);

  const rest = g.jobs.length - shown;
  card.append(h("div", "jm-card-foot", rest > 0 ? `ועוד ${rest} ברשימה` : "הרשימה מסוננת לעיר הזו"));
  return card;
}

interface OpenPopup {
  key: PlaceKey;
  sig: string;
  popup: Popup;
  onClose: () => void;
}

/** Remove a popup without reporting it as a user dismissal. */
function closeSilently(open: OpenPopup | null) {
  if (!open) return;
  open.popup.off("close", open.onClose);
  open.popup.remove();
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

/** `overlay`: height of the counter chip over the top of the map, kept clear of markers. */
function fitTo(map: MapLibreMap, bounds: LngLatBounds, animate: boolean, overlay = 0) {
  const { clientWidth: w, clientHeight: hgt } = map.getContainer();
  if (!w || !hgt) return;
  // Small containers can't afford the full padding (MapLibre warns and bails).
  const pad = Math.max(8, Math.min(FIT_PADDING, Math.floor(Math.min(w, hgt) / 5)));
  const top = Math.min(Math.max(pad, overlay + 24), Math.floor(hgt / 2) - pad);
  // Pills are wide and centred on their point; keep them clear of the zoom buttons (top-left).
  const padding = { top, bottom: pad, right: pad + 24, left: pad + (w > 360 ? 48 : 24) };
  map.fitBounds(bounds, { padding, maxZoom: FIT_MAX_ZOOM, ...(animate ? { duration: 600 } : { animate: false }) });
}

export default function JobsMap({ jobs, total, hiddenReasons, onShowAll, hoveredPlace, selectedPlace, onHover, onSelect }: JobsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Created asynchronously (after the worker is prepared), hence state.
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const styleRef = useRef<string | null>(null);
  const markersRef = useRef(new Map<PlaceKey, MarkerEntry>());
  const activeRef = useRef(new Set<PlaceKey>());
  const popupRef = useRef<OpenPopup | null>(null);
  const fitKeyRef = useRef<string | null>(null);
  const hasFitRef = useRef(false);
  // Last fitted bounds, refitted when the container resizes until the user moves the map.
  const boundsRef = useRef<LngLatBounds | null>(null);
  const userMovedRef = useRef(false);
  const chipRef = useRef<HTMLDivElement>(null);
  const overlay = () => chipRef.current?.offsetHeight ?? 0;

  // Marker/map listeners are attached once; read callbacks through refs so they never go stale.
  const onHoverRef = useRef(onHover);
  const onSelectRef = useRef(onSelect);
  useLayoutEffect(() => {
    onHoverRef.current = onHover;
    onSelectRef.current = onSelect;
  });

  const dark = useSyncExternalStore(subscribeScheme, isDark, isDarkOnServer);

  const groups = useMemo(() => groupByPlace(jobs), [jobs]);
  const located = useMemo(() => [...groups.values()].reduce((n, g) => n + g.jobs.length, 0), [groups]);
  const placesKey = useMemo(() => [...groups.keys()].sort().join(","), [groups]);

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let instance: MapLibreMap | null = null;

    prepareWorker().then(() => {
      if (cancelled) return;
      // Only after the worker URL is set: registering the plugin spins up the worker pool.
      if (getRTLTextPluginStatus() === "unavailable") {
        setRTLTextPlugin(RTL_PLUGIN_URL, true).catch(() => {});
      }
      const style = styleFor(isDark());
      const m = new MapLibreMap({
        container,
        style,
        center: INITIAL_CENTER,
        zoom: INITIAL_ZOOM,
        attributionControl: false,
        // On touch devices one finger scrolls the page; two fingers move the map.
        cooperativeGestures: window.matchMedia("(pointer: coarse)").matches,
        // No compass, so no way back from a rotated/pitched view: keep it flat and north-up.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
      });
      m.touchZoomRotate.disableRotation();
      m.keyboard.disableRotation();
      // RTL page: controls on the left, the count chip on the right.
      m.addControl(new NavigationControl({ showCompass: false }), "top-left");
      m.addControl(new AttributionControl({ compact: true }), "bottom-left");

      // Clicking empty map clears the city filter. With a popup open, its own
      // close handler reports that instead (this listener runs first).
      m.on("click", () => {
        if (!popupRef.current) onSelectRef.current(null);
      });
      let frame = 0;
      m.on("move", () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => declutter(m, markersRef.current));
      });

      instance = m;
      styleRef.current = style;
      setMap(m);
    });

    const markers = markersRef.current;
    const active = activeRef.current;
    return () => {
      cancelled = true;
      if (!instance) return;
      closeSilently(popupRef.current);
      popupRef.current = null;
      markers.clear();
      active.clear();
      fitKeyRef.current = null;
      hasFitRef.current = false;
      instance.remove();
      setMap(null);
    };
  }, []);

  // Follow the OS color scheme. HTML markers and the popup survive setStyle.
  useEffect(() => {
    const style = styleFor(dark);
    if (!map || styleRef.current === style) return;
    styleRef.current = style;
    map.setStyle(style);
  }, [map, dark]);

  // Diff markers against the cities that have jobs.
  useEffect(() => {
    if (!map) return;
    const markers = markersRef.current;

    for (const [key, entry] of markers) {
      if (!groups.has(key)) {
        entry.marker.remove();
        markers.delete(key);
      }
    }

    for (const g of groups.values()) {
      const existing = markers.get(g.key);
      if (existing) {
        if (existing.sig !== markerSig(g)) paintMarker(existing, g);
        continue;
      }

      const key = g.key;
      const p = PLACES[key];
      const el = h("div", "jm-marker");
      const pill = h("button", "jm-pill");
      pill.type = "button";
      pill.dir = "rtl";
      const count = h("span", "jm-pill-count");
      const name = h("span", "jm-pill-name", p.name);
      pill.append(h("span", "jm-pill-dot"), name, count);
      el.append(pill);

      pill.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "touch") onHoverRef.current(key);
      });
      pill.addEventListener("pointerleave", (e) => {
        if (e.pointerType !== "touch") onHoverRef.current(null);
      });
      pill.addEventListener("click", (e) => {
        e.stopPropagation(); // keep the map's click (deselect) from firing
        onSelectRef.current(key);
      });
      pill.addEventListener("dblclick", (e) => e.stopPropagation());

      const marker = new Marker({ element: el, anchor: "center" }).setLngLat([p.lng, p.lat]).addTo(map);
      const entry: MarkerEntry = { marker, el, pill, count, name, nameWidth: name.offsetWidth + 5, jobs: 0, sig: "" };
      paintMarker(entry, g);
      markers.set(key, entry);
    }
    declutter(map, markers);
  }, [map, groups]);

  // Highlight hovered + selected markers (re-applied after the marker diff).
  useEffect(() => {
    const markers = markersRef.current;
    const next = new Set<PlaceKey>();
    if (hoveredPlace) next.add(hoveredPlace);
    if (selectedPlace) next.add(selectedPlace);
    for (const key of activeRef.current) {
      if (!next.has(key)) setMarkerActive(markers.get(key), false, false);
    }
    for (const key of next) setMarkerActive(markers.get(key), true, key === selectedPlace);
    activeRef.current = next;
  }, [map, hoveredPlace, selectedPlace, groups]);

  // Fit to the cities whenever the set of cities changes.
  useEffect(() => {
    if (!map || fitKeyRef.current === placesKey) return;
    fitKeyRef.current = placesKey;
    if (!groups.size) return;

    const bounds = new LngLatBounds();
    for (const key of groups.keys()) bounds.extend([PLACES[key].lng, PLACES[key].lat]);
    boundsRef.current = bounds;
    userMovedRef.current = false;
    fitTo(map, bounds, hasFitRef.current, overlay());
    hasFitRef.current = true;
  }, [map, placesKey, groups]);

  // The sticky panel's height settles after first paint (it depends on the measured filter
  // bar), so refit on container resizes until the user pans or zooms on their own.
  useEffect(() => {
    if (!map) return;
    const onMoveStart = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) userMovedRef.current = true;
    };
    map.on("movestart", onMoveStart);
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        map.resize();
        if (!userMovedRef.current && boundsRef.current) fitTo(map, boundsRef.current, false, overlay());
      });
    });
    ro.observe(map.getContainer());
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      map.off("movestart", onMoveStart);
    };
  }, [map]);

  // Popup for the selected city (rebuilt when its jobs change, e.g. a job gets hidden).
  useEffect(() => {
    if (!map) return;
    const g = selectedPlace ? groups.get(selectedPlace) : undefined;
    const shown = popupJobs(map.getContainer().clientHeight);
    const sig = g ? `${g.key}:${g.jobs.slice(0, shown).map((j) => j.id).join(",")}:${g.jobs.length}` : "";
    if (popupRef.current && popupRef.current.sig === sig) return;

    const reopening = popupRef.current?.key === g?.key;
    closeSilently(popupRef.current);
    popupRef.current = null;
    if (!g) return;

    const p = PLACES[g.key];
    const popup = new Popup({
      closeButton: false,
      closeOnClick: true,
      focusAfterOpen: false, // focusing a link would scroll the page to the map
      className: reopening ? "jm-popup jm-popup--still" : "jm-popup",
      maxWidth: "none",
      offset: 18,
      padding: { top: 12, right: 12, bottom: 12, left: 12 },
    })
      .setLngLat([p.lng, p.lat])
      .setDOMContent(buildPopupContent(g, map.getContainer().clientWidth, shown));

    const open: OpenPopup = {
      key: g.key,
      sig,
      popup,
      onClose: () => {
        if (popupRef.current === open) popupRef.current = null;
        onSelectRef.current(null);
      },
    };
    popup.on("close", open.onClose);
    popup.addTo(map);
    popupRef.current = open;
    // A picked city counts as the user taking over: a resize refit must not pan the card away.
    userMovedRef.current = true;

    // Once the open animation settles, pan just enough that the whole card sits inside the map.
    const content = popup.getElement().querySelector<HTMLElement>(".maplibregl-popup-content");
    let done = false;
    const fit = () => {
      if (done || popupRef.current !== open) return;
      done = true;
      const box = map.getContainer().getBoundingClientRect();
      const card = (content ?? popup.getElement()).getBoundingClientRect();
      const margin = 12;
      const dx =
        card.left < box.left + margin ? card.left - box.left - margin : card.right > box.right - margin ? card.right - box.right + margin : 0;
      const dy =
        card.top < box.top + margin ? card.top - box.top - margin : card.bottom > box.bottom - margin ? card.bottom - box.bottom + margin : 0;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (dx || dy) map.panBy([dx, dy], { duration: reduce ? 0 : 450 });
    };
    content?.addEventListener("animationend", fit, { once: true });
    setTimeout(fit, 260); // reduced motion: no animation, so no animationend
  }, [map, selectedPlace, groups]);

  return (
    <div className="jm-root size-full">
      <div ref={containerRef} className="jm-canvas" dir="ltr" />
      <div ref={chipRef} className="jm-chip tabular" hidden={selectedPlace != null}>
        <div className="jm-chip-row">
          <span className="jm-chip-dot" aria-hidden />
          <span>
            <b>{located.toLocaleString("he-IL")}</b> על המפה
            {jobs.length > located && ` · ${(jobs.length - located).toLocaleString("he-IL")} בלי עיר`}
            {total > jobs.length && ` · ${(total - jobs.length).toLocaleString("he-IL")} מוסתרות בסינון`}
          </span>
        </div>
        {total > jobs.length && (
          <div className="jm-chip-why">
            {hiddenReasons.length > 0 && <span>{hiddenReasons.join(" · ")}</span>}
            <button type="button" onClick={onShowAll} className="jm-chip-all">
              הצג הכל
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import "./listings-map.css";

import {
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
import { cityName, SOURCES, type SourceKey } from "@/lib/config";
import type { ListingView } from "@/lib/data";
import { ils, ilsShort } from "@/lib/format";
import { STAR_PATH, useStarToggle } from "./favorites";
import { priceChangeHint } from "./price-history";

export interface ListingsMapProps {
  listings: ListingView[]; // the currently filtered listings (some have lat/lng null)
  hoveredId: number | null; // card hovered in the list → highlight its marker
  selectedId: number | null; // selected listing → open its popup + highlight
  onHover: (id: number | null) => void;
  onSelect: (id: number | null) => void;
}

const STYLES = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
} as const;

// CARTO styles switch to local (Hebrew) names at street zoom; without the
// RTL plugin those labels render with reversed letters.
const RTL_PLUGIN_URL = "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js";

const INITIAL_CENTER: [number, number] = [34.82, 32.1];
const INITIAL_ZOOM = 10.3;
const FIT_MAX_ZOOM = 14;
const FIT_PADDING = 48;

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
    console.warn("[listings-map] self-hosted MapLibre worker unavailable, using CDN", err);
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
/* Listing helpers                                                     */
/* ------------------------------------------------------------------ */

type Located = ListingView & { lat: number; lng: number };

const hasCoords = (l: ListingView): l is Located =>
  l.lat != null && l.lng != null && Number.isFinite(l.lat) && Number.isFinite(l.lng);

const priorityOf = (p: number) => (p >= 1 && p <= 4 ? Math.round(p) : 4);

const sourceName = (s: string) => SOURCES[s as SourceKey]?.name ?? s;

function factsOf(l: ListingView): string[] {
  return [
    l.rooms != null ? `${l.rooms} rooms` : null,
    l.sqm ? `${l.sqm} m²` : null,
    l.floor != null ? (l.floor === 0 ? "ground floor" : `floor ${l.floor}`) : null,
  ].filter((x): x is string => x != null);
}

function placeOf(l: ListingView): string {
  return (
    [l.street, l.neighborhood].filter(Boolean).join(", ") ||
    l.title ||
    cityName(l.city) ||
    ""
  );
}

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
  price: HTMLSpanElement;
  /** Signature of the fields the marker renders, to detect in-place updates. */
  sig: string;
}

const markerSig = (l: Located) => `${l.lat},${l.lng},${l.price},${l.priority}`;

function paintMarker(entry: MarkerEntry, l: Located) {
  const p = priorityOf(l.priority);
  entry.el.dataset.p = String(p);
  entry.pill.style.setProperty("--lm-dot", `var(--p${p})`);
  entry.price.textContent = ilsShort(l.price);
  const facts = factsOf(l);
  const place = placeOf(l);
  entry.pill.setAttribute("aria-label", [ils(l.price), ...facts, place].filter(Boolean).join(", "));
  entry.sig = markerSig(l);
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

const SVG_NS = "http://www.w3.org/2000/svg";

/** Reflects the listing's star. Returns false if nothing changed. */
function paintStar(btn: HTMLButtonElement, starred: boolean) {
  if (btn.getAttribute("aria-pressed") === String(starred)) return false;
  btn.setAttribute("aria-pressed", String(starred));
  btn.setAttribute("aria-label", starred ? "Unstar listing" : "Star listing");
  btn.classList.toggle("is-on", starred);
  return true;
}

function popStar(btn: HTMLButtonElement) {
  btn.classList.remove("is-pop");
  void btn.offsetWidth; // restart the animation
  btn.classList.add("is-pop");
}

/** Star toggle for the popup. Its state follows the listing data (see the sync effect), not the click. */
function buildStar(starred: boolean, onToggle: (next: boolean) => void) {
  const btn = h("button", "lm-star");
  btn.type = "button";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", STAR_PATH);
  path.setAttribute("stroke-width", "1.4");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  btn.append(svg);
  paintStar(btn, starred);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onToggle(btn.getAttribute("aria-pressed") !== "true");
  });
  return btn;
}

// Built with DOM APIs only: every string here is scraped third-party text.
function buildPopupContent(
  l: Located,
  mapWidth: number,
  mapHeight: number,
  onStar: ((next: boolean) => void) | null,
): HTMLElement {
  // Short maps (the mobile layout) get a horizontal card that fits under a pin.
  const compact = mapHeight < 520;
  const card = h("div", compact ? "lm-card lm-card--compact" : "lm-card");
  card.style.width = `${Math.min(compact ? 300 : 264, mapWidth - 32)}px`;
  const href = safeHttpUrl(l.url);
  const image = safeHttpUrl(l.image);

  if (image) {
    const media = href ? h("a", "lm-card-media") : h("div", "lm-card-media");
    if (media instanceof HTMLAnchorElement && href) {
      media.href = href;
      media.target = "_blank";
      media.rel = "noopener noreferrer";
      media.tabIndex = -1;
      media.setAttribute("aria-hidden", "true");
    }
    const img = h("img");
    img.alt = "";
    img.decoding = "async";
    img.draggable = false;
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => media.remove(), { once: true });
    img.src = image;
    media.append(img);
    card.append(media);
  }

  const body = h("div", "lm-card-body");

  const priceRow = h("div", "lm-card-price-row");
  priceRow.append(h("span", "lm-card-price", ils(l.price)));
  if (l.price && l.sqm) priceRow.append(h("span", "lm-card-per-sqm", `${ilsShort(Math.round(l.price / l.sqm))}/m²`));
  body.append(priceRow);

  // "↓ ₪120K · Was ₪3.9M · changed 3d ago"
  const hint = priceChangeHint(l, Date.now());
  if (hint && l.priceChange != null) {
    const dir = l.priceChange < 0 ? "down" : l.priceChange > 0 ? "up" : "flat";
    const was = h("div", "lm-card-was");
    was.dataset.dir = dir;
    const delta = h("span", "lm-card-was-delta", `${dir === "down" ? "↓" : dir === "up" ? "↑" : "↔"} ${ilsShort(Math.abs(l.priceChange))}`);
    was.append(delta, document.createTextNode(` · ${hint}`));
    was.title = hint;
    body.append(was);
  }

  const facts = factsOf(l);
  if (facts.length) body.append(h("div", "lm-card-facts", facts.join(" · ")));

  const place = placeOf(l);
  if (place) {
    const line = h("div", "lm-card-place", place);
    line.dir = "auto";
    line.title = place;
    body.append(line);
  }

  const foot = h("div", "lm-card-foot");
  const source = h("span", "lm-card-source");
  const dot = h("span", "lm-card-dot");
  dot.style.setProperty("--lm-dot", `var(--p${priorityOf(l.priority)})`);
  source.append(dot, document.createTextNode(sourceName(l.source)));
  foot.append(source);
  const actions = h("div", "lm-card-actions");
  if (onStar) actions.append(buildStar(l.starredAt != null, onStar));
  if (href) {
    const link = h("a", "lm-card-link", "Open listing ↗");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    actions.append(link);
  }
  if (actions.childElementCount) foot.append(actions);
  body.append(foot);

  card.append(body);
  return card;
}

interface OpenPopup {
  id: number;
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

function fitTo(map: MapLibreMap, bounds: LngLatBounds, animate: boolean) {
  const { clientWidth: w, clientHeight: hgt } = map.getContainer();
  if (!w || !hgt) return;
  // Small containers can't afford the full padding (MapLibre warns and bails).
  const padding = Math.max(8, Math.min(FIT_PADDING, Math.floor(Math.min(w, hgt) / 5)));
  map.fitBounds(bounds, { padding, maxZoom: FIT_MAX_ZOOM, ...(animate ? { duration: 600 } : { animate: false }) });
}

export default function ListingsMap({ listings, hoveredId, selectedId, onHover, onSelect }: ListingsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Created asynchronously (after the worker is prepared), hence state.
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const styleRef = useRef<string | null>(null);
  const markersRef = useRef(new Map<number, MarkerEntry>());
  const activeRef = useRef(new Set<number>());
  const popupRef = useRef<OpenPopup | null>(null);
  const fitKeyRef = useRef<string | null>(null);
  const hasFitRef = useRef(false);
  // Last fitted bounds, refitted when the container resizes until the user moves the map.
  const boundsRef = useRef<LngLatBounds | null>(null);
  const userMovedRef = useRef(false);

  // Marker/map listeners are attached once; read callbacks through refs so they never go stale.
  const onHoverRef = useRef(onHover);
  const onSelectRef = useRef(onSelect);
  const toggleStar = useStarToggle();
  const toggleStarRef = useRef(toggleStar);
  useLayoutEffect(() => {
    onHoverRef.current = onHover;
    onSelectRef.current = onSelect;
    toggleStarRef.current = toggleStar;
  });

  const dark = useSyncExternalStore(subscribeScheme, isDark, isDarkOnServer);

  const located = useMemo(() => listings.filter(hasCoords), [listings]);
  // Sorted so reordering the list (sorting) doesn't count as a new set.
  const idsKey = useMemo(
    () => located.map((l) => l.id).sort((a, b) => a - b).join(","),
    [located],
  );

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
        attributionControl: { compact: true },
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
      m.addControl(new NavigationControl({ showCompass: false }), "top-right");

      // Clicking empty map clears the selection. With a popup open, its own
      // close handler reports that instead (this listener runs first).
      m.on("click", () => {
        if (!popupRef.current) onSelectRef.current(null);
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

  // Diff markers against the located listings.
  useEffect(() => {
    if (!map) return;
    const markers = markersRef.current;
    const next = new Set(located.map((l) => l.id));

    for (const [id, entry] of markers) {
      if (!next.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    }

    for (const l of located) {
      const existing = markers.get(l.id);
      if (existing) {
        if (existing.sig !== markerSig(l)) {
          existing.marker.setLngLat([l.lng, l.lat]);
          paintMarker(existing, l);
        }
        continue;
      }

      const id = l.id;
      const el = h("div", "lm-marker");
      const pill = h("button", "lm-pill");
      pill.type = "button";
      const price = h("span", "lm-pill-price");
      pill.append(h("span", "lm-pill-dot"), price);
      el.append(pill);

      pill.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "touch") onHoverRef.current(id);
      });
      pill.addEventListener("pointerleave", (e) => {
        if (e.pointerType !== "touch") onHoverRef.current(null);
      });
      pill.addEventListener("click", (e) => {
        e.stopPropagation(); // keep the map's click (deselect) from firing
        onSelectRef.current(id);
      });
      pill.addEventListener("dblclick", (e) => e.stopPropagation());

      const marker = new Marker({ element: el, anchor: "center" }).setLngLat([l.lng, l.lat]).addTo(map);
      const entry: MarkerEntry = { marker, el, pill, price, sig: "" };
      paintMarker(entry, l);
      markers.set(id, entry);
    }
  }, [map, located]);

  // Highlight hovered + selected markers (re-applied after the marker diff).
  useEffect(() => {
    const markers = markersRef.current;
    const next = new Set<number>();
    if (hoveredId != null) next.add(hoveredId);
    if (selectedId != null) next.add(selectedId);
    for (const id of activeRef.current) {
      if (!next.has(id)) setMarkerActive(markers.get(id), false, false);
    }
    for (const id of next) setMarkerActive(markers.get(id), true, id === selectedId);
    activeRef.current = next;
  }, [map, hoveredId, selectedId, located]);

  // Fit to the listings whenever the set of located ids changes.
  useEffect(() => {
    if (!map || fitKeyRef.current === idsKey) return;
    fitKeyRef.current = idsKey;
    if (!located.length) return;

    const bounds = new LngLatBounds();
    for (const l of located) bounds.extend([l.lng, l.lat]);
    boundsRef.current = bounds;
    userMovedRef.current = false;
    fitTo(map, bounds, hasFitRef.current);
    hasFitRef.current = true;
  }, [map, idsKey, located]);

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
        if (!userMovedRef.current && boundsRef.current) fitTo(map, boundsRef.current, false);
      });
    });
    ro.observe(map.getContainer());
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      map.off("movestart", onMoveStart);
    };
  }, [map]);

  // Popup for the selected listing.
  useEffect(() => {
    if (!map) return;
    const listing = selectedId != null ? located.find((l) => l.id === selectedId) : undefined;
    if (popupRef.current && popupRef.current.id === listing?.id) return;

    closeSilently(popupRef.current);
    popupRef.current = null;
    if (!listing) return;

    const lngLat: [number, number] = [listing.lng, listing.lat];
    const popup = new Popup({
      closeButton: false,
      closeOnClick: true,
      focusAfterOpen: false, // focusing the link would scroll the page to the map
      className: "lm-popup",
      maxWidth: "none",
      offset: 20,
      padding: { top: 12, right: 12, bottom: 12, left: 12 },
    })
      .setLngLat(lngLat)
      .setDOMContent(
        buildPopupContent(
          listing,
          map.getContainer().clientWidth,
          map.getContainer().clientHeight,
          toggleStarRef.current ? (next) => toggleStarRef.current?.(listing.id, next) : null,
        ),
      );

    const open: OpenPopup = {
      id: listing.id,
      popup,
      onClose: () => {
        if (popupRef.current === open) popupRef.current = null;
        onSelectRef.current(null);
      },
    };
    popup.on("close", open.onClose);
    popup.addTo(map);
    popupRef.current = open;

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
  }, [map, selectedId, located]);

  // Keep the open popup's star in step with the data (optimistic star, rollback, passcode dialog).
  useEffect(() => {
    const open = popupRef.current;
    const btn = open?.popup.getElement()?.querySelector<HTMLButtonElement>(".lm-star");
    if (!open || !btn) return;
    const starred = located.find((l) => l.id === open.id)?.starredAt != null;
    if (paintStar(btn, starred) && starred && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) popStar(btn);
  }, [located]);

  return (
    <div className="lm-root size-full">
      <div ref={containerRef} className="lm-canvas" />
      <div className="lm-chip tabular">
        <span className="lm-chip-dot" aria-hidden />
        <span>
          <b>{located.length.toLocaleString("en-US")}</b> of {listings.length.toLocaleString("en-US")} on map
        </span>
      </div>
    </div>
  );
}

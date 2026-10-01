"use client";

import { useEffect } from "react";

/**
 * iOS Safari ignores `user-scalable=no`, so pinch-zoom is blocked through its gesture events.
 * The map keeps its own pinch-to-zoom (MapLibre handles those touches itself).
 */
export function NoZoom() {
  useEffect(() => {
    const block = (e: Event) => {
      if (!(e.target as Element | null)?.closest?.(".maplibregl-map")) e.preventDefault();
    };
    document.addEventListener("gesturestart", block, { passive: false });
    document.addEventListener("gesturechange", block, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", block);
      document.removeEventListener("gesturechange", block);
    };
  }, []);
  return null;
}

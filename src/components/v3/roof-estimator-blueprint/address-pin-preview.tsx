"use client";

// Pin-on-the-roof confirmation for the intake panels (data + drawing forms).
//
// A picked suggestion already carries Google's ROOFTOP point (places-suggest
// resolves `location` via fetchFields), but until now the first time anyone
// SAW where that point landed was after the billed lookup had run. This shows
// the point before the order: a live satellite view with a pin on the roof,
// so the wrong-house case is caught while it still costs nothing.
//
// Renders nothing without the browser key, and retires itself for the session
// if the SDK refuses to load — the intake works exactly as before either way.
// Free-typed addresses have no point to show; the parent only mounts this for
// a picked suggestion.

import * as React from "react";
import { isMapsBrowserEnabled, loadMapsLibrary } from "@/lib/googleMaps";
import { blueprintPinIcon } from "./pin";

// Same zoom as the report's live map — one house fills the frame.
const PIN_ZOOM = 20;

// Minimal structural types for the JS SDK — the repo carries no
// @types/google.maps; same approach as the report viewer and lead-map.tsx.
// Classic Marker on purpose: AdvancedMarkerElement needs a Map ID.
interface PinMap {
  setCenter(c: { lat: number; lng: number }): void;
  setZoom(z: number): void;
}
interface PinMarker {
  setPosition(c: { lat: number; lng: number }): void;
  setTitle(t: string): void;
}
/* eslint-disable @typescript-eslint/no-explicit-any */
type G = any;

export function AddressPinPreview({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const builtRef = React.useRef<{ host: HTMLDivElement; map: PinMap; marker: PinMarker } | null>(null);
  const [down, setDown] = React.useState(false);
  const enabled = isMapsBrowserEnabled();

  React.useEffect(() => {
    if (!enabled || down) return;
    let cancelled = false;
    void (async () => {
      try {
        // importLibrary("maps") is the readiness signal; Marker comes off the
        // populated global namespace, the same way lead-map.tsx reads it.
        await loadMapsLibrary<G>("maps");
        await loadMapsLibrary<G>("marker").catch(() => null);
        const maps = (window as unknown as { google: { maps: G } }).google.maps;
        const host = hostRef.current;
        if (cancelled || !host) return;
        const center = { lat, lng };
        if (builtRef.current?.host === host) {
          // Same mount, new pick: recentre and move the pin.
          builtRef.current.map.setCenter(center);
          builtRef.current.map.setZoom(PIN_ZOOM);
          builtRef.current.marker.setPosition(center);
          builtRef.current.marker.setTitle(label);
        } else {
          const map = new maps.Map(host, {
            center,
            zoom: PIN_ZOOM,
            mapTypeId: "satellite",
            tilt: 0,
            disableDefaultUI: true,
            zoomControl: true,
            clickableIcons: false,
          }) as PinMap;
          const marker = new maps.Marker({
            map,
            position: center,
            title: label,
            icon: blueprintPinIcon(maps.Point),
          }) as PinMarker;
          builtRef.current = { host, map, marker };
        }
      } catch {
        if (!cancelled) setDown(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, down, lat, lng, label]);

  if (!enabled || down) return null;

  return (
    <div className="rf-pin">
      <div ref={hostRef} className="rf-pin-map" aria-label={`Map preview with a pin on ${label}`} />
      <p className="rf-note rf-pin-note">
        The pin marks <b>{label}</b> — the roof the measurement will read. Wrong house? Pick the address
        again.
      </p>
      <style jsx global>{`
        .jf-blueprint .content .rf-pin {
          margin-top: 14px;
        }
        .jf-blueprint .content .rf-pin-map {
          width: 100%;
          height: clamp(240px, 30vw, 340px);
          border: 1.5px solid var(--hair-soft);
          border-radius: var(--radius);
          overflow: hidden;
          background: var(--paper-deep);
        }
        .jf-blueprint .content .rf-pin-note {
          margin-top: 8px;
        }
      `}</style>
    </div>
  );
}

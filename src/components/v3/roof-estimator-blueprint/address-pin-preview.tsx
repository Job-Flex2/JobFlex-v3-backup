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
//
// THE PERSON'S PIN (2026-10-26, ticket 8KETUL: an apartment complex measured
// at its garage). With `onMove` the pin can be dragged — or the map tapped —
// onto the building to measure; the parent sends that point with the order and
// it decides which building is main. While the pin is held the page does not
// scroll under the finger. A typed-out address gets its point from the
// server's geocoder (the data form), so the map shows for it too.

import * as React from "react";
import { isMapsBrowserEnabled, loadMapsLibrary } from "@/lib/googleMaps";
import { blueprintPinIcon } from "./pin";

// Same zoom as the report's live map — one house fills the frame.
const PIN_ZOOM = 20;

// Minimal structural types for the JS SDK — the repo carries no
// @types/google.maps; same approach as the report viewer and lead-map.tsx.
// Classic Marker on purpose: AdvancedMarkerElement needs a Map ID.
type MapEvent = { latLng?: { lat(): number; lng(): number } };
type Listener = { remove(): void };
interface PinMap {
  setCenter(c: { lat: number; lng: number }): void;
  setZoom(z: number): void;
  addListener?(ev: string, fn: (e: MapEvent) => void): Listener;
}
interface PinMarker {
  setPosition(c: { lat: number; lng: number }): void;
  setTitle(t: string): void;
  setDraggable?(d: boolean): void;
  addListener?(ev: string, fn: (e: MapEvent) => void): Listener;
}
/* eslint-disable @typescript-eslint/no-explicit-any */
type G = any;

const pointOf = (e: MapEvent) => (e.latLng ? { lat: e.latLng.lat(), lng: e.latLng.lng() } : null);

export function AddressPinPreview({
  lat,
  lng,
  label,
  scanning = false,
  onMove,
  moved = false,
}: {
  lat: number;
  lng: number;
  label: string;
  /** On the measuring screen (2026-10-13): a sweep over the map, no "wrong house?" note. */
  scanning?: boolean;
  /** The pin can be dragged (or the map tapped) onto the building to measure; called with the new point. */
  onMove?: (p: { lat: number; lng: number }) => void;
  /** The pin stands where the person put it, not where the address resolved. */
  moved?: boolean;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const builtRef = React.useRef<{ host: HTMLDivElement; map: PinMap; marker: PinMarker; listeners: Listener[] } | null>(null);
  const [down, setDown] = React.useState(false);
  const enabled = isMapsBrowserEnabled();
  const movable = !!onMove && !scanning;
  // The latest handler, so the listeners (made once, with the map) call this render's.
  const moveRef = React.useRef(onMove);
  React.useEffect(() => {
    moveRef.current = movable ? onMove : undefined;
  });
  // The page stays still while the pin is held: a finger dragging the pin must not scroll the page under it. The
  // dashboard scrolls inside its shell, not the document, so every scrolling box above the map is held.
  const heldRef = React.useRef<Array<{ el: HTMLElement; overflow: string; touch: string }> | null>(null);
  const hold = React.useCallback((on: boolean) => {
    if (on && !heldRef.current) {
      const boxes: HTMLElement[] = [document.documentElement];
      for (let el = hostRef.current?.parentElement ?? null; el; el = el.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) boxes.push(el);
      }
      heldRef.current = boxes.map((el) => ({ el, overflow: el.style.overflow, touch: el.style.touchAction }));
      for (const { el } of heldRef.current) {
        el.style.overflow = "hidden";
        el.style.touchAction = "none";
      }
    } else if (!on && heldRef.current) {
      for (const h of heldRef.current) {
        h.el.style.overflow = h.overflow;
        h.el.style.touchAction = h.touch;
      }
      heldRef.current = null;
    }
  }, []);
  React.useEffect(
    () => () => {
      hold(false);
      for (const l of builtRef.current?.listeners ?? []) l.remove();
    },
    [hold],
  );

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
          // Same mount, new point: move the pin — and recentre, unless the person just put it there.
          if (!moved) {
            builtRef.current.map.setCenter(center);
            builtRef.current.map.setZoom(PIN_ZOOM);
          }
          builtRef.current.marker.setPosition(center);
          builtRef.current.marker.setTitle(label);
          builtRef.current.marker.setDraggable?.(movable);
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
            draggable: movable,
          }) as PinMarker;
          const listeners: Listener[] = [];
          if (marker.addListener) {
            listeners.push(marker.addListener("dragstart", () => hold(true)));
            listeners.push(
              marker.addListener("dragend", (e) => {
                hold(false);
                const p = pointOf(e);
                if (p) moveRef.current?.(p);
              }),
            );
          }
          // A tap on the map puts the pin there — on a phone the quickest way to point at a building.
          if (map.addListener) {
            listeners.push(
              map.addListener("click", (e) => {
                const p = pointOf(e);
                if (!p || !moveRef.current) return;
                marker.setPosition(p);
                moveRef.current(p);
              }),
            );
          }
          builtRef.current = { host, map, marker, listeners };
        }
      } catch {
        if (!cancelled) setDown(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, down, lat, lng, label, movable, moved, hold]);

  if (!enabled || down) return null;

  return (
    <div className={"rf-pin" + (scanning ? " is-scanning" : "")} data-rf-pin={movable ? "movable" : undefined}>
      <div ref={hostRef} className="rf-pin-map" aria-label={`Map preview with a pin on ${label}`} />
      {scanning ? (
        // The scan is the app's own blueprint theatre: an opaque veil over
        // the live map (which stays warm underneath for the reveal). While
        // it is up no map imagery is on screen — so no provider chrome is
        // either; hiding the attribution OVER visible imagery is something
        // the imagery's terms do not allow.
        <span className="rf-pin-veil" aria-hidden="true">
          <span className="rf-pin-veil-dot" />
          <span className="rf-pin-veil-label">{label}</span>
        </span>
      ) : null}
      {scanning ? <span className="rf-pin-sweep" aria-hidden="true" /> : null}
      {scanning ? null : movable ? (
        <>
          <p className="rf-pin-caption">Measure the building under the pin</p>
          <p className="rf-note rf-pin-note">
            {moved ? (
              <>
                Pin moved from <b>{label}</b>.
              </>
            ) : (
              <>
                The pin marks <b>{label}</b>.
              </>
            )}{" "}
            Drag it, or tap the map, to put it on another building. Wrong house? Pick the address again.
          </p>
        </>
      ) : (
        <p className="rf-note rf-pin-note">
          The pin marks <b>{label}</b> — the roof the measurement will read. Wrong house? Pick the address
          again.
        </p>
      )}
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
        .jf-blueprint .content .rf-pin-caption {
          margin: 10px 0 0;
          font-size: 15px;
          font-weight: 800;
          line-height: 1.3;
          color: var(--ink);
        }
        .jf-blueprint .content .rf-pin-note {
          margin-top: 8px;
        }
      `}</style>
    </div>
  );
}

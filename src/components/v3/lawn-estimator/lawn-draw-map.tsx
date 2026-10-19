"use client";
// THE YARD, DRAWN (lawn estimator, 2026-10-19 — owner: "let's just have a good pic and the contractor can draw lines
// and get the sq ft to cut — make it smart"). Google's satellite photo — the sharpest aerial there is, the one the fence
// estimator draws on — with the lot line over it, and the contractor's own shapes: click the corners of a lawn, a bed,
// or a cut-out (a patio, a garden — not mowed); click the first corner, double-click or Finish to close it. While
// drawing, the corner snaps onto another shape's corner or edge and the lot line, so a bed shares its edge with the lawn
// it sits in, and a chip by the pointer gives the side's length and the area so far. A finished shape is labelled with
// its name and square feet; tap it to select, drag its corners, drag a mid-side handle to add one, right-click a corner
// to take it out. One tap with "Outline a piece" traces a lawn or bed from the USDA photo's reading. The USDA photo
// itself can be laid over the satellite where Google's is out of date. Google Maps' own terms apply: the photo is
// shown, never read by the app — the reading is the USDA photo's.
import * as React from "react";
import s from "./lawn.module.css";
import { loadMapsLibrary, isMapsBrowserEnabled } from "@/lib/googleMaps";
import type { LatLng } from "@/lib/lawn/geo";
import { labelPoint, pathFt, ringSqft, type LawnShape, type ShapeKind } from "@/lib/lawn/shapes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GMaps = any;
export type Bounds = { south: number; west: number; north: number; east: number };

export const SHAPE_STYLE: Record<ShapeKind, { fill: string; fillOpacity: number; line: string; dash?: boolean }> = {
  lawn: { fill: "#a3e635", fillOpacity: 0.3, line: "#d9f99d" },
  bed: { fill: "#f59e0b", fillOpacity: 0.34, line: "#fcd34d" },
  cut: { fill: "#0f172a", fillOpacity: 0.4, line: "#ffffff", dash: true },
};
const Z = { lot: 5, lawn: 10, cut: 12, bed: 14, selected: 20, draft: 30 };
const SNAP_CORNER_PX = 12;
const SNAP_EDGE_PX = 8;
const CLOSE_PX = 14;

type Props = {
  center: LatLng;
  lotRing: LatLng[];
  /** Where the map opens. */
  frame: Bounds | null;
  /** The USDA photo, to lay over the satellite. */
  usda: { url: string; bounds: Bounds } | null;
  imagery: "google" | "usda";
  shapes: LawnShape[];
  /** Each shape's area for its label. */
  sqftOf: Record<string, number>;
  selected: string | null;
  /** What a click does: put down a corner of a lawn, bed, cut-out or the lot line, or outline the piece under it. */
  tool: ShapeKind | "lot" | "wand" | null;
  onClose: (kind: ShapeKind | "lot", ring: LatLng[]) => void;
  onWand: (at: LatLng) => void;
  onEdit: (id: string, ring: LatLng[]) => void;
  onSelect: (id: string | null) => void;
  /** The map couldn't load (no key, blocked): the host shows the USDA photo instead. */
  onUnavailable: () => void;
};

type Api = { overlay: GMaps; LatLng: GMaps } | null;
/** A point's place on the screen, through the map's projection (null before the map has drawn). */
function pxOf(a: Api, ll: LatLng): { x: number; y: number } | null {
  const p = a?.overlay.getProjection?.();
  if (!a || !p) return null;
  const q = p.fromLatLngToContainerPixel(new a.LatLng(ll.lat, ll.lng));
  return q ? { x: q.x, y: q.y } : null;
}

type Label = { id: string; at: LatLng; el: HTMLDivElement; sqft: number };
/** The labels at their shapes: the bigger first, and one that would sit on a label already placed is left off at this
 *  zoom. */
function placeLabels(a: Api, labels: Label[]) {
  const p = a?.overlay.getProjection?.();
  if (!a || !p) return;
  const taken: Array<[number, number, number, number]> = [];
  for (const l of [...labels].sort((x, y) => y.sqft - x.sqft)) {
    const q = p.fromLatLngToDivPixel(new a.LatLng(l.at.lat, l.at.lng));
    if (!q) continue;
    l.el.style.transform = `translate(${q.x}px, ${q.y}px) translate(-50%, -50%)`;
    l.el.style.display = "";
    const w = l.el.offsetWidth;
    const h = l.el.offsetHeight;
    const box: [number, number, number, number] = [q.x - w / 2, q.y - h / 2, q.x + w / 2, q.y + h / 2];
    if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) l.el.style.display = "none";
    else taken.push(box);
  }
}

const sameRing = (a: LatLng[], b: LatLng[]) => a.length === b.length && a.every((p, i) => Math.abs(p.lat - b[i].lat) < 1e-10 && Math.abs(p.lng - b[i].lng) < 1e-10);
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function LawnDrawMap(props: Props) {
  const { center, lotRing, frame, usda, imagery, shapes, sqftOf, selected, tool } = props;
  const mountRef = React.useRef<HTMLDivElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const chipRef = React.useRef<HTMLDivElement>(null);
  const api = React.useRef<{
    maps: GMaps;
    map: GMaps;
    LatLng: GMaps;
    overlay: GMaps;
    ground: GMaps | null;
    labelHost: HTMLDivElement | null;
    polys: Map<string, { poly: GMaps; kind: ShapeKind; listeners: GMaps[] }>;
    draftLine: GMaps;
    rubber: GMaps;
    firstDot: GMaps;
    snapDot: GMaps;
  } | null>(null);
  const [ready, setReady] = React.useState(false);
  // The label pane exists once the map has added its overlay — a moment after the map itself.
  const [labelPane, setLabelPane] = React.useState(false);
  const [npts, setNpts] = React.useState(0);
  // The latest props for the map's own listeners, which are attached once.
  const live = React.useRef(props);
  React.useEffect(() => {
    live.current = props;
  });
  const pts = React.useRef<LatLng[]>([]);
  const syncing = React.useRef(false);
  const labels = React.useRef<Label[]>([]);

  /** A corner put down near another shape's corner or edge, or the lot line, lands on it. */
  const snap = React.useCallback((ll: LatLng): LatLng => {
    const a = api.current;
    const at = pxOf(a, ll);
    const p = a?.overlay.getProjection?.();
    if (!at || !p || !a) return ll;
    const rings = [...live.current.shapes.map((x) => x.ring), live.current.lotRing];
    let best: { d: number; ll: LatLng } | null = null;
    for (const r of rings)
      for (const v of r) {
        const q = pxOf(a, v);
        if (!q) continue;
        const d = Math.hypot(q.x - at.x, q.y - at.y);
        if (d <= SNAP_CORNER_PX && (!best || d < best.d)) best = { d, ll: v };
      }
    if (best) return best.ll;
    let edge: { d: number; x: number; y: number } | null = null;
    for (const r of rings)
      for (let i = 0; i < r.length; i++) {
        const A = pxOf(a, r[i]);
        const B = pxOf(a, r[(i + 1) % r.length]);
        if (!A || !B) continue;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const L = dx * dx + dy * dy;
        if (!L) continue;
        const t = Math.max(0, Math.min(1, ((at.x - A.x) * dx + (at.y - A.y) * dy) / L));
        const x = A.x + t * dx;
        const y = A.y + t * dy;
        const d = Math.hypot(x - at.x, y - at.y);
        if (d <= SNAP_EDGE_PX && (!edge || d < edge.d)) edge = { d, x, y };
      }
    if (edge) {
      const q = p.fromContainerPixelToLatLng({ x: edge.x, y: edge.y });
      if (q) return { lat: q.lat(), lng: q.lng() };
    }
    return ll;
  }, []);

  const redrawDraft = React.useCallback((cursor: LatLng | null) => {
    const a = api.current;
    if (!a) return;
    const p = pts.current;
    a.draftLine.setPath(p);
    a.firstDot.setPosition(p[0] ?? null);
    a.firstDot.setVisible(p.length >= 3);
    const last = p[p.length - 1];
    a.rubber.setPath(cursor && last ? (p.length >= 2 ? [last, cursor, p[0]] : [last, cursor]) : []);
    const chip = chipRef.current;
    if (!chip) return;
    if (!cursor || !last) {
      chip.style.display = "none";
      return;
    }
    const seg = pathFt([last, cursor], false);
    const area = p.length >= 2 ? ringSqft([...p, cursor]) : 0;
    chip.textContent = area ? `${fmt(seg)} ft · ${fmt(area)} sq ft` : `${fmt(seg)} ft`;
    chip.style.display = "";
  }, []);

  const finish = React.useCallback(() => {
    const p = pts.current;
    const t = live.current.tool;
    if (p.length >= 3 && t && t !== "wand") live.current.onClose(t, p.slice());
    pts.current = [];
    setNpts(0);
    redrawDraft(null);
  }, [redrawDraft]);
  const cancel = React.useCallback(() => {
    pts.current = [];
    setNpts(0);
    redrawDraft(null);
  }, [redrawDraft]);
  const undoPoint = React.useCallback(() => {
    pts.current = pts.current.slice(0, -1);
    setNpts(pts.current.length);
    redrawDraft(null);
  }, [redrawDraft]);

  // The map, once.
  React.useEffect(() => {
    if (!isMapsBrowserEnabled()) {
      live.current.onUnavailable();
      return;
    }
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    (async () => {
      try {
        const [maps, core, markerLib] = await Promise.all([loadMapsLibrary<GMaps>("maps"), loadMapsLibrary<GMaps>("core"), loadMapsLibrary<GMaps>("marker")]);
        if (cancelled || !mountRef.current) return;
        const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
        const map = new maps.Map(mountRef.current, {
          center,
          zoom: 20,
          maxZoom: 22,
          mapTypeId: "satellite",
          tilt: 0,
          heading: 0,
          rotateControl: false,
          // On a phone one finger scrolls the page and taps put corners down; two fingers move the map.
          gestureHandling: coarse ? "cooperative" : "greedy",
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: true,
          keyboardShortcuts: false,
          // A double-click finishes a shape here; Google's double-click zoom would fight it.
          disableDoubleClickZoom: true,
          clickableIcons: false,
        });
        if (frame) map.fitBounds(frame, 24);
        // The lot line: a dark casing and a dashed light line, never in the way of a click.
        const lot = [...lotRing, lotRing[0]].filter(Boolean);
        new maps.Polyline({ map, path: lot, clickable: false, strokeColor: "#000000", strokeOpacity: 0.45, strokeWeight: 4, zIndex: Z.lot });
        new maps.Polyline({ map, path: lot, clickable: false, strokeOpacity: 0, zIndex: Z.lot + 1, icons: [{ icon: { path: "M 0,-1 0,1", strokeColor: "#fbcfe8", strokeOpacity: 1, strokeWeight: 2, scale: 3 }, offset: "0", repeat: "11px" }] });
        // The shape being drawn: its sides so far, a dashed rubber band to the pointer and back to the start, and a
        // ring on the first corner to close on.
        const draftLine = new maps.Polyline({ map, clickable: false, strokeColor: "#ffffff", strokeOpacity: 1, strokeWeight: 2.5, zIndex: Z.draft });
        const rubber = new maps.Polyline({ map, clickable: false, strokeOpacity: 0, zIndex: Z.draft, icons: [{ icon: { path: "M 0,-1 0,1", strokeColor: "#ffffff", strokeOpacity: 0.95, strokeWeight: 2, scale: 3 }, offset: "0", repeat: "10px" }] });
        const firstDot = new markerLib.Marker({ map, clickable: false, visible: false, zIndex: Z.draft + 1, icon: { path: 0, scale: 7, fillColor: "#ffffff", fillOpacity: 1, strokeColor: "#0f172a", strokeWeight: 2 } });
        // Where a corner will land when it snaps onto a shape or the lot line.
        const snapDot = new markerLib.Marker({ map, clickable: false, visible: false, zIndex: Z.draft + 2, icon: { path: 0, scale: 6, fillOpacity: 0, strokeColor: "#22d3ee", strokeWeight: 3 } });
        // A projection for snapping and a pane for the labels.
        const overlay = new maps.OverlayView();
        overlay.onAdd = () => {
          const host = document.createElement("div");
          host.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;pointer-events:none";
          overlay.getPanes()?.floatPane?.appendChild(host);
          if (api.current) api.current.labelHost = host;
          setLabelPane(true);
          overlay.draw();
        };
        overlay.draw = () => placeLabels(api.current, labels.current);
        overlay.onRemove = () => api.current?.labelHost?.remove();
        api.current = { maps, map, LatLng: core.LatLng, overlay, ground: null, labelHost: null, polys: new Map(), draftLine, rubber, firstDot, snapDot };
        overlay.setMap(map);
        const ll = (e: GMaps): LatLng => ({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        cleanups.push(
          map.addListener("click", (e: GMaps) => {
            const t = live.current.tool;
            if (!t) {
              live.current.onSelect(null);
              return;
            }
            if (t === "wand") {
              live.current.onWand(ll(e));
              return;
            }
            const at = snap(ll(e));
            const p = pts.current;
            const a = pxOf(api.current, at);
            if (p.length >= 3 && a) {
              const f = pxOf(api.current, p[0]);
              if (f && Math.hypot(f.x - a.x, f.y - a.y) <= CLOSE_PX) {
                finish();
                return;
              }
            }
            const lastPx = p.length ? pxOf(api.current, p[p.length - 1]) : null;
            if (lastPx && a && Math.hypot(lastPx.x - a.x, lastPx.y - a.y) < 3) return;
            pts.current = [...p, at];
            setNpts(pts.current.length);
            redrawDraft(at);
          }).remove,
          map.addListener("dblclick", () => {
            if (live.current.tool && live.current.tool !== "wand") finish();
          }).remove,
          map.addListener("mousemove", (e: GMaps) => {
            const t = live.current.tool;
            const chip = chipRef.current;
            const raw = ll(e);
            const at = t && t !== "wand" ? snap(raw) : raw;
            snapDot.setVisible(at !== raw);
            if (at !== raw) snapDot.setPosition(at);
            if (!t || t === "wand" || !pts.current.length) {
              if (chip) chip.style.display = "none";
              return;
            }
            redrawDraft(at);
            const wrap = wrapRef.current;
            if (chip && wrap && e.domEvent) {
              const r = wrap.getBoundingClientRect();
              chip.style.left = `${e.domEvent.clientX - r.left + 14}px`;
              chip.style.top = `${e.domEvent.clientY - r.top + 14}px`;
            }
          }).remove,
          map.addListener("mouseout", () => {
            if (chipRef.current) chipRef.current.style.display = "none";
            snapDot.setVisible(false);
          }).remove,
        );
        setReady(true);
      } catch {
        if (!cancelled) live.current.onUnavailable();
      }
    })();
    return () => {
      cancelled = true;
      for (const c of cleanups) c();
      const a = api.current;
      if (a) {
        for (const p of a.polys.values()) p.poly.setMap(null);
        a.overlay.setMap(null);
      }
      api.current = null;
    };
    // The map is built once per property (the host keys it by the read); the rest follows in the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The labels: each shape's name and size at the point inside it farthest from its edges.
  React.useEffect(() => {
    const a = api.current;
    if (!ready || !labelPane || !a?.labelHost) return;
    const host = a.labelHost;
    host.textContent = "";
    labels.current = shapes.map((sh) => {
      const el = document.createElement("div");
      el.className = `${s.mapLabel} ${sh.kind === "bed" ? s.mapLabelBed : sh.kind === "cut" ? s.mapLabelCut : ""} ${sh.id === selected ? s.mapLabelOn : ""}`;
      el.textContent = `${sh.name} · ${fmt(sqftOf[sh.id] ?? ringSqft(sh.ring))} sq ft`;
      host.appendChild(el);
      // A lawn's label keeps clear of the beds and cut-outs drawn in it.
      const holes = sh.kind === "lawn" ? shapes.filter((x) => x.kind !== "lawn").map((x) => x.ring) : [];
      return { id: sh.id, at: labelPoint(sh.ring, holes), el, sqft: sqftOf[sh.id] ?? 0 };
    });
    placeLabels(a, labels.current);
  }, [ready, labelPane, shapes, sqftOf, selected]);

  // The shapes: one polygon each, kept in step with the list; the selected one editable.
  React.useEffect(() => {
    const a = api.current;
    if (!ready || !a) return;
    const seen = new Set<string>();
    syncing.current = true;
    for (const sh of shapes) {
      seen.add(sh.id);
      const st = SHAPE_STYLE[sh.kind];
      const on = sh.id === selected;
      const opts = {
        fillColor: st.fill,
        fillOpacity: on ? st.fillOpacity + 0.12 : st.fillOpacity,
        strokeColor: on ? "#ffffff" : st.line,
        strokeOpacity: 1,
        strokeWeight: on ? 3 : 2,
        zIndex: on ? Z.selected : Z[sh.kind],
        clickable: !tool,
        editable: on && !tool,
      };
      let rec = a.polys.get(sh.id);
      if (!rec) {
        const poly = new a.maps.Polygon({ map: a.map, paths: sh.ring, ...opts });
        const id = sh.id;
        const emit = () => {
          if (syncing.current) return;
          const path = poly.getPath();
          const ring: LatLng[] = [];
          for (let i = 0; i < path.getLength(); i++) {
            const q = path.getAt(i);
            ring.push({ lat: q.lat(), lng: q.lng() });
          }
          live.current.onEdit(id, ring);
        };
        const path = poly.getPath();
        const listeners = [
          poly.addListener("click", () => live.current.onSelect(id)),
          poly.addListener("rightclick", (e: GMaps) => {
            const p = poly.getPath();
            if (e.vertex != null && p.getLength() > 3) p.removeAt(e.vertex);
          }),
          path.addListener("set_at", emit),
          path.addListener("insert_at", emit),
          path.addListener("remove_at", emit),
        ];
        rec = { poly, kind: sh.kind, listeners };
        a.polys.set(sh.id, rec);
      } else {
        const path = rec.poly.getPath();
        const cur: LatLng[] = [];
        for (let i = 0; i < path.getLength(); i++) cur.push({ lat: path.getAt(i).lat(), lng: path.getAt(i).lng() });
        if (!sameRing(cur, sh.ring)) {
          // A new path object: the old one's listeners go with it, so they're re-attached.
          for (const l of rec.listeners.slice(2)) l.remove();
          rec.poly.setPath(sh.ring);
          const np = rec.poly.getPath();
          const id = sh.id;
          const emit = () => {
            if (syncing.current) return;
            const ring: LatLng[] = [];
            for (let i = 0; i < np.getLength(); i++) ring.push({ lat: np.getAt(i).lat(), lng: np.getAt(i).lng() });
            live.current.onEdit(id, ring);
          };
          rec.listeners = [rec.listeners[0], rec.listeners[1], np.addListener("set_at", emit), np.addListener("insert_at", emit), np.addListener("remove_at", emit)];
        }
        rec.kind = sh.kind;
        rec.poly.setOptions(opts);
      }
    }
    for (const [id, rec] of a.polys) {
      if (seen.has(id)) continue;
      for (const l of rec.listeners) l.remove();
      rec.poly.setMap(null);
      a.polys.delete(id);
    }
    syncing.current = false;
  }, [ready, shapes, selected, tool]);

  // The tool: a crosshair to draw with; a shape half drawn is dropped when the tool changes.
  React.useEffect(() => {
    const a = api.current;
    if (!ready || !a) return;
    a.map.setOptions({ draggableCursor: tool ? "crosshair" : null });
    a.snapDot.setVisible(false);
    pts.current = [];
    setNpts(0);
    redrawDraft(null);
  }, [ready, tool, redrawDraft]);

  // Keys while drawing: Enter finishes, Backspace takes the last corner back, Escape drops the shape.
  React.useEffect(() => {
    if (!tool || tool === "wand") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "Enter") finish();
      else if (e.key === "Escape") cancel();
      else if (e.key === "Backspace" && pts.current.length) {
        e.preventDefault();
        undoPoint();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, finish, cancel, undoPoint]);

  // The USDA photo over the satellite, on request.
  React.useEffect(() => {
    const a = api.current;
    if (!ready || !a || !usda) return;
    if (!a.ground) a.ground = new a.maps.GroundOverlay(usda.url, usda.bounds, { clickable: false, opacity: 1 });
    a.ground.setMap(imagery === "usda" ? a.map : null);
  }, [ready, imagery, usda]);

  return (
    <div className={s.drawWrap} ref={wrapRef} data-lawn-draw-map>
      <div ref={mountRef} className={s.drawMap} />
      <div ref={chipRef} className={s.drawChip} style={{ display: "none" }} />
      {tool && tool !== "wand" && npts > 0 ? (
        <div className={s.drawBar} data-lawn-draw-bar>
          <span className={s.mono}>{npts} corner{npts === 1 ? "" : "s"}</span>
          <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnPrimary}`} onClick={finish} disabled={npts < 3} data-lawn-draw-finish>
            Finish
          </button>
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={undoPoint} data-lawn-draw-back>
            Back a corner
          </button>
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={cancel}>
            Cancel
          </button>
        </div>
      ) : null}
      {!ready ? <div className={s.mapAttr} style={{ left: 6, right: "auto", top: 6, bottom: "auto" }}>Loading the satellite photo…</div> : null}
      {imagery === "usda" ? <div className={s.mapAttr}>USDA NAIP aerial over Google</div> : null}
    </div>
  );
}

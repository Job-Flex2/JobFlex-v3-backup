"use client";
// Satellite draw surface. Uses an EDITABLE google.maps.Polyline so vertex drag
// and midpoint-insert come for free; we only translate the path to/from local
// feet and push commits to the studio store (debounced to one frame so a drag
// doesn't thrash the 3D rebuild). The store stays the source of truth in feet.
//
// Beyond drawing the run, this surface also:
//   • shows a satellite view immediately (a default lot) so the page is never blank,
//   • uses a crosshair cursor + a live "segment / total" chip that trails the pointer,
//   • rubber-bands a preview line from the last dot to the cursor while tracing,
//   • hosts the Add gate / Add door tools; a click drops the armed opening — snapping
//     onto a run only when it lands very close, otherwise placing it free,
//   • renders each opening as draggable markers (centre = move; attached gates also
//     get two edge handles to set the width).
import * as React from "react";
import { Move, Spline, Trash2, Undo2, DoorOpen, DoorClosed, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { loadMapsLibrary, isMapsBrowserEnabled } from "@/lib/googleMaps";
import { latLngToLocalFeet, localFeetToLatLng, type LatLng } from "./mapProjection";
import type { TopoOverlay } from "./fenceTopo";
import { ringAreaSqFt, ringEdges, snapToTargets, type Seg } from "./fenceHouse";
import {
  GATE_VARIANTS,
  DOOR_VARIANTS,
  VARIANT_LABEL,
  presetWidthFt,
  variantLabel,
  type PathPoint,
  type GateSpec,
  type OpeningKind,
  type CustomOpening,
} from "./fenceTypes";
import type { ArmedOpening } from "@/stores/useFenceStudioStore";

// Defaults only. The colours are props (see FenceDrawMapProps) so a host with a
// different design system passes its own tokens instead of inheriting the sage
// studio's literals — the blueprint Fence studio passes --blueprint / --muted.
const DEFAULT_ACCENT = "#1f7a52"; // Pressed Sage (locked accent) for the drawn line
const DEFAULT_DOOR_INK = "#5a6473"; // cool-ink-muted — doors read neutral vs the sage gate
// Surveyed property line (redrawn 2026-09-20, owner's remark: the emerald
// dashes on a glowing casing were "not JobFlex"). Now a drawing-office line:
// a thin solid core in the host's colour on half a px of ink either side —
// the edge is what keeps it legible on bright concrete and dark tree cover,
// with no blur and no glow — a faint tint over the lot, and a 6 px paper
// SQUARE on each real corner (the point a dot is snapping to fills with the
// active colour; a surveyed point that is not a corner shows only then). The
// width follows the zoom (parcelWeights) and never passes 3 px. A ring that
// is not closed is drawn dashed; a closed lot is solid. The geometry is
// untouched.
export interface ParcelPalette {
  /** The line itself, and the corner squares' stroke. */
  line: string;
  /** The 1 px edge either side of the line, and under each square. */
  casing: string;
  /** Corner square fill (paper). */
  dot: string;
  /** The side under the cursor in the host's list, and the corner about to be snapped to. */
  active: string;
}
const DEFAULT_PARCEL: ParcelPalette = { line: "#4a9eff", casing: "#0a0a0a", dot: "#ffffff", active: "#1854a0" };
/** The lot line at this zoom: a hairline when the lot is small on screen, never
 *  thicker than 3 px with its ink edge (owner, 2026-09-20: "the line is fat"). */
const parcelWeights = (zoom: number | undefined) =>
  typeof zoom !== "number" || zoom >= 20 ? { core: 2, edge: 0.5 } : zoom >= 19 ? { core: 1.5, edge: 0.5 } : { core: 1, edge: 0 };
// The house outline (redrawn 2026-09-20, owner's remark: the white line was
// pale on the photo). A drawing-office building: an ink core on a 1 px paper
// edge either side — dark line, light halo, legible on grass, roof and
// asphalt alike — no glow, no fill; the second candidate hatches the inside
// diagonally in faint ink, the way a plan marks a structure. The house is a
// secondary layer: thinner and quieter than the lot line, and at zoom 18 or
// below it thins to a bare 1 px. No corner markers outside the House tool;
// the wall a fence dot is about to snap to lights up in the active colour
// for as long as the snap holds. Detected footprints (OSM / Regrid) take the
// same colours, lighter, with no hatch.
export interface HousePalette {
  /** The core, and the hatch lines. */
  line: string;
  /** The 1 px edge either side of the core. */
  edge: string;
  /** The wall a fence dot is snapping to. */
  active: string;
  /** Variant 2: diagonal hatching inside a traced house. */
  hatched: boolean;
  /** A tint over a traced house (empty = none), so the drawn house reads as
   *  an area in its own colour, apart from the fence (2026-09-27). */
  fill: string;
  fillOpacity: number;
}
const DEFAULT_HOUSE: HousePalette = { line: "#0a0a0a", edge: "#ffffff", active: "#1854a0", hatched: false, fill: "", fillOpacity: 0 };

/** The drawn fence (2026-09-28, owner: "when I draw the fence lines, show
 *  them in a different colour — it's hard to see if it's been drawn or
 *  not"). A core in its own colour on a CASING either side, so the line
 *  reads on grass, roof, concrete and shadow alike; a dot at every placed
 *  corner in the same pairing; and the rubber band to the cursor dashed in
 *  the core colour, so what is drawn (solid) and what is not yet (dashed)
 *  never look the same. An empty casing is the old single line. */
export interface FencePalette {
  /** The line itself. */
  line: string;
  /** The edge either side of it (empty = none). */
  casing: string;
  /** A placed corner's fill … */
  dot: string;
  /** … and its ring. */
  dotRing: string;
}
/** Core width and casing width of the fence line at this zoom. */
const fenceWeights = (zoom: number | undefined) =>
  typeof zoom === "number" && zoom <= 17 ? { core: 2, casing: 1 } : { core: 3, casing: 1.5 };
/** Core width and edge width of the house line at this zoom. */
const houseWeights = (zoom: number | undefined) =>
  typeof zoom === "number" && zoom <= 18 ? { core: 1, edge: 0 } : { core: 1.5, edge: 1 };
/** The hatch: a paper line on a 1 px ink bed every 8 px, at 45° — ink alone
 *  vanished on a dark roof, paper alone on a light one. */
const HATCH_STEP_PX = 8;
const HATCH_OVER_OPACITY = 0.55;
const HATCH_UNDER_OPACITY = 0.3;

/** Corner squares this close on screen collapse into one on a curve. */
const CORNER_MIN_PX = 14;
/** A turn sharper than this is a real corner and always keeps its square. */
const CORNER_KEEP_DEG = 28;
/** The corner square: 6 px, centred. */
const CORNER_SQUARE = "M -3,-3 L 3,-3 L 3,3 L -3,3 Z";
// A real residential lot that is inside the Regrid free-trial coverage, so the map
// is never blank and the sample "Load Property Lines" works out of the box.
const DEFAULT_CENTER: LatLng = { lat: 32.834967, lng: -96.563861 };
const SNAP_ON_FT = 5; // only magnet an opening onto a run when it lands this close

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GMaps = any;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

// Nearest fence segment to a point (local feet) with the clamped position along it.
function nearestSegment(p: PathPoint, pts: PathPoint[]): { i: number; t: number; dist: number } | null {
  let best: { i: number; t: number; dist: number } | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (b.gap) continue; // run break — openings can't sit on the invisible connector
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) continue;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = clamp(t, 0, 1);
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (!best || d < best.dist) best = { i, t, dist: d };
  }
  return best;
}

// Shift the centre so a `widthFt` opening sits FULLY on segment `i` near `tRaw`
// (one end against the fence, the rest extending inward) rather than being centred
// on the click and clamped — which stacks all the dots at a corner.
function fitCenterT(i: number, tRaw: number, pts: PathPoint[], widthFt: number): number {
  const a = pts[i];
  const b = pts[i + 1];
  const segLen = Math.hypot(b.x - a.x, b.y - a.y);
  if (segLen < 1e-6) return 0.5;
  const w = Math.min(widthFt, segLen);
  return clamp(tRaw * segLen, w / 2, segLen - w / 2) / segLen;
}

/**
 * The imperative handle the surface exposes to whoever hosts it. The sage studio
 * drives it from the surface's own toolbar; a host that renders its OWN toolbar
 * (the blueprint Fence studio) takes it through `onApi` and drives it from there.
 */
export type FenceDrawMapApi = {
  clear: () => void;
  closeLoop: () => void;
  undo: () => void;
  setFromPoints: () => void;
  setAlign: (on: boolean) => void;
  syncOpenings: () => void;
  refreshCursor: () => void;
  hideGhost: () => void;
  zoomBy: (delta: number) => void;
  /** The host changed the surface's size (full-screen stage): re-lay the
   *  tiles and keep the same centre — Maps anchors a resize at the top-left. */
  resized: () => void;
  /** Finish what is being traced: stop the fence run, or close the house outline. */
  finishDraft: () => void;
  /** Take back the last dot of the fence run or the last house corner. */
  undoDraft: () => void;
  /** Drop an unfinished house outline / stop the fence run. */
  cancelDraft: () => void;
  /** House tool on/off (the `houseMode` prop drives it). */
  setHouseMode: (on: boolean) => void;
  /** Put a closed outline back on the surface as the draft being traced
   *  (its corners, the tool armed) — the host's Undo after an outline closed
   *  by mistake. The host removes the house itself. */
  openHouseDraft: (ring: PathPoint[]) => void;
};

/** What is being traced right now, for a host that renders its own controls. */
export interface DraftState {
  /** A fence run is following the cursor. */
  fence: boolean;
  /** Corners placed on an unfinished house outline (0 = none). */
  houseCorners: number;
}

export type FenceDrawMapProps = {
  lat?: number;
  lng?: number;
  points: PathPoint[];
  onChange: (pts: PathPoint[]) => void;
  revision?: number; // bump to re-seed the polyline from `points` (parcel load / reset)
  className?: string;
  gates: GateSpec[];
  armed: ArmedOpening | null;
  customOpenings: CustomOpening[]; // user-created gate/door types (shown in the pickers)
  onArm: (kind: OpeningKind, variant: string) => void; // Add gate/door tools (on the map)
  onDropOpening: (segmentIndex: number, t: number, x?: number, y?: number) => void;
  onUpdateGate: (id: string, patch: Partial<GateSpec>) => void; // marker drag → move/resize
  onDisarm: () => void; // Esc / click-in-empty cancels the armed tool
  /**
   * Render the surface's own chrome — the Align/Close loop/Undo/Clear row, the
   * Gate/Door pickers, the hint pill and Google's zoom control. Default true.
   * A host with its own toolbar passes false and drives `onApi` instead, so the
   * two never stack on the same corner of the same map.
   */
  chrome?: boolean;
  /** Handed the api once the map is live, and null when it is torn down. */
  onApi?: (api: FenceDrawMapApi | null) => void;
  /** Drawn-line / gate colour. Defaults to the sage studio's accent. */
  accentColor?: string;
  /** Door marker colour (reads neutral against the gate colour). */
  doorColor?: string;
  /**
   * Cadastral parcel overlay (ReportAll): the lot's outer ring drawn as a
   * translucent fill under the trace, plus `highlight` — the vertex path of the
   * side under the cursor in the host's sides list. A path rather than an index
   * because one listed side can span several surveyed segments (see
   * lib/parcels groupSides). Display only: the polygon is not clickable and
   * never enters the trace.
   *
   * `rings` is the whole PROPERTY when it is recorded as more than one lot (two
   * adjoining deeds bought together). Every ring is drawn; `ring` stays as the
   * subject lot for hosts that only ever have one.
   */
  parcel?: { ring: LatLng[]; rings?: LatLng[][]; highlight?: LatLng[] | null } | null;
  /** Raster parcel-boundary tiles (proxied ReportAll layer, zoom 14–21). */
  parcelTiles?: boolean;
  /** Host colours for the property line (Maps needs literal colour strings). */
  parcelPalette?: Partial<ParcelPalette>;
  /** Host colours for house outlines and detected footprints. */
  housePalette?: Partial<HousePalette>;
  /** Host colours for the drawn fence (core on a casing, corner dots). */
  fencePalette?: Partial<FencePalette>;
  /**
   * Measured slope per NON-LEVEL traced segment (fenceTerrain classes). Each
   * entry recolours its segment on the map — amber for racked, red for
   * stepped — and a click on the coloured line answers with the slope and the
   * rise. Level segments stay the accent colour and are not listed here.
   */
  terrain?: TerrainSegView[] | null;
  /**
   * Lot topography (fenceTopo): contour lines drawn on the land — the lot's
   * own lines strong with a dark casing so they read on grass, roof and
   * asphalt alike, the neighbours' faint — elevation labels along the lines
   * ("+4 ft" above the lot's low point), and HIGH / LOW marks. Display only:
   * nothing here is clickable, so tracing and placement clicks pass through.
   */
  topo?: TopoOverlay | null;
  /** Host colours for the topo layer (Maps needs literal colour strings). */
  topoPalette?: Partial<TopoPalette>;
  /** Padding for the one-time fit to a new lot, px — a host that lays a plate
   *  over a corner of the map passes more room on that side. Default 48. */
  fitPadding?: number | { top: number; right: number; bottom: number; left: number };
  /** Footprints found for the site (OSM / Regrid): drawn faint, and snap targets. */
  detectedBuildings?: LatLng[][];
  /** House outlines the user traced. Editable while `houseMode` is on. */
  houses?: Array<{ id: string; ring: LatLng[]; label: string }>;
  /** House tool: clicks trace a house outline instead of a fence run. */
  houseMode?: boolean;
  /** A traced outline was closed (local feet). */
  onHouseAdd?: (ring: PathPoint[]) => void;
  /** A traced outline's corner was dragged, or the whole outline was moved (local feet). */
  onHouseChange?: (id: string, ring: PathPoint[]) => void;
  /** A detected footprint was dragged: the contractor lining the source data
   *  up with the photo. The host moves EVERY detected footprint by this much
   *  (local feet, east / north) — the offset of a data source is site-wide. */
  onDetectedShift?: (dx: number, dy: number) => void;
  /** The outline being edited (a traced house's id, "det:<n>" for a detected
   *  footprint), or null. The host owns it: its "Edit house" button sets it,
   *  its "Done" clears it. While set, that outline drags whole and — a traced
   *  one — shows its corner handles. */
  houseEdit?: string | null;
  /** The surface asks for an outline to be edited (a long press on its line)
   *  or put down (Escape). A plain click or tap never does: it is a fence dot. */
  onHouseSelect?: (key: string | null) => void;
  /** Backspace / Delete on the outline being edited: the host removes it. */
  onHouseRemove?: (id: string) => void;
  /** Run ends fixed to a house wall — labelled on the map. */
  wallMounts?: LatLng[];
  /** What is being traced, whenever it changes. */
  onDraftChange?: (state: DraftState) => void;
  /** A dot was placed with the touch reticle (hold, drag, release) — the host
   *  retires its one-time "hold, then drag to aim" hint. */
  onTouchAim?: () => void;
};

export interface TopoPalette {
  /** Minor contour. */
  line: string;
  /** Index contour, every fifth interval. */
  major: string;
  /** The dark stroke under a lot line that separates it from the photo. */
  casing: string;
  /** Label text. */
  ink: string;
  /** Label ground. */
  paper: string;
  /** Label face — the annotation (mono) face. */
  font: string;
}

const DEFAULT_TOPO: TopoPalette = {
  line: "#fff7df",
  major: "#f3e7c2",
  casing: "#0a0a0a",
  ink: "#0a0a0a",
  paper: "rgba(242, 240, 235, 0.94)",
  font: "'JetBrains Mono', ui-monospace, monospace",
};

/** One non-level segment's slope facts, for the overlay and its click card. */
export interface TerrainSegView {
  seg: number; // segment = points[seg] → points[seg + 1]
  cls: "racked" | "stepped";
  thetaDeg: number;
  riseFt: number;
  gradeFt: number;
  steps?: number;
  stepDropFt?: number;
}

const RACKED_COLOR = "#c47f17"; // amber — panels rack to follow the grade
const STEPPED_COLOR = "#b3261e"; // red — panels must stair-step

// Stacking, bottom to top, in one place so a new layer cannot land between two
// others by accident. Contours lie ON the lot's tint but UNDER its blue
// property line; the fence sits over the land and the line it follows; slope
// recolouring sits over the fence it describes.
const Z = {
  parcelTint: 1,
  topoCasing: 2,
  topo: 3,
  parcelCasing: 5,
  parcelLine: 6,
  house: 7,
  fenceCasing: 7.5,
  fence: 8,
  highlight: 9,
  terrain: 9,
  preview: 10,
  ghost: 11,
} as const;

/** One text label pinned to the ground. */
/** The label layer's stacking in the marker pane: over the dots, under the handles. */
const LABEL_Z = 28;

interface MapLabel {
  at: LatLng;
  text: string;
  /** Screen rotation, degrees clockwise. */
  angleDeg?: number;
  style: Partial<CSSStyleDeclaration>;
  /** Higher wins a collision. */
  priority: number;
  /** Hidden below this map zoom. */
  minZoom: number;
  /** Sit just above the point — or just below when that spot is taken —
   *  instead of on it, so a chip does not hide its line and a mark does not
   *  hide the corner it names. Contour labels belong ON their line. */
  lift?: boolean;
}

/**
 * Diagonal hatching inside rings — variant 2 of the house outline. One SVG
 * in the overlay pane (under the lines and the markers), the rings drawn as
 * paths and filled with a 45° pattern of `color` lines, HATCH_STEP_PX apart in
 * SCREEN pixels whatever the zoom (userSpaceOnUse). Re-projected on every
 * draw. Returns the teardown.
 */
function mountHatchLayer(maps: GMaps, map: GMaps, rings: LatLng[][], over: string, under: string): () => void {
  const g = (window as unknown as { google?: GMaps }).google;
  const LatLngCtor = g?.maps?.LatLng;
  if (!LatLngCtor || !rings.length) return () => {};
  const NS = "http://www.w3.org/2000/svg";
  const id = `jf-house-hatch-${Math.random().toString(36).slice(2, 8)}`;
  const layer = new maps.OverlayView();
  let svg: SVGSVGElement | null = null;
  let paths: SVGPathElement[] = [];
  layer.onAdd = () => {
    svg = document.createElementNS(NS, "svg");
    svg.setAttribute("style", "position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none");
    const defs = document.createElementNS(NS, "defs");
    const pattern = document.createElementNS(NS, "pattern");
    pattern.setAttribute("id", id);
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    pattern.setAttribute("width", String(HATCH_STEP_PX));
    pattern.setAttribute("height", String(HATCH_STEP_PX));
    pattern.setAttribute("patternTransform", "rotate(45)");
    for (const [stroke, width, opacity] of [[under, "3", HATCH_UNDER_OPACITY], [over, "1", HATCH_OVER_OPACITY]] as const) {
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", "2");
      line.setAttribute("y1", "0");
      line.setAttribute("x2", "2");
      line.setAttribute("y2", String(HATCH_STEP_PX));
      line.setAttribute("stroke", stroke);
      line.setAttribute("stroke-width", width);
      line.setAttribute("stroke-opacity", String(opacity));
      pattern.appendChild(line);
    }
    defs.appendChild(pattern);
    svg.appendChild(defs);
    paths = rings.map(() => {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("fill", `url(#${id})`);
      p.setAttribute("stroke", "none");
      svg!.appendChild(p);
      return p;
    });
    layer.getPanes()?.overlayLayer?.appendChild(svg);
  };
  layer.draw = () => {
    const proj = layer.getProjection();
    if (!proj || !svg) return;
    rings.forEach((ring, i) => {
      const d = ring
        .map((q, k) => {
          const px = proj.fromLatLngToDivPixel(new LatLngCtor(q.lat, q.lng));
          return `${k ? "L" : "M"}${px.x.toFixed(1)} ${px.y.toFixed(1)}`;
        })
        .join(" ");
      paths[i]?.setAttribute("d", d + " Z");
    });
  };
  layer.onRemove = () => {
    svg?.remove();
    svg = null;
    paths = [];
  };
  layer.setMap(map);
  return () => layer.setMap(null);
}

/**
 * A DOM label layer on the map (an OverlayView in the marker pane — above the
 * lines, pointer-events off, so clicks still reach the map and the fence).
 * Every redraw (pan, zoom) re-projects the labels and hides any that would
 * overlap a higher-priority one at THIS zoom, so zooming out thins the labels
 * instead of piling them up. Returns the teardown.
 */
function mountLabelLayer(maps: GMaps, map: GMaps, items: MapLabel[], zIndex: number, avoid: LatLng[] = []): () => void {
  const g = (window as unknown as { google?: GMaps }).google;
  const LatLngCtor = g?.maps?.LatLng;
  if (!LatLngCtor || !items.length) return () => {};
  const nodes = [...items]
    .sort((a, b) => b.priority - a.priority)
    .map((it) => ({ it, el: null as HTMLDivElement | null, ll: new LatLngCtor(it.at.lat, it.at.lng), w: 0, h: 0 }));
  const avoidLl = avoid.map((q) => new LatLngCtor(q.lat, q.lng));
  const layer = new maps.OverlayView();
  let host: HTMLDivElement | null = null;
  layer.onAdd = () => {
    host = document.createElement("div");
    host.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:${zIndex}`;
    for (const n of nodes) {
      const el = document.createElement("div");
      el.textContent = n.it.text;
      Object.assign(
        el.style,
        { position: "absolute", left: "0", top: "0", whiteSpace: "nowrap", transformOrigin: "0 0", pointerEvents: "none" },
        n.it.style,
      );
      host.appendChild(el);
      n.el = el;
    }
    layer.getPanes()?.markerLayer?.appendChild(host);
  };
  layer.draw = () => {
    const proj = layer.getProjection();
    if (!proj || !host) return;
    const zoom = Number(map.getZoom()) || 0;
    const taken: Array<[number, number, number, number]> = [];
    // The fence's corner dots: a lifted chip takes the side of its point
    // where no dot sits ("WALL MOUNT" read "W··L MOUNT" under two of them).
    const dots: Array<[number, number, number, number]> = [];
    for (const ll of avoidLl) {
      const q = proj.fromLatLngToDivPixel(ll);
      if (q) dots.push([q.x - 7, q.y - 7, q.x + 7, q.y + 7]);
    }
    for (const n of nodes) {
      const el = n.el;
      if (!el) continue;
      const px = proj.fromLatLngToDivPixel(n.ll);
      if (!px || zoom < n.it.minZoom) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "";
      if (!n.w) {
        n.w = el.offsetWidth;
        n.h = el.offsetHeight;
      }
      const deg = n.it.angleDeg ?? 0;
      const a = (deg * Math.PI) / 180;
      const bw = Math.abs(n.w * Math.cos(a)) + Math.abs(n.h * Math.sin(a));
      const bh = Math.abs(n.w * Math.sin(a)) + Math.abs(n.h * Math.cos(a));
      const off = bh / 2 + 10;
      const tries = n.it.lift ? [-off, off] : [0];
      const hits = (box: [number, number, number, number], list: Array<[number, number, number, number]>) =>
        list.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1]);
      let placedAt: number | null = null;
      // Over a dot is still better than no chip: the layer sits above the dots.
      let overDot: { cy: number; box: [number, number, number, number] } | null = null;
      for (const dy of tries) {
        const cy = px.y + dy;
        const box: [number, number, number, number] = [px.x - bw / 2 - 3, cy - bh / 2 - 3, px.x + bw / 2 + 3, cy + bh / 2 + 3];
        if (hits(box, taken)) continue;
        if (n.it.lift && hits(box, dots)) {
          overDot ??= { cy, box };
          continue;
        }
        taken.push(box);
        placedAt = cy;
        break;
      }
      if (placedAt === null && overDot) {
        taken.push(overDot.box);
        placedAt = overDot.cy;
      }
      if (placedAt === null) {
        el.style.display = "none";
        continue;
      }
      el.style.transform = `translate(${px.x}px, ${placedAt}px) rotate(${deg}deg) translate(-50%, -50%)`;
    }
  };
  layer.onRemove = () => {
    host?.remove();
    host = null;
  };
  layer.setMap(map);
  return () => layer.setMap(null);
}

export function FenceDrawMap({
  lat,
  lng,
  points,
  onChange,
  revision,
  className,
  gates,
  armed,
  customOpenings,
  onArm,
  onDropOpening,
  onUpdateGate,
  onDisarm,
  chrome = true,
  onApi,
  accentColor = DEFAULT_ACCENT,
  doorColor = DEFAULT_DOOR_INK,
  parcel = null,
  parcelTiles = false,
  terrain = null,
  topo = null,
  topoPalette,
  fitPadding = 48,
  parcelPalette,
  housePalette,
  fencePalette,
  detectedBuildings,
  houses,
  houseMode = false,
  onDetectedShift,
  houseEdit = null,
  onHouseSelect,
  onHouseRemove,
  onTouchAim,
  onHouseAdd,
  onHouseChange,
  wallMounts,
  onDraftChange,
}: FenceDrawMapProps) {
  const mountRef = React.useRef<HTMLDivElement>(null);
  const measureRef = React.useRef<HTMLDivElement>(null);

  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  });
  const pointsRef = React.useRef(points);
  React.useEffect(() => {
    pointsRef.current = points;
  }, [points]);
  const gatesRef = React.useRef(gates);
  React.useEffect(() => {
    gatesRef.current = gates;
  }, [gates]);
  const armedRef = React.useRef(armed);
  React.useEffect(() => {
    armedRef.current = armed;
    // Esc / placement / tool toggle all land here with armed=null — clear the
    // ghost immediately instead of waiting for the next mousemove.
    if (!armed) apiRef.current?.hideGhost();
  }, [armed]);
  const customOpeningsRef = React.useRef(customOpenings);
  React.useEffect(() => {
    customOpeningsRef.current = customOpenings;
  }, [customOpenings]);
  const onDropRef = React.useRef(onDropOpening);
  const onUpdateGateRef = React.useRef(onUpdateGate);
  const onDisarmRef = React.useRef(onDisarm);
  const onApiRef = React.useRef(onApi);
  // Read inside the map-build effect, which deliberately depends only on the
  // origin — routing them through refs keeps that dep list honest (and matches
  // how every other prop that effect touches is already read). Seeded from the
  // mount value, so the first build reads them correctly.
  const chromeRef = React.useRef(chrome);
  const accentRef = React.useRef(accentColor);
  const doorRef = React.useRef(doorColor);
  const topoPaletteRef = React.useRef(topoPalette);
  const fitPaddingRef = React.useRef(fitPadding);
  const parcelPaletteRef = React.useRef(parcelPalette);
  const housePaletteRef = React.useRef(housePalette);
  const fencePaletteRef = React.useRef(fencePalette);
  /** Set by the parcel layer: fills the corner square the snap ring sits on. */
  const parcelActiveRef = React.useRef<((ll: GMaps | null) => void) | null>(null);
  const onHouseAddRef = React.useRef(onHouseAdd);
  const onHouseChangeRef = React.useRef(onHouseChange);
  const onDetectedShiftRef = React.useRef(onDetectedShift);
  const onHouseSelectRef = React.useRef(onHouseSelect);
  const onHouseRemoveRef = React.useRef(onHouseRemove);
  const onTouchAimRef = React.useRef(onTouchAim);
  const aimRef = React.useRef<HTMLDivElement>(null);
  const flashRef = React.useRef<HTMLDivElement>(null);
  /** The outline being edited — the host's `houseEdit`, asked for through
   *  `onHouseSelect`. */
  const selHouseRaw = houseEdit;
  const setSelHouse = (key: string | null) => onHouseSelectRef.current?.(key);
  // An outline that is gone (the layer was hidden, the house deleted) or a
  // House trace in progress puts it down — derived, not a second state.
  const selHouse =
    selHouseRaw &&
    !houseMode &&
    (selHouseRaw.startsWith("det:")
      ? Number(selHouseRaw.slice(4)) < (detectedBuildings?.length ?? 0)
      : (houses ?? []).some((h) => h.id === selHouseRaw))
      ? selHouseRaw
      : null;
  const selHouseRef = React.useRef<string | null>(null);
  const onDraftChangeRef = React.useRef(onDraftChange);
  const houseModeRef = React.useRef(houseMode);
  /** The draw surface's pointer handlers, for overlays that sit on top of it. */
  const drawHandlersRef = React.useRef<{
    click: (e: GMaps) => void;
    move: (e: GMaps) => void;
    dblclick: () => void;
    rightclick: () => void;
    /** True when a click here is the draw surface's: something is being
     *  traced or placed, or the point snaps to a wall, a corner or a line. */
    wantsDraw: (e: GMaps) => boolean;
  } | null>(null);
  // Snap targets from the site (lot lines, traced houses, detected buildings),
  // read by the draw handlers at event time — the build effect never re-runs
  // for them.
  const siteRef = React.useRef<{ parcel: FenceDrawMapProps["parcel"]; houses: FenceDrawMapProps["houses"]; detected: LatLng[][] | undefined }>({
    parcel,
    houses,
    detected: detectedBuildings,
  });
  React.useEffect(() => {
    onDropRef.current = onDropOpening;
    onUpdateGateRef.current = onUpdateGate;
    onDisarmRef.current = onDisarm;
    onApiRef.current = onApi;
    chromeRef.current = chrome;
    accentRef.current = accentColor;
    doorRef.current = doorColor;
    topoPaletteRef.current = topoPalette;
    fitPaddingRef.current = fitPadding;
    parcelPaletteRef.current = parcelPalette;
    housePaletteRef.current = housePalette;
    fencePaletteRef.current = fencePalette;
    onHouseAddRef.current = onHouseAdd;
    onHouseChangeRef.current = onHouseChange;
    onDetectedShiftRef.current = onDetectedShift;
    onHouseSelectRef.current = onHouseSelect;
    onHouseRemoveRef.current = onHouseRemove;
    onTouchAimRef.current = onTouchAim;
    onDraftChangeRef.current = onDraftChange;
    siteRef.current = { parcel, houses, detected: detectedBuildings };
  });

  const apiRef = React.useRef<FenceDrawMapApi | null>(null);
  const fittedRingRef = React.useRef<string | null>(null);

  // The live map + maps library, exposed to the parcel-overlay and tile-layer
  // effects below. `mapEpoch` bumps when a (re)built map lands so those effects
  // re-run against the new instance — the build effect owns the map's life.
  const gmapRef = React.useRef<GMaps | null>(null);
  const mapsLibRef = React.useRef<GMaps | null>(null);
  const [mapEpoch, setMapEpoch] = React.useState(0);

  // Which opening picker menu is open (the pill dropdowns on the map).
  const [openMenu, setOpenMenu] = React.useState<OpeningKind | null>(null);
  const [aligning, setAligning] = React.useState(false);
  const aligningRef = React.useRef(false);
  // `setAlign` owns the whole mode switch (ref + state + polyline options +
  // cursor), so an EXTERNAL toolbar driving the api lands in exactly the same
  // state as this button — previously the ref was flipped out here and an
  // external caller would have left `aligningRef` stale, which is what the
  // click/mousemove handlers read to suppress drawing.
  const toggleAlign = React.useCallback(() => {
    const next = !aligningRef.current;
    if (apiRef.current) {
      apiRef.current.setAlign(next);
      return;
    }
    aligningRef.current = next;
    setAligning(next);
  }, []);

  const firstRev = React.useRef(true);
  React.useEffect(() => {
    if (firstRev.current) {
      firstRev.current = false;
      return;
    }
    apiRef.current?.setFromPoints();
  }, [revision]);

  React.useEffect(() => {
    apiRef.current?.syncOpenings();
  }, [gates, points]);

  React.useEffect(() => {
    houseModeRef.current = houseMode;
    apiRef.current?.setHouseMode(houseMode);
  }, [houseMode, mapEpoch]);

  const enabled = isMapsBrowserEnabled();
  const hasFence = points.length >= 2;

  React.useEffect(() => {
    if (!enabled || !mountRef.current) return;
    let cancelled = false;
    let cleanup = () => {};

    (async () => {
      try {
        const [maps, core, markerLib] = await Promise.all([
          loadMapsLibrary<GMaps>("maps"),
          loadMapsLibrary<GMaps>("core"),
          loadMapsLibrary<GMaps>("marker"),
        ]);
        if (cancelled || !mountRef.current) return;
        const LatLngCtor = core.LatLng;
        const Marker = markerLib.Marker;
        // Host-supplied palette, resolved once per map build.
        const ACCENT = accentRef.current;
        const DOOR_INK = doorRef.current;
        const fpal: FencePalette = { line: ACCENT, casing: "", dot: "#ffffff", dotRing: ACCENT, ...(fencePaletteRef.current ?? {}) };
        // No address yet → open on a real sample lot so the surface is never blank.
        const origin: LatLng = typeof lat === "number" && typeof lng === "number" ? { lat, lng } : DEFAULT_CENTER;
        const map = new maps.Map(mountRef.current, {
          center: origin,
          zoom: 20,
          mapTypeId: "satellite",
          tilt: 0,
          gestureHandling: "greedy",
          disableDefaultUI: true,
          // A host with its own chrome supplies its own zoom buttons; Google's
          // would otherwise sit under them in the same corner.
          zoomControl: chromeRef.current,
          keyboardShortcuts: false,
          // A double-click FINISHES a run or an outline here (FenceScan's
          // gesture); Google's own double-click zoom would fight it.
          disableDoubleClickZoom: true,
          draggableCursor: "crosshair", // signal "you can draw here"
        });
        // The fence is a list of RUNS — each an independent editable polyline, so
        // disconnected fences coexist (store encoding: `gap` on each run's first
        // point). Tracing appends to the ACTIVE run; ending a trace and clicking
        // elsewhere starts a fresh run instead of chaining to the old fence.
        type Run = { line: GMaps; listeners: GMaps[]; casing: GMaps | null; dots: GMaps[] };
        const runs: Run[] = [];
        let activeIdx = -1;

        // Rubber-band preview from the last dot to the cursor: dashed, in the
        // fence colour — what is not yet drawn never looks like what is.
        const previewLine = new maps.Polyline({
          map,
          clickable: false,
          strokeOpacity: 0,
          icons: [
            {
              icon: { path: "M 0,-1 0,1", strokeColor: fpal.line, strokeOpacity: 0.95, strokeWeight: fpal.casing ? 2.5 : 2, scale: 3 },
              offset: "0",
              repeat: "12px",
            },
          ],
          path: [],
          zIndex: Z.preview,
        });
        // A placed corner answers at once: a ring that lands on the dot and
        // settles — on a photo, the click had nothing else to show for itself.
        const pulseAt = (ll: GMaps) => {
          const ring = new Marker({ map, clickable: false, zIndex: 40, position: ll, icon: { path: 0, scale: 16, fillOpacity: 0, strokeColor: fpal.line, strokeOpacity: 0.9, strokeWeight: 3 } });
          const t0 = performance.now();
          const tick = () => {
            const k = Math.min(1, (performance.now() - t0) / 380);
            if (k >= 1) {
              ring.setMap(null);
              return;
            }
            ring.setIcon({ path: 0, scale: 16 - 11 * k, fillOpacity: 0, strokeColor: fpal.line, strokeOpacity: 0.9 * (1 - k * 0.7), strokeWeight: 3 - 1.5 * k });
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        };

        const ll2ft = (ll: GMaps) => latLngToLocalFeet(origin, { lat: ll.lat(), lng: ll.lng() });
        const ft2ll = (p: PathPoint) => {
          const q = localFeetToLatLng(origin, p);
          return new LatLngCtor(q.lat, q.lng);
        };
        const distFt = (a: GMaps, b: GMaps) => {
          const p = ll2ft(a);
          const q = ll2ft(b);
          return Math.hypot(p.x - q.x, p.y - q.y);
        };

        let raf = 0;
        let syncing = false;
        // Rubber-band preview only trails the cursor while actively tracing a run.
        // Clicking an existing point (to connect) or right-clicking ends the trace.
        let drawing = false;
        const commit = () => {
          if (syncing) return;
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            // Flatten runs in order; each run after the first opens with `gap` so
            // geometry/pricing know there's no fence across the break.
            const arr: PathPoint[] = [];
            runs.forEach((r, ri) => {
              let vi = 0;
              r.line.getPath().forEach((ll: GMaps) => {
                const f = ll2ft(ll);
                if (ri > 0 && vi === 0) f.gap = true;
                arr.push(f);
                vi++;
              });
            });
            onChangeRef.current(arr);
          });
        };

        // Hit radii are SCREEN pixels, not feet: a fixed-feet radius scales with
        // zoom (8 ft ≈ 40 px at parcel zoom, 160+ px zoomed in), so the rubber
        // band pinned to dots while the cursor was visibly far away and stopped
        // following it anywhere inside that circle. Pixel radii feel identical
        // at every zoom; they're converted to feet on demand for the local
        // planar math via the map's current meters-per-pixel scale.
        const MAGNET_PX = 12; // cursor magnet radius around dots while tracing
        const SNAP_PX = 8; // drag-a-dot-onto-a-dot join threshold
        const ftPerPx = () => {
          const z = map.getZoom() ?? 19;
          const lat = map.getCenter()?.lat() ?? origin.lat;
          // Web-mercator ground resolution at this latitude/zoom, in ft per px.
          return ((156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z)) * 3.28084;
        };
        const magnetFt = () => MAGNET_PX * ftPerPx();
        const snapFt = () => SNAP_PX * ftPerPx();
        let snapping = false;

        // Nearest vertex across ALL runs within `radiusFt` of a map point.
        const magnetVertex = (ll: GMaps, radiusFt: number): { run: number; vi: number; ll: GMaps } | null => {
          const p = ll2ft(ll);
          let best: { run: number; vi: number; ll: GMaps; d: number } | null = null;
          runs.forEach((r, ri) => {
            const pa = r.line.getPath();
            const n = pa.getLength();
            for (let j = 0; j < n; j++) {
              const v = pa.getAt(j);
              const f = ll2ft(v);
              const d = Math.hypot(p.x - f.x, p.y - f.y);
              if (d <= radiusFt && (!best || d < best.d)) best = { run: ri, vi: j, ll: v, d };
            }
          });
          return best;
        };

        const isClosedPath = (pa: GMaps) => {
          const n = pa.getLength();
          return n > 2 && distFt(pa.getAt(0), pa.getAt(n - 1)) < 0.5;
        };

        // ── Site snapping ──
        // After the fence's own dots: property-line and house CORNERS within
        // the magnet radius, then anywhere ALONG a house wall, a lot line or
        // another run within a tighter one. Targets are rebuilt only when the
        // site props change identity.
        const EDGE_PX = 9;
        let siteKey: unknown[] = [];
        let siteCorners: PathPoint[] = [];
        let siteEdges: Seg[] = [];
        const siteTargets = () => {
          const cur = siteRef.current;
          const key = [cur.parcel, cur.houses, cur.detected];
          if (key.some((k, i) => k !== siteKey[i])) {
            siteKey = key;
            const rings: PathPoint[][] = [];
            const lots = cur.parcel?.rings ?? (cur.parcel?.ring ? [cur.parcel.ring] : []);
            for (const r of lots) rings.push(r.map((q) => latLngToLocalFeet(origin, q)));
            for (const h of cur.houses ?? []) rings.push(h.ring.map((q) => latLngToLocalFeet(origin, q)));
            for (const b of cur.detected ?? []) rings.push(b.map((q) => latLngToLocalFeet(origin, q)));
            const usable = rings.filter((r) => r.length >= 3);
            siteCorners = usable.flat();
            siteEdges = usable.flatMap((r) => ringEdges(r));
          }
          return { corners: siteCorners, edges: siteEdges };
        };
        /** Segments of the traced fence a new dot may land on — every run's
         *  segments except the one the cursor is extending from. */
        const runEdges = (): Seg[] => {
          const out: Seg[] = [];
          runs.forEach((r, ri) => {
            const pa = r.line.getPath();
            const n = pa.getLength();
            for (let j = 1; j < n; j++) {
              if (drawing && ri === activeIdx && j === n - 1) continue;
              out.push([ll2ft(pa.getAt(j - 1)), ll2ft(pa.getAt(j))]);
            }
          });
          return out;
        };
        type SiteSnap = { kind: "corner" | "edge"; ll: GMaps };
        const snapSite = (ll: GMaps, withRuns: boolean): SiteSnap | null => {
          const t = siteTargets();
          const px = ftPerPx();
          const edges = withRuns ? t.edges.concat(runEdges()) : t.edges;
          const hit = snapToTargets(ll2ft(ll), t.corners, edges, MAGNET_PX * px, EDGE_PX * px);
          return hit ? { kind: hit.kind, ll: ft2ll(hit.pt) } : null;
        };
        // The wall a dot is about to snap to, lit in the active colour while
        // the ring sits on it. Found from the snapped point itself — the
        // nearest house or footprint wall through that point — so the snap
        // math is untouched.
        const hpal = (): HousePalette => ({ ...DEFAULT_HOUSE, ...(housePaletteRef.current ?? {}) });
        const wallLine = new maps.Polyline({
          map,
          clickable: false,
          path: [],
          strokeColor: hpal().active,
          strokeOpacity: 1,
          strokeWeight: 3,
          zIndex: Z.highlight,
        });
        wallLine.set("jfWall", true);
        const showWall = (ll: GMaps | null) => {
          if (!ll) {
            wallLine.setPath([]);
            return;
          }
          const p = ll2ft(ll);
          const cur = siteRef.current;
          const rings: LatLng[][] = [...(cur.houses ?? []).map((h) => h.ring), ...(cur.detected ?? [])];
          let best: { a: LatLng; b: LatLng; d: number } | null = null;
          for (const ring of rings) {
            for (let i = 0; i < ring.length; i++) {
              const a = ring[i];
              const b = ring[(i + 1) % ring.length];
              const fa = latLngToLocalFeet(origin, a);
              const fb = latLngToLocalFeet(origin, b);
              const dx = fb.x - fa.x;
              const dy = fb.y - fa.y;
              const len2 = dx * dx + dy * dy;
              if (len2 < 1e-9) continue;
              const t = Math.max(0, Math.min(1, ((p.x - fa.x) * dx + (p.y - fa.y) * dy) / len2));
              const d = Math.hypot(p.x - (fa.x + t * dx), p.y - (fa.y + t * dy));
              if (d <= 0.05 && (!best || d < best.d)) best = { a, b, d };
            }
          }
          wallLine.setOptions({ strokeColor: hpal().active });
          wallLine.setPath(best ? [best.a, best.b] : []);
        };
        // The lock ring: where a click will actually land.
        const snapRing = new Marker({
          map,
          clickable: false,
          visible: false,
          zIndex: 28,
          icon: { path: 0, scale: 8, fillColor: "#ffffff", fillOpacity: 0.25, strokeColor: ACCENT, strokeWeight: 2.5 },
        });
        const showRing = (ll: GMaps | null) => {
          if (ll) {
            snapRing.setPosition(ll);
            snapRing.setVisible(true);
          } else snapRing.setVisible(false);
          parcelActiveRef.current?.(ll);
        };

        // ── House outline being traced (House tool) ──
        const houseDraft: GMaps[] = [];
        // Ink dashes on a paper edge — the finished outline's colours.
        const houseLineEdge = new maps.Polyline({
          map,
          clickable: false,
          strokeOpacity: 0,
          icons: [
            {
              icon: { path: "M 0,-1 0,1", strokeColor: hpal().edge, strokeOpacity: 0.9, strokeWeight: 4, scale: 3 },
              offset: "0",
              repeat: "11px",
            },
          ],
          path: [],
          zIndex: Z.preview,
        });
        const houseLine = new maps.Polyline({
          map,
          clickable: false,
          strokeOpacity: 0,
          icons: [
            {
              icon: { path: "M 0,-1 0,1", strokeColor: hpal().line, strokeOpacity: 1, strokeWeight: 2, scale: 3 },
              offset: "0",
              repeat: "11px",
            },
          ],
          path: [],
          zIndex: Z.preview,
        });
        const houseDots: GMaps[] = [];
        const paintHouseDraft = (cursor: GMaps | null) => {
          const path = cursor ? [...houseDraft, cursor] : [...houseDraft];
          houseLineEdge.setPath(path);
          houseLine.setPath(path);
          while (houseDots.length > houseDraft.length) houseDots.pop()?.setMap(null);
          houseDraft.forEach((ll, i) => {
            const closable = i === 0 && houseDraft.length >= 3;
            const icon = {
              path: 0,
              scale: closable ? 7 : 4,
              // The house's own colour, not the fence's: what is being drawn
              // is a house, and the dot that closes it says so.
              fillColor: closable ? hpal().line : "#ffffff",
              fillOpacity: 1,
              strokeColor: "#0a0a0a",
              strokeWeight: 1.5,
            };
            if (!houseDots[i]) houseDots[i] = new Marker({ map, clickable: false, zIndex: 27, position: ll, icon });
            else {
              houseDots[i].setPosition(ll);
              houseDots[i].setIcon(icon);
            }
          });
        };
        let lastDraft = "false:0";
        const notifyDraft = () => {
          const key = `${drawing}:${houseDraft.length}`;
          if (key === lastDraft) return;
          lastDraft = key;
          onDraftChangeRef.current?.({ fence: drawing, houseCorners: houseDraft.length });
        };
        const closeHouse = () => {
          if (houseDraft.length >= 3) onHouseAddRef.current?.(houseDraft.map((ll) => ll2ft(ll)));
          houseDraft.length = 0;
          paintHouseDraft(null);
          notifyDraft();
        };
        const cancelHouse = () => {
          houseDraft.length = 0;
          paintHouseDraft(null);
          notifyDraft();
        };

        // Dragged vertex magnets onto any nearby vertex (its own run or another —
        // that's the "drag a dot onto another to join" affordance).
        const onVertexDragged = (run: Run, index: number, prev?: GMaps) => {
          // Align moves the whole outline: every vertex fires `set_at`, and
          // snapping any of them would bend the shape the mode promises to keep.
          if (!snapping && !aligningRef.current) {
            const pa = run.line.getPath();
            const m = ll2ft(pa.getAt(index));
            const was = prev ? ll2ft(prev) : null;
            // A dot dragged OFF a target (a corner the fence was laid on, a dot
            // it was joined to) must not be pulled straight back onto it.
            const startedOn = (q: PathPoint) => !!was && Math.hypot(was.x - q.x, was.y - q.y) <= snapFt();
            outer: for (const r of runs) {
              const p2 = r.line.getPath();
              const n = p2.getLength();
              for (let j = 0; j < n; j++) {
                if (r === run && j === index) continue;
                const f = ll2ft(p2.getAt(j));
                if (Math.hypot(m.x - f.x, m.y - f.y) <= snapFt() && !startedOn(f)) {
                  snapping = true;
                  pa.setAt(index, p2.getAt(j));
                  snapping = false;
                  commit();
                  return;
                }
              }
            }
            // No dot in reach: a lot or house corner, or a house wall / lot line.
            const t = siteTargets();
            const hit = snapToTargets(m, t.corners, t.edges, snapFt(), snapFt());
            if (hit && hit.d > 1e-3 && !startedOn(hit.pt)) {
              snapping = true;
              pa.setAt(index, ft2ll(hit.pt));
              snapping = false;
            }
          }
          commit();
        };

        const destroyRun = (run: Run) => {
          const ri = runs.indexOf(run);
          if (ri < 0) return;
          for (const l of run.listeners) l?.remove?.();
          run.line.setMap(null);
          run.casing?.setMap(null);
          for (const d of run.dots) d.setMap(null);
          runs.splice(ri, 1);
          if (ri === activeIdx) {
            drawing = false;
            activeIdx = runs.length - 1;
            notifyDraft();
          } else if (ri < activeIdx) {
            activeIdx--;
          }
        };

        // The casing under a run and the dot on each of its corners follow the
        // run's own path — on every edit, not only on commit, so a corner
        // being dragged keeps its edge and its dot under the hand.
        const dotIcon = () => ({
          path: 0,
          scale: fenceWeights(map.getZoom()).core + 3.5,
          fillColor: fpal.dot,
          fillOpacity: 1,
          strokeColor: fpal.dotRing,
          strokeWeight: 2,
        });
        const syncDeco = (run: Run) => {
          const pa = run.line.getPath().getArray();
          run.casing?.setPath(pa);
          if (!fpal.casing) return;
          while (run.dots.length > pa.length) run.dots.pop()?.setMap(null);
          pa.forEach((ll: GMaps, i: number) => {
            if (!run.dots[i]) run.dots[i] = new Marker({ map, clickable: false, zIndex: 20, position: ll, icon: dotIcon() });
            else run.dots[i].setPosition(ll);
          });
        };
        const reweighRuns = () => {
          const w = fenceWeights(map.getZoom());
          for (const r of runs) {
            r.line.setOptions({ strokeWeight: fpal.casing ? w.core : 2 });
            r.casing?.setOptions({ strokeWeight: w.core + 2 * w.casing });
            for (const d of r.dots) d.setIcon(dotIcon());
          }
        };
        const newRun = (initial: GMaps[]): Run => {
          const w = fenceWeights(map.getZoom());
          const line = new maps.Polyline({
            map,
            editable: !aligningRef.current,
            draggable: aligningRef.current,
            path: initial,
            strokeColor: fpal.line,
            strokeWeight: fpal.casing ? w.core : 2,
            strokeOpacity: 1,
            zIndex: Z.fence,
          });
          const casing = fpal.casing
            ? new maps.Polyline({
                map,
                clickable: false,
                path: initial,
                strokeColor: fpal.casing,
                strokeWeight: w.core + 2 * w.casing,
                strokeOpacity: 1,
                zIndex: Z.fenceCasing,
              })
            : null;
          const run: Run = { line, listeners: [], casing, dots: [] };
          const pa = line.getPath();
          syncDeco(run);
          run.listeners.push(
            pa.addListener("set_at", (i: number, prev: GMaps) => onVertexDragged(run, i, prev)),
            pa.addListener("set_at", () => syncDeco(run)),
            pa.addListener("insert_at", () => syncDeco(run)),
            pa.addListener("remove_at", () => syncDeco(run)),
            pa.addListener("insert_at", commit),
            pa.addListener("remove_at", commit),
            line.addListener("drag", () => syncDeco(run)),
            line.addListener("dragend", () => syncDeco(run)),
            line.addListener("dragend", commit),
            // Polylines swallow the map's mousemove when hovered — without this the
            // rubber band froze the moment the cursor neared a dot. (fix: same handler)
            line.addListener("mousemove", (e: GMaps) => onMove(e)),
            line.addListener("click", (e: GMaps) => onVertexClick(run, e)),
            line.addListener("rightclick", (e: GMaps) => onVertexRightclick(run, e)),
            // A double-click that lands on a line still finishes the run / outline.
            line.addListener("dblclick", () => onDoubleClick()),
          );
          runs.push(run);
          return run;
        };

        // Begin tracing a brand-new run at a point.
        const startRun = (ll: GMaps) => {
          newRun([ll]);
          activeIdx = runs.length - 1;
          drawing = true;
          commit();
          notifyDraft();
        };

        // Seed runs from the store's points (split on `gap`). Used at mount and by
        // setFromPoints (parcel load / reset / undo-external).
        const seedRuns = () => {
          syncing = true;
          while (runs.length) destroyRun(runs[runs.length - 1]);
          let current: GMaps[] = [];
          const flush = () => {
            if (current.length > 0) newRun(current);
            current = [];
          };
          for (const p of pointsRef.current) {
            if (p.gap) flush();
            const q = localFeetToLatLng(origin, p);
            current.push(new LatLngCtor(q.lat, q.lng));
          }
          flush();
          activeIdx = runs.length - 1;
          drawing = false;
          previewLine.setPath([]);
          syncing = false;
          notifyDraft();
        };

        // ── Opening markers (centre dot + gate edge handles) ──
        type OpeningMarker = { center: GMaps; a?: GMaps; b?: GMaps };
        const openings = new Map<string, OpeningMarker>();
        const circleIcon = (scale: number, fill: string, stroke: string, strokeW: number) => ({
          path: 0, // google.maps.SymbolPath.CIRCLE
          scale,
          fillColor: fill,
          fillOpacity: 1,
          strokeColor: stroke,
          strokeWeight: strokeW,
        });
        const centerIcon = (kind: GateSpec["kind"]) =>
          circleIcon(7, kind === "gate" ? ACCENT : DOOR_INK, "#ffffff", 2);
        const handleIcon = () => circleIcon(5, "#ffffff", ACCENT, 2);

        const isAttached = (g: GateSpec) => g.segmentIndex >= 0 && !!pointsRef.current[g.segmentIndex + 1];

        // Centre + (attached only) edge positions in local feet.
        const openingGeom = (g: GateSpec): { center: PathPoint; a?: PathPoint; b?: PathPoint } | null => {
          if (!isAttached(g)) {
            if (typeof g.x !== "number" || typeof g.y !== "number") return null;
            return { center: { x: g.x, y: g.y } };
          }
          const a = pointsRef.current[g.segmentIndex];
          const b = pointsRef.current[g.segmentIndex + 1];
          const segLen = Math.hypot(b.x - a.x, b.y - a.y);
          if (segLen < 1e-6) return null;
          const ux = (b.x - a.x) / segLen;
          const uy = (b.y - a.y) / segLen;
          const w = Math.min(g.widthFt, segLen);
          const cDist = clamp(g.t, 0, 1) * segLen;
          const aDist = Math.max(0, cDist - w / 2);
          const bDist = Math.min(segLen, cDist + w / 2);
          return {
            center: { x: a.x + ux * cDist, y: a.y + uy * cDist },
            a: { x: a.x + ux * aDist, y: a.y + uy * aDist },
            b: { x: a.x + ux * bDist, y: a.y + uy * bDist },
          };
        };

        const removeMarker = (mk: OpeningMarker) => {
          mk.center.setMap(null);
          mk.a?.setMap(null);
          mk.b?.setMap(null);
        };

        const makeHandle = (id: string, role: "a" | "b") => {
          const h = new Marker({ map, draggable: true, icon: handleIcon(), zIndex: 31, cursor: "ew-resize" });
          h.set("id", id);
          h.set("role", role);
          h.addListener("dragend", () => {
            const g = gatesRef.current.find((x) => x.id === h.get("id"));
            if (!g) return renderOpenings();
            const a = pointsRef.current[g.segmentIndex];
            const b = pointsRef.current[g.segmentIndex + 1];
            const pos = h.getPosition();
            if (!a || !b || !pos) return renderOpenings();
            const segLen = Math.hypot(b.x - a.x, b.y - a.y);
            if (segLen < 1e-6) return renderOpenings();
            const ux = (b.x - a.x) / segLen;
            const uy = (b.y - a.y) / segLen;
            const p = ll2ft(pos);
            let tHandle = ((p.x - a.x) * ux + (p.y - a.y) * uy) / segLen;
            tHandle = clamp(tHandle, 0, 1);
            const halfT = Math.min(g.widthFt, segLen) / 2 / segLen;
            const otherT = h.get("role") === "a" ? Math.min(1, g.t + halfT) : Math.max(0, g.t - halfT);
            const newWidth = Math.max(1.5, Math.min(segLen, Math.abs(tHandle - otherT) * segLen));
            const newT = clamp((tHandle + otherT) / 2, 0, 1);
            onUpdateGateRef.current(g.id, { t: newT, widthFt: newWidth });
          });
          return h;
        };

        // ── Armed-tool ghost: while placing a gate/door, previews the seated
        // position on the nearest fence line BEFORE the click. Uses the same
        // nearestSegment + SNAP_ON_FT + fitCenterT math as the click handler, so
        // the ghost appears exactly (and only) where a click would magnet on;
        // away from any run it vanishes — that click would drop the opening free.
        const ghostIcon = (kind: GateSpec["kind"]) => ({
          path: 0, // google.maps.SymbolPath.CIRCLE
          scale: 7,
          fillColor: kind === "gate" ? ACCENT : DOOR_INK,
          fillOpacity: 0.5,
          strokeColor: "#ffffff",
          strokeOpacity: 0.75,
          strokeWeight: 2,
        });
        const ghostCenter = new Marker({ map, clickable: false, visible: false, zIndex: 29 });
        // Width span along the run — shows the stretch of fence the opening will occupy.
        const ghostSpan = new maps.Polyline({
          map,
          clickable: false,
          path: [],
          strokeColor: ACCENT,
          strokeOpacity: 0.45,
          strokeWeight: 7,
          zIndex: Z.ghost,
        });
        let ghostShown = false;
        const hideGhost = () => {
          if (!ghostShown) return;
          ghostShown = false;
          ghostCenter.setVisible(false);
          ghostSpan.setPath([]);
        };
        // Returns true when the ghost is snapped onto a run (drives the chip copy).
        const updateGhost = (ll: GMaps): boolean => {
          const a = armedRef.current;
          if (!a) {
            hideGhost();
            return false;
          }
          const p = ll2ft(ll);
          const hit = nearestSegment(p, pointsRef.current);
          if (!hit || hit.dist > SNAP_ON_FT) {
            hideGhost();
            return false;
          }
          const s0 = pointsRef.current[hit.i];
          const s1 = pointsRef.current[hit.i + 1];
          const segLen = Math.hypot(s1.x - s0.x, s1.y - s0.y);
          if (segLen < 1e-6) {
            hideGhost();
            return false;
          }
          const ux = (s1.x - s0.x) / segLen;
          const uy = (s1.y - s0.y) / segLen;
          const cDist = fitCenterT(hit.i, hit.t, pointsRef.current, a.widthFt) * segLen;
          const half = Math.min(a.widthFt, segLen) / 2;
          ghostCenter.setIcon(ghostIcon(a.kind));
          ghostCenter.setPosition(ft2ll({ x: s0.x + ux * cDist, y: s0.y + uy * cDist }));
          ghostCenter.setVisible(true);
          ghostSpan.setOptions({ strokeColor: a.kind === "gate" ? ACCENT : DOOR_INK });
          ghostSpan.setPath([
            ft2ll({ x: s0.x + ux * (cDist - half), y: s0.y + uy * (cDist - half) }),
            ft2ll({ x: s0.x + ux * (cDist + half), y: s0.y + uy * (cDist + half) }),
          ]);
          ghostShown = true;
          return true;
        };

        const renderOpenings = () => {
          const want = gatesRef.current;
          const ids = new Set(want.map((g) => g.id));
          for (const [id, mk] of [...openings]) {
            if (!ids.has(id)) {
              removeMarker(mk);
              openings.delete(id);
            }
          }
          for (const g of want) {
            const geom = openingGeom(g);
            if (!geom) {
              const stale = openings.get(g.id);
              if (stale) {
                removeMarker(stale);
                openings.delete(g.id);
              }
              continue;
            }
            let mk = openings.get(g.id);
            if (!mk) {
              const center = new Marker({ map, draggable: true, icon: centerIcon(g.kind), zIndex: 30, cursor: "move" });
              center.set("id", g.id);
              center.addListener("dragend", () => {
                const cur = gatesRef.current.find((x) => x.id === center.get("id"));
                const pos = center.getPosition();
                if (!cur || !pos) return renderOpenings();
                const p = ll2ft(pos);
                const hit = nearestSegment(p, pointsRef.current);
                if (hit && hit.dist <= SNAP_ON_FT) {
                  // Magnet onto the run only when very close; keep it fully on-segment.
                  onUpdateGateRef.current(cur.id, {
                    segmentIndex: hit.i,
                    t: fitCenterT(hit.i, hit.t, pointsRef.current, cur.widthFt),
                    x: undefined,
                    y: undefined,
                  });
                } else {
                  // Otherwise leave it free where it was dropped.
                  onUpdateGateRef.current(cur.id, { segmentIndex: -1, x: p.x, y: p.y });
                }
              });
              mk = { center };
              openings.set(g.id, mk);
            }
            mk.center.setIcon(centerIcon(g.kind));
            mk.center.setPosition(ft2ll(geom.center));
            // Resize handles only for ATTACHED gates. Doors + detached openings move only.
            if (g.kind === "gate" && geom.a && geom.b) {
              if (!mk.a) mk.a = makeHandle(g.id, "a");
              if (!mk.b) mk.b = makeHandle(g.id, "b");
              mk.a.setPosition(ft2ll(geom.a));
              mk.b.setPosition(ft2ll(geom.b));
            } else if (mk.a || mk.b) {
              mk.a?.setMap(null);
              mk.b?.setMap(null);
              mk.a = undefined;
              mk.b = undefined;
            }
          }
        };

        // ── Live measurement chip + preview line ──
        const measureEl = measureRef.current;
        // The chip is placed with `transform: translate()`, which is applied in
        // the surface's OWN coordinate space, from a delta measured off
        // `getBoundingClientRect()` and a pointer position — both of which are
        // viewport pixels. Under a CSS-zoomed host the two spaces differ, so the
        // delta has to be divided by the effective zoom or the chip drifts away
        // from the cursor proportionally to the distance from the top-left
        // corner. (The blueprint shell zooms its root: FLUID SCALE, window
        // width / 1728, clamped 0.78–1.35 — so only an exactly 1728px viewport
        // was correct. blueprint-shell/list-motion corrects its FLIP deltas the
        // same way.) The sage studio is unzoomed and divides by 1.
        // Cached per build and refreshed on resize, which is the only thing that
        // changes it — reading it per mousemove would walk the tree 60×/second.
        let hostZoom = 1;
        const readZoom = () => {
          let z = 1;
          for (let n: HTMLElement | null = mountRef.current; n; n = n.parentElement) {
            // Nested zooms multiply; `normal` / unsupported parses to NaN and is skipped.
            const v = parseFloat(getComputedStyle(n).zoom);
            if (isFinite(v) && v > 0) z *= v;
          }
          hostZoom = z > 0 ? z : 1;
        };
        readZoom();
        window.addEventListener("resize", readZoom);
        // The SAME mismatch bites Google's own hit test: it derives `e.latLng`
        // from the pointer's VIEWPORT coordinates and measures them against the
        // map div as though the two spaces were one. Under a zoomed host every
        // click therefore resolves SHORT of the cursor, by exactly the drift the
        // chip above corrects — a dot lands up-left of where it was placed, and
        // the error grows with the distance from the map's top-left corner.
        // So the pointer is re-projected here instead of trusted: viewport delta
        // -> local pixels -> the map's own projection. The overlay exists only to
        // hand back that projection (getProjection is an OverlayView method).
        const projector = new maps.OverlayView();
        projector.onAdd = () => {};
        projector.draw = () => {};
        projector.onRemove = () => {};
        projector.setMap(map);
        /** Where the pointer REALLY is. Google's own answer is kept whenever the
         *  correction cannot be made — an unzoomed host, a projection that has
         *  not drawn yet, or an event with no pointer behind it. */
        const trueLL = (e: GMaps): GMaps | null => {
          const fallback = e.latLng ?? null;
          if (hostZoom === 1) return fallback;
          const dom = e.domEvent as MouseEvent | undefined;
          const el = mountRef.current;
          const rect = el?.getBoundingClientRect();
          if (!dom || typeof dom.clientX !== "number" || !el || !rect) return fallback;
          const p = projector.getProjection();
          if (!p) return fallback;
          // TWO corrections, both from the same root cause. Google measured this
          // container with getBoundingClientRect() — viewport pixels, 20% short
          // here — but lays its panes out in the element's OWN pixels, and
          // centres the map on the size it measured. So (a) the pointer delta is
          // in viewport pixels and has to be divided back into element pixels,
          // and (b) Google's container origin sits half the difference between
          // the two sizes in from this element's top-left corner. Correcting only
          // the scale leaves a constant ~65px drift; correcting only the origin
          // leaves the fence measuring 17% short.
          const padX = (el.offsetWidth - rect.width) / 2;
          const padY = (el.offsetHeight - rect.height) / 2;
          const px = new core.Point(
            (dom.clientX - rect.left) / hostZoom - padX,
            (dom.clientY - rect.top) / hostZoom - padY,
          );
          return p.fromContainerPixelToLatLng(px) ?? fallback;
        };
        // Touch aim (see the block under the listeners).
        let suppressClickUntil = 0;
        let lastTouchAt = 0;
        const totalLenFt = () => {
          let total = 0;
          for (const r of runs) {
            const pa = r.line.getPath();
            const n = pa.getLength();
            for (let i = 1; i < n; i++) total += distFt(pa.getAt(i - 1), pa.getAt(i));
          }
          return total;
        };
        const onMove = (e: GMaps) => {
          const at = trueLL(e);
          if (!at) {
            previewLine.setPath([]);
            hideGhost();
            return;
          }
          const busy = !!armedRef.current || aligningRef.current;
          if (houseModeRef.current && !busy) {
            previewLine.setPath([]);
            hideGhost();
            const first = houseDraft[0];
            const closing = !!first && houseDraft.length >= 3 && distFt(first, at) <= magnetFt();
            const sn = closing ? null : snapSite(at, false);
            const cur = closing ? first : sn ? sn.ll : at;
            showRing(closing || sn ? cur : null);
            paintHouseDraft(houseDraft.length ? cur : null);
            if (measureEl) {
              const rect = mountRef.current?.getBoundingClientRect();
              const dom = e.domEvent as MouseEvent | undefined;
              if (rect && dom) {
                const dx = (dom.clientX - rect.left) / hostZoom + 14;
                const dy = (dom.clientY - rect.top) / hostZoom + 14;
                measureEl.style.transform = `translate(${dx}px, ${dy}px)`;
              }
              measureEl.style.display = "block";
              const last = houseDraft[houseDraft.length - 1];
              measureEl.textContent = closing
                ? "Click to close the outline"
                : last
                  ? `${Math.round(distFt(last, cur))} ft wall · click the next corner`
                  : "Click a corner of the house";
            }
            return;
          }
          // Endpoint magnet: within the pixel radius the cursor locks to the
          // nearest dot (and unlocks the moment it leaves the radius); failing
          // that, a lot or house corner, or a point along a wall or a line.
          const mag = busy ? null : magnetVertex(at, magnetFt());
          const site = busy || mag ? null : snapSite(at, true);
          const cursorLL = mag ? mag.ll : site ? site.ll : at;
          showRing(mag || site ? cursorLL : null);
          showWall(site?.kind === "edge" ? site.ll : null);
          const act = drawing && !busy ? runs[activeIdx] : null;
          const ap = act?.line.getPath();
          const an = ap ? ap.getLength() : 0;
          if (ap && an >= 1) {
            previewLine.setPath([ap.getAt(an - 1), cursorLL]);
          } else {
            previewLine.setPath([]);
          }
          if (!measureEl) return;
          const rect = mountRef.current?.getBoundingClientRect();
          const dom = e.domEvent as MouseEvent | undefined;
          if (rect && dom) {
            // Measured delta → local space (see hostZoom); the 14px nudge is
            // already local, so it is added after the division.
            const dx = (dom.clientX - rect.left) / hostZoom + 14;
            const dy = (dom.clientY - rect.top) / hostZoom + 14;
            measureEl.style.transform = `translate(${dx}px, ${dy}px)`;
          }
          measureEl.style.display = "block";
          if (armedRef.current) {
            // Magnet preview: the ghost seats itself on the fence line whenever
            // the cursor is close enough that a click would snap there.
            const snapped = updateGhost(at);
            const a = armedRef.current;
            // "double gate" for built-ins; a custom type reads by its own name.
            const armedName = VARIANT_LABEL[a.variant]
              ? `${VARIANT_LABEL[a.variant].toLowerCase()} ${a.kind}`
              : variantLabel(a.variant, customOpeningsRef.current);
            measureEl.textContent = snapped
              ? `Click to place the ${armedName} here`
              : `Click to place a ${armedName} — hover a fence line to snap it`;
            return;
          }
          if (ap && an >= 1) {
            const seg = distFt(ap.getAt(an - 1), cursorLL);
            let hint = "";
            if (mag) {
              hint =
                mag.run === activeIdx && mag.vi === 0 && an >= 3
                  ? " · click to close"
                  : mag.run === activeIdx && mag.vi === an - 1
                    ? " · click to stop"
                    : " · click to connect";
            } else if (site) {
              hint = site.kind === "corner" ? " · on the corner" : " · on the line";
            }
            measureEl.textContent = `+${Math.round(seg)} ft · ${Math.round(totalLenFt())} ft total${hint}`;
            return;
          }
          if (mag) {
            const mp = runs[mag.run].line.getPath();
            const openEnd = !isClosedPath(mp) && (mag.vi === mp.getLength() - 1 || mag.vi === 0);
            measureEl.textContent = openEnd ? "Click to continue this fence" : "Click to start a new fence";
            return;
          }
          measureEl.textContent = runs.length > 0 ? "Click to start a new fence" : "Click to start";
        };
        const hideMeasure = () => {
          if (measureEl) measureEl.style.display = "none";
          previewLine.setPath([]);
          showRing(null);
          showWall(null);
          if (houseModeRef.current) paintHouseDraft(null);
          hideGhost();
        };

        const stopTrace = () => {
          drawing = false;
          // Everything that trailed the pointer goes with the trace — the
          // rubber band, the snap ring and the length chip. They used to wait
          // for the next mousemove, so a run finished with Enter, Escape or a
          // right-click kept "+65 ft · click to close" and the ring on screen
          // until the hand moved (2026-09-20).
          hideMeasure();
          notifyDraft();
        };

        // Click on an existing dot (fires on the run's polyline, not the map).
        const onVertexClick = (run: Run, e: GMaps) => {
          if (!e?.jfAim && performance.now() < suppressClickUntil) return;
          if (houseModeRef.current) {
            // The house tool owns clicks — a click that lands on a fence dot
            // still places a house corner there.
            const at = trueLL(e);
            if (at) houseClick(at);
            return;
          }
          if (e.vertex == null) {
            // The line itself, not a dot: the same as a click on the ground
            // there — starts a branch from the middle of a run, drops an
            // armed opening, or adds a dot to the run being traced.
            onMapClick(e);
            return;
          }
          if (aligningRef.current || armedRef.current) return;
          const ri = runs.indexOf(run);
          const pa = run.line.getPath();
          const n = pa.getLength();
          if (!drawing) {
            // Idle: clicking an OPEN run's end dot resumes tracing that fence.
            if (!isClosedPath(pa) && e.vertex === n - 1) {
              activeIdx = ri;
              drawing = true;
              notifyDraft();
            } else if (!isClosedPath(pa) && e.vertex === 0 && n > 1) {
              // The head end: continue via a new run joined exactly at that dot.
              startRun(pa.getAt(0));
            }
            return;
          }
          const act = runs[activeIdx];
          if (!act) return stopTrace();
          const ap = act.line.getPath();
          if (ri === activeIdx) {
            if (e.vertex === 0 && ap.getLength() >= 3 && !isClosedPath(ap)) {
              // Own first dot closes the loop.
              ap.push(pa.getAt(0));
              commit();
            } else if (e.vertex !== ap.getLength() - 1) {
              // Own mid dot: connect into it (T-junction); own last dot just stops.
              ap.push(pa.getAt(e.vertex));
              commit();
            }
          } else {
            // A dot on another fence: connect the trace to it exactly.
            ap.push(pa.getAt(e.vertex));
            commit();
          }
          stopTrace();
        };

        /** A click while the House tool is on: a corner, or the close. */
        const houseClick = (at: GMaps) => {
          const first = houseDraft[0];
          if (first && houseDraft.length >= 3 && distFt(first, at) <= magnetFt()) {
            closeHouse();
            return;
          }
          const sn = snapSite(at, false);
          const ll = sn ? sn.ll : at;
          const last = houseDraft[houseDraft.length - 1];
          if (last && distFt(last, ll) < 3 * ftPerPx()) return; // double-click's second click
          houseDraft.push(ll);
          paintHouseDraft(null);
          notifyDraft();
        };

        const onVertexRightclick = (run: Run, e: GMaps) => {
          if (houseModeRef.current) {
            if (houseDraft.length >= 3) closeHouse();
            else cancelHouse();
            return;
          }
          if (e.vertex != null) {
            const pa = run.line.getPath();
            pa.removeAt(e.vertex);
            if (pa.getLength() === 0) destroyRun(run);
            commit();
          }
          stopTrace();
        };

        /** A click on open ground — or on a run's LINE away from its dots,
         *  which Google delivers to the polyline instead of the map. */
        const onMapClick = (e: GMaps) => {
            if (!e?.jfAim && performance.now() < suppressClickUntil) return;
            if (aligningRef.current) return;
            // An outline is being edited: a click on the ground is not the first
            // dot of a fence — and does not end the edit either (Done does; a
            // stray tap beside the house must not).
            if (selHouseRef.current && !drawing && !houseModeRef.current && !armedRef.current) return;
            const at = trueLL(e);
            const a = armedRef.current;
            if (a) {
              if (!at) return;
              const p = ll2ft(at);
              const hit = nearestSegment(p, pointsRef.current);
              if (hit && hit.dist <= SNAP_ON_FT) {
                // Very close to a run → magnet on, seated fully along the fence line.
                onDropRef.current(hit.i, fitCenterT(hit.i, hit.t, pointsRef.current, a.widthFt));
              } else {
                // Otherwise drop it free at the clicked spot (no magnet).
                onDropRef.current(-1, 0, p.x, p.y);
              }
              return;
            }
            if (!at) return;
            // A finger hides what it lands on: show, for a moment, where the
            // dot went and what it caught.
            if (e?.jfAim || performance.now() - lastTouchAt < 900) {
              const hit = aimInfo(at);
              flashAt(hit.ll, hit.label);
            }
            if (houseModeRef.current) {
              houseClick(at);
              return;
            }
            const mag = magnetVertex(at, magnetFt());
            const site = mag ? null : snapSite(at, true);
            const place = site ? site.ll : at;
            if (drawing) {
              const act = runs[activeIdx];
              if (!act) return stopTrace();
              const ap = act.line.getPath();
              if (mag) {
                // Magnetized click = connect/close/stop, mirroring the preview.
                const tgt = runs[mag.run].line.getPath().getAt(mag.vi);
                if (mag.run === activeIdx && mag.vi === 0 && ap.getLength() >= 3 && !isClosedPath(ap)) {
                  ap.push(tgt); // close the loop
                  commit();
                } else if (!(mag.run === activeIdx && mag.vi === ap.getLength() - 1)) {
                  ap.push(tgt); // connect to that dot exactly
                  commit();
                }
                return stopTrace();
              }
              // The second click of a double-click lands where the first did —
              // one dot, then the dblclick finishes the run.
              const last = ap.getLength() ? ap.getAt(ap.getLength() - 1) : null;
              if (last && distFt(last, place) < 3 * ftPerPx()) return;
              ap.push(place);
              pulseAt(place);
              commit();
              return;
            }
            // Not tracing: near an open end resumes that fence; anywhere else
            // starts a NEW disconnected fence (no line back to the old one).
            if (mag) {
              const mp = runs[mag.run].line.getPath();
              if (!isClosedPath(mp) && mag.vi === mp.getLength() - 1) {
                activeIdx = mag.run;
                drawing = true;
                notifyDraft();
                return;
              }
              startRun(mp.getAt(mag.vi));
              return;
            }
            startRun(place);
            pulseAt(place);
          };

        function onDoubleClick() {
          if (houseModeRef.current) {
            if (houseDraft.length >= 3) closeHouse();
            return;
          }
          stopTrace();
        }
        function onRightClick() {
          if (houseModeRef.current) {
            // Close an outline that can close; otherwise drop it.
            if (houseDraft.length >= 3) closeHouse();
            else cancelHouse();
            return;
          }
          // Right-click away from a vertex: just stop the run from following the cursor.
          stopTrace();
        }

        const listeners = [
          map.addListener("mousemove", onMove),
          map.addListener("mouseout", hideMeasure),
          map.addListener("click", (e: GMaps) => onMapClick(e)),
          map.addListener("dblclick", () => onDoubleClick()),
          map.addListener("rightclick", () => onRightClick()),
        ];
        // Traced houses are clickable while the House tool edits them; their
        // events are the draw surface's too (see the buildings effect).
        const wantsDraw = (e: GMaps) => {
          if (drawing || houseModeRef.current || armedRef.current || aligningRef.current) return true;
          const at = trueLL(e);
          return !!at && !!snapSite(at, true);
        };
        drawHandlersRef.current = { click: onMapClick, move: onMove, dblclick: onDoubleClick, rightclick: onRightClick, wantsDraw };

        // ── Touch aim ──────────────────────────────────────────────────────
        // A phone has no cursor and the finger covers the corner it is going
        // for. So a finger HELD still for AIM_HOLD_MS aims: a reticle rides
        // AIM_LIFT_PX above the finger, runs the same snapping the mouse does
        // (onMove), and the dot goes where the reticle is when the finger
        // lifts (onMapClick) — nothing about what snaps to what is decided
        // here. A quick tap is still Google's click, placed under the finger.
        // A finger that MOVES before the hold is up is moving the map (owner,
        // 2026-10-18: "hard to zoom in or move the map because it starts
        // drawing lines"): the aim stands down and Google pans, as any map
        // does; two fingers pinch and pan as ever, and a second finger calls
        // an aim off. Only an aiming finger's moves are kept from Google (so
        // it does not pan while aiming); it still sees every touch start and
        // end, which is what lets a pinch that begins one finger at a time
        // work. Google follows a gesture from listeners it puts on the
        // document when the finger lands, so the moves are stopped at the
        // WINDOW, in the capture phase — the one place that is ahead of them.
        const AIM_LIFT_PX = 56;
        const AIM_HOLD_MS = 320;
        const AIM_SLOP_PX = 10;
        const HANDLE_PX = 16;
        const mountEl = mountRef.current as HTMLDivElement;
        const aimEl = aimRef.current;
        const flashEl = flashRef.current;
        type Aim = { id: number; x0: number; y0: number; x: number; y: number; live: boolean; timer: number };
        let aim: Aim | null = null;
        let aimKey = "";
        const pads = () => {
          const rect = mountEl.getBoundingClientRect();
          return { rect, padX: (mountEl.offsetWidth - rect.width) / 2, padY: (mountEl.offsetHeight - rect.height) / 2 };
        };
        /** Viewport px → the surface's own px (see hostZoom). */
        const localOfClient = (x: number, y: number) => {
          const { rect } = pads();
          return { x: (x - rect.left) / hostZoom, y: (y - rect.top) / hostZoom };
        };
        const llOfClient = (x: number, y: number): GMaps | null => {
          const p = projector.getProjection();
          if (!p) return null;
          const { padX, padY } = pads();
          const l = localOfClient(x, y);
          return p.fromContainerPixelToLatLng(new core.Point(l.x - padX, l.y - padY)) ?? null;
        };
        const localOfLL = (ll: GMaps) => {
          const p = projector.getProjection();
          const c = p?.fromLatLngToContainerPixel(ll);
          if (!c) return null;
          const { padX, padY } = pads();
          return { x: c.x + padX, y: c.y + padY };
        };
        /** A pointer event the draw handlers can read, made at a screen point. */
        const synth = (x: number, y: number): GMaps => ({ latLng: llOfClient(x, y), domEvent: { clientX: x, clientY: y }, jfAim: true });
        const distToSegFt = (p: PathPoint, a: PathPoint, b: PathPoint) => {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const l2 = dx * dx + dy * dy;
          const t = l2 < 1e-9 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
          return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
        };
        /** Where a dot placed at `at` would go and what it would catch — the
         *  same calls, in the same order, as onMove / onMapClick make. */
        function aimInfo(at: GMaps): { ll: GMaps; label: string } {
          if (houseModeRef.current) {
            const first = houseDraft[0];
            if (first && houseDraft.length >= 3 && distFt(first, at) <= magnetFt()) return { ll: first, label: "first point" };
            const sn = snapSite(at, false);
            return sn ? { ll: sn.ll, label: sn.kind === "corner" ? "corner" : "line" } : { ll: at, label: "" };
          }
          const mag = magnetVertex(at, magnetFt());
          if (mag) {
            const an = drawing ? (runs[activeIdx]?.line.getPath().getLength() ?? 0) : 0;
            return { ll: mag.ll, label: drawing && mag.run === activeIdx && mag.vi === 0 && an >= 3 ? "first point" : "fence dot" };
          }
          const site = snapSite(at, true);
          if (!site) return { ll: at, label: "" };
          if (site.kind === "corner") return { ll: site.ll, label: "corner" };
          const p = ll2ft(site.ll);
          const cur = siteRef.current;
          const walls: LatLng[][] = [...(cur.houses ?? []).map((h) => h.ring), ...(cur.detected ?? [])];
          const tol = 0.75;
          for (const ring of walls) {
            for (let i = 0; i < ring.length; i++) {
              if (distToSegFt(p, latLngToLocalFeet(origin, ring[i]), latLngToLocalFeet(origin, ring[(i + 1) % ring.length])) <= tol) return { ll: site.ll, label: "house wall" };
            }
          }
          for (const [a, b] of runEdges()) if (distToSegFt(p, a, b) <= tol) return { ll: site.ll, label: "fence line" };
          return { ll: site.ll, label: "lot line" };
        }
        const reduced = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        let flashTimer = 0;
        function flashAt(ll: GMaps, label: string) {
          if (!flashEl) return;
          const c = localOfLL(ll);
          if (!c) return;
          // A tap on an outline's line had begun a long press: the dot's flash
          // takes the element over (Google reports the tap on pointerup, before
          // the touchend that would otherwise end the press and hide this).
          endPress();
          flashEl.style.transform = `translate(${c.x}px, ${c.y}px)`;
          flashEl.dataset.snapped = label ? "true" : "false";
          const tag = flashEl.querySelector<HTMLElement>("[data-fdm-label]");
          if (tag) tag.textContent = label;
          flashEl.style.display = "block";
          const ring = flashEl.querySelector<HTMLElement>("[data-fdm-ring]");
          if (ring?.animate && !reduced()) {
            ring.animate(
              [
                { transform: "translate(-50%, -50%) scale(0.6)", opacity: 1 },
                { transform: "translate(-50%, -50%) scale(1.5)", opacity: 0 },
              ],
              { duration: 400, easing: "ease-out" },
            );
          }
          window.clearTimeout(flashTimer);
          flashTimer = window.setTimeout(() => {
            flashEl.style.display = "none";
          }, 400);
        }
        const buzz = () => {
          try {
            navigator.vibrate?.(8);
          } catch {
            /* no vibration here */
          }
        };
        const hideAim = () => {
          if (aimEl) aimEl.style.display = "none";
          aimKey = "";
        };
        const renderAim = () => {
          if (!aim || !aimEl) return;
          const ax = aim.x;
          const ay = aim.y - AIM_LIFT_PX * hostZoom;
          const ev = synth(ax, ay);
          if (!ev.latLng) return;
          onMove(ev); // preview line, length chip, lit wall — the mouse's own path
          snapRing.setVisible(false); // the reticle is the ring here
          if (measureEl && measureEl.style.display !== "none") {
            // The chip speaks mouse ("click to close"); a finger RELEASES. And
            // on a phone-wide map it is kept inside the frame, under the reticle.
            measureEl.textContent = (measureEl.textContent ?? "")
              .replace(/Click/g, "Release")
              .replace(/click/g, "release")
              .replace("hover a fence line", "aim at a fence line");
            const l = localOfClient(ax, ay);
            const maxX = mountEl.offsetWidth - measureEl.offsetWidth - 8;
            measureEl.style.transform = `translate(${Math.max(8, Math.min(l.x + 14, maxX))}px, ${l.y + 22}px)`;
          }
          const hit = aimInfo(ev.latLng);
          const at = hit.label ? localOfLL(hit.ll) : localOfClient(ax, ay);
          if (!at) return;
          aimEl.style.transform = `translate(${at.x}px, ${at.y}px)`;
          aimEl.dataset.snapped = hit.label ? "true" : "false";
          const tag = aimEl.querySelector<HTMLElement>("[data-fdm-label]");
          if (tag) tag.textContent = hit.label;
          aimEl.style.display = "block";
          const key = hit.label ? `${hit.label}:${hit.ll.toUrlValue(6)}` : "";
          if (key && key !== aimKey) buzz();
          aimKey = key;
        };
        const cancelAim = (quiet?: boolean) => {
          if (!aim) return;
          window.clearTimeout(aim.timer);
          const wasLive = aim.live;
          aim = null;
          hideAim();
          if (wasLive) suppressClickUntil = performance.now() + 700;
          if (wasLive && !quiet) hideMeasure();
        };
        const aimEligible = (target: EventTarget | null) => {
          if (aligningRef.current || armedRef.current || selHouseRef.current) return false;
          if (mountEl.offsetParent === null) return false;
          return !(target instanceof Element && target.closest("button, a, [role='button']"));
        };
        /** A finger that lands on a dot, an opening or an outline's corner is
         *  going to drag it — that is Google's, not an aim. */
        const onHandle = (x: number, y: number) => {
          const pt = localOfClient(x, y);
          const near = (ll: GMaps | null | undefined) => {
            if (!ll) return false;
            const c = localOfLL(ll);
            return !!c && Math.hypot(c.x - pt.x, c.y - pt.y) <= HANDLE_PX;
          };
          for (const r of runs) {
            const pa = r.line.getPath();
            for (let i = 0; i < pa.getLength(); i++) if (near(pa.getAt(i))) return true;
          }
          for (const mk of openings.values()) {
            if (near(mk.center?.getPosition?.()) || near(mk.a?.getPosition?.()) || near(mk.b?.getPosition?.())) return true;
          }
          if (houseModeRef.current) {
            for (const h of siteRef.current.houses ?? []) for (const q of h.ring) if (near(new core.LatLng(q.lat, q.lng))) return true;
          }
          return false;
        };
        const touchOf = (list: TouchList, id: number) => {
          for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
          return null;
        };
        // ── Long press on a house outline = "edit this house" ──
        // Deliberate by construction: the finger (or the mouse button) has to
        // rest ON the outline's line for PRESS_MS without moving, and not while
        // a fence is being traced. A ring grows under it meanwhile, so the wait
        // is visible. Everything shorter is a tap — a fence dot.
        const PRESS_MS = 500;
        const PRESS_LINE_PX = 14;
        let press: { key: string; x: number; y: number; timer: number; anim: Animation | null } | null = null;
        const outlineAt = (x: number, y: number): string | null => {
          const pt = localOfClient(x, y);
          const cur = siteRef.current;
          const rings: Array<{ key: string; ring: LatLng[] }> = [
            ...(cur.houses ?? []).map((h) => ({ key: h.id, ring: h.ring })),
            ...(cur.detected ?? []).map((ring, i) => ({ key: `det:${i}`, ring })),
          ];
          let best: { key: string; d: number } | null = null;
          for (const { key, ring } of rings) {
            const px = ring.map((q) => localOfLL(new core.LatLng(q.lat, q.lng)));
            for (let i = 0; i < px.length; i++) {
              const a = px[i];
              const b = px[(i + 1) % px.length];
              if (!a || !b) continue;
              const d = distToSegFt(pt, a, b); // plain 2-D distance; the unit is whatever the points are in — px here
              if (d <= PRESS_LINE_PX && (!best || d < best.d)) best = { key, d };
            }
          }
          return best ? best.key : null;
        };
        function endPress() {
          if (!press) return;
          window.clearTimeout(press.timer);
          press.anim?.cancel();
          press = null;
          if (flashEl && flashEl.dataset.press === "true") {
            flashEl.dataset.press = "false";
            flashEl.style.display = "none";
          }
        }
        const beginPress = (x: number, y: number): boolean => {
          if (drawing || houseModeRef.current || aligningRef.current || armedRef.current || selHouseRef.current) return false;
          const key = outlineAt(x, y);
          if (!key) return false;
          endPress();
          let anim: Animation | null = null;
          if (flashEl) {
            const l = localOfClient(x, y);
            window.clearTimeout(flashTimer);
            flashEl.style.transform = `translate(${l.x}px, ${l.y}px)`;
            flashEl.dataset.snapped = "true";
            flashEl.dataset.press = "true";
            const tag = flashEl.querySelector<HTMLElement>("[data-fdm-label]");
            if (tag) tag.textContent = "hold to edit";
            flashEl.style.display = "block";
            const ring = flashEl.querySelector<HTMLElement>("[data-fdm-ring]");
            if (ring?.animate && !reduced()) {
              anim = ring.animate(
                [
                  { transform: "translate(-50%, -50%) scale(0.4)", opacity: 0.4 },
                  { transform: "translate(-50%, -50%) scale(1.6)", opacity: 1 },
                ],
                { duration: PRESS_MS, easing: "linear", fill: "forwards" },
              );
            }
          }
          const mine = { key, x, y, anim, timer: 0 };
          mine.timer = window.setTimeout(() => {
            if (press !== mine) return;
            endPress();
            cancelAim(true);
            hideMeasure();
            suppressClickUntil = performance.now() + 900; // the release is not a dot
            buzz();
            setSelHouse(key);
          }, PRESS_MS);
          press = mine;
          return true;
        };
        const movedPress = (x: number, y: number) => {
          if (press && Math.hypot(x - press.x, y - press.y) > AIM_SLOP_PX * hostZoom) endPress();
        };
        // The mouse's long press (touch has its own path below).
        const onMouseDown = (ev: PointerEvent) => {
          if (ev.pointerType === "touch" || ev.button !== 0) return;
          if (ev.target instanceof Element && ev.target.closest("button, a, [role='button']")) return;
          beginPress(ev.clientX, ev.clientY);
        };
        const onMouseTrack = (ev: PointerEvent) => {
          if (ev.pointerType !== "touch") movedPress(ev.clientX, ev.clientY);
        };
        const onMouseUp = (ev: PointerEvent) => {
          if (ev.pointerType !== "touch") endPress();
        };

        const onTouchStart = (ev: TouchEvent) => {
          lastTouchAt = performance.now();
          if (ev.touches.length !== 1) {
            endPress();
            cancelAim();
            return;
          }
          const t = ev.touches[0];
          if (!aimEligible(ev.target) || onHandle(t.clientX, t.clientY)) return;
          const a: Aim = { id: t.identifier, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, live: false, timer: 0 };
          // On an outline's line the hold belongs to the long press; the
          // reticle still comes up the moment the finger moves.
          if (!beginPress(t.clientX, t.clientY)) {
            a.timer = window.setTimeout(() => {
              if (aim === a && !a.live) {
                a.live = true;
                suppressClickUntil = Number.POSITIVE_INFINITY;
                buzz(); // felt as well as seen: from here the finger aims, it no longer moves the map
                renderAim();
              }
            }, AIM_HOLD_MS);
          }
          aim = a;
        };
        const onTouchMove = (ev: TouchEvent) => {
          if (!aim) return;
          if (ev.touches.length !== 1) {
            cancelAim();
            return;
          }
          const t = touchOf(ev.touches, aim.id);
          if (!t) return;
          if (!aim.live) {
            // Moving before the hold is up: the finger is moving the map. The
            // aim stands down (no dot on release) and Google pans with it.
            movedPress(t.clientX, t.clientY);
            if (Math.hypot(t.clientX - aim.x0, t.clientY - aim.y0) > AIM_SLOP_PX * hostZoom) cancelAim(true);
            return;
          }
          // An aiming finger never pans: Google does not get the move, and the
          // page under the map does not scroll.
          ev.stopImmediatePropagation();
          if (ev.cancelable) ev.preventDefault();
          aim.x = t.clientX;
          aim.y = t.clientY;
          movedPress(aim.x, aim.y);
          renderAim();
        };
        const onTouchEnd = (ev: TouchEvent) => {
          lastTouchAt = performance.now();
          endPress();
          if (!aim || touchOf(ev.touches, aim.id)) return;
          const a = aim;
          window.clearTimeout(a.timer);
          aim = null;
          hideAim();
          if (!a.live) return; // a tap: Google's click places it, under the finger
          suppressClickUntil = performance.now() + 700;
          const e2 = synth(a.x, a.y - AIM_LIFT_PX * hostZoom);
          hideMeasure();
          if (!e2.latLng) return;
          onMapClick(e2);
          onTouchAimRef.current?.();
        };
        const onTouchCancel = () => {
          endPress();
          cancelAim();
        };
        // The second finger may land anywhere — on the page beside the map, where
        // the surface's own listener never hears it.
        const onAnyTouchStart = (ev: TouchEvent) => {
          if (ev.touches.length > 1) endPress();
          if (aim && ev.touches.length > 1) cancelAim();
        };
        // Google listens with pointer events where it can: the same rule there.
        const onPointerMoveCapture = (ev: PointerEvent) => {
          if (aim?.live && ev.pointerType === "touch") ev.stopImmediatePropagation();
        };
        // A long press is a context menu on Android, which Google reports as a
        // right-click — and a right-click ends the run being aimed.
        const onContextMenu = (ev: Event) => {
          if (aim || press) {
            ev.preventDefault();
            ev.stopPropagation();
          }
        };
        mountEl.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
        window.addEventListener("touchstart", onAnyTouchStart, { capture: true, passive: true });
        window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
        mountEl.addEventListener("touchend", onTouchEnd, { capture: true });
        mountEl.addEventListener("touchcancel", onTouchCancel, { capture: true });
        window.addEventListener("pointermove", onPointerMoveCapture, { capture: true });
        mountEl.addEventListener("contextmenu", onContextMenu, { capture: true });
        mountEl.addEventListener("pointerdown", onMouseDown, { capture: true });
        window.addEventListener("pointermove", onMouseTrack, { capture: true });
        window.addEventListener("pointerup", onMouseUp, { capture: true });
        const removeTouchAim = () => {
          cancelAim(true);
          window.clearTimeout(flashTimer);
          mountEl.removeEventListener("touchstart", onTouchStart, { capture: true });
          window.removeEventListener("touchstart", onAnyTouchStart, { capture: true });
          window.removeEventListener("touchmove", onTouchMove, { capture: true });
          mountEl.removeEventListener("touchend", onTouchEnd, { capture: true });
          mountEl.removeEventListener("touchcancel", onTouchCancel, { capture: true });
          window.removeEventListener("pointermove", onPointerMoveCapture, { capture: true });
          mountEl.removeEventListener("contextmenu", onContextMenu, { capture: true });
          mountEl.removeEventListener("pointerdown", onMouseDown, { capture: true });
          window.removeEventListener("pointermove", onMouseTrack, { capture: true });
          window.removeEventListener("pointerup", onMouseUp, { capture: true });
          endPress();
        };

        const onKey = (ev: KeyboardEvent) => {
          if (ev.key === "Escape" && armedRef.current) {
            onDisarmRef.current();
            return;
          }
          if (ev.key === "Escape" && selHouseRef.current && !drawing && !houseModeRef.current) {
            setSelHouse(null);
            return;
          }
          // Drafting keys belong to the surface: not while it is hidden (the 3D
          // panel), and not while focus sits on a field or a button — Enter on a
          // focused "Cancel" is that button's, not "close the outline".
          const mount = mountRef.current;
          if (!mount || mount.offsetParent === null) return;
          const el = document.activeElement as HTMLElement | null;
          const outside = !!el && el !== document.body && !mount.contains(el);
          const typing = outside && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
          const onControl = typing || (outside && /^(BUTTON|A)$/.test(el.tagName));
          // Backspace / Delete are the surface's unless a field is being typed
          // in: a hand that just pressed the toolbar's Undo and reaches for
          // Backspace is still drawing (a button does nothing with Backspace).
          if (typing || (onControl && ev.key !== "Backspace" && ev.key !== "Delete")) return;
          if (ev.key === "Escape") {
            if (houseDraft.length) cancelHouse();
            else stopTrace();
            return;
          }
          if (ev.key === "Enter") {
            if (houseDraft.length >= 3) closeHouse();
            else if (drawing) stopTrace();
            return;
          }
          if (ev.key === "Backspace" || ev.key === "Delete") {
            if (houseDraft.length) {
              ev.preventDefault();
              houseDraft.pop();
              paintHouseDraft(null);
              notifyDraft();
            } else if (drawing) {
              ev.preventDefault();
              apiRef.current?.undo();
            } else if (selHouseRef.current && !selHouseRef.current.startsWith("det:")) {
              // The outline being edited goes, as a selected thing does.
              ev.preventDefault();
              onHouseRemoveRef.current?.(selHouseRef.current);
            }
          }
        };
        window.addEventListener("keydown", onKey);
        listeners.push(map.addListener("zoom_changed", reweighRuns));

        const setHouseModeOn = (on: boolean) => {
          houseModeRef.current = on;
          if (!on && houseDraft.length) cancelHouse();
          if (on) stopTrace();
          showRing(null);
          previewLine.setPath([]);
          map.setOptions({ draggableCursor: aligningRef.current ? "move" : "crosshair" });
        };

        apiRef.current = {
          clear: () => {
            while (runs.length) destroyRun(runs[runs.length - 1]);
            stopTrace();
            commit();
          },
          closeLoop: () => {
            const act = runs[activeIdx] ?? runs[runs.length - 1];
            if (!act) return;
            const pa = act.line.getPath();
            if (pa.getLength() < 3 || isClosedPath(pa)) return;
            pa.push(pa.getAt(0));
            commit();
            stopTrace();
          },
          undo: () => {
            const act = runs[activeIdx] ?? runs[runs.length - 1];
            if (!act) return;
            const pa = act.line.getPath();
            const n = pa.getLength();
            if (n > 0) {
              pa.removeAt(n - 1);
              if (n - 1 === 0) destroyRun(act);
              commit();
              if (!drawing) notifyDraft();
            }
          },
          setFromPoints: () => {
            seedRuns();
            renderOpenings();
          },
          setAlign: (on: boolean) => {
            aligningRef.current = on;
            setAligning(on);
            for (const r of runs) r.line.setOptions({ draggable: on, editable: !on });
            if (on) stopTrace();
            map.setOptions({ draggableCursor: on ? "move" : "crosshair" });
          },
          syncOpenings: renderOpenings,
          refreshCursor: () => {
            map.setOptions({ draggableCursor: aligningRef.current ? "move" : "crosshair" });
          },
          hideGhost,
          zoomBy: (delta: number) => {
            const z = map.getZoom();
            if (typeof z === "number") map.setZoom(z + delta);
          },
          resized: () => {
            const centre = map.getCenter();
            const g = (window as unknown as { google?: GMaps }).google;
            g?.maps?.event?.trigger?.(map, "resize");
            if (centre) map.setCenter(centre);
          },
          finishDraft: () => {
            if (houseDraft.length >= 3) closeHouse();
            else stopTrace();
          },
          undoDraft: () => {
            if (houseDraft.length) {
              houseDraft.pop();
              paintHouseDraft(null);
              notifyDraft();
            } else if (drawing) apiRef.current?.undo();
          },
          cancelDraft: () => {
            if (houseDraft.length) cancelHouse();
            else stopTrace();
          },
          setHouseMode: setHouseModeOn,
          openHouseDraft: (ring: PathPoint[]) => {
            setHouseModeOn(true);
            houseDraft.length = 0;
            for (const p of ring) houseDraft.push(ft2ll(p));
            paintHouseDraft(null);
            notifyDraft();
          },
        };

        seedRuns();
        renderOpenings();
        onApiRef.current?.(apiRef.current);
        gmapRef.current = map;
        mapsLibRef.current = maps;
        fittedRingRef.current = null; // a new map has not been fitted to anything
        setMapEpoch((e) => e + 1);

        cleanup = () => {
          onApiRef.current?.(null);
          onDraftChangeRef.current?.({ fence: false, houseCorners: 0 });
          drawHandlersRef.current = null;
          gmapRef.current = null;
          mapsLibRef.current = null;
          cancelAnimationFrame(raf);
          for (const l of listeners) l?.remove?.();
          while (runs.length) destroyRun(runs[runs.length - 1]);
          window.removeEventListener("keydown", onKey);
          window.removeEventListener("resize", readZoom);
          removeTouchAim();
          for (const mk of openings.values()) removeMarker(mk);
          openings.clear();
          projector.setMap(null);
          previewLine.setMap(null);
          ghostCenter.setMap(null);
          ghostSpan.setMap(null);
          snapRing.setMap(null);
          wallLine.setMap(null);
          houseLine.setMap(null);
          houseLineEdge.setMap(null);
          houseDots.forEach((d) => d.setMap(null));
        };
      } catch (err) {
        console.error("[FenceDrawMap] failed to build the map:", err);
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
      apiRef.current = null;
    };
    // Rebuild the map when the origin (address) changes.
  }, [enabled, lat, lng]);

  // ── Parcel overlay ─────────────────────────────────────────────────────────
  // Translucent lot fill + ink outline under the trace, and a heavier accent
  // stroke over the hovered side. Display-only objects, torn down whole on
  // every change — a parcel has a few dozen vertices, so rebuild is cheap and
  // there is no incremental state to get wrong.
  React.useEffect(() => {
    const map = gmapRef.current;
    const maps = mapsLibRef.current;
    if (!map || !maps) return;
    // Every lot of the property, not just the subject one: a house bought as two
    // adjoining deeds has two rings, and drawing one of them is drawing half the
    // land the fence goes round.
    const all = (parcel?.rings ?? (parcel?.ring ? [parcel.ring] : [])).filter((r) => r.length >= 3);
    if (!all.length) return;

    const pal: ParcelPalette = { ...DEFAULT_PARCEL, ...(parcelPaletteRef.current ?? {}) };
    const g0 = (window as unknown as { google?: GMaps }).google;
    const w0 = parcelWeights(map.getZoom());
    // A closed ring is solid; anything open (a draft, a partial side) is a
    // repeated dash. Maps cannot dash a stroke directly, so the dash is a
    // symbol repeated along the path.
    const isClosed = (path: LatLng[]) =>
      path.length >= 3 && path[0].lat === path[path.length - 1].lat && path[0].lng === path[path.length - 1].lng;
    // weight 0 = not drawn at this zoom (the ink edge below zoom 19)
    const strokeOpts = (path: LatLng[], color: string, weight: number) =>
      isClosed(path)
        ? { strokeColor: color, strokeOpacity: weight > 0 ? 1 : 0, strokeWeight: Math.max(weight, 0.1) }
        : {
            strokeOpacity: 0,
            icons:
              weight > 0
                ? [
                    {
                      icon: { path: "M 0,-1 0,1", strokeColor: color, strokeOpacity: 1, strokeWeight: weight, scale: 4 },
                      offset: "0",
                      repeat: "14px",
                    },
                  ]
                : [],
          };
    type Stroke = { line: GMaps; path: LatLng[]; color: string; role: "edge" | "core" };
    const strokes: Stroke[] = [];
    const weightOf = (role: Stroke["role"], w: { core: number; edge: number }) => (role === "core" ? w.core : w.edge ? w.core + 2 * w.edge : 0);
    const stroke = (path: LatLng[], color: string, role: Stroke["role"], zIndex: number) => {
      const line = new maps.Polyline({ map, path, clickable: false, zIndex, ...strokeOpts(path, color, weightOf(role, w0)) });
      strokes.push({ line, path, color, role });
      return line;
    };
    const polygons: GMaps[] = all.flatMap((r) => {
      const closed = [...r, r[0]];
      return [
        new maps.Polygon({
          map,
          paths: r,
          clickable: false,
          fillColor: pal.line,
          fillOpacity: 0.06,
          strokeOpacity: 0,
          zIndex: Z.parcelTint,
        }),
        // half a px of ink either side of the core: contrast on the photo, no blur.
        stroke(closed, pal.casing, "edge", Z.parcelCasing),
        stroke(closed, pal.line, "core", Z.parcelLine),
      ];
    });

    // Corner squares pin the lot's CORNERS — a turn sharper than
    // CORNER_KEEP_DEG. A surveyed point along a straight side or a curve has
    // no square of its own: it appears, filled, only while a fence dot is
    // snapping to it. Corners closer than CORNER_MIN_PX on screen collapse
    // into one. Recomputed on every zoom; the ring itself is never changed.
    type Corner = { ll: LatLng; casing: GMaps; square: GMaps; keep: boolean };
    const corners: Corner[] = [];
    const squareIcon = (fill: string) => ({
      path: CORNER_SQUARE,
      scale: 1,
      fillColor: fill,
      fillOpacity: 1,
      strokeColor: pal.line,
      strokeWeight: 1,
    });
    const turnDeg = (a: LatLng, b: LatLng, c: LatLng) => {
      const k = Math.cos((b.lat * Math.PI) / 180);
      const v1 = [(b.lng - a.lng) * k, b.lat - a.lat];
      const v2 = [(c.lng - b.lng) * k, c.lat - b.lat];
      const n1 = Math.hypot(v1[0], v1[1]);
      const n2 = Math.hypot(v2[0], v2[1]);
      if (n1 < 1e-12 || n2 < 1e-12) return 180;
      const cos = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)));
      return (Math.acos(cos) * 180) / Math.PI;
    };
    if (g0?.maps?.Marker) {
      for (const r of all) {
        r.forEach((p, i) => {
          const prev = r[(i - 1 + r.length) % r.length];
          const next = r[(i + 1) % r.length];
          const keep = turnDeg(prev, p, next) >= CORNER_KEEP_DEG;
          const casing = new g0.maps.Marker({
            map,
            position: p,
            clickable: false,
            zIndex: 1,
            icon: { path: CORNER_SQUARE, scale: 1, fillOpacity: 0, strokeColor: pal.casing, strokeWeight: 2.5 },
          });
          const square = new g0.maps.Marker({ map, position: p, clickable: false, zIndex: 2, icon: squareIcon(pal.dot) });
          corners.push({ ll: p, casing, square, keep });
        });
      }
    }
    const thinCorners = () => {
      const proj = map.getProjection?.();
      const zoom = map.getZoom?.();
      if (!proj || typeof zoom !== "number" || !g0?.maps?.LatLng) return;
      const scale = 2 ** zoom;
      const px = (ll: LatLng) => {
        const w = proj.fromLatLngToPoint(new g0.maps.LatLng(ll.lat, ll.lng));
        return { x: w.x * scale, y: w.y * scale };
      };
      let last: { x: number; y: number } | null = null;
      for (const c of corners) {
        const q = px(c.ll);
        const show = c === activeCorner || (c.keep && (!last || Math.hypot(q.x - last.x, q.y - last.y) >= CORNER_MIN_PX));
        c.casing.setVisible(show);
        c.square.setVisible(show);
        if (show && c.keep) last = q;
      }
    };
    let activeCorner: Corner | null = null;
    thinCorners();
    const reweigh = () => {
      const w = parcelWeights(map.getZoom());
      for (const st of strokes) st.line.setOptions(strokeOpts(st.path, st.color, weightOf(st.role, w)));
      thinCorners();
    };
    const zoomListener = map.addListener("zoom_changed", reweigh);
    // The point the snap ring is on fills with the active colour (and, when it
    // is not a corner, is shown for as long as the snap holds).
    parcelActiveRef.current = (ll: GMaps | null) => {
      let hit: Corner | null = null;
      if (ll) {
        const lat = ll.lat();
        const lng = ll.lng();
        hit = corners.find((c) => Math.abs(c.ll.lat - lat) < 1e-7 && Math.abs(c.ll.lng - lng) < 1e-7) ?? null;
      }
      if (hit === activeCorner) return;
      activeCorner?.square.setIcon(squareIcon(pal.dot));
      hit?.square.setIcon({ ...squareIcon(pal.active), strokeColor: pal.active });
      activeCorner = hit;
      thinCorners();
    };

    // The side under the cursor in the host's list: the active colour, half a
    // px wider than the line, on the same ink edge — 3 px at the most.
    const highlightLines: GMaps[] = [];
    const hi = parcel?.highlight;
    if (hi && hi.length >= 2) {
      highlightLines.push(
        new maps.Polyline({ map, path: hi, clickable: false, strokeColor: pal.casing, strokeOpacity: 1, strokeWeight: Math.min(3, w0.core + 1), zIndex: Z.highlight }),
        new maps.Polyline({ map, path: hi, clickable: false, strokeColor: pal.active, strokeOpacity: 1, strokeWeight: Math.min(2, w0.core + 0.5), zIndex: Z.highlight }),
      );
    }

    // A NEW ring (not a hover change) gets the camera: fit the lot once so a
    // large parcel is not half off-screen at the address zoom. LatLngBounds is
    // a core class — read off the global namespace the loader has populated.
    const g = (window as unknown as { google?: GMaps }).google;
    // Keyed by the GEOMETRY: a host that rebuilds the prop object on every
    // update (hover, trace commit) must not yank the camera back to the lot.
    const fitKey = all.map((r) => `${r.length}:${r[0].lat.toFixed(6)},${r[0].lng.toFixed(6)}`).join("|");
    if (fittedRingRef.current !== fitKey && g?.maps?.LatLngBounds) {
      fittedRingRef.current = fitKey;
      const b = new g.maps.LatLngBounds();
      for (const r of all) for (const p of r) b.extend(p);
      map.fitBounds(b, fitPaddingRef.current);
    }

    return () => {
      polygons.forEach((p) => p.setMap(null));
      highlightLines.forEach((p) => p.setMap(null));
      corners.forEach((c) => {
        c.casing.setMap(null);
        c.square.setMap(null);
      });
      zoomListener?.remove?.();
      parcelActiveRef.current = null;
    };
  }, [parcel, mapEpoch]);

  // ── Parcel boundary tiles ──────────────────────────────────────────────────
  // ReportAll's raster line-work for EVERY parcel in view, through the
  // /api/parcel-tiles proxy (separate ALLTIME tile quota; the key stays on the
  // server). Sits under the polygon and the trace.
  React.useEffect(() => {
    const map = gmapRef.current;
    const maps = mapsLibRef.current;
    if (!map || !maps || !parcelTiles) return;
    // Size is a core class — global namespace, same reasoning as LatLngBounds.
    const g = (window as unknown as { google?: GMaps }).google;
    if (!g?.maps?.Size) return;
    const layer = new maps.ImageMapType({
      getTileUrl: (coord: { x: number; y: number }, zoom: number) =>
        zoom >= 14 && zoom <= 21 ? `/api/parcel-tiles/${zoom}/${coord.x}/${coord.y}` : null,
      tileSize: new g.maps.Size(256, 256),
      opacity: 0.85,
      name: "Parcels",
    });
    map.overlayMapTypes.push(layer);
    return () => {
      const idx = map.overlayMapTypes.getArray().indexOf(layer);
      if (idx >= 0) map.overlayMapTypes.removeAt(idx);
    };
  }, [parcelTiles, mapEpoch]);

  // ── Buildings: detected footprints (faint) and traced houses ───────────────
  // A traced house is inked like a drawing — white wall line on a dark casing
  // over a dark tint — and while the House tool is on its corners drag.
  // Detected footprints are context: a thin line so the contractor can see
  // what the 3D will stand up, and what the snapping will catch.
  React.useEffect(() => {
    const map = gmapRef.current;
    const maps = mapsLibRef.current;
    if (!map || !maps) return;
    const objs: GMaps[] = [];
    const listeners: GMaps[] = [];
    const origin: LatLng = typeof lat === "number" && typeof lng === "number" ? { lat, lng } : DEFAULT_CENTER;
    const pal: HousePalette = { ...DEFAULT_HOUSE, ...(housePaletteRef.current ?? {}) };
    // Every outline is two polylines — a paper edge under an ink core — whose
    // widths follow the zoom (houseWeights); a footprint is the same pair at
    // 60 % so it reads as context next to a traced house.
    type Outline = { edge: GMaps; core: GMaps; faint: boolean };
    const outlines: Outline[] = [];
    const outline = (ring: LatLng[], faint: boolean, picked: boolean): Outline => {
      const closed = [...ring, ring[0]];
      const w = houseWeights(map.getZoom());
      const op = faint && !picked ? 0.6 : 1;
      const edge = new maps.Polyline({
        map,
        path: closed,
        clickable: false,
        strokeColor: pal.edge,
        strokeOpacity: w.edge ? op : 0,
        strokeWeight: w.core + 2 * w.edge,
        zIndex: Z.house,
      });
      const core = new maps.Polyline({
        map,
        path: closed,
        clickable: false,
        strokeColor: picked ? pal.active : pal.line,
        strokeOpacity: op,
        strokeWeight: w.core,
        zIndex: Z.house,
      });
      objs.push(edge, core);
      const o = { edge, core, faint: faint && !picked };
      outlines.push(o);
      return o;
    };
    const reweigh = () => {
      const w = houseWeights(map.getZoom());
      for (const o of outlines) {
        o.edge.setOptions({ strokeWeight: w.core + 2 * w.edge, strokeOpacity: w.edge ? (o.faint ? 0.6 : 1) : 0 });
        o.core.setOptions({ strokeWeight: w.core });
      }
    };
    // An outline that is NOT being edited is lines only — nothing over the
    // map to take a click, so a tap inside or beside a house is what it is
    // anywhere else: a fence dot, snapped to the wall if one is near. The
    // outline being edited (and every traced house while the House trace is
    // on) carries an invisible polygon: the drag that moves it whole and — for
    // a traced house — Google's corner handles.
    const editablePoly = (key: string, ring: LatLng[], o: Outline, handles: boolean, moved: (ring: LatLng[], from: LatLng[]) => void) => {
      const picked = selHouse === key;
      if (!picked && !(houseMode && handles)) return;
      const poly = new maps.Polygon({
        map,
        paths: ring,
        clickable: true,
        editable: handles && (houseMode || picked),
        draggable: picked && !houseMode,
        geodesic: false,
        fillOpacity: 0,
        strokeColor: pal.active,
        strokeOpacity: 0,
        strokeWeight: 1.5,
        zIndex: Z.house,
      });
      objs.push(poly);
      let dragging = false;
      const path = poly.getPath();
      const read = (): LatLng[] => path.getArray().map((ll: GMaps) => ({ lat: ll.lat(), lng: ll.lng() }));
      listeners.push(
        poly.addListener("click", (e: GMaps) => {
          if (e?.vertex != null) return;
          if (houseMode) drawHandlersRef.current?.click(e);
        }),
        poly.addListener("mousemove", (e: GMaps) => drawHandlersRef.current?.move(e)),
        poly.addListener("dblclick", () => drawHandlersRef.current?.dblclick()),
        poly.addListener("rightclick", (e: GMaps) => {
          if (e?.vertex == null) {
            drawHandlersRef.current?.rightclick();
            return;
          }
          // A right-click on a corner of the outline being edited takes that
          // corner out (never below a triangle) — the wrong click, undone in
          // place rather than by redrawing the house.
          if (handles && picked && !dragging && path.getLength() > 3) path.removeAt(e.vertex);
        }),
        // While it moves the polygon draws itself; the two-line outline stays
        // behind and is rebuilt where the hand lets go.
        poly.addListener("dragstart", () => {
          dragging = true;
          o.edge.setVisible(false);
          o.core.setVisible(false);
          poly.setOptions({ strokeOpacity: 1 });
        }),
        poly.addListener("dragend", () => {
          dragging = false;
          moved(read(), ring);
        }),
      );
      if (handles) {
        const changed = () => {
          if (!dragging) moved(read(), ring);
        };
        listeners.push(path.addListener("set_at", changed), path.addListener("insert_at", changed), path.addListener("remove_at", changed));
      }
    };
    (detectedBuildings ?? []).forEach((ring, i) => {
      if (ring.length < 3) return;
      const key = `det:${i}`;
      const o = outline(ring, true, selHouse === key);
      // A footprint moves, it is not reshaped: "Use detected outline" makes a
      // traced house of it, and that one has corners to drag.
      editablePoly(key, ring, o, false, (now, from) => {
        const a = latLngToLocalFeet(origin, from[0]);
        const b = latLngToLocalFeet(origin, now[0]);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.hypot(dx, dy) > 0.05) onDetectedShiftRef.current?.(dx, dy);
      });
    });
    for (const h of houses ?? []) {
      if (h.ring.length < 3) continue;
      if (pal.fill && pal.fillOpacity > 0) {
        // Under the outline, over the photo; never takes a click — a tap on a
        // house is a fence dot snapping to its wall, as anywhere else.
        objs.push(
          new maps.Polygon({
            map,
            paths: h.ring,
            clickable: false,
            fillColor: pal.fill,
            fillOpacity: pal.fillOpacity,
            strokeOpacity: 0,
            strokeWeight: 0,
            zIndex: Z.house,
          }),
        );
      }
      const o = outline(h.ring, false, selHouse === h.id);
      editablePoly(h.id, h.ring, o, true, (now) =>
        onHouseChangeRef.current?.(
          h.id,
          now.map((q) => latLngToLocalFeet(origin, q)),
        ),
      );
    }
    listeners.push(map.addListener("zoom_changed", reweigh));
    // Variant 2: the inside of a traced house hatched in faint ink — an SVG
    // in the overlay pane, re-projected on every draw like the labels.
    let hatch: (() => void) | null = null;
    const hatchRings = pal.hatched ? (houses ?? []).map((h) => h.ring).filter((r) => r.length >= 3) : [];
    if (hatchRings.length) hatch = mountHatchLayer(maps, map, hatchRings, pal.edge, pal.line);
    return () => {
      listeners.forEach((l) => l?.remove?.());
      objs.forEach((o) => o.setMap(null));
      hatch?.();
    };
  }, [houses, detectedBuildings, houseMode, selHouse, lat, lng, mapEpoch]);

  React.useEffect(() => {
    selHouseRef.current = selHouse;
  }, [selHouse]);
  // ── Topography ─────────────────────────────────────────────────────────────
  // Contours on the land. Built whole from the host's overlay, which the host
  // memoises — the object only changes when the ground, the lot or the toggle
  // does, not on every trace commit.
  React.useEffect(() => {
    const map = gmapRef.current;
    const maps = mapsLibRef.current;
    if (!map || !maps || !topo) return;
    const pal: TopoPalette = { ...DEFAULT_TOPO, ...(topoPaletteRef.current ?? {}) };
    const polys: GMaps[] = [];
    for (const line of topo.lines) {
      const color = line.major ? pal.major : pal.line;
      for (const path of line.inside) {
        polys.push(
          new maps.Polyline({
            map,
            path,
            clickable: false,
            strokeColor: pal.casing,
            strokeOpacity: 0.5,
            strokeWeight: line.major ? 5 : 3.5,
            zIndex: Z.topoCasing,
          }),
          new maps.Polyline({
            map,
            path,
            clickable: false,
            strokeColor: color,
            strokeOpacity: 0.95,
            strokeWeight: line.major ? 2.5 : 1.5,
            zIndex: Z.topo,
          }),
        );
      }
      for (const path of line.outside) {
        polys.push(
          new maps.Polyline({
            map,
            path,
            clickable: false,
            strokeColor: color,
            strokeOpacity: 0.4,
            strokeWeight: line.major ? 1.8 : 1.1,
            zIndex: Z.topo,
          }),
        );
      }
    }
    return () => {
      polys.forEach((p) => p.setMap(null));
    };
  }, [topo, mapEpoch]);

  // ── Terrain overlay ────────────────────────────────────────────────────────
  // Non-level segments recoloured over the trace (amber racked / red stepped).
  // Display only: the grade, rise and class are ON the map in the segment's
  // chip (see Map labels) and in the ledger row, so a click on a sloped line
  // belongs to drawing — branching a new run off it, placing an opening —
  // instead of opening a card over the spot being traced.
  React.useEffect(() => {
    const map = gmapRef.current;
    const maps = mapsLibRef.current;
    if (!map || !maps || !terrain?.length) return;
    const origin: LatLng = typeof lat === "number" && typeof lng === "number" ? { lat, lng } : DEFAULT_CENTER;
    const lines: GMaps[] = [];
    for (const t of terrain) {
      const a = points[t.seg];
      const b = points[t.seg + 1];
      if (!a || !b || b.gap) continue;
      lines.push(
        new maps.Polyline({
          map,
          path: [localFeetToLatLng(origin, a), localFeetToLatLng(origin, b)],
          clickable: false,
          strokeColor: t.cls === "stepped" ? STEPPED_COLOR : RACKED_COLOR,
          strokeOpacity: 0.95,
          strokeWeight: 5,
          zIndex: Z.terrain,
        }),
      );
    }
    return () => {
      lines.forEach((l) => l.setMap(null));
    };
  }, [terrain, points, lat, lng, mapEpoch]);

  // ── Map labels ─────────────────────────────────────────────────────────────
  // Every text label on the ground in ONE layer, so a collision is settled
  // across all of them: the slope chips on the fence outrank the HIGH / LOW
  // marks, which outrank index-contour labels, which outrank the rest. Two
  // layers could not see each other, and a chip landed on the "+20 FT" mark.
  React.useEffect(() => {
    const map = gmapRef.current;
    const maps = mapsLibRef.current;
    if (!map || !maps) return;
    const pal: TopoPalette = { ...DEFAULT_TOPO, ...(topoPaletteRef.current ?? {}) };
    const origin: LatLng = typeof lat === "number" && typeof lng === "number" ? { lat, lng } : DEFAULT_CENTER;
    const items: MapLabel[] = [];
    // Every traced segment carries its length on the map; a racked or stepped
    // one also carries its grade, so the slope stays ON the map and not only
    // behind a click.
    const slopeBySeg = new Map((terrain ?? []).map((t) => [t.seg, t]));
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (b.gap) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 4) continue;
      const t = slopeBySeg.get(i);
      const at = localFeetToLatLng(origin, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      if (t) {
        const color = t.cls === "stepped" ? STEPPED_COLOR : RACKED_COLOR;
        const pct = Math.round(Math.tan((t.thetaDeg * Math.PI) / 180) * 100);
        const how = t.cls === "stepped" ? `${t.steps ?? 1} STEPS` : "RACKED";
        items.push({
          at,
          text: `${Math.round(len)} FT · ${pct}% · ${how}`,
          priority: 5,
          minZoom: 16,
          lift: true,
          style: {
            font: `700 10.5px/16px ${pal.font}`,
            color,
            background: "#ffffff",
            border: `2px solid ${color}`,
            borderRadius: "2px",
            padding: "0 6px",
            letterSpacing: "0.04em",
          },
        });
      } else {
        items.push({
          at,
          text: `${Math.round(len)} FT`,
          priority: 4,
          minZoom: 17,
          lift: true,
          style: {
            font: `700 10px/15px ${pal.font}`,
            color: pal.ink,
            background: "#ffffff",
            border: `1.5px solid ${pal.ink}`,
            borderRadius: "2px",
            padding: "0 5px",
            letterSpacing: "0.04em",
          },
        });
      }
    }
    for (const m of wallMounts ?? []) {
      items.push({
        at: m,
        text: "WALL MOUNT",
        priority: 4.5,
        minZoom: 17,
        lift: true,
        style: {
          font: `800 9.5px/14px ${pal.font}`,
          color: "#ffffff",
          background: pal.ink,
          padding: "1px 5px",
          borderRadius: "2px",
          letterSpacing: "0.08em",
        },
      });
    }
    for (const h of houses ?? []) {
      if (h.ring.length < 3) continue;
      const ft = h.ring.map((q) => latLngToLocalFeet(origin, q));
      let cx = 0;
      let cy = 0;
      for (const q of ft) {
        cx += q.x / ft.length;
        cy += q.y / ft.length;
      }
      items.push({
        at: localFeetToLatLng(origin, { x: cx, y: cy }),
        text: `${h.label.toUpperCase()} · ${Math.round(ringAreaSqFt(ft)).toLocaleString("en-US")} SQ FT`,
        priority: 3,
        minZoom: 17,
        style: {
          font: `800 9.5px/14px ${pal.font}`,
          color: pal.ink,
          background: pal.paper,
          border: `1.5px solid ${pal.ink}`,
          padding: "0 5px",
          borderRadius: "2px",
          letterSpacing: "0.08em",
        },
      });
    }
    for (const m of topo?.marks ?? []) {
      items.push({
        at: m.at,
        text: (m.kind === "high" ? "▲ " : "▼ ") + m.text.toUpperCase(),
        priority: 3,
        minZoom: 15,
        lift: true,
        style: {
          font: `700 10px/15px ${pal.font}`,
          color: "#ffffff",
          background: pal.ink,
          padding: "1px 6px",
          borderRadius: "2px",
          letterSpacing: "0.06em",
          boxShadow: `2px 2px 0 ${pal.paper}`,
        },
      });
    }
    for (const l of topo?.labels ?? []) {
      items.push({
        at: l.at,
        text: l.text,
        angleDeg: l.angleDeg,
        priority: l.major ? 2 : 1,
        minZoom: 17,
        style: {
          font: `${l.major ? 800 : 600} 10px/14px ${pal.font}`,
          color: pal.ink,
          background: pal.paper,
          border: l.major ? `1.5px solid ${pal.ink}` : "1px solid rgba(10, 10, 10, 0.45)",
          borderRadius: "2px",
          padding: "0 4px",
          letterSpacing: "0.02em",
        },
      });
    }
    // Above the fence's dots (z 20) and the house tracer's (27), under the
    // drag handles (30+) — at 1 the dots printed over the chips' letters.
    const corners = points.map((q) => localFeetToLatLng(origin, q));
    return mountLabelLayer(maps, map, items, LABEL_Z, corners);
  }, [topo, terrain, points, houses, wallMounts, lat, lng, mapEpoch]);

  if (!enabled) {
    // A chrome-less host renders its own empty state (the blueprint studio keeps
    // its `.map-slot` placeholder), so don't paint this one over it.
    if (!chrome) return null;
    return (
      <div className={cn("grid place-items-center text-center p-6 bg-[color:var(--paper)]", className)}>
        <div className="max-w-xs text-[12px] text-[color:var(--ink-muted)] leading-relaxed">
          Map drawing needs a Google Maps browser key. Set{" "}
          <span className="font-mono text-[11px] text-[color:var(--ink-soft)]">
            NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY
          </span>{" "}
          to trace a fence over satellite imagery. The 3D sandbox and pricing still work without it.
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div ref={mountRef} className="absolute inset-0" />

      {/* Live measurement chip — positioned imperatively from map mousemove.
          `data-fdm="len"` is a STYLE HOOK, not behaviour: this chip renders even
          for a chrome-less host, so a host with its own design system (the
          blueprint Fence studio) needs one stable selector to re-skin it. The
          utility classes below stay the default look for every other host. */}
      <div
        ref={measureRef}
        data-fdm="len"
        style={{ display: "none" }}
        className="pointer-events-none absolute left-0 top-0 z-[5] rounded-full bg-[color:var(--ink)]/90 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white shadow-[var(--shadow-sm)] will-change-transform"
      />

      {/* Touch reticle and the "it landed here" flash — placed imperatively by
          the touch-aim block. `data-fdm` hooks, like the chip above: the host
          skins them; `data-snapped` says whether a target has been caught. */}
      <div ref={aimRef} data-fdm="aim" data-snapped="false" aria-hidden="true" style={{ display: "none" }} className="pointer-events-none absolute left-0 top-0 z-[6] will-change-transform">
        <span data-fdm-cross="h" />
        <span data-fdm-cross="v" />
        <span data-fdm-ring="" />
        <span data-fdm-label="" />
      </div>
      <div ref={flashRef} data-fdm="flash" data-snapped="false" aria-hidden="true" style={{ display: "none" }} className="pointer-events-none absolute left-0 top-0 z-[6]">
        <span data-fdm-ring="" />
        <span data-fdm-label="" />
      </div>

      {/* Draw controls (left) */}
      {chrome && (
      <div className="absolute left-3 top-3 flex gap-1.5">
        <MapBtn
          onClick={toggleAlign}
          active={aligning}
          icon={<Move className="h-3.5 w-3.5" />}
          label={aligning ? "Aligning" : "Align"}
        />
        <MapBtn onClick={() => apiRef.current?.closeLoop()} icon={<Spline className="h-3.5 w-3.5" />} label="Close loop" />
        <MapBtn onClick={() => apiRef.current?.undo()} icon={<Undo2 className="h-3.5 w-3.5" />} label="Undo" />
        <MapBtn onClick={() => apiRef.current?.clear()} icon={<Trash2 className="h-3.5 w-3.5" />} label="Clear" />
      </div>
      )}

      {/* Add gate / door tools (right) — each opens a minimal type picker; pick a
          variant to arm it, then click the map to place. */}
      {chrome && (
      <div className="absolute right-3 top-3 flex gap-1.5">
        <OpeningPicker
          kind="gate"
          label="Gate"
          icon={<DoorOpen className="h-3.5 w-3.5" />}
          armed={armed}
          disabled={!hasFence}
          open={openMenu === "gate"}
          onOpenChange={(o) => setOpenMenu(o ? "gate" : null)}
          customOpenings={customOpenings}
          onPick={(v) => {
            onArm("gate", v);
            setOpenMenu(null);
          }}
          onDisarm={onDisarm}
        />
        <OpeningPicker
          kind="door"
          label="Door"
          icon={<DoorClosed className="h-3.5 w-3.5" />}
          armed={armed}
          disabled={!hasFence}
          open={openMenu === "door"}
          onOpenChange={(o) => setOpenMenu(o ? "door" : null)}
          customOpenings={customOpenings}
          onPick={(v) => {
            onArm("door", v);
            setOpenMenu(null);
          }}
          onDisarm={onDisarm}
        />
      </div>
      )}

      {chrome && (
      <div className="absolute inset-x-0 bottom-3 flex justify-center px-3 pointer-events-none">
        <span
          className={cn(
            "rounded-full backdrop-blur hairline px-3 py-1 text-[11px] text-center",
            armed
              ? "bg-[color:var(--accent)] text-white shadow-[var(--shadow-sm)]"
              : "bg-white/85 text-[color:var(--ink-muted)]",
          )}
        >
          {armed
            ? `Placing a ${armed.kind} — click a fence line (snaps if close, else drops free) · Esc to cancel`
            : aligning
              ? "Drag the whole outline to line it up with the lot — shape & size stay locked"
              : "Click to trace — dots magnet when close (close / connect) · right-click to stop · after stopping, click open ground to start a separate fence · right-click a dot to remove"}
        </span>
      </div>
      )}
    </div>
  );
}

function MapBtn({
  onClick,
  icon,
  label,
  active,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full backdrop-blur hairline px-2.5 py-1 text-[11px] font-medium shadow-[var(--shadow-sm)]",
        active
          ? "bg-[color:var(--accent)] text-white hover:bg-[color:var(--accent)]"
          : "bg-white/90 text-[color:var(--ink-soft)] hover:bg-white",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// Prominent placement tool (lives on the map). Disabled until a fence exists.
// The Gate / Door tool: a pill that opens a minimal dropdown of opening types
// (line icon + name + width). Picking one arms it for placement; clicking the
// pill while its kind is armed cancels (same muscle memory as the old toggle).
function OpeningPicker({
  kind,
  label,
  icon,
  armed,
  disabled,
  open,
  onOpenChange,
  customOpenings,
  onPick,
  onDisarm,
}: {
  kind: OpeningKind;
  label: string;
  icon: React.ReactNode;
  armed: ArmedOpening | null;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customOpenings: CustomOpening[];
  onPick: (variant: string) => void;
  onDisarm: () => void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Outside click / Esc closes the menu (listeners only while open).
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  const isArmed = armed?.kind === kind;
  const builtIns = kind === "gate" ? GATE_VARIANTS : DOOR_VARIANTS;
  const customs = customOpenings.filter((o) => o.kind === kind);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          if (isArmed) {
            onDisarm();
            onOpenChange(false);
          } else {
            onOpenChange(!open);
          }
        }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={disabled ? "Draw a fence first" : undefined}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 h-8 text-[12px] font-semibold shadow-[var(--shadow-sm)] transition-colors",
          disabled
            ? "bg-white/70 text-[color:var(--ink-faint)] cursor-not-allowed"
            : isArmed
              ? "bg-[color:var(--accent)] text-white"
              : "bg-white/95 text-[color:var(--accent-ink)] hover:bg-white",
        )}
      >
        {icon}
        {isArmed ? "Placing…" : label}
        {!isArmed && (
          <ChevronDown className={cn("h-3 w-3 opacity-60 transition-transform", open && "rotate-180")} />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1.5 min-w-[176px] overflow-hidden rounded-[var(--r-md)] bg-white/95 backdrop-blur hairline shadow-[var(--shadow-md)]"
        >
          {builtIns.map((v) => (
            <PickerRow
              key={v}
              name={VARIANT_LABEL[v] ?? v}
              widthFt={presetWidthFt(kind, v)}
              active={isArmed && armed?.variant === v}
              glyph={<VariantGlyph kind={kind} variant={v} />}
              onClick={() => onPick(v)}
            />
          ))}
          {customs.length > 0 && <div className="h-px bg-[color:var(--ink-line)]" />}
          {customs.map((o) => (
            <PickerRow
              key={o.id}
              name={o.name}
              widthFt={o.widthFt}
              active={isArmed && armed?.variant === o.id}
              glyph={<VariantGlyph kind={kind} variant="custom" />}
              onClick={() => onPick(o.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PickerRow({
  name,
  widthFt,
  active,
  glyph,
  onClick,
}: {
  name: string;
  widthFt: number;
  active?: boolean;
  glyph: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-2.5 h-9 text-left text-[12px] transition-colors",
        active
          ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-ink)]"
          : "text-[color:var(--ink-soft)] hover:bg-black/[0.03]",
      )}
    >
      <span className={cn(active ? "text-[color:var(--accent-ink)]" : "text-[color:var(--ink-muted)]")}>{glyph}</span>
      <span className="font-medium truncate">{name}</span>
      <span className="ml-auto tabular-nums text-[11px] text-[color:var(--ink-faint)]">{widthFt} ft</span>
    </button>
  );
}

// Tiny line glyphs for the opening types — gates read wide, doors narrow,
// custom types dashed. Stroke-only so they stay quiet at menu scale.
function VariantGlyph({ kind, variant }: { kind: OpeningKind; variant: string }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg viewBox="0 0 20 15" className="h-[15px] w-5 shrink-0" aria-hidden {...common}>
      {kind === "gate" && variant === "single" && (
        <>
          <rect x="1.2" y="1.2" width="17.6" height="12.6" rx="1.2" />
          <line x1="1.2" y1="13.8" x2="18.8" y2="1.2" />
        </>
      )}
      {kind === "gate" && variant === "double" && (
        <>
          <rect x="1.2" y="1.2" width="8" height="12.6" rx="1" />
          <rect x="10.8" y="1.2" width="8" height="12.6" rx="1" />
        </>
      )}
      {kind === "gate" && variant === "triple" && (
        <>
          <rect x="1.2" y="1.2" width="5.2" height="12.6" rx="0.8" />
          <rect x="7.4" y="1.2" width="5.2" height="12.6" rx="0.8" />
          <rect x="13.6" y="1.2" width="5.2" height="12.6" rx="0.8" />
        </>
      )}
      {kind === "gate" && variant === "arched" && <path d="M1.2 13.8 V6.5 Q10 0.6 18.8 6.5 V13.8 Z" />}
      {kind === "gate" && variant === "custom" && (
        <rect x="1.2" y="1.2" width="17.6" height="12.6" rx="1.2" strokeDasharray="2.6 2.2" />
      )}
      {kind === "door" && variant === "solid" && (
        <>
          <rect x="6.2" y="1.2" width="7.6" height="12.6" rx="1" />
          <rect x="8.4" y="3.8" width="3.2" height="5.2" rx="0.6" />
        </>
      )}
      {kind === "door" && variant === "slatted" && (
        <>
          <rect x="6.2" y="1.2" width="7.6" height="12.6" rx="1" />
          <line x1="7.6" y1="5" x2="12.4" y2="5" />
          <line x1="7.6" y1="8" x2="12.4" y2="8" />
          <line x1="7.6" y1="11" x2="12.4" y2="11" />
        </>
      )}
      {kind === "door" && variant === "custom" && (
        <rect x="6.2" y="1.2" width="7.6" height="12.6" rx="1" strokeDasharray="2.6 2.2" />
      )}
    </svg>
  );
}

"use client";
// THE YARD ON THE AERIAL PHOTO (lawn estimator, 2026-10-18; redrawn 2026-10-19 — owner, of a wooded lot tinted pixel
// by pixel: "looks very bad … make outlines where you identify this is really the maintained place … color it
// better"). The USDA photo the property was read from, left as it is; the maintained yard drawn on it as one white
// outline, everything outside it dimmed (the woods, the field, the neighbours'); inside, the lawn, the beds and the pool
// each outlined and lightly filled, the lawn's pieces labelled with their size. "Map" shows every class flat. A brush
// corrects the reading inside the lot (never over the house); a tap counts a dimmed piece in or leaves a piece out.
// The numbers redo when the stroke ends. A lot line can be clicked in where the county has none, corner by corner.
import * as React from "react";
// Styled by the page that mounts it: `.lw-map` and `.lw-map-attr` live in lawn-estimator.css (desk and phone).
import type { Pt } from "@/lib/lawn/geo";
import { CLS } from "@/lib/lawn/classify";
import { chaikin, outlinesOf, pieceSpots } from "@/lib/lawn/vectorize";
import { yardArea } from "@/lib/lawn/yard";

/** Each class's colour — the "Map" view's fill, the brush's swatch. */
export const CLASS_COLOR: Record<number, [number, number, number]> = {
  [CLS.LAWN]: [132, 204, 22],
  [CLS.TREE]: [22, 101, 52],
  [CLS.BED]: [217, 119, 6],
  [CLS.HARD]: [203, 213, 225],
  [CLS.BUILDING]: [234, 88, 12],
  [CLS.WATER]: [14, 165, 233],
  [CLS.NATURAL]: [168, 162, 128],
};

/** The outlines on the photo: a light fill, a bright line over a dark halo so it reads on grass and on crowns alike. */
const LAYERS: Array<{ cls: number; minSqft: number; fill: string; line: string; width: number }> = [
  { cls: CLS.BED, minSqft: 25, fill: "rgba(245,158,11,0.30)", line: "#fbbf24", width: 1.6 },
  { cls: CLS.WATER, minSqft: 40, fill: "rgba(56,189,248,0.35)", line: "#7dd3fc", width: 1.6 },
  { cls: CLS.LAWN, minSqft: 40, fill: "rgba(163,230,53,0.28)", line: "#bef264", width: 2 },
  { cls: CLS.BUILDING, minSqft: 60, fill: "", line: "rgba(255,255,255,0.85)", width: 1.1 },
];

type Props = {
  w: number;
  h: number;
  /** Ground metres a pixel (for the sizes written on the lawn). */
  gsdM: number;
  photoUrl: string;
  labels: Uint8Array;
  lot: Uint8Array;
  lotRing: Pt[];
  /** The class the brush paints, or null to look only. */
  paint: number | null;
  /** Brush radius, pixels. */
  brushPx: number;
  view: "both" | "photo" | "classes";
  /** Framed on the maintained yard (a big lot's few hundred feet round the house), or the whole lot. */
  zoom?: "yard" | "lot";
  /** When this changes the frame is fitted again (a new read, a new reach); brush strokes don't move it. */
  frameKey?: string;
  /** A stroke ended: the labels as they now are. */
  onStroke: (labels: Uint8Array) => void;
  /** Tapping counts a piece in or leaves it out: the pixel tapped. */
  onTap?: ((at: number) => void) | null;
  /** Drawing a lot line: the corners so far, and a click adds one. */
  drawing?: { points: Pt[]; onAdd: (p: Pt) => void } | null;
};

type Geometry = {
  layers: Array<{ path: Path2D; fill: string; line: string; width: number }>;
  yard: Path2D | null;
  veil: HTMLCanvasElement;
  spots: Array<{ x: number; y: number; text: string }>;
};

const ringPath = (p: Path2D, r: Pt[]) => {
  r.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
  p.closePath();
};

/** Everything that depends on the labels only — rebuilt when a stroke ends, not on every pointer move. `L` is the
 *  labels inside the lot only (the neighbours' yards aren't outlined). */
function geometryOf(L: Uint8Array, lot: Uint8Array, w: number, h: number, gsdM: number, area: { mask: Uint8Array; sqft: number; wholeLot: boolean }): Geometry {
  const N = w * h;
  const sq = (gsdM * 3.280839895) ** 2;
  const layers = LAYERS.map((ly) => {
    const path = new Path2D();
    for (const o of outlinesOf(L, w, h, ly.cls, Math.ceil(ly.minSqft / sq), 0.9)) ringPath(path, chaikin(o.ring, 2));
    return { path, fill: ly.fill, line: ly.line, width: ly.width };
  });
  // A yard that's the whole lot is outlined by the lot line already.
  let yard: Path2D | null = null;
  if (area.sqft > 0 && !area.wholeLot) {
    yard = new Path2D();
    for (const o of outlinesOf(area.mask, w, h, 1, 1, 1.2)) ringPath(yard, chaikin(o.ring, 3));
  }
  // The veil: the lot outside the yard dimmed, beyond the lot more.
  const veil = document.createElement("canvas");
  veil.width = w;
  veil.height = h;
  const vg = veil.getContext("2d")!;
  const img = vg.createImageData(w, h);
  for (let i = 0; i < N; i++) {
    const a = !lot[i] ? 150 : area.sqft > 0 && !area.mask[i] ? 100 : 0;
    if (!a) continue;
    img.data[i * 4] = 12;
    img.data[i * 4 + 1] = 16;
    img.data[i * 4 + 2] = 22;
    img.data[i * 4 + 3] = a;
  }
  vg.putImageData(img, 0, 0);
  const spots = pieceSpots(L, w, h, CLS.LAWN, Math.ceil(500 / sq))
    .sort((a, b) => b.px - a.px)
    .slice(0, 8)
    .map((p) => ({ x: p.x, y: p.y, text: `${(Math.round((p.px * sq) / 10) * 10).toLocaleString("en-US")} sq ft` }));
  return { layers, yard, veil, spots };
}

type Rect = { x0: number; y0: number; fw: number; fh: number };

/** The pixels' box of a mask, or null when it's empty. */
function boxOf(mask: Uint8Array, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** What the map shows: the yard with room round it (a fifth of its size, 60 ft at least), never squashed past 2:1 —
 *  or the whole grid when that's most of it anyway, or when asked for the whole lot. */
function frameOf(zoom: "yard" | "lot", yard: Uint8Array | null, w: number, h: number, gsdM: number): Rect {
  const all: Rect = { x0: 0, y0: 0, fw: w, fh: h };
  const b = zoom === "yard" && yard ? boxOf(yard, w, h) : null;
  if (!b) return all;
  const pad = Math.max(60 / (gsdM * 3.280839895), 0.2 * Math.max(b.x1 - b.x0, b.y1 - b.y0));
  let x0 = b.x0 - pad;
  const x1 = b.x1 + pad;
  let y0 = b.y0 - pad;
  const y1 = b.y1 + pad;
  // Not narrower than 3:4, not wider than 2:1.
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let fw = x1 - x0;
  let fh = y1 - y0;
  if (fw < fh * 0.75) fw = fh * 0.75;
  if (fw > fh * 2) fh = fw / 2;
  fw = Math.min(fw, w);
  fh = Math.min(fh, h);
  x0 = Math.max(0, Math.min(w - fw, cx - fw / 2));
  y0 = Math.max(0, Math.min(h - fh, cy - fh / 2));
  if (fw * fh > w * h * 0.6) return all;
  return { x0, y0, fw, fh };
}

export function YardMap({ w, h, gsdM, photoUrl, labels, lot, lotRing, paint, brushPx, view, zoom = "yard", frameKey, onStroke, onTap, drawing }: Props) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const photoRef = React.useRef<HTMLImageElement | null>(null);
  const [photoReady, setPhotoReady] = React.useState(false);
  const [photoFailed, setPhotoFailed] = React.useState(false);
  const [cssW, setCssW] = React.useState(0);
  const work = React.useRef<Uint8Array | null>(null);
  const stamped = React.useRef<Set<number>>(new Set());
  const painting = React.useRef(false);
  const frame = React.useRef(0);
  const hover = React.useRef<Pt | null>(null);

  React.useEffect(() => {
    const img = new Image();
    img.onload = () => {
      photoRef.current = img;
      setPhotoReady(true);
    };
    img.onerror = () => setPhotoFailed(true);
    img.src = photoUrl;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [photoUrl]);

  // The canvas is drawn at the size it's shown (times the screen's density), so a 2 px line is 2 px on any lot.
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCssW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const inLot = React.useMemo(() => {
    const L = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) L[i] = lot[i] ? labels[i] : CLS.OUT;
    return L;
  }, [labels, lot, w, h]);
  const area = React.useMemo(() => yardArea(inLot, lot, { w, h, gsdM }), [inLot, lot, w, h, gsdM]);
  const geo = React.useMemo(() => (view === "both" && typeof document !== "undefined" ? geometryOf(inLot, lot, w, h, gsdM, area) : null), [inLot, lot, w, h, gsdM, area, view]);
  // The frame is set by the yard when the map opens, the zoom changes or the yard is read again (`frameKey`) — not
  // moved by every brush stroke.
  const key = `${zoom}|${frameKey ?? ""}|${w}x${h}`;
  const [framed, setFramed] = React.useState<{ key: string; rect: Rect } | null>(null);
  let fr = framed?.key === key ? framed.rect : null;
  if (!fr) {
    fr = frameOf(zoom, area.sqft ? area.mask : null, w, h, gsdM);
    setFramed({ key, rect: fr });
  }
  // The flat class map ("Map" view).
  const classMap = React.useMemo(() => {
    if (view !== "classes" || typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const col = lot[i] ? CLASS_COLOR[labels[i]] : null;
      if (!col) {
        img.data[i * 4 + 3] = lot[i] ? 0 : 200;
        continue;
      }
      img.data.set([col[0], col[1], col[2], 255], i * 4);
    }
    g.putImageData(img, 0, 0);
    return c;
  }, [view, labels, lot, w, h]);

  const draw = React.useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const shownW = cssW || w * 2;
    const cw = Math.round(shownW * dpr);
    const ch = Math.round(((shownW * fr.fh) / fr.fw) * dpr);
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
    }
    const g = c.getContext("2d");
    if (!g) return;
    const k = cw / fr.fw; // canvas pixels per grid pixel
    const px = (cssPx: number) => (cssPx * dpr) / k; // a screen width, in grid units
    const sx = (x: number) => (x - fr.x0) * k;
    const sy = (y: number) => (y - fr.y0) * k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = "#e7ebe3";
    g.fillRect(0, 0, cw, ch);
    g.imageSmoothingEnabled = true;
    g.setTransform(k, 0, 0, k, -fr.x0 * k, -fr.y0 * k);
    if (photoRef.current && view !== "classes") g.drawImage(photoRef.current, 0, 0, w, h);
    g.lineJoin = "round";
    if (view === "classes" && classMap) {
      g.imageSmoothingEnabled = false;
      g.drawImage(classMap, 0, 0, w, h);
      g.imageSmoothingEnabled = true;
    }
    if (view === "both" && geo) {
      g.drawImage(geo.veil, 0, 0, w, h);
      for (const ly of geo.layers) {
        if (ly.fill) {
          g.fillStyle = ly.fill;
          g.fill(ly.path, "evenodd");
        }
        g.lineWidth = px(ly.width + 2.5);
        g.strokeStyle = "rgba(0,0,0,0.5)";
        g.stroke(ly.path);
        g.lineWidth = px(ly.width);
        g.strokeStyle = ly.line;
        g.stroke(ly.path);
      }
      if (geo.yard) {
        g.lineWidth = px(5);
        g.strokeStyle = "rgba(0,0,0,0.45)";
        g.stroke(geo.yard);
        g.lineWidth = px(2.2);
        g.strokeStyle = "#ffffff";
        g.stroke(geo.yard);
      }
    }
    // A stroke in progress: the brushed pixels in the brush's colour, until the outlines redo at its end.
    if (painting.current && paint != null && stamped.current.size) {
      const col = CLASS_COLOR[paint] ?? [255, 255, 255];
      g.fillStyle = `rgba(${col.join(",")},0.6)`;
      for (const i of stamped.current) g.fillRect(i % w, Math.floor(i / w), 1, 1);
    }
    // The lot line.
    if (lotRing.length >= 3) {
      const lp = new Path2D();
      ringPath(lp, lotRing);
      g.lineWidth = px(3.5);
      g.strokeStyle = "rgba(0,0,0,0.5)";
      g.setLineDash([]);
      g.stroke(lp);
      g.lineWidth = px(1.6);
      g.strokeStyle = "#f9a8d4";
      g.setLineDash([px(7), px(5)]);
      g.stroke(lp);
      g.setLineDash([]);
    }
    // A lot line being drawn.
    if (drawing?.points.length) {
      g.beginPath();
      drawing.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      if (hover.current) g.lineTo(hover.current.x, hover.current.y);
      g.lineWidth = px(2.5);
      g.strokeStyle = "#facc15";
      g.stroke();
      for (const p of drawing.points) {
        g.beginPath();
        g.arc(p.x, p.y, px(5), 0, Math.PI * 2);
        g.fillStyle = "#facc15";
        g.fill();
      }
    }
    // The lawn's sizes, in screen pixels so the text stays crisp.
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (view === "both" && geo && !painting.current) {
      g.font = `700 ${11.5 * dpr}px system-ui, -apple-system, Segoe UI, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      for (const sp of geo.spots) {
        const x = sx(sp.x);
        const y = sy(sp.y);
        const tw = g.measureText(sp.text).width + 12 * dpr;
        const th = 20 * dpr;
        g.fillStyle = "rgba(255,255,255,0.92)";
        g.beginPath();
        g.roundRect(x - tw / 2, y - th / 2, tw, th, th / 2);
        g.fill();
        g.fillStyle = "#1a2e05";
        g.fillText(sp.text, x, y + 0.5 * dpr);
      }
    }
    // The brush under the pointer.
    if (paint != null && hover.current && !drawing && !onTap) {
      g.beginPath();
      g.arc(sx(hover.current.x), sy(hover.current.y), brushPx * k, 0, Math.PI * 2);
      g.lineWidth = 1.5 * dpr;
      g.strokeStyle = "#ffffff";
      g.stroke();
    }
  }, [geo, classMap, fr, lotRing, view, w, h, paint, brushPx, drawing, cssW, onTap]);

  React.useEffect(() => {
    draw();
  }, [draw, photoReady]);

  const at = (e: React.PointerEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: fr.x0 + ((e.clientX - r.left) / r.width) * fr.fw, y: fr.y0 + ((e.clientY - r.top) / r.height) * fr.fh };
  };
  const stamp = (p: Pt) => {
    const L = work.current;
    if (!L || paint == null) return;
    const r = brushPx;
    const x0 = Math.max(0, Math.floor(p.x - r));
    const x1 = Math.min(w - 1, Math.ceil(p.x + r));
    const y0 = Math.max(0, Math.floor(p.y - r));
    const y1 = Math.min(h - 1, Math.ceil(p.y + r));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if ((x + 0.5 - p.x) ** 2 + (y + 0.5 - p.y) ** 2 > r * r) continue;
        const k = y * w + x;
        // The brush stays in the lot, and never paints over the house's outline.
        if (lot[k] && L[k] !== CLS.BUILDING) {
          L[k] = paint;
          stamped.current.add(k);
        }
      }
  };
  const schedule = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw();
    });
  };

  return (
    <div className="lw-map" ref={wrapRef} data-mode={drawing ? "draw" : onTap ? "tap" : paint != null ? "paint" : "idle"}>
      <canvas
        ref={canvasRef}
        aria-label="The yard on the aerial photo"
        style={{ width: "100%", height: "auto", cursor: drawing ? "copy" : onTap ? "pointer" : paint != null ? "none" : "default" }}
        onPointerDown={(e) => {
          const p = at(e);
          if (drawing) {
            drawing.onAdd(p);
            return;
          }
          if (onTap) {
            const x = Math.floor(p.x);
            const y = Math.floor(p.y);
            if (x >= 0 && y >= 0 && x < w && y < h) onTap(y * w + x);
            return;
          }
          if (paint == null) return;
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          painting.current = true;
          work.current = new Uint8Array(labels);
          stamped.current = new Set();
          stamp(p);
          schedule();
        }}
        onPointerMove={(e) => {
          hover.current = at(e);
          if (painting.current) stamp(hover.current);
          schedule();
        }}
        onPointerLeave={() => {
          hover.current = null;
          schedule();
        }}
        onPointerUp={() => {
          if (!painting.current) return;
          painting.current = false;
          const L = work.current;
          work.current = null;
          stamped.current = new Set();
          if (L) onStroke(L);
        }}
        data-lawn-map
      />
      {photoFailed ? <div className="lw-map-attr lw-map-attr--left lw-map-attr--bad">The aerial photo didn&apos;t load — the classes are still here</div> : null}
      {!photoReady && !photoFailed && view !== "classes" ? (
        <div className="lw-map-attr lw-map-attr--top" data-lawn-photo-loading>
          Loading the aerial photo…
        </div>
      ) : null}
      <div className="lw-map-attr">USDA NAIP aerial · tree heights Meta/WRI (CC BY 4.0)</div>
    </div>
  );
}

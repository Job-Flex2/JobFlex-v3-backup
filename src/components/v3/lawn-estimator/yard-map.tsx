"use client";
// THE YARD ON THE AERIAL PHOTO (lawn estimator, 2026-10-18). The USDA photo the property was read from, every class
// tinted over it, the lot line drawn — and a brush to correct the reading: paint lawn, beds, trees or pavement inside
// the lot (the brush never leaves it). The numbers redo when the stroke ends. A lot line can be clicked in where the
// county has none, corner by corner.
import * as React from "react";
import s from "./lawn.module.css";
import type { Pt } from "@/lib/lawn/geo";
import { CLS } from "@/lib/lawn/classify";

export const CLASS_COLOR: Record<number, [number, number, number]> = {
  [CLS.LAWN]: [110, 220, 70],
  [CLS.TREE]: [20, 110, 40],
  [CLS.BED]: [190, 110, 50],
  [CLS.HARD]: [210, 210, 215],
  [CLS.BUILDING]: [240, 120, 50],
  [CLS.WATER]: [40, 130, 240],
};

type Props = {
  w: number;
  h: number;
  photoUrl: string;
  labels: Uint8Array;
  lot: Uint8Array;
  lotRing: Pt[];
  /** The class the brush paints, or null to look only. */
  paint: number | null;
  /** Brush radius, pixels. */
  brushPx: number;
  view: "both" | "photo" | "classes";
  /** A stroke ended: the labels as they now are. */
  onStroke: (labels: Uint8Array) => void;
  /** Drawing a lot line: the corners so far, and a click adds one. */
  drawing?: { points: Pt[]; onAdd: (p: Pt) => void } | null;
};

const SCALE = 3;

export function YardMap({ w, h, photoUrl, labels, lot, lotRing, paint, brushPx, view, onStroke, drawing }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const overlayRef = React.useRef<HTMLCanvasElement | null>(null);
  const photoRef = React.useRef<HTMLImageElement | null>(null);
  const [photoReady, setPhotoReady] = React.useState(false);
  const [photoFailed, setPhotoFailed] = React.useState(false);
  const work = React.useRef<Uint8Array | null>(null);
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

  const draw = React.useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const L = work.current ?? labels;
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = true;
    if (photoRef.current && view !== "classes") g.drawImage(photoRef.current, 0, 0, c.width, c.height);
    else {
      g.fillStyle = "#dfe5da";
      g.fillRect(0, 0, c.width, c.height);
    }
    if (view !== "photo") {
      let ov = overlayRef.current;
      if (!ov) {
        ov = document.createElement("canvas");
        overlayRef.current = ov;
      }
      ov.width = w;
      ov.height = h;
      const og = ov.getContext("2d")!;
      const img = og.createImageData(w, h);
      const a = view === "classes" ? 255 : 120;
      for (let i = 0; i < w * h; i++) {
        const col = CLASS_COLOR[L[i]];
        if (!lot[i]) {
          // Outside the lot: dimmed, not tinted.
          img.data[i * 4 + 3] = view === "classes" ? 200 : 90;
          continue;
        }
        if (!col) continue;
        img.data[i * 4] = col[0];
        img.data[i * 4 + 1] = col[1];
        img.data[i * 4 + 2] = col[2];
        img.data[i * 4 + 3] = a;
      }
      og.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(ov, 0, 0, c.width, c.height);
    }
    // The lot line.
    const ring = lotRing;
    if (ring.length >= 3) {
      g.beginPath();
      ring.forEach((p, i) => (i ? g.lineTo(p.x * SCALE, p.y * SCALE) : g.moveTo(p.x * SCALE, p.y * SCALE)));
      g.closePath();
      g.lineWidth = 3;
      g.strokeStyle = "rgba(255,255,255,0.95)";
      g.setLineDash([]);
      g.stroke();
      g.lineWidth = 1.5;
      g.strokeStyle = "#d61f69";
      g.setLineDash([8, 5]);
      g.stroke();
      g.setLineDash([]);
    }
    // A lot line being drawn.
    if (drawing?.points.length) {
      g.beginPath();
      drawing.points.forEach((p, i) => (i ? g.lineTo(p.x * SCALE, p.y * SCALE) : g.moveTo(p.x * SCALE, p.y * SCALE)));
      if (hover.current) g.lineTo(hover.current.x * SCALE, hover.current.y * SCALE);
      g.lineWidth = 2.5;
      g.strokeStyle = "#facc15";
      g.stroke();
      for (const p of drawing.points) {
        g.beginPath();
        g.arc(p.x * SCALE, p.y * SCALE, 5, 0, Math.PI * 2);
        g.fillStyle = "#facc15";
        g.fill();
      }
    }
    // The brush under the pointer.
    if (paint != null && hover.current && !drawing) {
      g.beginPath();
      g.arc(hover.current.x * SCALE, hover.current.y * SCALE, brushPx * SCALE, 0, Math.PI * 2);
      g.lineWidth = 1.5;
      g.strokeStyle = "#ffffff";
      g.stroke();
    }
  }, [labels, lot, lotRing, view, w, h, paint, brushPx, drawing]);

  React.useEffect(() => {
    draw();
  }, [draw, photoReady]);

  const at = (e: React.PointerEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
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
        if (lot[k] && L[k] !== CLS.BUILDING) L[k] = paint;
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
    <div className={s.mapWrap}>
      <canvas
        ref={canvasRef}
        width={w * SCALE}
        height={h * SCALE}
        aria-label="The yard on the aerial photo"
        style={{ cursor: drawing ? "copy" : paint != null ? "none" : "default" }}
        onPointerDown={(e) => {
          const p = at(e);
          if (drawing) {
            drawing.onAdd(p);
            return;
          }
          if (paint == null) return;
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          painting.current = true;
          work.current = new Uint8Array(labels);
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
          if (L) onStroke(L);
        }}
        data-lawn-map
      />
      {photoFailed ? <div className={s.mapAttr} style={{ left: 6, right: "auto", color: "#b91c1c" }}>The aerial photo didn&apos;t load — the classes are still here</div> : null}
      <div className={s.mapAttr}>USDA NAIP aerial · tree heights Meta/WRI (CC BY 4.0)</div>
    </div>
  );
}

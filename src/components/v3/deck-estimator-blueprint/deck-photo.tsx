"use client";
// THE PHOTO OF THE HOUSE (M2, 2026-10-10). Owner: "add a picture of the back
// wall of the house so the client recognises his house, where the deck will
// be." The contractor's photo fills the viewer; over it the deck's front
// elevation (lib/deck/elevation — the same polygons the client's page draws)
// as a see-through outline: drag it to the wall, pull the handle at the end
// of its ground line to size it. The placement is kept in the design and
// rides with the proposal; the client's page draws the same outline on the
// same picture.
//
// Pointer events only (one finger or the mouse); a wheel over the picture
// scales it. Nothing here touches the window — the photo is laid out by CSS
// and the SVG is sized to the picture's own box.
import * as React from "react";
import type { DeckPhoto } from "@/lib/deck/design";
import { defaultPlacement, elevationOverlay, type Elevation } from "@/lib/deck/elevation";
import { letterboxRows, type Crop } from "@/lib/deck/photoFit";
import s from "./deck-studio.module.css";

type Placed = NonNullable<DeckPhoto["placed"]>;
const ROOF_LAYERS = new Set(["roof-post", "header", "ridge", "rafter", "roofing", "trim", "gutter"]);

export function DeckPhotoView({ photo, href, elevation, onPlace, onRefresh }: { photo: DeckPhoto; href: string | null; elevation: Elevation; onPlace: (placed: Placed) => void; onRefresh: () => void }) {
  const placed = photo.placed ?? defaultPlacement();
  const [draft, setDraft] = React.useState<Placed | null>(null);
  const live = draft ?? placed;
  const svgRef = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<{ mode: "move" | "scale"; startX: number; startY: number; from: Placed; w: number; h: number } | null>(null);
  const polys = React.useMemo(() => elevationOverlay(elevation, live, photo.w, photo.h), [elevation, live, photo.w, photo.h]);
  const groundY = live.y * 1000;
  const groundX0 = live.x * 1000;
  const groundX1 = live.x * 1000 + live.w * 1000;

  // One set of handlers on the SVG: a press on the handle scales, anywhere else moves. The SVG itself
  // takes the pointer capture, so the move and the release reach it wherever the finger goes.
  const begin = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const onHandle = e.target instanceof Element && e.target.hasAttribute("data-deck-photo-handle");
    const box = svg.getBoundingClientRect();
    drag.current = { mode: onHandle ? "scale" : "move", startX: e.clientX, startY: e.clientY, from: live, w: box.width || 1, h: box.height || 1 };
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      /* an old browser: the drag still works while the pointer stays over the picture */
    }
    e.preventDefault();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.w;
    const dy = (e.clientY - d.startY) / d.h;
    if (d.mode === "move") setDraft({ x: d.from.x + dx, y: d.from.y + dy, w: d.from.w });
    else setDraft({ x: d.from.x, y: d.from.y, w: Math.max(0.08, Math.min(3, d.from.w + dx)) });
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    if (draft) onPlace(draft);
    setDraft(null);
  };
  const wheel = (e: React.WheelEvent) => {
    const k = e.deltaY > 0 ? 0.95 : 1.05;
    const next = { x: live.x + (live.w * (1 - k)) / 2, y: live.y, w: Math.max(0.08, Math.min(3, live.w * k)) };
    onPlace(next);
  };

  return (
    <div className={s.photoWrap} data-deck-photo="placed">
      <div className={s.photoStage}>
        {href ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private file behind this app's own signed link
          <img src={href} alt="The back of the house" width={photo.w} height={photo.h} draggable={false} onError={onRefresh} />
        ) : null}
        <svg ref={svgRef} className={s.photoSvg} viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label="The deck's outline on the photo — drag to move, pull the handle to size" onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onWheel={wheel}>
          <g className={s.elevDeck}>
            {polys.filter((p) => !ROOF_LAYERS.has(p.layer)).map((p, i) => (
              <polygon key={`d${i}`} points={p.points} />
            ))}
          </g>
          <g className={s.elevRoof}>
            {polys.filter((p) => ROOF_LAYERS.has(p.layer)).map((p, i) => (
              <polygon key={`r${i}`} points={p.points} />
            ))}
          </g>
          <line className={s.elevGround} x1={groundX0} y1={groundY} x2={groundX1} y2={groundY} />
          {/* The handle stays inside the picture even when the outline's end is dragged past its edge, so it can always be found. */}
          <circle className={s.photoHandle} cx={Math.min(986, Math.max(14, groundX1))} cy={Math.min(986, Math.max(14, groundY))} r={14} data-deck-photo-handle />
        </svg>
      </div>
    </div>
  );
}

function loadImage(file: File): Promise<{ img: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve({ img: el, release: () => URL.revokeObjectURL(url) });
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That picture could not be read — use a JPEG or PNG."));
    };
    el.src = url;
  });
}

async function canvasFile(canvas: HTMLCanvasElement, name: string): Promise<File | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  return blob ? new File([blob], name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : null;
}

/**
 * A phone's screenshot of a photo carries black bands (and the status bar)
 * above and below it. The rows' brightness, read off a thumbnail, says how
 * many to cut (lib/deck/photoFit letterboxRows); the picture comes back
 * without them, so the model and the crop see only the house.
 */
export async function trimLetterbox(file: File, w: number, h: number): Promise<{ file: File; w: number; h: number; cut: { top: number; bottom: number } }> {
  const none = { file, w, h, cut: { top: 0, bottom: 0 } };
  const { img, release } = await loadImage(file);
  try {
    const rows = Math.min(h, 480);
    const probe = document.createElement("canvas");
    probe.width = 48;
    probe.height = rows;
    const pg = probe.getContext("2d", { willReadFrequently: true });
    if (!pg) return none;
    pg.drawImage(img, 0, 0, 48, rows);
    const data = pg.getImageData(0, 0, 48, rows).data;
    // Each row's MEDIAN brightness: a status bar's white glyphs on black must still read as the black band they sit in.
    const bright = new Array<number>(rows);
    const lumas = new Array<number>(48);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 48; c++) {
        const i = (r * 48 + c) * 4;
        lumas[c] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      }
      bright[r] = [...lumas].sort((a, b) => a - b)[24];
    }
    const cut = letterboxRows(bright);
    if (!cut.top && !cut.bottom) return none;
    const top = Math.round((cut.top / rows) * h);
    const bottom = Math.round((cut.bottom / rows) * h);
    const h2 = h - top - bottom;
    if (h2 < 64) return none;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h2;
    const g = canvas.getContext("2d");
    if (!g) return none;
    g.drawImage(img, 0, top, w, h2, 0, 0, w, h2);
    const out = await canvasFile(canvas, file.name);
    return out ? { file: out, w, h: h2, cut: { top, bottom } } : none;
  } finally {
    release();
  }
}

/** The picture cut to the fit's crop (fractions of it). Back come the file and its size. */
export async function cropPhoto(file: File, crop: Crop, w: number, h: number): Promise<{ file: File; w: number; h: number }> {
  const x = Math.round(crop.x * w);
  const y = Math.round(crop.y * h);
  const cw = Math.max(16, Math.round(crop.w * w));
  const ch = Math.max(16, Math.round(crop.h * h));
  if (x === 0 && y === 0 && cw === w && ch === h) return { file, w, h };
  const { img, release } = await loadImage(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const g = canvas.getContext("2d");
    if (!g) return { file, w, h };
    g.drawImage(img, x, y, cw, ch, 0, 0, cw, ch);
    const out = await canvasFile(canvas, file.name);
    return out ? { file: out, w: cw, h: ch } : { file, w, h };
  } finally {
    release();
  }
}

/** A picture shrunk for the upload: the long side at most `maxSide` px, JPEG. Back come the file and its size. */
export async function shrinkPhoto(file: File, maxSide = 1600): Promise<{ file: File; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That picture could not be read — use a JPEG or PNG."));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(16, Math.round(img.naturalWidth * scale));
    const h = Math.max(16, Math.round(img.naturalHeight * scale));
    if (scale === 1 && file.type === "image/jpeg" && file.size < 1_500_000) return { file, w, h };
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return { file, w, h };
    g.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob) return { file, w, h };
    return { file: new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }), w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
import { applyHomography, invertHomography, letterboxRows, moveMark, type Crop, type MarkId, type Pt, type Quad, type WallRead } from "@/lib/deck/photoFit";
import s from "./deck-studio.module.css";

type Placed = NonNullable<DeckPhoto["placed"]>;
const ROOF_LAYERS = new Set(["roof-post", "header", "ridge", "rafter", "roofing", "trim", "gutter"]);
const pct = (f: number) => `${(f * 100).toFixed(2)}%`;
const inchesWords = (n: number) => (n < 24 ? `${n} in.` : n % 12 === 0 ? `${n / 12} ft` : `${Math.floor(n / 12)}'-${n % 12}"`);

/**
 * The photo with the deck's outline over it, and — when marking — the wall's
 * own lines as handles: the base's two ends, the door's threshold and top,
 * a measure's ends, each step. The lines live in the SVG (strokes keep
 * their width under its stretch); the handles and their labels are HTML,
 * placed by percent, so they stay round and readable whatever the
 * picture's shape. A handle's drag edits the read (lib/deck/photoFit
 * moveMark) and hands it back on release.
 */
export function DeckPhotoView({ photo, href, elevation, onPlace, onRefresh, marking = false, read = null, onRead, corners = null, onCorners }: { photo: DeckPhoto; href: string | null; elevation: Elevation; onPlace: (placed: Placed) => void; onRefresh: () => void; marking?: boolean; read?: WallRead | null; onRead?: (read: WallRead) => void; /** Straightening: the four corners of the wall to drag (top-left, top-right, bottom-right, bottom-left). */ corners?: Quad | null; onCorners?: (quad: Quad) => void }) {
  const placed = photo.placed ?? defaultPlacement();
  const [draft, setDraft] = React.useState<Placed | null>(null);
  const [readDraft, setReadDraft] = React.useState<WallRead | null>(null);
  const live = draft ?? placed;
  const marks = marking ? (readDraft ?? read) : null;
  /** The read's lines shown faintly whenever there is one and nothing is being marked, so what was read is seen before it is trusted. */
  const shown = !marking && read ? read : null;
  const [cornerDraft, setCornerDraft] = React.useState<Quad | null>(null);
  const quad = corners ? (cornerDraft ?? corners) : null;
  const svgRef = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<{ mode: "move" | "scale" | "mark" | "corner"; mark: MarkId | null; corner: number; startX: number; startY: number; from: Placed; fromRead: WallRead | null; fromQuad: Quad | null; left: number; top: number; w: number; h: number } | null>(null);
  const polys = React.useMemo(() => elevationOverlay(elevation, live, photo.w, photo.h), [elevation, live, photo.w, photo.h]);
  const groundY = live.y * 1000;
  const groundX0 = live.x * 1000;
  const groundX1 = live.x * 1000 + live.w * 1000;

  // One set of handlers: a press on a mark drags that mark, on the handle scales, anywhere else moves. The SVG
  // takes the pointer capture, so the move and the release reach it wherever the finger goes.
  const begin = (e: React.PointerEvent<Element>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const el = e.target instanceof Element ? e.target : null;
    const mark = (el?.closest("[data-mark]")?.getAttribute("data-mark") ?? null) as MarkId | null;
    const onHandle = !!el?.hasAttribute("data-deck-photo-handle");
    const cornerAttr = el?.closest("[data-corner]")?.getAttribute("data-corner") ?? null;
    const corner = cornerAttr === null ? -1 : Number(cornerAttr);
    // While the corners are out, only they move: a press anywhere else is nothing.
    if (quad && corner < 0) return;
    const box = svg.getBoundingClientRect();
    drag.current = { mode: quad && corner >= 0 ? "corner" : mark && marks ? "mark" : onHandle ? "scale" : "move", mark, corner, startX: e.clientX, startY: e.clientY, from: live, fromRead: marks, fromQuad: quad, left: box.left, top: box.top, w: box.width || 1, h: box.height || 1 };
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
    if (d.mode === "corner") {
      if (d.fromQuad) {
        const x = Math.min(1.2, Math.max(-0.2, (e.clientX - d.left) / d.w));
        const y = Math.min(1.2, Math.max(-0.2, (e.clientY - d.top) / d.h));
        setCornerDraft(d.fromQuad.map((q, i) => (i === d.corner ? { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 } : q)) as Quad);
      }
      return;
    }
    if (d.mode === "mark") {
      if (d.mark && d.fromRead) setReadDraft(moveMark(d.fromRead, d.mark, { x: (e.clientX - d.left) / d.w, y: (e.clientY - d.top) / d.h }));
      return;
    }
    const dx = (e.clientX - d.startX) / d.w;
    const dy = (e.clientY - d.startY) / d.h;
    if (d.mode === "move") setDraft({ x: d.from.x + dx, y: d.from.y + dy, w: d.from.w });
    else setDraft({ x: d.from.x, y: d.from.y, w: Math.max(0.08, Math.min(3, d.from.w + dx)) });
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.mode === "corner") {
      if (cornerDraft && onCorners) onCorners(cornerDraft);
      setCornerDraft(null);
      return;
    }
    if (d.mode === "mark") {
      if (readDraft && onRead) onRead(readDraft);
      setReadDraft(null);
      return;
    }
    if (draft) onPlace(draft);
    setDraft(null);
  };
  const wheel = (e: React.WheelEvent) => {
    const k = e.deltaY > 0 ? 0.95 : 1.05;
    const next = { x: live.x + (live.w * (1 - k)) / 2, y: live.y, w: Math.max(0.08, Math.min(3, live.w * k)) };
    onPlace(next);
  };
  const handle = (id: MarkId, x: number, y: number, label: string) => (
    <button key={id} type="button" className={s.markHandle} data-mark={id} style={{ left: pct(x), top: pct(y) }} aria-label={label} onPointerDown={begin} />
  );
  const doorCx = marks?.door ? (marks.door.x0 + marks.door.x1) / 2 : 0;
  const linesOf = (r: WallRead) => (
    <>
      <line className={s.markBase} x1={r.base.left.x * 1000} y1={r.base.left.y * 1000} x2={r.base.right.x * 1000} y2={r.base.right.y * 1000} />
      {r.eave ? <line className={s.markBase} x1={r.eave.left.x * 1000} y1={r.eave.left.y * 1000} x2={r.eave.right.x * 1000} y2={r.eave.right.y * 1000} /> : null}
      {r.door ? <rect className={s.markDoor} x={r.door.x0 * 1000} y={r.door.top * 1000} width={(r.door.x1 - r.door.x0) * 1000} height={(r.door.bottom - r.door.top) * 1000} /> : null}
      {r.scaleLine ? <line className={s.markScale} x1={r.scaleLine.a.x * 1000} y1={r.scaleLine.a.y * 1000} x2={r.scaleLine.b.x * 1000} y2={r.scaleLine.b.y * 1000} /> : null}
      {r.jogs.map((j, i) => (
        <line key={i} className={s.markJog} x1={j.x * 1000} y1={j.y * 1000 - 120} x2={j.x * 1000} y2={j.y * 1000 + 40} />
      ))}
    </>
  );
  const CORNER_LABEL = ["The top of the wall, left", "The top of the wall, right", "Where the wall meets the ground, right", "Where the wall meets the ground, left"];

  return (
    <div className={s.photoWrap} data-deck-photo="placed" data-deck-marking={marking || undefined}>
      <div className={s.photoStage}>
        {href ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private file behind this app's own signed link
          <img src={href} alt="The back of the house" width={photo.w} height={photo.h} draggable={false} onError={onRefresh} />
        ) : null}
        <svg ref={svgRef} className={s.photoSvg} viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label={marks ? "The wall's lines on the photo — drag a handle to move it" : "The deck's outline on the photo — drag to move, pull the handle to size"} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onWheel={wheel}>
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
          {marks ? (
            <g className={s.marks} aria-hidden="true">
              {linesOf(marks)}
            </g>
          ) : shown ? (
            <g className={`${s.marks} ${s.marksFaint}`} aria-hidden="true" data-deck-read-lines>
              {linesOf(shown)}
            </g>
          ) : null}
          {quad ? <polygon className={s.cornerQuad} points={quad.map((q) => `${q.x * 1000},${q.y * 1000}`).join(" ")} data-deck-corner-quad /> : null}
        </svg>
        {quad
          ? quad.map((q, i) => (
              <button key={i} type="button" className={s.markHandle} data-corner={i} style={{ left: pct(q.x), top: pct(q.y) }} aria-label={CORNER_LABEL[i]} onPointerDown={begin} />
            ))
          : null}
        {quad ? <span className={s.markTag} style={{ left: pct((quad[2].x + quad[3].x) / 2), top: pct(Math.max(quad[2].y, quad[3].y)) }}>the wall meets the ground</span> : null}
        {marks ? (
          <>
            {handle("base-left", marks.base.left.x, marks.base.left.y, "The wall's base, left end")}
            {handle("base-right", marks.base.right.x, marks.base.right.y, "The wall's base, right end")}
            {marks.door ? handle("door-bottom", doorCx, marks.door.bottom, "The door's threshold") : null}
            {marks.door ? handle("door-top", doorCx, marks.door.top, "The top of the door") : null}
            {marks.door ? <span className={s.markTag} style={{ left: pct(doorCx), top: pct(marks.door.bottom) }}>{"door · 6'-8\""}</span> : null}
            {marks.scaleLine ? handle("scale-a", marks.scaleLine.a.x, marks.scaleLine.a.y, "The measure's first end") : null}
            {marks.scaleLine ? handle("scale-b", marks.scaleLine.b.x, marks.scaleLine.b.y, "The measure's second end") : null}
            {marks.scaleLine ? <span className={s.markTag} style={{ left: pct((marks.scaleLine.a.x + marks.scaleLine.b.x) / 2), top: pct(Math.max(marks.scaleLine.a.y, marks.scaleLine.b.y)) }}>measure · {inchesWords(marks.scaleLine.lengthIn)}</span> : null}
            {marks.jogs.map((j, i) => (
              <React.Fragment key={i}>
                {handle(`jog-${i}`, j.x, j.y, `Step ${i + 1} in the wall`)}
                <span className={s.markTag} style={{ left: pct(j.x), top: pct(j.y) }}>step · {j.dir === "toward" ? "comes out" : "steps back"} {j.depthFt ?? 2} ft</span>
              </React.Fragment>
            ))}
            <span className={s.markTag} style={{ left: pct(marks.base.left.x), top: pct(marks.base.left.y) }}>wall meets the ground</span>
          </>
        ) : null}
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

/**
 * THE PICTURE STRAIGHTENED (2026-10-11): warped so four corners of the wall
 * become the corners of an `out.w × out.h` picture — `H` takes the saved
 * picture's pixels (`from`) to the output's (lib/deck/photoFit rectifyPlan).
 * Drawn as a mesh of small triangles, each an affine piece of the warp, so
 * it runs on the 2D canvas every phone has; each clip reaches a hair past
 * its triangle so no seam shows. What lies outside the picture is a plain
 * grey. Null when the canvas or the warp is not to be had.
 */
export async function straightenPhoto(file: File, H: readonly number[], out: { w: number; h: number }, from: { w: number; h: number }): Promise<{ file: File; w: number; h: number } | null> {
  const Hinv = invertHomography(H);
  if (!Hinv || !(out.w > 0 && out.h > 0)) return null;
  const { img, release } = await loadImage(file);
  try {
    const kx = img.naturalWidth / (from.w || img.naturalWidth);
    const ky = img.naturalHeight / (from.h || img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = out.w;
    canvas.height = out.h;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#8d969e";
    g.fillRect(0, 0, out.w, out.h);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    const cell = 32;
    const nx = Math.max(1, Math.ceil(out.w / cell));
    const ny = Math.max(1, Math.ceil(out.h / cell));
    const src = (x: number, y: number): Pt => {
      const q = applyHomography(Hinv, { x, y });
      return { x: q.x * kx, y: q.y * ky };
    };
    const tri = (s0: Pt, s1: Pt, s2: Pt, d0: Pt, d1: Pt, d2: Pt) => {
      const den = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
      if (!Number.isFinite(den) || Math.abs(den) < 1e-9) return;
      const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / den;
      const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / den;
      const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / den;
      const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / den;
      const e = d0.x - a * s0.x - c * s0.y;
      const f = d0.y - b * s0.x - d * s0.y;
      if (![a, b, c, d, e, f].every(Number.isFinite)) return;
      const cx = (d0.x + d1.x + d2.x) / 3;
      const cy = (d0.y + d1.y + d2.y) / 3;
      const grow = (q: Pt): Pt => {
        const dx = q.x - cx;
        const dy = q.y - cy;
        const L = Math.hypot(dx, dy) || 1;
        return { x: q.x + (dx / L) * 0.7, y: q.y + (dy / L) * 0.7 };
      };
      const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];
      g.save();
      g.beginPath();
      g.moveTo(g0.x, g0.y);
      g.lineTo(g1.x, g1.y);
      g.lineTo(g2.x, g2.y);
      g.closePath();
      g.clip();
      g.transform(a, b, c, d, e, f);
      g.drawImage(img, 0, 0);
      g.restore();
    };
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x0 = i * cell;
        const y0 = j * cell;
        const x1 = Math.min(out.w, x0 + cell);
        const y1 = Math.min(out.h, y0 + cell);
        const d00 = { x: x0, y: y0 };
        const d10 = { x: x1, y: y0 };
        const d11 = { x: x1, y: y1 };
        const d01 = { x: x0, y: y1 };
        const s00 = src(x0, y0);
        const s10 = src(x1, y0);
        const s11 = src(x1, y1);
        const s01 = src(x0, y1);
        tri(s00, s10, s11, d00, d10, d11);
        tri(s00, s11, s01, d00, d11, d01);
      }
    }
    const outFile = await canvasFile(canvas, file.name);
    return outFile ? { file: outFile, w: out.w, h: out.h } : null;
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

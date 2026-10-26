// THE ROOF VISUALIZER'S ENGINE (2026-10-25). Owner: "when they pick the material it shows on the roof picture — how
// the roof will look; clicking the material, metal, colour — isolating the exact roof the contractor is estimating".
//
// Pure, pixel-level, no DOM: works on an ImageData-shaped {data, width, height} in the browser (a canvas) and in QA.
//   1. THE ROOF'S MASK — one byte a pixel, 0…255:
//        polygonMask    the measured outline rings projected onto the aerial (roofPictures.frameProject) — the exact
//                       roof the estimate measured, nothing else;
//        growMask       a tap on a street photo: the region of like colour around the tap, stopped at edges, so the
//                       roof is picked out of sky, wall and lawn; more taps add, a brush takes away;
//        cleanMask      the specks dropped, the holes filled, the edge feathered.
//   2. THE LOOK — paintRoof keeps every pixel's own light (its luminance against the roof's average) and gives it the
//      material's colour, then lays the material's pattern over it (shingle rows and staggered joints, standing seams,
//      barrel tiles, shakes, slates, a flat membrane) in the roof's own orientation (the mask's principal axis).
import type { RoofFamily } from "@/lib/roofPackage/catalog";
import { frameProject, type LatLng, type RoofFrame } from "@/lib/roofPictures";

export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface RoofColor {
  id: string;
  name: string;
  hex: string;
}

/** The colours a family comes in — the names manufacturers use, close to their swatches. */
export const ROOF_COLORS: Record<RoofFamily, RoofColor[]> = {
  asphalt: [
    { id: "charcoal", name: "Charcoal", hex: "#3a3b3d" },
    { id: "pewter", name: "Pewter Gray", hex: "#6b6d70" },
    { id: "weathered_wood", name: "Weathered Wood", hex: "#6e6256" },
    { id: "driftwood", name: "Driftwood", hex: "#8a7f72" },
    { id: "barkwood", name: "Barkwood", hex: "#5b4a3c" },
    { id: "hickory", name: "Hickory", hex: "#7a5a3e" },
    { id: "slate", name: "Slate", hex: "#4e5663" },
    { id: "shakewood", name: "Shakewood", hex: "#8c7355" },
    { id: "hunter_green", name: "Hunter Green", hex: "#3f5a46" },
    { id: "burnt_sienna", name: "Burnt Sienna", hex: "#8a4a36" },
    { id: "black", name: "Onyx Black", hex: "#232426" },
    { id: "white", name: "Birchwood", hex: "#b9b3a6" },
  ],
  metal: [
    { id: "charcoal", name: "Charcoal Gray", hex: "#474a4e" },
    { id: "matte_black", name: "Matte Black", hex: "#26282b" },
    { id: "burgundy", name: "Burgundy", hex: "#7a2f33" },
    { id: "colonial_red", name: "Colonial Red", hex: "#8e3a34" },
    { id: "forest_green", name: "Forest Green", hex: "#355242" },
    { id: "slate_blue", name: "Slate Blue", hex: "#4a6079" },
    { id: "galvalume", name: "Galvalume", hex: "#b8bbbd" },
    { id: "regal_white", name: "Regal White", hex: "#e6e6e2" },
    { id: "sandstone", name: "Sandstone", hex: "#b9a78a" },
    { id: "copper", name: "Copper Penny", hex: "#a8683f" },
    { id: "medium_bronze", name: "Medium Bronze", hex: "#5a4a3a" },
    { id: "terra_cotta", name: "Terra Cotta", hex: "#b1623f" },
  ],
  tile: [
    { id: "terracotta", name: "Terracotta", hex: "#b5623d" },
    { id: "sand", name: "Sand Blend", hex: "#c2a582" },
    { id: "slate_gray", name: "Slate Gray", hex: "#5c6066" },
    { id: "charcoal", name: "Charcoal", hex: "#3d3f42" },
    { id: "brown_blend", name: "Brown Blend", hex: "#7a5236" },
    { id: "red_blend", name: "Red Blend", hex: "#93423a" },
  ],
  shake: [
    { id: "natural", name: "Natural Cedar", hex: "#b2865b" },
    { id: "weathered", name: "Weathered Gray", hex: "#8b8578" },
    { id: "honey", name: "Honey", hex: "#c4955f" },
    { id: "dark_cedar", name: "Dark Cedar", hex: "#7a5636" },
  ],
  slate: [
    { id: "gray", name: "Vermont Gray", hex: "#5a5f66" },
    { id: "black", name: "Black", hex: "#2b2d31" },
    { id: "green", name: "Unfading Green", hex: "#4d6358" },
    { id: "purple", name: "Mottled Purple", hex: "#5a4b5e" },
  ],
  synthetic: [
    { id: "slate_gray", name: "Slate Gray", hex: "#575b62" },
    { id: "black", name: "Black", hex: "#2d2f33" },
    { id: "brown", name: "Brown", hex: "#5b4636" },
    { id: "cedar", name: "Cedar", hex: "#a07a52" },
  ],
  "low-slope": [
    { id: "white", name: "White TPO", hex: "#e9e9e4" },
    { id: "gray", name: "Gray", hex: "#9a9c9e" },
    { id: "tan", name: "Tan", hex: "#c9bba0" },
    { id: "black", name: "Black EPDM", hex: "#2a2b2d" },
  ],
};

export const LOOK_FAMILIES: Array<{ id: RoofFamily; label: string }> = [
  { id: "asphalt", label: "Asphalt shingle" },
  { id: "metal", label: "Standing-seam metal" },
  { id: "tile", label: "Tile" },
  { id: "shake", label: "Cedar shake" },
  { id: "slate", label: "Slate" },
  { id: "synthetic", label: "Synthetic" },
  { id: "low-slope", label: "Flat membrane" },
];

export interface RoofLook {
  family: RoofFamily;
  colorId: string;
}

export function lookColor(look: RoofLook): RoofColor {
  const list = ROOF_COLORS[look.family] ?? ROOF_COLORS.asphalt;
  return list.find((c) => c.id === look.colorId) ?? list[0];
}

export function lookWords(look: RoofLook): string {
  const fam = LOOK_FAMILIES.find((f) => f.id === look.family)?.label ?? look.family;
  return `${fam} · ${lookColor(look).name}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ── masks ─────────────────────────────────────────────────────────────── */

export type Point = [number, number];

/** A mask filled from polygons (pixel coordinates), even-odd, 255 inside. */
export function polygonMask(width: number, height: number, polygons: readonly Point[][]): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (const poly of polygons) {
      const n = poly.length;
      if (n < 3) continue;
      for (let i = 0; i < n; i++) {
        const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n];
        if (y0 === y1) continue;
        if (cy < Math.min(y0, y1) || cy >= Math.max(y0, y1)) continue;
        xs.push(x0 + ((cy - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = Math.max(0, Math.ceil(xs[i] - 0.5)), b = Math.min(width - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = a; x <= b; x++) mask[y * width + x] = 255;
    }
  }
  return mask;
}

/** The measured rings on the aerial: lat/lng → the picture's pixels (the frame projects into a 0…1000 square). */
export function ringsToPixels(rings: readonly LatLng[][], frame: RoofFrame, width: number, height: number): Point[][] {
  return rings.map((ring) => ring.map((p) => { const q = frameProject(p, frame); return [(q.x / 1000) * width, (q.y / 1000) * height] as Point; }));
}

// A colour space where a roof's shading moves little: luma down-weighted, chroma up.
const LUMA_W = 0.55, CHROMA_W = 1.6;
function ycc(r: number, g: number, b: number): [number, number, number] {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return [y, 0.564 * (b - y), 0.713 * (r - y)];
}
function dist(a: [number, number, number], b: [number, number, number]): number {
  const dy = (a[0] - b[0]) * LUMA_W, du = (a[1] - b[1]) * CHROMA_W, dv = (a[2] - b[2]) * CHROMA_W;
  return Math.sqrt(dy * dy + du * du + dv * dv);
}

/** The mean colour of the pixels around a point (a 5×5 patch), in the roof's colour space. */
function patchColor(img: Raster, x: number, y: number): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const px = x + dx, py = y + dy;
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
    const i = (py * img.width + px) * 4;
    r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
  }
  return ycc(r / n, g / n, b / n);
}

/**
 * The region of like colour around a tap, 4-connected, stopped where the colour drifts past the tolerance from the
 * tap's own colour (0 = only its exact shade, 100 = nearly anything) — the roof, not the sky, the wall or the lawn.
 * Adds to `into` when given. Returns how many pixels were added.
 */
export function growMask(img: Raster, seed: Point, tolerance: number, into?: Uint8Array, maxShare = 0.85): { mask: Uint8Array; added: number } {
  const { width: w, height: h } = img;
  const mask = into ?? new Uint8Array(w * h);
  const sx = Math.round(seed[0]), sy = Math.round(seed[1]);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { mask, added: 0 };
  const ref = patchColor(img, sx, sy);
  const tol = 6 + (Math.max(0, Math.min(100, tolerance)) / 100) * 110;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [sy * w + sx];
  seen[sy * w + sx] = 1;
  let added = 0;
  const cap = Math.floor(w * h * maxShare);
  // the reference drifts a little toward what it accepts (a shaded roof plane is still the roof), bounded
  let ry = ref[0], ru = ref[1], rv = ref[2], rn = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const i = p * 4;
    const c = ycc(img.data[i], img.data[i + 1], img.data[i + 2]);
    if (dist(c, [ry, ru, rv]) > tol) continue;
    if (!mask[p]) { mask[p] = 255; added++; if (added > cap) break; }
    if (rn < 4000) { rn++; ry += (c[0] - ry) / rn; ru += (c[1] - ru) / rn; rv += (c[2] - rv) / rn; }
    const x = p % w, y = (p - x) / w;
    if (x > 0 && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
    if (x < w - 1 && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
    if (y > 0 && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
    if (y < h - 1 && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
  }
  return { mask, added };
}

/** A round brush on the mask: paints 255 (add) or 0 (take away). */
export function brushMask(mask: Uint8Array, width: number, height: number, center: Point, radius: number, add: boolean): void {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(center[0] - radius)), x1 = Math.min(width - 1, Math.ceil(center[0] + radius));
  const y0 = Math.max(0, Math.floor(center[1] - radius)), y1 = Math.min(height - 1, Math.ceil(center[1] + radius));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x - center[0], dy = y - center[1];
    if (dx * dx + dy * dy <= r2) mask[y * width + x] = add ? 255 : 0;
  }
}

function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let on = 0;
    for (let dy = -r; dy <= r && !on; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx >= 0 && xx < w && src[yy * w + xx]) { on = 1; break; } } }
    out[y * w + x] = on ? 255 : 0;
  }
  return out;
}
function erode(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let all = 1;
    for (let dy = -r; dy <= r && all; dy++) { const yy = y + dy; for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (yy < 0 || yy >= h || xx < 0 || xx >= w || !src[yy * w + xx]) { all = 0; break; } } }
    out[y * w + x] = all ? 255 : 0;
  }
  return out;
}

/** Holes inside the mask filled: whatever the outside cannot reach is the roof. */
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (p: number) => { if (!outside[p] && !mask[p]) { outside[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w, y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  const out = new Uint8Array(w * h);
  for (let p = 0; p < out.length; p++) out[p] = outside[p] ? 0 : 255;
  return out;
}

/** Specks and hairs dropped (open), gaps closed, holes filled, then the edge softened over `feather` pixels. */
export function cleanMask(mask: Uint8Array, w: number, h: number, opts: { open?: number; close?: number; feather?: number; minShare?: number } = {}): Uint8Array {
  const open = opts.open ?? 1, close = opts.close ?? 2, feather = opts.feather ?? 2;
  let m = mask;
  if (open > 0) m = dilate(erode(m, w, h, open), w, h, open);
  if (close > 0) m = erode(dilate(m, w, h, close), w, h, close);
  m = fillHoles(m, w, h);
  // the biggest islands only: anything under minShare of the largest is a speck
  m = keepIslands(m, w, h, opts.minShare ?? 0.02);
  if (feather > 0) m = blurMask(m, w, h, feather);
  return m;
}

function keepIslands(mask: Uint8Array, w: number, h: number, minShare: number): Uint8Array {
  const label = new Int32Array(w * h);
  const sizes: number[] = [0];
  let next = 1;
  for (let p0 = 0; p0 < mask.length; p0++) {
    if (!mask[p0] || label[p0]) continue;
    const id = next++;
    let size = 0;
    const stack = [p0]; label[p0] = id;
    while (stack.length) {
      const p = stack.pop()!; size++;
      const x = p % w, y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && mask[q] && !label[q]) { label[q] = id; stack.push(q); }
    }
    sizes.push(size);
  }
  const biggest = Math.max(...sizes);
  const out = new Uint8Array(w * h);
  for (let p = 0; p < out.length; p++) if (mask[p] && sizes[label[p]] >= biggest * minShare) out[p] = 255;
  return out;
}

function blurMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // two box passes ≈ a soft edge of about 2r pixels
  let src = Float32Array.from(mask);
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += src[y * w + Math.max(0, Math.min(w - 1, x))]; for (let x = 0; x < w; x++) { tmp[y * w + x] = s / (2 * r + 1); s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]; } }
    const out = new Float32Array(w * h);
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[Math.max(0, Math.min(h - 1, y)) * w + x]; for (let y = 0; y < h; y++) { out[y * w + x] = s / (2 * r + 1); s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
    src = out;
  }
  const out = new Uint8Array(w * h);
  for (let p = 0; p < out.length; p++) out[p] = Math.round(Math.max(0, Math.min(255, src[p])));
  return out;
}

export interface MaskStats {
  area: number;
  share: number;
  bbox: { x: number; y: number; w: number; h: number } | null;
  cx: number;
  cy: number;
  /** The long axis of the roof in the picture, radians from the x axis (−π/2…π/2). */
  angle: number;
}

export function maskStats(mask: Uint8Array, w: number, h: number): MaskStats {
  let n = 0, sx = 0, sy = 0, minX = w, minY = h, maxX = -1, maxY = -1;
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] < 128) continue;
    const x = p % w, y = (p - x) / w;
    n++; sx += x; sy += y;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!n) return { area: 0, share: 0, bbox: null, cx: w / 2, cy: h / 2, angle: 0 };
  const cx = sx / n, cy = sy / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] < 128) continue;
    const x = p % w - cx, y = (p - (p % w)) / w - cy;
    sxx += x * x; syy += y * y; sxy += x * y;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { area: n, share: n / (w * h), bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, cx, cy, angle };
}

/* ── the look ──────────────────────────────────────────────────────────── */

export interface PaintOptions {
  /** The pattern's period in pixels (a shingle row, a seam spacing, a tile row); 0 = no pattern. */
  period?: number;
  /** The roof's orientation in the picture, radians; the pattern runs with it. Default: the mask's own axis. */
  angle?: number;
  /** How strong the pattern draws, 0…1. */
  strength?: number;
  /** How much of the original shading survives, 0…1 (1 = every shadow and highlight kept). */
  shading?: number;
}

const hash = (x: number, y: number) => { let n = (x * 374761393 + y * 668265263) | 0; n = (n ^ (n >> 13)) * 1274126177; return (((n ^ (n >> 16)) >>> 0) % 1000) / 1000; };
const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** The material's pattern at a point of the roof's own grid (u along the eave, v up the slope), 1 = untouched. */
function pattern(family: RoofFamily, u: number, v: number, period: number, strength: number): number {
  if (period <= 0 || strength <= 0) return 1;
  const p = period;
  const row = Math.floor(v / p), fv = v / p - row;
  switch (family) {
    case "metal": {
      // standing seams up the slope: a dark line with a bright lip beside it
      const su = ((u % (p * 1.6)) + p * 1.6) % (p * 1.6);
      const d = Math.min(su, p * 1.6 - su);
      const line = d < 0.6 ? 0.72 : d < 1.6 ? 1.06 : 1;
      return 1 + (line - 1) * strength;
    }
    case "tile": {
      // barrel tiles: a rounded highlight across each tile, a shadow under each row
      const tu = ((u % (p * 1.2)) + p * 1.2) % (p * 1.2) / (p * 1.2);
      const barrel = 0.9 + 0.22 * Math.sin(tu * Math.PI);
      const shadow = fv < 0.14 ? 0.72 + fv * 1.6 : 1;
      return 1 + (barrel * shadow - 1) * strength;
    }
    case "shake":
    case "synthetic": {
      const off = (row % 2) * p * 0.45 + hash(row, 0) * p * 0.3;
      const wu = ((u + off) % (p * 0.9)) + (hash(row, 1) > 0.5 ? 0 : 0);
      const joint = Math.abs(wu) < 0.9 ? 0.78 : 1;
      const butt = fv < 0.1 ? 0.7 + fv * 2.4 : 1;
      const grain = 0.96 + 0.08 * hash(Math.floor(u), row);
      return 1 + (joint * butt * grain - 1) * strength;
    }
    case "slate": {
      const off = (row % 2) * p * 0.75;
      const wu = ((u + off) % (p * 1.5) + p * 1.5) % (p * 1.5);
      const joint = Math.min(wu, p * 1.5 - wu) < 0.7 ? 0.74 : 1;
      const butt = fv < 0.12 ? 0.68 + fv * 2.4 : 1;
      const tone = 0.95 + 0.1 * hash(Math.floor(u / (p * 1.5)), row);
      return 1 + (joint * butt * tone - 1) * strength;
    }
    case "low-slope": {
      // a membrane: faint seams every few feet, nothing else
      const su = ((u % (p * 6)) + p * 6) % (p * 6);
      return 1 + ((su < 0.8 ? 0.9 : 1) - 1) * strength;
    }
    case "asphalt":
    default: {
      // shingle rows with a soft shadow at each butt, joints staggered by half a tab, a little grain
      const off = (row % 2) * p * 0.5;
      const wu = ((u + off) % p + p) % p;
      const joint = Math.min(wu, p - wu) < 0.55 ? 0.86 : 1;
      const butt = fv < 0.12 ? 0.7 + fv * 2.5 : 1;
      const grain = 0.97 + 0.06 * hash(Math.floor(u * 0.7), Math.floor(v * 0.7));
      return 1 + (joint * butt * grain - 1) * strength;
    }
  }
}

/**
 * The roof painted in the look. Every pixel keeps its own light — its luminance against the masked area's mean —
 * so the planes, shadows and ridges of the real roof stay; only the material changes. Returns new pixels.
 */
export function paintRoof(img: Raster, mask: Uint8Array, look: RoofLook, opts: PaintOptions = {}): Uint8ClampedArray {
  const { width: w, height: h } = img;
  const out = new Uint8ClampedArray(img.data);
  const [tr, tg, tb] = hexToRgb(lookColor(look).hex);
  const st = maskStats(mask, w, h);
  if (!st.area) return out;
  // the roof's mean luminance, over the masked pixels
  let sum = 0, n = 0;
  for (let p = 0; p < mask.length; p++) if (mask[p] >= 128) { const i = p * 4; sum += luma(img.data[i], img.data[i + 1], img.data[i + 2]); n++; }
  const mean = Math.max(0.08, sum / Math.max(1, n));
  const shading = opts.shading ?? 1;
  const strength = opts.strength ?? 0.8;
  const angle = opts.angle ?? st.angle;
  const period = opts.period ?? defaultPeriod(look.family, st);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  // the target in a light-linear way: the material's colour at the roof's mean light; brighter paint stays brighter
  const tl = luma(tr, tg, tb);
  for (let p = 0; p < mask.length; p++) {
    const a = mask[p];
    if (!a) continue;
    const i = p * 4;
    const r0 = img.data[i], g0 = img.data[i + 1], b0 = img.data[i + 2];
    const l = luma(r0, g0, b0);
    // how much lighter or darker this pixel is than the roof as a whole — its own shading
    let s = l / mean;
    s = 1 + (s - 1) * shading;
    s = Math.max(0.25, Math.min(1.75, s));
    // a very dark material shows less contrast, a light one more: scale around its own light
    const k = s * (0.55 + 0.45 * Math.min(1, tl / 0.35));
    const x = p % w, y = (p - x) / w;
    const u = (x - st.cx) * ca + (y - st.cy) * sa, v = -(x - st.cx) * sa + (y - st.cy) * ca;
    const pat = pattern(look.family, u, v, period, strength);
    const f = k * pat;
    const r = Math.min(255, tr * f), g = Math.min(255, tg * f), b = Math.min(255, tb * f);
    const t = a / 255;
    out[i] = Math.round(r0 + (r - r0) * t);
    out[i + 1] = Math.round(g0 + (g - g0) * t);
    out[i + 2] = Math.round(b0 + (b - b0) * t);
  }
  return out;
}

/** A pattern period that reads at the picture's scale: from the roof's size in the picture. */
export function defaultPeriod(family: RoofFamily, st: MaskStats): number {
  const size = st.bbox ? Math.max(st.bbox.w, st.bbox.h) : 400;
  const base = Math.max(4, size / 42);
  switch (family) {
    case "metal": return base * 1.15;
    case "tile": return base * 0.9;
    case "shake": return base * 1.05;
    case "slate": return base * 1.2;
    case "low-slope": return base * 2;
    default: return base;
  }
}

/** The rings' mask on the aerial picture — the measured roof, exactly. */
export function measuredMask(rings: readonly LatLng[][], frame: RoofFrame, width: number, height: number, feather = 1.5): Uint8Array {
  const polys = ringsToPixels(rings, frame, width, height);
  const m = polygonMask(width, height, polys);
  return feather > 0 ? blurMask(m, width, height, Math.max(1, Math.round(feather))) : m;
}

/** Polygons a vision model answered in 0…1 of the picture, into pixels; anything malformed dropped. */
export function normalizedPolygons(raw: unknown, width: number, height: number): Point[][] {
  const polys = Array.isArray(raw) ? raw : [];
  const out: Point[][] = [];
  for (const poly of polys) {
    if (!Array.isArray(poly)) continue;
    const pts: Point[] = [];
    for (const pt of poly) {
      const x = Array.isArray(pt) ? Number(pt[0]) : typeof pt === "object" && pt ? Number((pt as { x?: unknown }).x) : NaN;
      const y = Array.isArray(pt) ? Number(pt[1]) : typeof pt === "object" && pt ? Number((pt as { y?: unknown }).y) : NaN;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push([Math.max(0, Math.min(1, x)) * width, Math.max(0, Math.min(1, y)) * height]);
    }
    if (pts.length >= 3) out.push(pts);
  }
  return out;
}

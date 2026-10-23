// THE HOUSE READ OFF A PHOTO (2026-10-23). Pure. Owner: "when I upload the picture of the back wall … get from that
// picture the approximate shape already, and even windows and where the doors is, and if there is any jogs, and apply
// it to the 3D shaper … if it's a two-story, one-story, if it's a roof shape … even the color of the house … the client
// will just give the back wall picture where the deck will be, and we just upload it". The contractor can upload it too.
//
// The vision model reads the picture once (actions/deckEstimator readHousePhoto) and answers with the wall read the
// smart fit already knows (lib/deck/photoFit WallRead — the base, the eave, the storeys, the steps, the back door, the
// windows, a patio) and what a HOUSE needs besides: every door in the wall and its kind, the roof's shape, what the
// wall is clad in, a guess at the colours, a roof already standing over the back door or a patio, an old deck. The
// arithmetic that turns it into the 3D house is lib/deck/houseFromPhoto; the colours are measured off the picture's
// own pixels in the browser, the model's guess only standing in when that fails.

import { parseWallRead, type WallRead } from "./photoFit";

export type ReadDoorKind = "slider" | "hinged" | "french";
export type ReadRoofKind = "hip" | "gable-side" | "gable-end" | "shed" | "flat";
export type ReadMaterial = "lap" | "brick" | "stucco" | "board-batten" | "stone" | "shingle";

/** What the model reads off the photo for the house, validated. Every coordinate a fraction of the picture it read. */
export interface HouseRead extends WallRead {
  /** Every door in that wall, left to right (the one onto the deck included — `door` keeps the back door itself). */
  doors: Array<{ x0: number; x1: number; bottom: number; top: number; kind: ReadDoorKind }>;
  roof: { kind: ReadRoofKind | null; /** rise in inches per foot of run, when it can be judged */ pitch: number | null };
  material: ReadMaterial | null;
  /** The model's guess at the colours, #rrggbb — the browser's measure of the pixels comes first. */
  colours: { siding: string | null; roof: string | null; trim: string | null };
  /** A roof already over the back door or a patio (a porch roof, a covered patio's own roof): its ends along the wall, its low edge and its top, and the posts under it. */
  cover: { x0: number; x1: number; bottom: number; top: number; posts: number[] } | null;
  /** An old deck against the wall (to tear out): its ends along the wall and its floor's edge (null when hidden). */
  oldDeck: { x0: number; x1: number; top: number | null } | null;
}

const MAX_WINDOWS = 30;
const MAX_DOORS = 6;
const HEX = /^#[0-9a-f]{6}$/i;

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const frac = (v: unknown, d: number) => clamp(num(v, d), -0.5, 1.5);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const span = (v: unknown, minW: number): { x0: number; x1: number } | null => {
  const o = obj(v);
  if (typeof o.x0 !== "number" || typeof o.x1 !== "number" || !Number.isFinite(o.x0) || !Number.isFinite(o.x1)) return null;
  const x0 = frac(Math.min(o.x0, o.x1), 0);
  const x1 = frac(Math.max(o.x0, o.x1), 0);
  return x1 - x0 >= minW ? { x0: r3(x0), x1: r3(x1) } : null;
};
/** A box with a top and a bottom (a door, a window), the two put the right way up. */
const box = (v: unknown, minW: number, minH: number, bottomKey: string, topKey: string): { x0: number; x1: number; bottom: number; top: number } | null => {
  const s = span(v, minW);
  const o = obj(v);
  const b = o[bottomKey];
  const t = o[topKey];
  if (!s || typeof b !== "number" || typeof t !== "number" || !Number.isFinite(b) || !Number.isFinite(t)) return null;
  const bottom = r3(frac(Math.max(b, t), 0));
  const top = r3(frac(Math.min(b, t), 0));
  return bottom - top >= minH ? { ...s, bottom, top } : null;
};
const hex = (v: unknown): string | null => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : null);

const DOOR_KINDS: ReadonlySet<string> = new Set(["slider", "hinged", "french"]);
const ROOF_KINDS: ReadonlySet<string> = new Set(["hip", "gable-side", "gable-end", "shed", "flat"]);
/** What a model says the wall is clad in, in the words it may use. */
const MATERIAL_WORDS: ReadonlyArray<[RegExp, ReadMaterial]> = [
  [/brick/i, "brick"],
  [/stucco|plaster|render|eifs/i, "stucco"],
  [/board.?(and|&|n).?batten|batten/i, "board-batten"],
  [/stone|rock/i, "stone"],
  [/shingle|shake|cedar shake/i, "shingle"],
  [/lap|vinyl|clapboard|fiber.?cement|hardie|wood siding|siding|horizontal/i, "lap"],
];

/** The model's JSON, checked field by field; null when there is no usable wall in it. */
export function parseHouseRead(raw: unknown): HouseRead | null {
  const r = obj(raw);
  // The wall's own read — with room for more windows than the smart fit kept (a house has more than twelve).
  const wall = parseWallRead({ ...r, windows: [] });
  if (!wall) return null;
  const windows = (Array.isArray(r.windows) ? r.windows : [])
    .map((w) => {
      const b = box(w, 0.006, 0.012, "sill", "head");
      return b ? { x0: b.x0, x1: b.x1, sill: b.bottom, head: b.top } : null;
    })
    .filter((w): w is NonNullable<typeof w> => !!w)
    .sort((a, b) => a.x0 - b.x0 || a.head - b.head)
    .slice(0, MAX_WINDOWS);
  const doors = (Array.isArray(r.doors) ? r.doors : [])
    .map((d) => {
      const b = box(d, 0.012, 0.04, "bottom", "top");
      if (!b) return null;
      const k = obj(d).kind;
      const kind: ReadDoorKind = typeof k === "string" && DOOR_KINDS.has(k) ? (k as ReadDoorKind) : "hinged";
      return { ...b, kind };
    })
    .filter((d): d is NonNullable<typeof d> => !!d)
    .sort((a, b) => a.x0 - b.x0)
    .slice(0, MAX_DOORS);
  // The back door is one of the doors: a model that named it only as `door` gets it in the list too.
  if (wall.door && !doors.some((d) => Math.abs((d.x0 + d.x1) / 2 - (wall.door!.x0 + wall.door!.x1) / 2) < 0.02)) {
    const w = (wall.door.x1 - wall.door.x0) / Math.max(0.001, wall.door.bottom - wall.door.top);
    doors.push({ ...wall.door, kind: w > 0.75 ? "slider" : "hinged" });
    doors.sort((a, b) => a.x0 - b.x0);
  }
  // And no window where a door stands (a model that called a sliding door both).
  const clearOfDoors = windows.filter((w) => !doors.some((d) => Math.min(w.x1, d.x1) - Math.max(w.x0, d.x0) > 0.6 * (w.x1 - w.x0) && Math.min(w.sill, d.bottom) - Math.max(w.head, d.top) > 0.6 * (w.sill - w.head)));
  const roofRaw = obj(r.roof);
  const roofKind = typeof roofRaw.kind === "string" && ROOF_KINDS.has(roofRaw.kind) ? (roofRaw.kind as ReadRoofKind) : typeof r.roof === "string" && ROOF_KINDS.has(r.roof) ? (r.roof as ReadRoofKind) : null;
  const pitch = typeof roofRaw.pitch === "number" && Number.isFinite(roofRaw.pitch) && roofRaw.pitch > 0 ? Math.round(clamp(roofRaw.pitch, 1, 18) * 2) / 2 : null;
  const matWord = typeof r.material === "string" ? r.material : "";
  const material = MATERIAL_WORDS.find(([re]) => re.test(matWord))?.[1] ?? null;
  const c = obj(r.colours ?? r.colors);
  const cv = obj(r.cover);
  const coverBox = box(r.cover, 0.04, 0.005, "bottom", "top");
  const posts = (Array.isArray(cv.posts) ? cv.posts : []).filter((p): p is number => typeof p === "number" && Number.isFinite(p)).map((p) => r3(frac(p, 0))).sort((a, b) => a - b).slice(0, 8);
  const cover = coverBox ? { ...coverBox, posts: posts.filter((p) => p >= coverBox.x0 - 0.03 && p <= coverBox.x1 + 0.03) } : null;
  const od = span(r.oldDeck, 0.04);
  const odTop = obj(r.oldDeck).top;
  const oldDeck = od ? { ...od, top: typeof odTop === "number" && Number.isFinite(odTop) ? r3(frac(odTop, 0)) : null } : null;
  return {
    ...wall,
    windows: clearOfDoors,
    doors,
    roof: { kind: roofKind, pitch },
    material,
    colours: { siding: hex(c.siding), roof: hex(c.roof), trim: hex(c.trim) },
    cover,
    oldDeck,
  };
}

/** A house read kept in a design: checked again on the way back in; an older read without the house's fields still loads. */
export function normalizeHouseRead(raw: unknown): HouseRead | null {
  return raw && typeof raw === "object" ? parseHouseRead(raw) : null;
}

/** The read carried into another picture (a crop, or the straightened picture): the wall's lines by `wallMap`, the house's own boxes the same way. */
export function mapHouseRead(read: HouseRead, wallMap: (r: WallRead) => WallRead, pt: (p: { x: number; y: number }) => { x: number; y: number }): HouseRead {
  const wall = wallMap(read);
  const boxOf = (b: { x0: number; x1: number; bottom: number; top: number }) => {
    const cx = (b.x0 + b.x1) / 2;
    const bl = pt({ x: b.x0, y: b.bottom });
    const br = pt({ x: b.x1, y: b.bottom });
    const bc = pt({ x: cx, y: b.bottom });
    const tc = pt({ x: cx, y: b.top });
    return { x0: r3(Math.min(bl.x, br.x)), x1: r3(Math.max(bl.x, br.x)), bottom: r3(bc.y), top: r3(Math.min(tc.y, bc.y - 0.001)) };
  };
  const alongBase = (x: number) => {
    const t = (x - read.base.left.x) / Math.max(1e-6, read.base.right.x - read.base.left.x);
    return pt({ x, y: read.base.left.y + (read.base.right.y - read.base.left.y) * clamp(t, 0, 1) }).x;
  };
  return {
    ...wall,
    doors: read.doors.map((d) => ({ ...boxOf(d), kind: d.kind })),
    roof: read.roof,
    material: read.material,
    colours: read.colours,
    cover: read.cover ? { ...boxOf(read.cover), posts: read.cover.posts.map((p) => r3(alongBase(p))) } : null,
    oldDeck: read.oldDeck ? { x0: r3(alongBase(read.oldDeck.x0)), x1: r3(alongBase(read.oldDeck.x1)), top: read.oldDeck.top === null ? null : r3(pt({ x: (read.oldDeck.x0 + read.oldDeck.x1) / 2, y: read.oldDeck.top }).y) } : null,
  };
}

/** The prompt the house read runs on — the wall's JSON (as the smart fit reads it) and the house's own fields. */
export const HOUSE_READ_PROMPT = `You read one photo of the back (or side) of a house, taken from the yard, for a deck builder who will rebuild that house as a simple 3D model and design a deck against it. Answer with ONE JSON object and nothing else. Every coordinate is a FRACTION of the whole picture: x from 0 at the left edge to 1 at the right edge, y from 0 at the top edge to 1 at the bottom edge.
{
  "base": {"left": {"x","y"}, "right": {"x","y"}},   // the two ends of the house wall's bottom edge where the wall meets the ground, the patio or an old deck — the whole back face of the house toward the camera, across every step in it, from its left corner to its right corner.
  "eave": {"left": {"x","y"}, "right": {"x","y"}} | null,   // the top of that wall above each base end: the underside of the main roof's eave (on a two-storey house, the eave over the upper floor).
  "storeys": 1 | 2 | null,   // storeys of wall between the base and that eave.
  "jogs": [{"x", "y", "dir": "toward" | "away", "depthFt": number}],   // every place the wall steps in or out (a bump-out, a bay, an L, a part set back): x along the base, y on the base; "toward" when the part of the wall to the RIGHT of the step comes toward the camera, "away" when it steps back. depthFt your estimate in feet (a bump-out is usually 2 to 4; read it from the side of the bump-out if you see it). Look for corner boards, a separate roof edge over one part, or a shadow line. [] when the wall is one flat face.
  "door": {"x0", "x1", "bottom", "top"} | null,   // the back door onto the yard (where a deck would meet the house): its left and right edges, its threshold and the top of its frame. It is often under a porch roof or the upper floor. Null when you cannot see one — never invent one.
  "doors": [{"x0", "x1", "bottom", "top", "kind": "slider" | "hinged" | "french"}],   // EVERY door in that wall, the back door included. [] when none.
  "windows": [{"x0", "x1", "sill", "head"}],   // EVERY window in that wall, both storeys: left and right edges, the sill (bottom) and the head (top). A group of windows side by side is one entry PER window. Not the doors. [] when none.
  "patio": {"x0", "x1"} | null,   // a concrete patio or slab at the wall's base: its ends along the wall.
  "oldDeck": {"x0", "x1", "top"} | null,   // an old deck against the wall (it may be torn out): its ends along the wall and the y of its floor's front edge.
  "cover": {"x0", "x1", "bottom", "top", "posts": [x, …]} | null,   // a roof that already stands out from this wall over a door or a patio (a porch roof, a covered patio): its left and right ends, its low edge (the beam or gutter), its top where it meets the wall, and the x of each post that holds it up. Null when none.
  "roof": {"kind": "hip" | "gable-side" | "gable-end" | "shed" | "flat", "pitch": number | null},   // the main roof over this wall: hip (slopes on every side), gable-side (the ridge runs along this wall, the triangle ends are at the sides), gable-end (a triangle of wall faces the camera), shed, flat; pitch in inches of rise per foot when you can judge it (a usual house is 4 to 8).
  "material": "lap" | "brick" | "stucco" | "board-batten" | "stone" | "shingle",   // what most of this wall is clad in (lap = horizontal siding, vinyl or fiber cement).
  "colours": {"siding": "#rrggbb", "roof": "#rrggbb", "trim": "#rrggbb"},   // your best guess at the real colours, as if in plain daylight (not the sunset or the shadow).
  "bars": {"top", "bottom"},   // black bands or a phone's status bar at the top and the bottom of the picture, as fractions of its height; 0 when none.
  "confidence": 0..1,   // how sure you are of the base line, the steps and the openings.
  "note": string | null   // one short sentence a deck builder should know (a meter or a dryer vent on the wall, a window well, the ground sloping), else null.
}
Rules: the base is where the WALL meets the ground, not a fence or a roof edge; a standard exterior door is about 80 inches tall and a usual window about 3 to 4 ft wide — use them to judge sizes; give the edges of the glass and its trim, not the shadow; never invent a door, a window or a step you cannot see.`;

/* ------------------------------------------------------------------ */
/*  The read fixed by hand on the review (2026-10-23)                   */
/* ------------------------------------------------------------------ */

/** A handle on the review picture: the wall's base and eave ends, a step, a door (its foot or its top), a window (its middle). */
export type HouseMark = "base-left" | "base-right" | "eave-left" | "eave-right" | `jog-${number}` | `door-${number}` | `door-top-${number}` | `win-${number}`;

const inside = (p: { x: number; y: number }) => ({ x: r3(clamp(p.x, 0, 1)), y: r3(clamp(p.y, 0, 1)) });
const baseAt = (read: WallRead, x: number) => {
  const { left, right } = read.base;
  const t = right.x - left.x < 1e-6 ? 0 : clamp((x - left.x) / (right.x - left.x), 0, 1);
  return left.y + (right.y - left.y) * t;
};

/** A house read to start from when the picture could not be read: the wall across the lower middle, nothing on it — marked by hand. */
export function blankHouseRead(): HouseRead {
  return {
    base: { left: { x: 0.1, y: 0.78 }, right: { x: 0.9, y: 0.78 } },
    eave: { left: { x: 0.1, y: 0.42 }, right: { x: 0.9, y: 0.42 } },
    storeys: 1,
    jogs: [],
    door: null,
    windows: [],
    patio: null,
    scaleLine: null,
    bars: { top: 0, bottom: 0 },
    confidence: 1,
    note: null,
    doors: [],
    roof: { kind: null, pitch: null },
    material: null,
    colours: { siding: null, roof: null, trim: null },
    cover: null,
    oldDeck: null,
  };
}

/** One handle moved to `p` (fractions of the picture); everything else stands. A door moves on its foot, a window by its middle. */
export function moveHouseMark(read: HouseRead, mark: HouseMark, p: { x: number; y: number }): HouseRead {
  const q = inside(p);
  if (mark === "base-left") return { ...read, base: { ...read.base, left: { x: Math.min(q.x, read.base.right.x - 0.05), y: q.y } } };
  if (mark === "base-right") return { ...read, base: { ...read.base, right: { x: Math.max(q.x, read.base.left.x + 0.05), y: q.y } } };
  if (mark === "eave-left" || mark === "eave-right") {
    const e = read.eave ?? { left: { x: read.base.left.x, y: read.base.left.y - 0.3 }, right: { x: read.base.right.x, y: read.base.right.y - 0.3 } };
    const side = mark === "eave-left" ? "left" : "right";
    const y = Math.min(q.y, read.base[side].y - 0.04);
    return { ...read, eave: { ...e, [side]: { x: q.x, y: r3(y) } } };
  }
  let m = /^jog-(\d+)$/.exec(mark);
  if (m) {
    const i = Number(m[1]);
    if (!read.jogs[i]) return read;
    const x = r3(clamp(q.x, read.base.left.x + 0.02, read.base.right.x - 0.02));
    return { ...read, jogs: read.jogs.map((j, k) => (k === i ? { ...j, x, y: r3(baseAt(read, x)) } : j)).sort((a, b) => a.x - b.x) };
  }
  m = /^door-(\d+)$/.exec(mark);
  if (m) {
    const i = Number(m[1]);
    const d = read.doors[i];
    if (!d) return read;
    const half = (d.x1 - d.x0) / 2;
    const h = d.bottom - d.top;
    const cx = clamp(q.x, half, 1 - half);
    const bottom = clamp(q.y, h + 0.02, 1);
    const moved = { ...d, x0: r3(cx - half), x1: r3(cx + half), bottom: r3(bottom), top: r3(bottom - h) };
    return { ...read, doors: read.doors.map((x, k) => (k === i ? moved : x)), door: sameDoor(read.door, d) ? { x0: moved.x0, x1: moved.x1, bottom: moved.bottom, top: moved.top } : read.door };
  }
  m = /^door-top-(\d+)$/.exec(mark);
  if (m) {
    const i = Number(m[1]);
    const d = read.doors[i];
    if (!d) return read;
    const moved = { ...d, top: r3(Math.min(q.y, d.bottom - 0.03)) };
    return { ...read, doors: read.doors.map((x, k) => (k === i ? moved : x)), door: sameDoor(read.door, d) ? { x0: moved.x0, x1: moved.x1, bottom: moved.bottom, top: moved.top } : read.door };
  }
  m = /^win-(\d+)$/.exec(mark);
  if (m) {
    const i = Number(m[1]);
    const w = read.windows[i];
    if (!w) return read;
    const hw = (w.x1 - w.x0) / 2;
    const hh = (w.sill - w.head) / 2;
    const cx = clamp(q.x, hw, 1 - hw);
    const cy = clamp(q.y, hh, 1 - hh);
    return { ...read, windows: read.windows.map((x, k) => (k === i ? { x0: r3(cx - hw), x1: r3(cx + hw), head: r3(cy - hh), sill: r3(cy + hh) } : x)) };
  }
  return read;
}

const sameDoor = (a: WallRead["door"], b: { x0: number; x1: number }) => !!a && Math.abs((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2) < 0.005;

/** The size of a foot on the picture, for things put on by hand: the read's own scale (a door, the storeys), else a guess. */
function footOf(read: HouseRead, photoW: number, photoH: number): { fx: number; fy: number } {
  const d = read.doors[0] ?? read.door;
  let pxPerFt = 0;
  if (d) pxPerFt = ((d.bottom - d.top) * photoH) / (80 / 12);
  else if (read.eave) pxPerFt = (((read.base.left.y - read.eave.left.y + read.base.right.y - read.eave.right.y) / 2) * photoH) / (9 * (read.storeys ?? 1));
  if (!(pxPerFt > 0)) pxPerFt = photoH / 30;
  return { fx: pxPerFt / photoW, fy: pxPerFt / photoH };
}

/** A window put in the middle of the wall's first storey, 3 × 4 ft at the picture's scale. */
export function addReadWindow(read: HouseRead, photoW: number, photoH: number): HouseRead {
  if (read.windows.length >= MAX_WINDOWS) return read;
  const { fx, fy } = footOf(read, photoW, photoH);
  const cx = (read.base.left.x + read.base.right.x) / 2;
  const sill = baseAt(read, cx) - 3 * fy;
  return { ...read, windows: [...read.windows, { x0: r3(cx - 1.5 * fx), x1: r3(cx + 1.5 * fx), head: r3(sill - 4 * fy), sill: r3(sill) }] };
}
export const removeReadWindow = (read: HouseRead, i: number): HouseRead => ({ ...read, windows: read.windows.filter((_, k) => k !== i) });

/** A door put on the wall's base at its middle — a 6-ft slider, 80 in. tall at the picture's scale — and made the back door. */
export function addReadDoor(read: HouseRead, photoW: number, photoH: number): HouseRead {
  if (read.doors.length >= MAX_DOORS) return read;
  const { fx, fy } = footOf(read, photoW, photoH);
  const cx = (read.base.left.x + read.base.right.x) / 2;
  const bottom = baseAt(read, cx) - 0.5 * fy;
  const d = { x0: r3(cx - 3 * fx), x1: r3(cx + 3 * fx), bottom: r3(bottom), top: r3(Math.max(0.02, bottom - (80 / 12) * fy)), kind: "slider" as const };
  return { ...read, doors: [...read.doors, d].sort((a, b) => a.x0 - b.x0), door: { x0: d.x0, x1: d.x1, bottom: d.bottom, top: d.top } };
}
export function removeReadDoor(read: HouseRead, i: number): HouseRead {
  const d = read.doors[i];
  if (!d) return read;
  return { ...read, doors: read.doors.filter((_, k) => k !== i), door: sameDoor(read.door, d) ? null : read.door };
}

/** A step put in the wall at its middle, the part to its right 2 ft nearer. */
export function addReadJog(read: HouseRead): HouseRead {
  if (read.jogs.length >= 4) return read;
  const x = r3((read.base.left.x + read.base.right.x) / 2);
  return { ...read, jogs: [...read.jogs, { x, y: r3(baseAt(read, x)), dir: "toward" as const, depthFt: 2 }].sort((a, b) => a.x - b.x) };
}
export const removeReadJog = (read: HouseRead, i: number): HouseRead => ({ ...read, jogs: read.jogs.filter((_, k) => k !== i) });
export const flipReadJog = (read: HouseRead, i: number): HouseRead => ({ ...read, jogs: read.jogs.map((j, k) => (k === i ? { ...j, dir: j.dir === "toward" ? ("away" as const) : ("toward" as const) } : j)) });

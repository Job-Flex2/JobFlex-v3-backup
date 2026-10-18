// THE DESIGN LIBRARY (Home Design Studio, milestone 3 — 2026-10-17). What can go in a kitchen: cabinets in their
// standard sizes (3-inch steps, the codes a cabinet shop writes: B24, SB36, W3036…), appliances in their standard
// widths, lights, furniture — and the finishes, brand-neutral (the contractor types a brand's code beside a color when
// they want it on the proposal). Every cabinet and appliance is drawn to its size from its numbers; nothing here is a
// 3D file. Pure.
import type { DesignItem, Finishes } from "./model";

export type LibCat = "base" | "wall" | "tall" | "island" | "appliance" | "light" | "furniture";

export type LibEntry = {
  id: string;
  name: string;
  cat: LibCat;
  /** The plan's short code before the size: B, SB, W… */
  code: string;
  widths: number[];
  /** Default size and height above the floor. */
  w: number;
  d: number;
  h: number;
  z: number;
  heights?: number[];
  depths?: number[];
  /** Goes against a wall by default. */
  wall: boolean;
  /** Stands in a run of base cabinets (a dishwasher, a range): the counter line runs through it. */
  inRun?: boolean;
  /** Has a counter on top. */
  counter?: boolean;
  /** One line about it. */
  note?: string;
  opts?: Record<string, string | number | boolean>;
};

const range = (a: number, b: number, step = 3) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);

export const BASE_H = 34.5; // box + toe kick; the counter makes it 36
export const COUNTER_T = 1.25;
export const UPPER_Z = 54; // bottom of wall cabinets: 18 in above a 36 in counter

export const LIBRARY: LibEntry[] = [
  // Base cabinets — 24 in deep, 34½ in tall.
  { id: "B", name: "Base cabinet", cat: "base", code: "B", widths: range(9, 36), w: 24, d: 24, h: BASE_H, z: 0, wall: true, counter: true, note: "A drawer over a door (two doors from 24 in)" },
  { id: "DB", name: "Drawer base", cat: "base", code: "DB", widths: [12, 15, 18, 21, 24, 30, 36], w: 18, d: 24, h: BASE_H, z: 0, wall: true, counter: true, note: "Three or four drawers" },
  { id: "SB", name: "Sink base", cat: "base", code: "SB", widths: [24, 27, 30, 33, 36, 42], w: 36, d: 24, h: BASE_H, z: 0, wall: true, counter: true, note: "False front over two doors, the sink in the counter above", opts: { sink: "single" } },
  { id: "BC", name: "Blind corner base", cat: "base", code: "BC", widths: [36, 39, 42, 45, 48], w: 42, d: 24, h: BASE_H, z: 0, wall: true, counter: true, note: "Fills an inside corner; the run that meets it starts at its face" },
  { id: "BF", name: "Base filler", cat: "base", code: "BF", widths: [1.5, 3, 4.5, 6], w: 3, d: 24, h: BASE_H, z: 0, wall: true, counter: true },
  // Wall cabinets — 12 in deep, bottoms 54 in up.
  { id: "W", name: "Wall cabinet", cat: "wall", code: "W", widths: range(9, 36), w: 30, d: 12, h: 36, z: UPPER_Z, heights: [30, 36, 42], wall: true },
  { id: "WR", name: "Over-fridge cabinet", cat: "wall", code: "W", widths: [30, 33, 36, 42], w: 36, d: 24, h: 18, z: 72, heights: [12, 15, 18, 24], depths: [12, 24], wall: true },
  { id: "WF", name: "Wall filler", cat: "wall", code: "WF", widths: [1.5, 3, 4.5, 6], w: 3, d: 12, h: 36, z: UPPER_Z, wall: true },
  // Tall.
  { id: "P", name: "Pantry cabinet", cat: "tall", code: "P", widths: [18, 24, 30, 36], w: 24, d: 24, h: 84, z: 0, heights: [84, 90, 96], wall: true },
  { id: "OV", name: "Oven cabinet", cat: "tall", code: "OV", widths: [30, 33], w: 30, d: 24, h: 84, z: 0, heights: [84, 90, 96], wall: true, note: "With a wall oven and microwave" },
  // Island.
  { id: "ISL", name: "Island", cat: "island", code: "ISL", widths: range(48, 120, 6), w: 72, d: 36, h: BASE_H, z: 0, depths: [24, 30, 36, 42, 48], wall: false, counter: true, opts: { seats: true }, note: "Cabinets on the work side, a 12 in overhang to sit at" },
  // Appliances.
  { id: "RNG", name: "Range", cat: "appliance", code: "RNG", widths: [30, 36, 48], w: 30, d: 26, h: 36, z: 0, wall: true, inRun: true },
  { id: "CT", name: "Cooktop", cat: "appliance", code: "CT", widths: [30, 36], w: 30, d: 21, h: 3, z: 36, wall: false, note: "Set in the counter" },
  { id: "REF", name: "Refrigerator", cat: "appliance", code: "REF", widths: [30, 33, 36, 42, 48], w: 36, d: 30, h: 70, z: 0, heights: [66, 70, 72, 84], wall: true },
  { id: "DW", name: "Dishwasher", cat: "appliance", code: "DW", widths: [18, 24], w: 24, d: 24, h: BASE_H, z: 0, wall: true, inRun: true, counter: true },
  { id: "HD", name: "Range hood", cat: "appliance", code: "HD", widths: [30, 36, 42, 48], w: 30, d: 20, h: 18, z: 66, wall: true },
  { id: "MW", name: "Microwave · over the range", cat: "appliance", code: "MW", widths: [30], w: 30, d: 16, h: 17, z: 66, wall: true },
  // Lights.
  { id: "PEN", name: "Pendant light", cat: "light", code: "PEN", widths: [8, 10, 12, 14, 16], w: 10, d: 10, h: 14, z: 66, wall: false },
  { id: "CAN", name: "Recessed light", cat: "light", code: "CAN", widths: [4, 6], w: 6, d: 6, h: 1, z: 95, wall: false },
  // Furniture.
  { id: "STL", name: "Counter stool", cat: "furniture", code: "STL", widths: [17, 18, 20], w: 17, d: 17, h: 26, z: 0, wall: false },
  { id: "TBL", name: "Dining table", cat: "furniture", code: "TBL", widths: [48, 60, 72, 84], w: 60, d: 36, h: 30, z: 0, depths: [30, 36, 40, 42], wall: false },
  { id: "CHR", name: "Dining chair", cat: "furniture", code: "CHR", widths: [18, 20], w: 18, d: 20, h: 34, z: 0, wall: false },
];

export const lib = (id: string): LibEntry | undefined => LIBRARY.find((e) => e.id === id);

/** The code a cabinet shop writes: B24, SB36, W3036, P2484, REF36. */
export function itemCode(it: Pick<DesignItem, "lib" | "w" | "h">): string {
  const e = lib(it.lib);
  if (!e) return it.lib;
  const w = Number.isInteger(it.w) ? String(it.w) : it.w.toFixed(1);
  if (e.cat === "wall" && e.id !== "WF") return `${e.code}${w}${Math.round(it.h)}`;
  if (e.cat === "tall") return `${e.code}${w}${Math.round(it.h)}`;
  if (e.cat === "light" || e.cat === "furniture") return e.code;
  return `${e.code}${w}`;
}

/** A new item from the library at its default size. */
export function newItemFrom(id: string, at: { x: number; y: number; rot: number; wallId?: string | null; room?: string | null }, uid: string, w?: number): DesignItem | null {
  const e = lib(id);
  if (!e) return null;
  return { id: uid, lib: e.id, x: at.x, y: at.y, rot: at.rot, w: w ?? e.w, d: e.d, h: e.h, z: e.z, wallId: at.wallId ?? null, room: at.room ?? null, ...(e.opts ? { opts: { ...e.opts } } : {}) };
}

/* ── Finishes ──────────────────────────────────────────────────────────────────────────────────────────────────── */

export type Swatch = { name: string; hex: string };

export const PAINTS: Swatch[] = [
  { name: "Warm white", hex: "#f3efe6" },
  { name: "Bright white", hex: "#f8f8f5" },
  { name: "Soft gray", hex: "#d6d5d0" },
  { name: "Greige", hex: "#cdc4b6" },
  { name: "Sage", hex: "#b9c4a7" },
  { name: "Pale blue", hex: "#c9d6df" },
  { name: "Clay", hex: "#c8a48b" },
  { name: "Navy", hex: "#2e4058" },
  { name: "Forest", hex: "#3c5446" },
  { name: "Charcoal", hex: "#3c3e42" },
];

export const CABINET_COLORS: Array<Swatch & { wood?: boolean }> = [
  { name: "White", hex: "#f4f3ef" },
  { name: "Cream", hex: "#ebe3d1" },
  { name: "Greige", hex: "#bfb5a6" },
  { name: "Sage", hex: "#9aad87" },
  { name: "Navy", hex: "#27364e" },
  { name: "Charcoal", hex: "#3a3b3e" },
  { name: "Black", hex: "#1e1f22" },
  { name: "Natural oak", hex: "#bb8c58", wood: true },
  { name: "Walnut", hex: "#6a4632", wood: true },
];

export type FloorPreset = { id: string; name: string; kind: "wood" | "lvp" | "tile"; hex: string; hex2?: string; tile?: { w: number; h: number }; grout?: string; plank?: number };
export const FLOORS: FloorPreset[] = [
  { id: "oak-natural", name: "White oak · natural", kind: "wood", hex: "#c8a273", plank: 5 },
  { id: "oak-light", name: "White oak · light", kind: "wood", hex: "#dcc3a0", plank: 7 },
  { id: "walnut", name: "Walnut", kind: "wood", hex: "#6c4a34", plank: 5 },
  { id: "hickory", name: "Hickory · rustic", kind: "wood", hex: "#a77a4f", hex2: "#d1ab7d", plank: 6 },
  { id: "lvp-gray", name: "Luxury vinyl · gray oak", kind: "lvp", hex: "#a9a39b", plank: 7 },
  { id: "tile-gray", name: "Porcelain · 12×24 warm gray", kind: "tile", hex: "#bdb8af", tile: { w: 24, h: 12 }, grout: "#9c978f" },
  { id: "tile-marble", name: "Marble-look porcelain · 24×24", kind: "tile", hex: "#ebe8e3", tile: { w: 24, h: 24 }, grout: "#d3d0ca" },
  { id: "tile-terracotta", name: "Terracotta · 8×8", kind: "tile", hex: "#b8683f", tile: { w: 8, h: 8 }, grout: "#d8c4ad" },
  { id: "tile-checker", name: "Checkerboard · 12×12", kind: "tile", hex: "#f1efe9", hex2: "#26272a", tile: { w: 12, h: 12 }, grout: "#bdbab3" },
];

export type CounterPreset = { id: string; name: string; hex: string; look: "solid" | "veined" | "speckled" | "wood" };
export const COUNTERS: CounterPreset[] = [
  { id: "quartz-white", name: "Quartz · white", hex: "#f1f0ec", look: "solid" },
  { id: "quartz-calacatta", name: "Quartz · Calacatta look", hex: "#f3f1ec", look: "veined" },
  { id: "marble-carrara", name: "Marble · Carrara", hex: "#e9e8e4", look: "veined" },
  { id: "granite-black", name: "Granite · black", hex: "#2b2b2e", look: "speckled" },
  { id: "granite-salt", name: "Granite · salt and pepper", hex: "#b9b7b2", look: "speckled" },
  { id: "soapstone", name: "Soapstone", hex: "#3f4644", look: "veined" },
  { id: "concrete", name: "Concrete", hex: "#a9a7a1", look: "solid" },
  { id: "butcher", name: "Butcher block · maple", hex: "#c99a5d", look: "wood" },
];

export type SplashPreset = { id: string; name: string; hex: string; tile?: { w: number; h: number; offset?: boolean; herring?: boolean }; grout?: string; slab?: boolean };
export const SPLASHES: SplashPreset[] = [
  { id: "subway-white", name: "Subway 3×6 · white", hex: "#f6f6f2", tile: { w: 6, h: 3, offset: true }, grout: "#d4d3cd" },
  { id: "subway-sage", name: "Subway 3×12 · sage", hex: "#a7b598", tile: { w: 12, h: 3, offset: true }, grout: "#e7e5dc" },
  { id: "zellige-green", name: "Zellige 4×4 · green", hex: "#5d8a6c", tile: { w: 4, h: 4 }, grout: "#d9d6cb" },
  { id: "marble-herring", name: "Marble · herringbone", hex: "#e8e6e1", tile: { w: 6, h: 2, herring: true }, grout: "#cfccc5" },
  { id: "slab", name: "Counter slab · full height", hex: "", slab: true },
  { id: "none", name: "None · painted wall", hex: "" },
];

export const HARDWARE_HEX: Record<Finishes["hardware"]["finish"], string> = { black: "#1b1b1d", brass: "#b48a45", nickel: "#a9aaa7", chrome: "#d7d9da" };

export const DEFAULT_FINISHES: Finishes = {
  wall: { color: PAINTS[0].hex, name: PAINTS[0].name, sheen: "eggshell", texture: "smooth" },
  floor: { id: "oak-natural", pattern: "straight", angle: 0 },
  cabinets: { style: "shaker", color: CABINET_COLORS[0].hex, name: CABINET_COLORS[0].name },
  counter: { id: "quartz-calacatta", edge: "eased" },
  backsplash: { id: "subway-white", height: "18in" },
  hardware: { kind: "bar", finish: "black" },
};

export const finishesFor = (all: Record<string, Finishes> | undefined, room: string | null | undefined): Finishes => ({
  ...DEFAULT_FINISHES,
  ...(room && all?.[room] ? all[room] : {}),
});
export const floorPreset = (id: string) => FLOORS.find((f) => f.id === id) ?? FLOORS[0];
export const counterPreset = (id: string) => COUNTERS.find((c) => c.id === id) ?? COUNTERS[0];
export const splashPreset = (id: string) => SPLASHES.find((s) => s.id === id) ?? SPLASHES[0];

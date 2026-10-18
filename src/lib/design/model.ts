// THE HOME DESIGN STUDIO'S ROOM MODEL (owner, 2026-10-17: "upload the blueprint, say I want to design the kitchen,
// and you bring that room already drawn — the sizes, where the doors are, whatever is in the plan — then design it in
// 3D"). One document per design: walls by their centerlines, doors and windows ON a wall, room labels, and the marks
// the plan drew (cabinets, appliances, fixtures). Rooms are not stored as shapes: they are the closed loops the walls
// make (lib/design/geometry roomsOf), named by the label inside — move a wall and the room follows.
// Units: INCHES. Plan axes as the sheet reads: x to the right, y DOWN the sheet. Pure, browser-safe.

export type P = { x: number; y: number };

export type Wall = {
  id: string;
  /** Centerline ends. */
  a: P;
  b: P;
  /** Finished thickness, inches (2×4 interior ≈ 4.5, 2×6 exterior with siding ≈ 6.5–8). */
  thick: number;
  /** Height to the ceiling, inches. */
  height: number;
  /** On the outside of the house (the outer loop). */
  exterior?: boolean;
  /** Read from the plan, or drawn here. */
  from?: "plan" | "drawn";
};

export type OpeningKind = "door" | "double" | "slider" | "pocket" | "window" | "opening";

export type Opening = {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** Center of the opening, inches along the wall from `a`. */
  at: number;
  width: number;
  height: number;
  /** Floor to the bottom of the opening (0 for doors). */
  sill: number;
  /** Which jamb the door hangs on. */
  hinge?: "a" | "b";
  /** The side it swings into: "left" of the wall walking a→b (the +normal side), or "right". */
  swing?: "left" | "right";
  /** The plan's tag, when read ("3", "B"). */
  tag?: string;
};

/** A room's name, placed inside it. The room is whichever loop of walls holds the label. */
export type RoomLabel = {
  id: string;
  name: string;
  at: P;
  /** Ceiling height, inches. */
  ceiling?: number;
  /** The area the plan printed under the name, to check the scale against. */
  planSqFt?: number | null;
};

export type MarkRole = "cabinet" | "appliance" | "plumbing";

/** Something the plan drew inside the rooms — a cabinet run, a fridge, a toilet — kept as its lines. */
export type PlanMark = {
  id: string;
  role: MarkRole;
  lines: Array<[P, P]>;
  /** Its bounding box. */
  box: { x: number; y: number; w: number; h: number };
  label?: string;
};

/* ── Milestone 3: what goes in the room (2026-10-17) ─────────────────────────────────────────────────────────── */

/**
 * A thing placed in the room: a cabinet, an appliance, a light, a piece of furniture. Its footprint is a rectangle
 * w (along its front) × d (front to back), centered at (x, y), its FRONT facing `rot` degrees in plan axes (x right,
 * y down: 90 faces down the sheet). z is its bottom above the floor, h its height. `lib` names the library entry
 * (lib/design/library) it was made from; everything else is this instance's own.
 */
export type DesignItem = {
  id: string;
  lib: string;
  x: number;
  y: number;
  rot: number;
  w: number;
  d: number;
  h: number;
  z: number;
  /** The wall its back is against, when it is. */
  wallId?: string | null;
  /** The room it belongs to (a label id). */
  room?: string | null;
  /** This one's own options: seats at an island, a single or double sink, the door's hinge side… */
  opts?: Record<string, string | number | boolean>;
};

export type Sheen = "flat" | "eggshell" | "satin" | "semi";
export type WallTexture = "smooth" | "orange" | "knockdown" | "skim";
export type DoorStyle = "shaker" | "slab" | "raised";
export type FloorPattern = "straight" | "diagonal" | "herringbone" | "grid" | "offset";

/** A room's finishes. Colors are hex; `code` is the contractor's own paint/product code ("SW 7008"), shown as written. */
export type Finishes = {
  wall: { color: string; name: string; code?: string; sheen: Sheen; texture: WallTexture };
  /** A wall painted apart from the rest. */
  accents?: Array<{ wallId: string; color: string; name: string; code?: string }>;
  floor: { id: string; pattern: FloorPattern; angle: number };
  cabinets: { style: DoorStyle; color: string; name: string; island?: string; islandName?: string; uppers?: string; uppersName?: string };
  counter: { id: string; edge: "eased" | "bevel" | "ogee" | "bullnose" };
  backsplash: { id: string; height: "4in" | "18in" | "full" };
  hardware: { kind: "bar" | "knob" | "cup"; finish: "black" | "brass" | "nickel" | "chrome" };
  ceiling?: { color: string };
};

export type DesignSource = {
  kind: "pdf" | "image" | "drawn";
  fileName?: string;
  page?: number;
  /** As the plan states it: `1/4" = 1'-0"`. */
  scaleText?: string | null;
  /** How the scale was settled. */
  scaleBy?: "title" | "areas" | "calibrated" | "assumed";
  /** CAD layers were read (walls, doors, windows by layer name). */
  layers?: boolean;
};

export type DesignDoc = {
  v: 1;
  title: string;
  walls: Wall[];
  openings: Opening[];
  labels: RoomLabel[];
  marks: PlanMark[];
  /** The room being designed (a label id). */
  focus?: string | null;
  source?: DesignSource;
  /** What is placed in the rooms (milestone 3). */
  items?: DesignItem[];
  /** Each room's finishes, by its label id (milestone 3). */
  finishes?: Record<string, Finishes>;
  /** The estimate's choices (milestone 4): remodel or new, rough-in, permits, who supplies the appliances, the job. */
  estimate?: { scope: "remodel" | "new"; roughIn: boolean; permits: boolean; appliances: "owner" | "allowance"; address?: string; title?: string };
};

export const DEFAULT_CEILING = 96;
export const DEFAULT_INTERIOR = 4.5;
export const DEFAULT_EXTERIOR = 6.5;
export const DOOR_HEIGHT = 80;
export const WINDOW_HEIGHT = 48;
export const WINDOW_SILL = 36;

export const emptyDesign = (title = "New design"): DesignDoc => ({ v: 1, title, walls: [], openings: [], labels: [], marks: [] });

let seq = 0;
/** A short id, unique within a design. */
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Feet and inches as a builder writes them: 12'-6". */
export function ftIn(inches: number): string {
  const neg = inches < 0;
  let t = Math.round(Math.abs(inches) * 2) / 2;
  const ft = Math.floor(t / 12);
  t -= ft * 12;
  const inch = Number.isInteger(t) ? String(t) : `${Math.floor(t)}½`;
  return `${neg ? "−" : ""}${ft}'-${inch}"`;
}

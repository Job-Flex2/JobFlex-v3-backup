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

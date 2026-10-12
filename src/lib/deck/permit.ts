// THE PERMIT SET'S DRAWINGS, AS DATA (2026-10-10) — pure, no React.
//
// Owner: "a professional construction plan for the decks that can be
// submitted for the permits, with the sizes and everything and the names of
// the materials — a construction drawing, two or three pages depending on
// the deck: the roof separately, the floor separately, per code, and if
// possible lateral."
//
// The building office wants the same things every time: a framing plan for
// each level of structure, an elevation, a section through the deck that
// shows the ledger, the joist, the beam, the post and the footing against
// the grade and the frost line, the details that fasten it together, the
// schedules with the table each number came from, and the material list.
// Everything here is read off the engine's own structure (lib/deck): the
// section is the real joist depth, the real beam, the real footing depth.
// The sheet (components/v3/deck-permit) only draws what comes back, so the
// QA script can prove a drawing without a browser.
//
// Drawings are lists of primitives in INCHES. The section and the details
// use an upright frame — X across, Z up from the grade — and the renderer
// flips Z. A `dim` is a dimension string with ticks and its label.

import { ftIn, LEDGER_FASTENER_LABEL, RULE } from "./codeTables";
import { RULE_RAFTER } from "./roofTables";
import type { DeckDesign } from "./design";
import type { DeckFrame, Post } from "./frame";
import type { DeckStructure } from "./structure";
import type { DeckPackage } from "./pricing";
import { BOM_STEP_LABEL, type BomStep } from "./takeoff";

export type DrawClass = "ink" | "wood" | "concrete" | "steel" | "hatch" | "dash" | "thin" | "dim" | "grade" | "glass";

export type DrawItem =
  | { t: "rect"; x: number; z: number; w: number; h: number; cls: DrawClass }
  | { t: "line"; x1: number; z1: number; x2: number; z2: number; cls: DrawClass }
  | { t: "poly"; pts: number[]; cls: DrawClass; closed?: boolean }
  | { t: "circle"; x: number; z: number; r: number; cls: DrawClass }
  | { t: "text"; x: number; z: number; s: string; size?: number; anchor?: "start" | "middle" | "end"; rot?: number; cls?: "note" | "label" | "dim" }
  | { t: "dim"; x1: number; z1: number; x2: number; z2: number; label: string; off?: number };

export interface Drawing {
  /** The drawing's extent in inches: left, bottom, width, height (Z up). */
  box: { x: number; z: number; w: number; h: number };
  items: DrawItem[];
}

export interface DetailDrawing {
  title: string;
  drawing: Drawing;
  /** The notes a reviewer reads with it, each with the rule it rests on. */
  notes: string[];
}

export type PermitPageKind = "floor" | "roof" | "elevation" | "section" | "details" | "schedules" | "materials" | "notes";

export interface PermitPage {
  no: string;
  name: string;
  kind: PermitPageKind;
}

const POST_W: Record<string, number> = { "4x4": 3.5, "4x6": 3.5, "6x6": 5.5, "8x8": 7.5 };
const JOIST_DEPTH: Record<string, number> = { "2x6": 5.5, "2x8": 7.25, "2x10": 9.25, "2x12": 11.25 };
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The sheets a structure needs, in order: a plan for each level of structure, the elevation, the section, the details, the schedules, the notes. */
export function permitPages(s: DeckStructure): PermitPage[] {
  const pages: PermitPage[] = [];
  let a = 0;
  const A = (name: string, kind: PermitPageKind) => pages.push({ no: `A${++a}`, name, kind });
  if (s.frame) A("Floor framing plan", "floor");
  if (s.roof) A(s.roof.kind === "pergola" ? "Pergola framing plan" : "Roof framing plan", "roof");
  A("Front elevation", "elevation");
  if (s.frame) A("Section through the deck", "section");
  A("Details and lateral connections", "details");
  pages.push({ no: "S1", name: "Schedules", kind: "schedules" });
  pages.push({ no: "S2", name: "Materials", kind: "materials" });
  pages.push({ no: "S3", name: "Notes and code checks", kind: "notes" });
  return pages;
}

/** The post the section cuts through: the first beam's first post (the deck's front line), else the first post. */
export function sectionPost(frame: DeckFrame): Post | null {
  const front = frame.beams.find((b) => b.role === "front") ?? frame.beams[0];
  return (front && frame.posts.find((p) => p.beamId === front.id)) ?? frame.posts[0] ?? null;
}

/**
 * The section through the deck, looking along the house: the house wall and
 * the ledger at the left, one joist from the ledger to the rim, the decking
 * on it, every beam cut across, the post and its footing against the grade
 * and the frost line, the guard at the front, the stairs down when there
 * are any — with the dimensions a plan checker reads first.
 */
export function sectionDrawing(s: DeckStructure): Drawing | null {
  const f = s.frame;
  if (!f) return null;
  const d = f.design;
  const items: DrawItem[] = [];
  const D = Math.max(...f.zones.map((z) => z.zone.y1));
  const joistDepth = JOIST_DEPTH[f.joistSize] ?? 7.25;
  const attached = d.placement === "attached" && f.ledgers.length > 0;
  const post = sectionPost(f);
  const frost = d.frostIn;
  const deepest = Math.max(frost, ...f.posts.map((p) => p.footing.depthIn), 12);
  const rails = s.rails;
  const guardTop = rails.on ? f.surfaceIn + rails.heightIn : f.surfaceIn;
  const top = Math.max(guardTop, f.surfaceIn) + 30;
  const left = attached ? -14 : -6;
  const right = D + 52;
  const dimX = left - 5;
  const boxL = dimX - 9;

  // The grade, the frost line, the house.
  items.push({ t: "line", x1: left, z1: 0, x2: right, z2: 0, cls: "grade" });
  items.push({ t: "text", x: right - 2, z: -3.5, s: "grade", anchor: "end", cls: "label" });
  items.push({ t: "line", x1: left, z1: -frost, x2: right, z2: -frost, cls: "dash" });
  items.push({ t: "text", x: right - 2, z: -frost - 3.5, s: `frost line ${frost} in.`, anchor: "end", cls: "label" });
  if (attached) {
    items.push({ t: "rect", x: -12, z: -6, w: 12, h: top + 6, cls: "hatch" });
    items.push({ t: "text", x: -6, z: top - 10, s: "HOUSE", anchor: "middle", rot: -90, cls: "label" });
    // The ledger on the house, flashed; the joist hangs on it.
    items.push({ t: "rect", x: 0, z: f.joistBottomIn, w: 1.5, h: joistDepth, cls: "wood" });
    items.push({ t: "line", x1: -1, z1: f.joistTopIn + 2.5, x2: 2.5, z2: f.joistTopIn + 2.5, cls: "steel" });
    items.push({ t: "line", x1: 2.5, z1: f.joistTopIn + 2.5, x2: 2.5, z2: f.joistTopIn, cls: "steel" });
    items.push({ t: "text", x: 4, z: f.joistTopIn + 3.6, s: "flashing", cls: "note" });
    const run = f.ledgers[0];
    items.push({ t: "text", x: 2.5, z: f.joistBottomIn - 4, s: `${f.joistSize} ledger · ${LEDGER_FASTENER_LABEL[d.ledger.fastener]}, 2 rows @ ${run.spacingIn} in.`, cls: "note" });
  }
  // The joist, the rim, the decking.
  items.push({ t: "rect", x: attached ? 1.5 : 0, z: f.joistBottomIn, w: D - (attached ? 1.5 : 0), h: joistDepth, cls: "wood" });
  items.push({ t: "rect", x: D, z: f.joistBottomIn, w: 1.5, h: joistDepth, cls: "wood" });
  items.push({ t: "rect", x: 0, z: f.joistTopIn, w: D + 1.5, h: f.surfaceIn - f.joistTopIn, cls: "wood" });
  items.push({ t: "text", x: D / 2, z: f.surfaceIn + 9, s: `${f.decking.label} decking on ${f.joistSize} joists @ ${f.spacingIn} in. o.c.`, anchor: "middle", cls: "note" });
  // The beams, cut across.
  for (const b of f.beams) {
    const depth = b.spec.depthIn;
    const thick = b.spec.thickIn;
    const z = b.style === "flush" ? f.joistBottomIn : f.joistBottomIn - depth;
    items.push({ t: "rect", x: b.y - thick / 2, z, w: thick, h: depth, cls: "wood" });
    items.push({ t: "text", x: b.y + thick / 2 + 1.5, z: z + depth / 2 - 1.5, s: `${b.spec.size} beam${b.style === "flush" ? ", flush" : ""}`, cls: "note" });
  }
  // The post and its footing.
  if (post) {
    const w = POST_W[post.size] ?? 5.5;
    const beam = f.beams.find((b) => b.id === post.beamId) ?? f.beams[0];
    const postTop = beam ? (beam.style === "flush" ? f.joistBottomIn : f.joistBottomIn - beam.spec.depthIn) : f.joistBottomIn;
    const ft = post.footing;
    items.push({ t: "rect", x: post.y - w / 2, z: ft.topIn, w, h: Math.max(1, postTop - ft.topIn), cls: "wood" });
    items.push({ t: "text", x: post.y + w / 2 + 1.5, z: ft.topIn + (postTop - ft.topIn) / 2, s: `${post.size} post on a post base`, cls: "note" });
    if (ft.type === "poured") {
      items.push({ t: "rect", x: post.y - ft.pierIn / 2, z: -ft.depthIn + ft.padThickIn, w: ft.pierIn, h: ft.depthIn - ft.padThickIn + ft.topIn, cls: "concrete" });
      items.push({ t: "rect", x: post.y - ft.padIn / 2, z: -ft.depthIn, w: ft.padIn, h: ft.padThickIn, cls: "concrete" });
      items.push({ t: "text", x: post.y + ft.padIn / 2 + 1.5, z: -ft.depthIn + 1, s: `${ft.padIn}×${ft.padThickIn} in. pad, ${ft.pierIn} in. pier`, cls: "note" });
      items.push({ t: "dim", x1: post.y - ft.padIn / 2 - 6, z1: 0, x2: post.y - ft.padIn / 2 - 6, z2: -ft.depthIn, label: `${ft.depthIn} in. below grade` });
    } else {
      items.push({ t: "rect", x: post.y - ft.padIn / 2, z: ft.topIn - ft.padThickIn, w: ft.padIn, h: ft.padThickIn, cls: "concrete" });
      items.push({ t: "text", x: post.y + ft.padIn / 2 + 1.5, z: ft.topIn - ft.padThickIn + 1, s: `${ft.padIn} in. precast pier block on compacted gravel`, cls: "note" });
    }
  }
  // The guard at the front edge.
  if (rails.on) {
    items.push({ t: "rect", x: D - 2, z: f.joistBottomIn, w: 3.5, h: guardTop - f.joistBottomIn, cls: "wood" });
    items.push({ t: "rect", x: D - 4, z: guardTop - 1.5, w: 7.5, h: 1.5, cls: "wood" });
    items.push({ t: "dim", x1: D + 12, z1: f.surfaceIn, x2: D + 12, z2: guardTop, label: `${rails.heightIn} in. guard` });
  }
  // The stairs down the front, if any.
  const stair = s.stairs.find((st) => st.design.side === "front" && st.kind === "flight");
  if (stair && stair.risers > 0) {
    const riser = f.surfaceIn / stair.risers;
    const tread = stair.runIn;
    const pts: number[] = [D + 1.5, f.surfaceIn];
    for (let i = 0; i < stair.risers; i++) {
      const x = D + 1.5 + i * tread;
      const zTop = f.surfaceIn - i * riser;
      pts.push(x, zTop - riser, x + tread, zTop - riser);
    }
    items.push({ t: "poly", pts, cls: "ink" });
    items.push({ t: "text", x: D + 4, z: f.surfaceIn / 2, s: `${stair.risers} risers @ ${r1(riser)} in. · ${stair.stringers.count} 2x12 stringers`, cls: "note" });
  }
  // The dimensions a checker reads first.
  items.push({ t: "dim", x1: dimX, z1: 0, x2: dimX, z2: f.surfaceIn, label: `${ftIn(f.surfaceIn)} deck height` });
  if (f.beams[0]) items.push({ t: "dim", x1: 0, z1: f.joistBottomIn - (f.beams[0].style === "flush" ? 0 : f.beams[0].spec.depthIn) - 8, x2: f.beams[0].y, z2: f.joistBottomIn - (f.beams[0].style === "flush" ? 0 : f.beams[0].spec.depthIn) - 8, label: `${ftIn(f.beams[0].y)} joist span` });
  items.push({ t: "dim", x1: 0, z1: top - 6, x2: D, z2: top - 6, label: `${ftIn(D)} deep` });

  const stairRight = stair && stair.risers > 0 ? D + 1.5 + stair.risers * (stair.runIn) + 6 : 0;
  return { box: { x: boxL, z: -deepest - 10, w: Math.max(right, stairRight) - boxL + 4, h: top + deepest + 14 }, items };
}

/** The details a reviewer expects fastened the way the tables say — drawn from this deck's own numbers. */
export function detailDrawings(s: DeckStructure): DetailDrawing[] {
  const out: DetailDrawing[] = [];
  const f = s.frame;
  const d: DeckDesign = s.design;
  if (f) {
    const joistDepth = JOIST_DEPTH[f.joistSize] ?? 7.25;
    if (d.placement === "attached" && f.ledgers[0]) {
      const run = f.ledgers[0];
      const items: DrawItem[] = [];
      // The house rim, the sheathing, the ledger, two rows of fasteners staggered, the flashing, the hanger.
      items.push({ t: "rect", x: -10, z: -4, w: 10, h: joistDepth + 12, cls: "hatch" });
      items.push({ t: "text", x: -5, z: joistDepth + 10.5, s: "house rim", anchor: "middle", cls: "label" });
      items.push({ t: "rect", x: 0, z: 0, w: 1.5, h: joistDepth, cls: "wood" });
      items.push({ t: "rect", x: 1.5, z: 0, w: 14, h: joistDepth, cls: "wood" });
      items.push({ t: "text", x: 8.5, z: joistDepth / 2 - 1, s: `${f.joistSize} joist`, anchor: "middle", cls: "note" });
      items.push({ t: "rect", x: 1.5, z: 0, w: 1.75, h: joistDepth * 0.8, cls: "steel" });
      items.push({ t: "text", x: 3.8, z: -3.5, s: "joist hanger", cls: "note" });
      for (let i = 0; i < 3; i++) {
        items.push({ t: "circle", x: -2, z: joistDepth * 0.72 - (i % 2) * joistDepth * 0.44, r: 0.7, cls: "steel" });
      }
      items.push({ t: "line", x1: -1.5, z1: joistDepth + 2, x2: 2.5, z2: joistDepth + 2, cls: "steel" });
      items.push({ t: "line", x1: 2.5, z1: joistDepth + 2, x2: 2.5, z2: joistDepth, cls: "steel" });
      items.push({ t: "text", x: 3.5, z: joistDepth + 6.5, s: "metal flashing over the ledger,", cls: "note" });
      items.push({ t: "text", x: 3.5, z: joistDepth + 3.2, s: "under the siding", cls: "note" });
      items.push({ t: "dim", x1: -7, z1: 0, x2: -7, z2: joistDepth, label: `${f.joistSize} ledger` });
      out.push({
        title: "Ledger attachment",
        drawing: { box: { x: -14, z: -8, w: 62, h: joistDepth + 24 }, items },
        notes: [
          `${LEDGER_FASTENER_LABEL[d.ledger.fastener]} in two staggered rows, ${run.spacingIn} in. on centre — ${run.fasteners} on this ledger (${run.rule}).`,
          `${d.ledger.lateral === "four" ? "Four 750-lb" : "Two 1,500-lb"} lateral load connectors tie the deck's joists to the house framing. ${RULE.lateral}.`,
          `The ledger is flashed; no ledger on a cantilevered floor, brick veneer or a hollow wall. ${RULE.ledgerWall}.`,
        ],
      });
    }
    const post = sectionPost(f);
    if (post) {
      const beam = f.beams.find((b) => b.id === post.beamId) ?? f.beams[0];
      const w = POST_W[post.size] ?? 5.5;
      const ft = post.footing;
      const items: DrawItem[] = [];
      const beamDepth = beam?.spec.depthIn ?? 9.25;
      const beamThick = beam?.spec.thickIn ?? 3;
      const postH = 30;
      items.push({ t: "line", x1: -16, z1: 0, x2: 50, z2: 0, cls: "grade" });
      items.push({ t: "rect", x: -w / 2, z: ft.topIn, w, h: postH, cls: "wood" });
      items.push({ t: "rect", x: -w / 2 - 1.5, z: ft.topIn + postH, w: w + 3, h: 1, cls: "steel" });
      items.push({ t: "rect", x: -beamThick / 2, z: ft.topIn + postH + 1, w: beamThick, h: beamDepth, cls: "wood" });
      items.push({ t: "text", x: beamThick / 2 + 2, z: ft.topIn + postH + beamDepth / 2, s: `${beam?.spec.size ?? "beam"} in a post cap`, cls: "note" });
      items.push({ t: "rect", x: -w / 2 - 1, z: ft.topIn, w: w + 2, h: 1.5, cls: "steel" });
      items.push({ t: "text", x: w / 2 + 2, z: ft.topIn + 1, s: "post base, 1 in. up", cls: "note" });
      if (ft.type === "poured") {
        items.push({ t: "rect", x: -ft.pierIn / 2, z: -ft.depthIn + ft.padThickIn, w: ft.pierIn, h: ft.depthIn - ft.padThickIn + ft.topIn, cls: "concrete" });
        items.push({ t: "rect", x: -ft.padIn / 2, z: -ft.depthIn, w: ft.padIn, h: ft.padThickIn, cls: "concrete" });
        items.push({ t: "dim", x1: -ft.padIn / 2 - 5, z1: 0, x2: -ft.padIn / 2 - 5, z2: -ft.depthIn, label: `${ft.depthIn} in.` });
        items.push({ t: "dim", x1: -ft.padIn / 2, z1: -ft.depthIn - 5, x2: ft.padIn / 2, z2: -ft.depthIn - 5, label: `${ft.padIn} in. pad` });
      } else {
        items.push({ t: "rect", x: -ft.padIn / 2, z: ft.topIn - ft.padThickIn, w: ft.padIn, h: ft.padThickIn, cls: "concrete" });
        items.push({ t: "text", x: ft.padIn / 2 + 2, z: ft.topIn - ft.padThickIn + 1, s: `${ft.padIn} in. pier block`, cls: "note" });
      }
      items.push({ t: "line", x1: -16, z1: -d.frostIn, x2: 50, z2: -d.frostIn, cls: "dash" });
      items.push({ t: "text", x: 49, z: -d.frostIn + 1.5, s: `frost ${d.frostIn} in.`, anchor: "end", cls: "label" });
      out.push({
        title: "Post, beam and footing",
        drawing: { box: { x: -22, z: -Math.max(ft.depthIn, d.frostIn) - 12, w: 74, h: Math.max(ft.depthIn, d.frostIn) + postH + beamDepth + 20 }, items },
        notes: [
          `${post.size} posts in metal post bases and caps; the tallest post ${ftIn(Math.max(...f.posts.map((p) => p.heightIn)))}. ${RULE.post}.`,
          ft.type === "poured" ? `Footings ${ft.padIn} in. square (or round) and ${ft.padThickIn} in. thick on undisturbed soil, ${ft.depthIn} in. below grade — below the ${d.frostIn} in. frost line. ${RULE.footing}; ${RULE.frost}.` : `Precast pier blocks on compacted gravel; ${RULE.pierBlock}.`,
          `Soil taken at ${d.soilPsf.toLocaleString("en-US")} psf; each post carries at most ${Math.round(Math.max(...f.posts.map((p) => p.tributarySqFt)))} sq ft of deck.`,
        ],
      });
    }
    if (s.rails.on) {
      const items: DrawItem[] = [];
      const H = s.rails.heightIn;
      items.push({ t: "rect", x: 0, z: 0, w: 14, h: joistDepth, cls: "wood" });
      items.push({ t: "text", x: -1.5, z: joistDepth / 2 - 1, s: "rim joist", anchor: "end", cls: "note" });
      items.push({ t: "rect", x: 0, z: joistDepth, w: 14, h: 1, cls: "wood" });
      items.push({ t: "rect", x: 14, z: -2, w: 3.5, h: joistDepth + 2 + 1 + H, cls: "wood" });
      items.push({ t: "rect", x: 12, z: joistDepth + 1 + H - 1.5, w: 7.5, h: 1.5, cls: "wood" });
      items.push({ t: "circle", x: 15.75, z: joistDepth * 0.7, r: 0.7, cls: "steel" });
      items.push({ t: "circle", x: 15.75, z: joistDepth * 0.25, r: 0.7, cls: "steel" });
      items.push({ t: "rect", x: 10, z: 0, w: 1.5, h: joistDepth, cls: "wood" });
      items.push({ t: "text", x: 9, z: -3.5, s: "blocking", anchor: "end", cls: "note" });
      items.push({ t: "dim", x1: 24, z1: joistDepth + 1, x2: 24, z2: joistDepth + 1 + H, label: `${H} in. guard` });
      out.push({
        title: "Guard post",
        drawing: { box: { x: -20, z: -8, w: 52, h: joistDepth + H + 16 }, items },
        notes: [
          `Guard ${H} in. high, posts through-bolted to the rim with two ½-in. bolts and blocked, pickets with no 4-in. opening. ${RULE.guard}.`,
          s.rails.system === "wood" ? `Wood 4x4 posts ${d.rail.postSpacingFt} ft on centre.` : `${s.rails.label} system installed to its listing; posts ${d.rail.postSpacingFt} ft on centre.`,
        ],
      });
    }
    if (d.placement !== "attached") {
      const items: DrawItem[] = [];
      items.push({ t: "rect", x: 0, z: 0, w: 5.5, h: 40, cls: "wood" });
      items.push({ t: "rect", x: -14, z: 40, w: 36, h: 9.25, cls: "wood" });
      items.push({ t: "poly", pts: [5.5, 16, 29.5, 40, 27.5, 41.5, 4, 18], cls: "wood", closed: true });
      items.push({ t: "text", x: 20, z: 24, s: "2x4 knee brace, 45°, ½-in. lag each end", cls: "note" });
      items.push({ t: "text", x: 2.75, z: 20, s: "post", anchor: "middle", rot: -90, cls: "label" });
      items.push({ t: "text", x: 4, z: 44, s: "beam", anchor: "middle", cls: "label" });
      out.push({
        title: "Lateral bracing, free-standing",
        drawing: { box: { x: -18, z: -6, w: 56, h: 60 }, items },
        notes: [`A deck that stands free braces itself: knee braces at the end posts of every beam, both ways, where the posts are over 2 ft. ${RULE.bracing}; ${RULE.selfSupporting}.`],
      });
    }
  }
  const roof = s.roof;
  if (roof && roof.kind !== "pergola") {
    const items: DrawItem[] = [];
    const H = roof.headers[0];
    const hd = H?.spec.depthIn ?? 9.25;
    const slope = roof.slope;
    items.push({ t: "rect", x: 0, z: 0, w: 5.5, h: 36, cls: "wood" });
    items.push({ t: "rect", x: -1, z: 36, w: 7.5, h: 1, cls: "steel" });
    items.push({ t: "rect", x: -12, z: 37, w: 30, h: hd, cls: "wood" });
    items.push({ t: "text", x: 3, z: 37 + hd / 2 - 1, s: `${H?.spec.size ?? "header"} header in a post cap`, anchor: "middle", cls: "note" });
    const rz = 37 + hd;
    items.push({ t: "poly", pts: [-16, rz - 16 * slope + 0.5, 24, rz + 24 * slope + 0.5, 24, rz + 24 * slope + 0.5 + 7.25, -16, rz - 16 * slope + 0.5 + 7.25], cls: "wood", closed: true });
    const hiTop = rz + 24 * slope + 0.5 + 7.25;
    items.push({ t: "text", x: -20, z: hiTop + 8, s: roof.trusses ? `truss @ 24 in. o.c., ${roof.trusses.chord} chords` : `${roof.rafters.size} rafter @ ${roof.rafters.spacingIn} in. o.c.`, cls: "note" });
    items.push({ t: "text", x: -20, z: hiTop + 4, s: roof.trusses ? "bears on the header, a hurricane tie each end" : "seat cut on the header, a hurricane tie", cls: "note" });
    items.push({ t: "text", x: 2.75, z: 18, s: `${roof.roof.post} post`, anchor: "middle", rot: -90, cls: "label" });
    out.push({
      title: roof.trusses ? "Truss to header to post" : "Rafter to header to post",
      drawing: { box: { x: -22, z: -6, w: 56, h: hiTop + 18 }, items },
      notes: [
        roof.trusses
          ? `${roof.trusses.count} manufactured trusses @ 24 in. o.c. span ${ftIn(roof.trusses.spanIn)} bearing to bearing at ${roof.roof.pitch}:12, designed and stamped by the truss maker for ${roof.roofLoad} psf ${roof.roofLoad === 20 ? "roof live load" : "ground snow"} and ${roof.deadPsf} psf dead; the truss design drawings are submitted with the permit. IRC R802.10.1; permanent bracing per those drawings and BCSI-B3, IRC R802.10.3.`
          : `${roof.rafters.size} rafters @ ${roof.rafters.spacingIn} in. o.c. span ${ftIn(roof.rafters.spanIn)} (the table allows ${ftIn(roof.rafters.maxSpanIn)}) at ${roof.roof.pitch}:12. ${RULE_RAFTER[roof.roofLoad]}.`,
        `Each ${roof.trusses ? "truss bears on the header with a hurricane tie at each end" : "rafter seat-cut over the header with a hurricane tie"}; headers ${[...new Set(roof.headers.filter((h) => !h.cross).map((h) => h.spec.size))].join(" / ")} in post caps. ${RULE.beam}.`,
        // 2026-10-12: the cross beams under the ridge and the ring's straps.
        ...(roof.crossBeams ? [`${roof.crossBeams === 1 ? "A cross beam" : `${roof.crossBeams} cross beams`} (${[...new Set(roof.headers.filter((h) => h.cross).map((h) => h.spec.size))].join(" / ")}) hung on the headers in beam hangers over a post at each end, each carrying a king post under the ridge beam.`] : []),
        ...(roof.ringTensionLb > 0 ? [`A tension strap across every header joint, rated for at least ${roof.ringTensionLb.toLocaleString("en-US")} lb: the hips push the corners out.`] : []),
        roof.attach === "wall" ? `Roof ledger on the house with structural screws, flashed. ${RULE.ledgerBoard}.` : `Free-standing: knee braces at the posts hold the roof square. ${RULE.bracing}.`,
      ],
    });
  }
  return out;
}

export interface MaterialGroup {
  step: BomStep;
  label: string;
  lines: Array<{ label: string; qty: number; unit: string; note: string | null; byClient: boolean }>;
}

/** The material list by step, as the yard counts it. */
export function materialSchedule(pkg: DeckPackage): MaterialGroup[] {
  const groups = new Map<BomStep, MaterialGroup>();
  for (const l of pkg.bom) {
    const g = groups.get(l.step) ?? { step: l.step, label: BOM_STEP_LABEL[l.step] ?? l.step, lines: [] };
    g.lines.push({ label: l.label, qty: l.qty, unit: l.unit, note: l.note ?? null, byClient: !!l.byClient });
    groups.set(l.step, g);
  }
  return [...groups.values()];
}

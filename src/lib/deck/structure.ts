// THE WHOLE STRUCTURE, ASSEMBLED (Deck Studio M3, 2026-10-10) — pure.
//
// One design → everything that stands on the site, built in the order the
// parts depend on one another:
//   1. the roof (its posts need footings in the deck),
//   2. the main deck's frame over the real ground (the site's slope lengthens
//      the downhill posts), with the roof's posts through it,
//   3. the lower level in front, a deck of its own a step down,
//   4. the stairs — from either level, onto the ground, a pad or the lower
//      deck,
//   5. the rails along every open edge that is left.
// pricing.ts prices it, takeoff.ts counts it, checks.ts reads it, scene.ts
// draws it. Nothing here is stored: a design builds the same structure every
// time.

import { buildDeckFrame, type BuildOptions, type DeckFrame, PIER_BLOCK } from "./frame";
import { buildRoofFrame, roofPostsForDeck, type RoofFrame } from "./roof";
import { deckSurface, type DeckSurface } from "./surface";
import { buildStair, type StairBuild, type StairLevel } from "./stairs";
import { buildRails, type RailBuild, type RailLevel } from "./rails";
import { buildElectrical, type ElectricalBuild } from "./electrical";
import { framingSpecies } from "./catalog";
import { groundAt as slopeGroundAt, slopeGradePct } from "./site";
import { frontEdgeAt, hasDeck, hasLowerLevel, hasRoof, normalizeDeckDesign, shapeOutline, shapeZones, type DeckDesign, type DeckEdge } from "./design";
import { RISER_MAX_IN } from "./codeTables";

/** The lower level: its own frame and boards, placed in front of the main deck. */
export interface LowerBuild {
  design: DeckDesign;
  frame: DeckFrame;
  surface: DeckSurface;
  /** Where its (0, 0) sits in the main deck's coordinates, inches. */
  offsetXIn: number;
  offsetYIn: number;
  /** The step down from the main deck, inches. */
  dropIn: number;
}

export interface DeckStructure {
  design: DeckDesign;
  frame: DeckFrame | null;
  surface: DeckSurface | null;
  roof: RoofFrame | null;
  lower: LowerBuild | null;
  stairs: StairBuild[];
  rails: RailBuild;
  electrical: ElectricalBuild;
  /** The ground under any point of the plan, inches against the house line's ground. */
  groundAt: (x: number, y: number) => number;
  gradePct: number;
  /** Between the levels: a plain step the lower deck itself makes, or a stair that is wanted. */
  stepDown: { lengthIn: number; dropIn: number; stairWanted: boolean } | null;
}

export type StructureOptions = BuildOptions;

/** Which straight edge of the frame an outline segment lies on, if any. */
function edgeFor(edges: readonly DeckEdge[], A: { x: number; y: number }, B: { x: number; y: number }): DeckEdge | null {
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  for (const e of edges) {
    const horizontal = Math.abs(e.y0 - e.y1) < 0.01;
    if (horizontal && Math.abs(my - e.y0) < 0.6 && mx >= Math.min(e.x0, e.x1) - 0.6 && mx <= Math.max(e.x0, e.x1) + 0.6 && Math.abs(A.y - B.y) < 0.6) return e;
    if (!horizontal && Math.abs(mx - e.x0) < 0.6 && my >= Math.min(e.y0, e.y1) - 0.6 && my <= Math.max(e.y0, e.y1) + 0.6 && Math.abs(A.x - B.x) < 0.6) return e;
  }
  return null;
}

/** A rail's view of a level: its outline's sides with the house's (and the step's) marked. */
function railLevelOf(id: "upper" | "lower", frame: DeckFrame, offsetX: number, offsetY: number, groundAt: (x: number, y: number) => number, stepDown: RailLevel["stepDown"], backIsStep: boolean): RailLevel {
  const ring = shapeOutline(frame.design.shape).map((p) => ({ x: p.x + offsetX, y: p.y + offsetY }));
  const edges = frame.edges.map((e) => ({ ...e, x0: e.x0 + offsetX, x1: e.x1 + offsetX, y0: e.y0 + offsetY, y1: e.y1 + offsetY }));
  const sides: RailLevel["sides"] = [];
  for (let i = 0; i < ring.length; i++) {
    const A = ring[i];
    const B = ring[(i + 1) % ring.length];
    if (Math.hypot(B.x - A.x, B.y - A.y) < 0.5) continue;
    const e = edgeFor(edges, A, B);
    const onBack = Math.abs(A.y - offsetY) < 0.5 && Math.abs(B.y - offsetY) < 0.5;
    const side: RailLevel["sides"][number]["side"] = e ? e.side : onBack ? "back" : "front";
    const house = e ? e.house : onBack && backIsStep;
    sides.push({ x0: A.x, y0: A.y, x1: B.x, y1: B.y, house: house || (onBack && backIsStep), side });
  }
  const W = Math.max(...ring.map((p) => p.x));
  const D = Math.max(...ring.map((p) => p.y));
  const lowestGroundIn = Math.min(groundAt(offsetX, D), groundAt(W, D), groundAt((offsetX + W) / 2, D), groundAt(offsetX, offsetY), groundAt(W, offsetY));
  return { id, surfaceIn: frame.surfaceIn, joistBottomIn: frame.joistBottomIn, sides, lowestGroundIn, stepDown };
}

/** The design, built. Never throws: what cannot be done is flagged on the parts. */
export function buildStructure(raw: DeckDesign, opts: StructureOptions = {}): DeckStructure {
  const design = normalizeDeckDesign(raw);
  const species = framingSpecies(design.framing.species);
  const withDeck = hasDeck(design);
  const zones = shapeZones(design.shape);
  const W = Math.max(...zones.map((z) => z.x1));
  const D = Math.max(...zones.map((z) => z.y1));
  // The ground: the site's fall across the main deck's rectangle, read anywhere in the plan.
  const groundAt = (x: number, y: number) => slopeGroundAt(design.site.slope, x, y, W, D);
  const gradePct = slopeGradePct(design.site.slope, W, D);
  const footingTopIn = design.footing.type === "pier-block" ? PIER_BLOCK.topIn : design.footing.aboveGradeIn;

  const deckUnder = withDeck ? { zones, footingTopIn } : null;
  const roof = hasRoof(design) ? buildRoofFrame(design, species, species.group, deckUnder, { ...opts, groundAt }) : null;
  const frame = withDeck ? buildDeckFrame(design, { ...opts, groundAt, extraPosts: roof ? roofPostsForDeck(roof) : undefined }) : null;
  const surface = frame ? deckSurface(frame) : null;

  // The lower level: a detached deck of its own, a step down, touching the main deck's front.
  let lower: LowerBuild | null = null;
  if (frame && hasLowerLevel(design)) {
    const lw = Math.round(design.lower.widthFt * 12);
    const offsetXIn = design.lower.align === "left" ? 0 : design.lower.align === "right" ? W - lw : Math.round((W - lw) / 2);
    const offsetYIn = D;
    const lowerDesign = normalizeDeckDesign({
      ...design,
      shape: { kind: "rect", widthFt: design.lower.widthFt, depthFt: design.lower.depthFt },
      placement: "detached",
      heightIn: design.heightIn - design.lower.dropIn,
      structure: "deck",
      floor: "deck",
      lower: { ...design.lower, on: false },
      stairs: [],
      photo: null,
      // Its own beams are read from its own size; the posts and footings follow the main deck's choices.
      framing: { ...design.framing, joist: "auto", beam: "auto", beamStyle: "auto", overhangFt: "auto" },
    });
    const lowerFrame = buildDeckFrame(lowerDesign, { ...opts, groundAt: (x, y) => groundAt(x + offsetXIn, y + offsetYIn) });
    lower = { design: lowerDesign, frame: lowerFrame, surface: deckSurface(lowerFrame), offsetXIn, offsetYIn, dropIn: design.lower.dropIn };
  }

  // The stairs.
  const stairs: StairBuild[] = [];
  if (frame && surface) {
    const upper: StairLevel = { id: "upper", surfaceIn: frame.surfaceIn, joistBottomIn: frame.joistBottomIn, x0: 0, y0: 0, widthIn: W, depthIn: D, frontAt: (x) => frontEdgeAt(design.shape, x) };
    const lowerLevel: StairLevel | null = lower ? { id: "lower", surfaceIn: lower.frame.surfaceIn, joistBottomIn: lower.frame.joistBottomIn, x0: lower.offsetXIn, y0: lower.offsetYIn, widthIn: Math.round(design.lower.widthFt * 12), depthIn: Math.round(design.lower.depthFt * 12), frontAt: () => Math.round(design.lower.depthFt * 12) } : null;
    for (const st of design.stairs) {
      const level = st.level === "lower" && lowerLevel ? lowerLevel : upper;
      stairs.push(buildStair({ design, stair: st, level, lowerLevel: level.id === "upper" ? lowerLevel : null, product: frame.decking, rail: design.rail, groundAt, postSize: design.framing.post === "8x8" ? "6x6" : design.framing.post === "4x6" ? "4x4" : design.framing.post }));
    }
  }

  // The step between the levels.
  let stepDown: DeckStructure["stepDown"] = null;
  if (lower) {
    const lengthIn = Math.round(design.lower.widthFt * 12);
    const stairBetween = stairs.some((s) => s.level === "upper" && s.lands === "lower-deck");
    stepDown = { lengthIn, dropIn: lower.dropIn, stairWanted: lower.dropIn > RISER_MAX_IN && !stairBetween };
  }

  // The rails.
  const levels: RailLevel[] = [];
  if (frame) levels.push(railLevelOf("upper", frame, 0, 0, groundAt, lower ? { x0: lower.offsetXIn, x1: lower.offsetXIn + Math.round(design.lower.widthFt * 12), dropIn: lower.dropIn } : null, false));
  if (lower) levels.push(railLevelOf("lower", lower.frame, lower.offsetXIn, lower.offsetYIn, groundAt, null, true));
  const rails = buildRails({ design, rail: design.rail, levels, stairs });

  // The electrical: fixtures where the contractor put them or where they usually go, and the wiring to them.
  const ringW = roof && !frame ? roof.widthIn : W;
  const ringD = roof && !frame ? roof.depthIn : D;
  const electrical = buildElectrical({ design, frame, roof, stairs, rails, widthIn: ringW, depthIn: ringD, onHouse: frame ? design.placement !== "detached" : roof?.attach === "wall", floorIn: frame ? frame.surfaceIn : roof ? roof.floorIn : 0 });

  return { design, frame, surface, roof, lower, stairs, rails, electrical, groundAt, gradePct, stepDown };
}

/** The structure's deck levels, main first, each with where it sits. */
export function structureLevels(s: DeckStructure): Array<{ id: "upper" | "lower"; frame: DeckFrame; surface: DeckSurface; offsetXIn: number; offsetYIn: number }> {
  const out: Array<{ id: "upper" | "lower"; frame: DeckFrame; surface: DeckSurface; offsetXIn: number; offsetYIn: number }> = [];
  if (s.frame && s.surface) out.push({ id: "upper", frame: s.frame, surface: s.surface, offsetXIn: 0, offsetYIn: 0 });
  if (s.lower) out.push({ id: "lower", frame: s.lower.frame, surface: s.lower.surface, offsetXIn: s.lower.offsetXIn, offsetYIn: s.lower.offsetYIn });
  return out;
}

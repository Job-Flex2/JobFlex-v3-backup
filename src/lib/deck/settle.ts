// SETTLING A DESIGN AFTER A RESIZE (2026-10-10). Owner: "when I'm changing
// the sizes of the deck, make sure it reads the codes and rebuilds the
// material at the same time — if the deck gets bigger, the beams, the
// support, everything exchanges."
//
// A pick left on "auto" always re-runs the tables: a wider deck gets its
// joists, beams, posts and footings re-sized on the spot. A pick the
// contractor made by hand (2x6 joists, a 4x4 post) stays what it is — and
// after a resize can fail its table. The checks already say so and carry a
// one-tap fix (lib/deck/checks); settling applies those fixes itself, for
// the member-sizing checks only, so the deck on screen is never one the
// tables refuse. What was changed comes back as the fixes' own labels, for
// the studio to say.
import { applyDeckPatch, deckChecks, type DeckCheck, type DeckPatch } from "./checks";
import type { DeckDesign, RoofDesign } from "./design";
import { buildStructure } from "./structure";
import type { DeckPriceOptions } from "./pricing";

/** The failing checks a resize may settle on its own: member sizes and spans, never the footing type or the ledger's fasteners. */
export const AUTO_FIX = /^(joist-span|joist-spacing|beam-|post-height|post-area|header-|ridge|rafter|low-beam)/;

export interface Settled {
  design: DeckDesign;
  /** What was changed, in the checks' own words ("Use 2x10 joists"). Empty when the tables were already happy. */
  fixes: string[];
}

/** The design with every member-sizing fail fixed the way its check says, up to `rounds` passes (a fix can move a span). */
export function settleDesign(design: DeckDesign, opts: DeckPriceOptions = {}, rounds = 3): Settled {
  let d = design;
  const fixes: string[] = [];
  for (let i = 0; i < rounds; i++) {
    const checks = deckChecks(buildStructure(d, opts));
    const todo = checks.filter((c) => c.level === "fail" && c.fix && AUTO_FIX.test(c.id));
    if (!todo.length) break;
    for (const c of todo) {
      if (!c.fix) continue;
      d = applyDeckPatch(d, c.fix.patch);
      fixes.push(c.fix.label);
    }
  }
  return { design: d, fixes: [...new Set(fixes)] };
}

/** True for a patch that changes what the tables must carry. */
export function resizes(p: DeckPatch): boolean {
  return ["shape", "heightIn", "lower", "placement", "floor", "structure", "loadPsf", "site", "framing"].some((k) => k in p);
}

/** True for a roof patch that changes the roof's spans or loads. */
export function roofResizes(p: Partial<RoofDesign>): boolean {
  return ["plan", "eaveHeightIn", "pitch", "kind", "attach", "load", "overhangIn", "rafter", "header"].some((k) => k in p);
}

/* ------------------------------------------------------------------ */
/*  Auto-fix (2026-10-11, owner: "offer fixes or auto fix")             */
/* ------------------------------------------------------------------ */

/**
 * The warnings auto-fix answers along with the failures: a guard the code requires, pier blocks the code's wording does
 * not cover, the clearance a board's maker requires, a roof shape the studio could not build as picked. The other
 * warnings are choices (gutters, braces, a 4:12 pitch) and stay one tap each.
 */
export const AUTO_WARN = /^(guard|guard-posts|footing-blocks|footing-block-size|low-air|roof-kind|lumber-spf|lower-step)$/;

export interface AutoFixed {
  design: DeckDesign;
  /** What was done, in the checks' own words. */
  fixes: string[];
  /** What is left for a person: an engineer, the building office, or a choice the studio will not make alone. */
  left: DeckCheck[];
}

const weight = (checks: DeckCheck[]) => checks.reduce((n, c) => n + (c.level === "fail" ? 10 : c.level === "warn" && AUTO_WARN.test(c.id) ? 1 : 0), 0);

/**
 * Every failure's own fix and every answerable warning's, applied round by round (a fix can move a span); a round is
 * kept only when it leaves less to fix, and when the whole round does not, each fix is tried alone and kept if it helps.
 */
export function autoFixDesign(design: DeckDesign, opts: DeckPriceOptions = {}, rounds = 6): AutoFixed {
  let d = design;
  let checks = deckChecks(buildStructure(d, opts));
  const fixes: string[] = [];
  for (let i = 0; i < rounds; i++) {
    const todo = checks.filter((c) => c.fix && (c.level === "fail" || (c.level === "warn" && AUTO_WARN.test(c.id))));
    if (!todo.length) break;
    let next = d;
    for (const c of todo) next = applyDeckPatch(next, c.fix!.patch);
    const nextChecks = deckChecks(buildStructure(next, opts));
    if (weight(nextChecks) < weight(checks)) {
      d = next;
      checks = nextChecks;
      fixes.push(...todo.map((c) => c.fix!.label));
      continue;
    }
    let improved = false;
    for (const c of todo) {
      const t = applyDeckPatch(d, c.fix!.patch);
      const tc = deckChecks(buildStructure(t, opts));
      if (weight(tc) < weight(checks)) {
        d = t;
        checks = tc;
        fixes.push(c.fix!.label);
        improved = true;
      }
    }
    if (!improved) break;
  }
  return { design: d, fixes: [...new Set(fixes)], left: checks.filter((c) => c.level === "fail" || c.level === "warn") };
}

/** How many things auto-fix would take on right now (the button's count). */
export function autoFixable(checks: DeckCheck[]): number {
  return checks.filter((c) => c.fix && (c.level === "fail" || (c.level === "warn" && AUTO_WARN.test(c.id)))).length;
}

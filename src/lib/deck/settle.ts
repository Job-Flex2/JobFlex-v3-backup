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
import { applyDeckPatch, deckChecks, type DeckPatch } from "./checks";
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

// THE DEPTH MAP'S WORD ON THE WALL'S STEPS (2026-10-26). Pure, browser-safe. Owner: "see where the windows are, walls,
// dents, roof … changes in walls if a certain part comes out or goes deeper". The vision model is good at WHAT and
// WHERE in the picture and poor at how far (its depth error is half again a depth model's, OpenAI's own evaluations
// say); the eave-shadow pass (lib/deck/wallSteps) reads which way a part stands only when the shadow is plain. A depth
// map of the picture (lib/deck/houseDepth, a Depth Anything run on fal) says it directly: a part of the wall nearer the
// camera than the main wall's plane stands out, one farther stands back. What comes here is already that verdict per
// stretch of the wall; this applies it to the read's sections — the sign from the depth map, the size from what was
// already known (the model's section, the contractor's hand), else the usual 2 ft.

import { JOG_DEFAULT_FT } from "./photoFit";
import { mainSection, readSections, setSectionOut, type HouseRead } from "./houseRead";

/** One stretch of the wall by the depth map: out, back or level against the main wall's plane. `shift` is how far from
 *  that plane in the map's own units (nearer is positive), `sure` 0…1 how plainly — past twice the threshold is 1. */
export interface DepthVerdict {
  x0: number;
  x1: number;
  state: "out" | "back" | "level";
  shift: number;
  sure: number;
}

/** A raised or recessed part of a wall face the depth map found inside one section — a chimney, a bay, a recessed
 *  entry — as a box in the picture's fractions, which way it goes and how plainly (1 = at the threshold). */
export interface DepthRelief {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dir: "out" | "back";
  strength: number;
}

const overlap = (a: { x0: number; x1: number }, b: { x0: number; x1: number }) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));

/**
 * The read's sections set out or back as the depth map says. Each section (the main wall aside — it is the plane the
 * rest are measured from) takes the verdict covering most of it:
 *   · out or back where the read had it level: set that way, the depth the model gave that stretch when it agreed on
 *     the sign, else 2 ft (the review says it is a guess);
 *   · the other way round from the read: flipped — unless the photo's own eave shadows set it (`stepsFromPhoto`) and
 *     the depth map is not sure;
 *   · level where the read had a step: levelled, on the same terms.
 * Back come the read and how many sections changed, how many of those were flipped.
 */
export function applyDepthVerdicts(read: HouseRead, verdicts: DepthVerdict[], opts: { modelSections?: Array<{ x0: number; x1: number; outFt: number }>; stepsFromPhoto?: boolean } = {}): { read: HouseRead; changed: number; flipped: number } {
  const secs = readSections(read);
  if (secs.length < 2 || !verdicts.length) return { read, changed: 0, flipped: 0 };
  const main = mainSection(secs);
  const firm = opts.stepsFromPhoto ? 0.7 : 0.45;
  let out = read;
  let changed = 0;
  let flipped = 0;
  secs.forEach((sec, i) => {
    if (i === main) return;
    const width = sec.x1 - sec.x0;
    if (width <= 0) return;
    const v = verdicts.map((x) => ({ x, o: overlap(sec, x) })).sort((a, b) => b.o - a.o)[0];
    if (!v || v.o < width * 0.5) return;
    const cur = sec.outFt;
    if (v.x.state === "level") {
      if (cur !== 0 && v.x.sure >= firm) {
        out = setSectionOut(out, i, 0);
        changed++;
      }
      return;
    }
    const sign = v.x.state === "out" ? 1 : -1;
    if (cur === 0) {
      if (v.x.sure < 0.45) return;
      const model = (opts.modelSections ?? []).map((m) => ({ m, o: overlap(sec, m) })).sort((a, b) => b.o - a.o)[0];
      const size = model && model.o >= width * 0.5 && Math.sign(model.m.outFt) === sign ? Math.abs(model.m.outFt) : JOG_DEFAULT_FT;
      out = setSectionOut(out, i, sign * size);
      changed++;
    } else if (Math.sign(cur) !== sign && v.x.sure >= firm) {
      out = setSectionOut(out, i, -cur);
      changed++;
      flipped++;
    }
  });
  return { read: out, changed, flipped };
}

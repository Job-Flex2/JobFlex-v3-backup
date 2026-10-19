// The fence down a slope (2026-10-18 — owner: "fence the slope down without [the panels] falling like this; small
// steps or an angle — make it smart"). A stepped run is a level panel per bay on the high ground under it, posts where
// the ground spends a step: no panel hangs more than one code step over the ground, none buries, the 3D draws what the
// ticket charges, and rolling ground (a small net rise, a big up-and-down) gets the steps it really needs.
//   npx tsx qa/tests/logic/fence-slope-steps.check.ts
import { computeFenceLayout } from "../../../src/components/estimator/fence/fenceGeometry";
import { terrainFromProfile } from "../../../src/components/estimator/fence/fenceTerrain";
import { MAX_STEP_DROP_FT, MIN_STEP_BAY_FT, segmentSteps, stepStations, summarizeSlope } from "../../../src/lib/fence/slope";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const SPACING = 8;

/** A run of `len` ft along x over ground z(x): the profile every `ds`, the terrain report, the priced steps, the 3D. */
function run(len: number, z: (x: number) => number, ds = 10) {
  const n = Math.max(2, Math.round(len / ds) + 1);
  const elev = Array.from({ length: n }, (_, k) => z((len * k) / (n - 1)));
  const report = terrainFromProfile([{ seg: 0, start: 0, count: n, planFt: len }], elev, { sectionFt: SPACING, rackMaxDeg: 4 });
  const seg = report.segs[0];
  const priced = segmentSteps(seg, SPACING).steps;
  const layout = computeFenceLayout([{ x: 0, y: 0 }, { x: len, y: 0 }], [], { groundAt: (x) => z(x), segClass: () => seg.cls, segSteps: () => priced });
  // The gap under every panel and how far any panel would bury, sampled every 3 in.
  let gap = 0;
  let bury = 0;
  let minBay = Infinity;
  let maxBay = 0;
  const bays = layout.bays;
  let drawn = 0;
  for (let k = 0; k < bays.length; k += 7) {
    const [x0, , z0, x1, , z1, stepped] = bays.slice(k, k + 7);
    if (stepped) drawn++;
    minBay = Math.min(minBay, x1 - x0);
    maxBay = Math.max(maxBay, x1 - x0);
    for (let x = x0; x <= x1 + 1e-9; x += 0.25) {
      const base = z0 + ((z1 - z0) * (x - x0)) / Math.max(1e-9, x1 - x0);
      gap = Math.max(gap, base - z(x));
      bury = Math.max(bury, z(x) - base);
    }
  }
  return { seg, priced, drawn, gap, bury, minBay, maxBay, report };
}

console.log("── rolling ground — a small net rise, feet of up and down (the 3D that floated)");
const rolling = (x: number) => 0.02 * x + 2.2 * Math.sin(x / 7);
const r1 = run(96, rolling);
const naive = Math.ceil(96 / SPACING);
check("it steps (rolling ground can't rack)", r1.seg.cls === "stepped");
check("more steps than one a bay — the up and down counted, not the net rise", r1.priced > naive, `${r1.priced} vs ${naive}`);
check("no panel hangs more than about one step over the ground", r1.gap <= MAX_STEP_DROP_FT + 0.15, `${r1.gap.toFixed(2)} ft`);
check("no panel buries", r1.bury <= 0.05, `${r1.bury.toFixed(2)} ft`);
check("the 3D draws the steps the ticket charges", r1.drawn === r1.priced, `${r1.drawn} drawn, ${r1.priced} priced`);

console.log("── a steep straight hill (40%)");
const steep = (x: number) => -0.4 * x;
const r2 = run(60, steep);
check("steps of at most a foot", r2.gap <= MAX_STEP_DROP_FT + 0.05, `${r2.gap.toFixed(2)} ft`);
check("a step per foot of fall", r2.priced >= 24 && r2.priced <= 26, `${r2.priced} steps over 24 ft of fall`);
check("no bay shorter than the shortest a step makes", r2.minBay >= MIN_STEP_BAY_FT - 1e-6, `${r2.minBay.toFixed(2)} ft`);
check("no panel buries", r2.bury <= 0.05);

console.log("── gentle ground a rackable fence follows");
const gentle = (x: number) => 0.1 * x;
const gr = terrainFromProfile([{ seg: 0, start: 0, count: 9, planFt: 80 }], Array.from({ length: 9 }, (_, k) => gentle(k * 10)), { sectionFt: SPACING, rackMaxDeg: 25 });
check("a straight 10% slope racks — one line following the grade, no steps", gr.segs[0].cls === "racked" && !gr.segs[0].steps);
const gp = terrainFromProfile([{ seg: 0, start: 0, count: 9, planFt: 80 }], Array.from({ length: 9 }, (_, k) => gentle(k * 10)), { sectionFt: SPACING, rackMaxDeg: 4 });
check("the same slope with prefab panels (barely rack) steps", gp.segs[0].cls === "stepped");

console.log("── the plan itself");
const flat = stepStations(Array.from({ length: 41 }, () => 0), 1, SPACING);
check("flat ground: bays of the post spacing", flat.length - 1 === 5 && Math.abs(flat[1] - 8) < 1e-6);
const cliff = stepStations(Array.from({ length: 21 }, (_, k) => (k < 10 ? 0 : -3)), 1, SPACING);
const gaps = cliff.slice(1).map((s, i) => s - cliff[i]);
check("a sheer 3 ft drop isn't posts inches apart — the shortest bay is 2 ft", Math.min(...gaps) >= MIN_STEP_BAY_FT - 1e-6, gaps.map((g) => g.toFixed(1)).join(", "));
check("the 3D draws exactly the ticket's count", stepStations(Array.from({ length: 41 }, () => 0), 1, SPACING, { count: 9 }).length - 1 === 9);

console.log("── the ticket");
const sum = summarizeSlope([{ planFt: 96, gradeFt: r1.seg.gradeFt, riseFt: r1.seg.riseFt, thetaDeg: r1.seg.thetaDeg, cls: "stepped", steps: r1.seg.steps, stepDropFt: r1.seg.stepDropFt, planned: r1.seg.planned }], 6, SPACING);
check("the slope line counts the real steps", sum.steppedSections === r1.priced, `${sum.steppedSections}`);
check("a rolling run is no wall", sum.wallSegments === 0);
const wall = summarizeSlope([{ planFt: 16, gradeFt: 17, riseFt: 6, thetaDeg: 20, cls: "stepped", steps: 8, stepDropFt: 0.75 }], 6, SPACING);
check("a 6 ft drop over two bays still reads as a wall to ask about", wall.wallSegments === 1);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);

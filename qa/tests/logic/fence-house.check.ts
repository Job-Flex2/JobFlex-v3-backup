// Synthetic check of house outlines and site snapping — no network, no browser.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/fence-house.check.ts
import {
  mergeBuildings,
  ringAreaSqFt,
  runEnds,
  snapToTargets,
  ringEdges,
  storyHeightFt,
  wallMountsFor,
  type DrawnHouse,
} from "../../../src/components/estimator/fence/fenceHouse";
import type { BuildingFootprint, PathPoint } from "../../../src/components/estimator/fence/fenceTypes";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const house: PathPoint[] = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }];

ok("area of a 40×30 outline", ringAreaSqFt(house) === 1200);
ok("four walls", ringEdges(house).length === 4);
ok("storey heights", storyHeightFt(1) === 13 && storyHeightFt(2) === 23 && storyHeightFt(3) === 33);

// ── snapping: corners win, then walls ──
{
  const edges = ringEdges(house);
  const c = snapToTargets({ x: 41, y: 1.2 }, house, edges, 2, 1.5);
  ok("a point near a corner lands ON the corner", !!c && c.kind === "corner" && c.pt.x === 40 && c.pt.y === 0);
  const e = snapToTargets({ x: 20, y: 31 }, house, edges, 2, 1.5);
  ok("a point near a wall lands on the wall", !!e && e.kind === "edge" && near(e.pt.x, 20, 1e-9) && near(e.pt.y, 30, 1e-9));
  ok("open ground does not snap", snapToTargets({ x: 20, y: 50 }, house, edges, 2, 1.5) === null);
}

// ── run ends and wall mounts ──
{
  const pts: PathPoint[] = [
    { x: -30, y: 15 }, { x: 0, y: 15 },               // run 1 ends ON the west wall
    { x: 60, y: 0, gap: true }, { x: 60, y: 40 },      // run 2: nowhere near
    { x: 10, y: 60, gap: true }, { x: 30, y: 60 }, { x: 30, y: 80 }, { x: 10, y: 60 }, // closed loop
  ];
  const ends = runEnds(pts);
  ok("open runs contribute two ends each, loops none", ends.length === 4, String(ends.length));
  const mounts = wallMountsFor(pts, [house]);
  ok("only the end on the wall is a wall mount", mounts.length === 1 && mounts[0].x === 0 && mounts[0].y === 15, JSON.stringify(mounts));
  ok("no houses, no mounts", wallMountsFor(pts, []).length === 0);
  const near: PathPoint[] = [{ x: -30, y: 15 }, { x: -0.7, y: 15 }];
  ok("an end that only comes CLOSE to a wall is not a mount", wallMountsFor(near, [house]).length === 0);
}

// ── the traced house replaces the detected footprint it covers ──
{
  const drawn: DrawnHouse[] = [{ id: "h1", ring: house, stories: 2 }];
  const detectedSame: BuildingFootprint = { ring: [{ x: 2, y: 2 }, { x: 38, y: 2 }, { x: 38, y: 28 }, { x: 2, y: 28 }], heightFt: 13, role: "subject" };
  const garage: BuildingFootprint = { ring: [{ x: 60, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 20 }, { x: 60, y: 20 }], heightFt: 12, role: "subject" };
  const merged = mergeBuildings(drawn, [detectedSame, garage]);
  ok("traced house + the garage it does not cover", merged.length === 2, String(merged.length));
  ok("traced house first, at 2-storey height", merged[0].heightFt === 23 && merged[0].role === "subject" && merged[0].ring === house);
  ok("the garage stays", merged[1] === garage);
  // Tracing ONLY the garage inside one combined house-and-garage footprint.
  const combined: BuildingFootprint = { ring: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 30 }, { x: 0, y: 30 }], heightFt: 13, role: "subject" };
  const garageOnly: DrawnHouse[] = [{ id: "g", ring: [{ x: 48, y: 2 }, { x: 58, y: 2 }, { x: 58, y: 12 }, { x: 48, y: 12 }], stories: 1 }];
  ok("a small traced garage keeps the big footprint", mergeBuildings(garageOnly, [combined]).length === 2);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

// Synthetic check of the lot topography math — no network, no browser.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/fence-topo.check.ts
// Planes and cones with known answers: the lattice stays under its cap, the
// contour of a plane is a straight line where the plane says, a cone's contour
// closes at the right radius, lines split exactly on the property line, the
// labels sit on the lot, and the grade of a straight line matches the slope.
import {
  planTopoGrid,
  topoSamplePoints,
  gridFromSamples,
  elevationAt,
  pickTopoInterval,
  contourChains,
  smoothChain,
  splitByRegion,
  buildLotTopo,
  lineGradeOnGrid,
  TOPO_MAX_POINTS,
  type TopoGridPlan,
} from "../../../src/components/estimator/fence/fenceTopo";
import { sampleFencePath, MAX_PROFILE_SAMPLES } from "../../../src/components/estimator/fence/fenceTerrain";
import { latLngToLocalFeet, pointInRingFt } from "../../../src/components/estimator/fence/mapProjection";
import type { PathPoint } from "../../../src/components/estimator/fence/fenceTypes";

const ORIGIN = { lat: 47.75, lng: -122.14 };
let failures = 0;
let passes = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

function gridOf(plan: TopoGridPlan, f: (x: number, y: number) => number): number[][] {
  const g: number[][] = [];
  for (let r = 0; r < plan.rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < plan.cols; c++) row.push(f(plan.x0 + c * plan.dx, plan.y0 + r * plan.dy));
    g.push(row);
  }
  return g;
}

// ── lattice ──
{
  const p = planTopoGrid({ x0: 0, y0: 0, x1: 150, y1: 200 });
  ok("quarter-acre lattice at the finest cell", p.dx === 8 && p.cols * p.rows <= TOPO_MAX_POINTS, `${p.cols}×${p.rows} @ ${p.dx} ft`);
  ok("lattice covers the box", p.x0 <= 0 && p.y0 <= 0 && p.x0 + (p.cols - 1) * p.dx >= 150 && p.y0 + (p.rows - 1) * p.dy >= 200);
  const big = planTopoGrid({ x0: -600, y0: -500, x1: 700, y1: 900 });
  ok("five-acre lattice stays under the cap", big.cols * big.rows <= TOPO_MAX_POINTS, `${big.cols}×${big.rows} @ ${big.dx.toFixed(1)} ft`);
  const pts = topoSamplePoints(p, ORIGIN);
  ok("one sample per node", pts.length === p.cols * p.rows);
  const back = latLngToLocalFeet(ORIGIN, pts[p.cols + 1]);
  ok("row-major order (row 1, col 1)", near(back.x, p.x0 + p.dx, 0.01) && near(back.y, p.y0 + p.dy, 0.01));
  ok("wrong answer length is rejected", gridFromSamples(p, [1, 2, 3]) === null);
  const flat = gridFromSamples(p, pts.map((_, i) => 100 + (i % p.cols)));
  ok("answer folds into rows", !!flat && flat[2][3] === 103);
}

// ── bilinear ──
{
  const p = planTopoGrid({ x0: 0, y0: 0, x1: 100, y1: 100 });
  const g = gridOf(p, (x, y) => 100 + 0.1 * x + 0.05 * y);
  const z = elevationAt(g, p, { x: 37.3, y: 61.9 });
  ok("bilinear is exact on a plane", z !== null && near(z, 100 + 3.73 + 3.095, 1e-6), String(z));
  ok("off the lattice is null", elevationAt(g, p, { x: -500, y: 0 }) === null);
}

// ── interval ──
ok("under a foot is flat", pickTopoInterval(0.8, true) === 0);
ok("3 ft of fall on lidar → half-foot lines", pickTopoInterval(3, true) === 0.5);
ok("3 ft on a coarse model → 1 ft lines", pickTopoInterval(3, false) === 1);
ok("20 ft → 2 ft", pickTopoInterval(20, false) === 2);
ok("40 ft → 5 ft", pickTopoInterval(40, true) === 5);

// ── contours ──
{
  const p = planTopoGrid({ x0: 0, y0: 0, x1: 200, y1: 120 });
  const g = gridOf(p, (x) => 100 + x / 10); // 1 ft per 10 ft east
  const chains = contourChains(g, p, 105.5);
  const xs = chains.flat().map((q) => q.x);
  ok("a plane's contour is one line", chains.length === 1, `${chains.length} chains`);
  ok("…at the right place (x = 55)", xs.every((x) => near(x, 55, 1e-6)), `${Math.min(...xs)}..${Math.max(...xs)}`);
  const ys = chains[0].map((q) => q.y);
  ok("…spanning the lattice", near(Math.min(...ys), p.y0, 1e-6) && near(Math.max(...ys), p.y0 + (p.rows - 1) * p.dy, 1e-6));
}
{
  const p = planTopoGrid({ x0: -150, y0: -150, x1: 150, y1: 150 });
  const g = gridOf(p, (x, y) => 30 - Math.hypot(x, y) / 10);
  const chains = contourChains(g, p, 25);
  const ring = chains[0] ?? [];
  const closed = ring.length > 4 && near(ring[0].x, ring[ring.length - 1].x, 1e-9) && near(ring[0].y, ring[ring.length - 1].y, 1e-9);
  const radii = ring.map((q) => Math.hypot(q.x, q.y));
  ok("a cone's contour closes", chains.length === 1 && closed, `${chains.length} chains`);
  ok("…at radius 50 ft (±2)", radii.every((r) => near(r, 50, 2)), `${Math.min(...radii).toFixed(2)}..${Math.max(...radii).toFixed(2)}`);
  const sm = smoothChain(ring);
  ok("smoothing keeps a ring closed", near(sm[0].x, sm[sm.length - 1].x, 1e-9) && near(sm[0].y, sm[sm.length - 1].y, 1e-9));
  const open = smoothChain([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }]);
  ok("smoothing keeps an open line's ends", open[0].x === 0 && open[open.length - 1].x === 20);
}

// ── split at the property line ──
{
  const sq: PathPoint[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const inside = (q: PathPoint) => pointInRingFt(q, sq);
  const pieces = splitByRegion([{ x: -50, y: 50 }, { x: 25, y: 50 }, { x: 150, y: 50 }], inside);
  ok("a line through a lot splits in three", pieces.length === 3 && !pieces[0].inside && pieces[1].inside && !pieces[2].inside);
  const cutIn = pieces[1]?.pts[0];
  const cutOut = pieces[1]?.pts[pieces[1].pts.length - 1];
  ok("…exactly on the boundary", !!cutIn && !!cutOut && near(cutIn.x, 0, 0.01) && near(cutOut.x, 100, 0.01), `${cutIn?.x.toFixed(3)} / ${cutOut?.x.toFixed(3)}`);
  // A diamond round the lot, densified the way a smoothed contour is (a vertex
  // every foot): four corners poke out, four arcs stay in, and the outside
  // piece that straddles the ring's seam comes back as ONE piece.
  const corners = [{ x: 50, y: -20 }, { x: 120, y: 50 }, { x: 50, y: 120 }, { x: -20, y: 50 }, { x: 50, y: -20 }];
  const ring: PathPoint[] = [corners[0]];
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1];
    const b = corners[i];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
    for (let k = 1; k <= n; k++) ring.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  ring[ring.length - 1] = { ...ring[0] };
  const rp = splitByRegion(ring, inside);
  ok("a closed ring rejoins across its seam", rp.filter((x) => x.inside).length === 4 && rp.filter((x) => !x.inside).length === 4, `${rp.length} pieces`);
}

// ── the lot ──
{
  // A lot on ground rising 1 ft per 8 ft to the east, inside a wider lattice.
  const lot: PathPoint[] = [{ x: 0, y: 0 }, { x: 96, y: 0 }, { x: 96, y: 120 }, { x: 0, y: 120 }];
  const plan = planTopoGrid({ x0: -40, y0: -40, x1: 136, y1: 160 });
  const grid = gridOf(plan, (x) => 200 + x / 8);
  const topo = buildLotTopo({ grid, plan, origin: ORIGIN, rings: [lot], fine: true });
  ok("relief measured on the lot, not the lattice", near(topo.reliefFt, 12, 0.05), topo.reliefFt.toFixed(2));
  ok("interval for 12 ft of fall on lidar", topo.intervalFt === 1, String(topo.intervalFt));
  ok("ground falls toward W", topo.fallsToward === "W", String(topo.fallsToward));
  ok("grade figure is 12.5%", near(topo.gradePct, 12.5, 0.1), topo.gradePct.toFixed(2));
  const ov = topo.overlay;
  ok("overlay drawn", !!ov && ov.lines.length > 0);
  if (ov) {
    ok("lines carry lot and off-lot pieces", ov.lines.some((l) => l.inside.length) && ov.lines.some((l) => l.outside.length));
    const lotLL = lot; // local feet
    const labelsOnLot = ov.labels.every((l) => pointInRingFt(latLngToLocalFeet(ORIGIN, l.at), lotLL));
    ok("every label sits on the lot", ov.labels.length > 0 && labelsOnLot, `${ov.labels.length} labels`);
    ok("labels read upright (±110 on near-vertical lines)", ov.labels.every((l) => l.angleDeg >= -110 && l.angleDeg <= 110));
    ok("labels count up from the low point", ov.labels.length >= 4 && ["+2 ft", "+4 ft", "+10 ft"].every((x) => ov.labels.some((l) => l.text === x)) && !ov.labels.some((l) => l.text === "0 ft"), ov.labels.map((l) => l.text).join(" "));
    const local = ov.labels.map((l) => latLngToLocalFeet(ORIGIN, l.at));
    const tight = local.some((a, i) => local.some((b, j) => j > i && Math.hypot(a.x - b.x, a.y - b.y) < 25.9));
    ok("no two labels crowd each other", !tight);
    ok("off-lot context capped at two intervals", ov.lines.length <= 12 + 1 + 4, `${ov.lines.length} levels`);
    const low = ov.marks.find((m) => m.kind === "low");
    const high = ov.marks.find((m) => m.kind === "high");
    ok("low mark on the west line", !!low && near(latLngToLocalFeet(ORIGIN, low.at).x, 0, 0.5));
    ok("high mark on the east line, +12 ft", !!high && near(latLngToLocalFeet(ORIGIN, high.at).x, 96, 0.5) && high.text === "High · +12 ft", high?.text);
  }
  const flat = buildLotTopo({ grid: gridOf(plan, () => 200.2), plan, origin: ORIGIN, rings: [lot], fine: true });
  ok("a level lot draws nothing", flat.overlay === null && flat.intervalFt === 0);
  const noLot = buildLotTopo({ grid, plan, origin: ORIGIN, rings: [], fine: false });
  ok("without a parcel the whole lattice is the site", near(noLot.reliefFt, (plan.cols - 1) * plan.dx / 8, 0.05), noLot.reliefFt.toFixed(2));
}

// ── the lot's extremes come from its edges too ──
{
  // Flat lot with a 6 ft knoll centred just OUTSIDE the south line: the
  // bilinear surface crests on that line between two corners.
  const lot: PathPoint[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 150 }, { x: 0, y: 150 }];
  const plan = planTopoGrid({ x0: -40, y0: -40, x1: 140, y1: 190 });
  const grid = gridOf(plan, (x, y) => 100 + 6 * Math.max(0, 1 - Math.hypot(x - 50, y + 4) / 18));
  const topo = buildLotTopo({ grid, plan, origin: ORIGIN, rings: [lot], fine: true });
  let edgeMax = -Infinity;
  for (let x = 0; x <= 100; x += 0.25) edgeMax = Math.max(edgeMax, elevationAt(grid, plan, { x, y: 0 }) ?? -Infinity);
  ok("relief reaches the crest on the lot line", near(topo.reliefFt, edgeMax - 100, 0.05), `${topo.reliefFt.toFixed(2)} vs ${(edgeMax - 100).toFixed(2)}`);
  const high = topo.overlay?.marks.find((m) => m.kind === "high");
  ok("HIGH mark sits on the south line", !!high && near(latLngToLocalFeet(ORIGIN, high.at).y, 0, 0.5));
}

// ── near-vertical labels all read the same way on one slope ──
{
  const lot: PathPoint[] = [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 160 }, { x: 0, y: 160 }];
  const plan = planTopoGrid({ x0: -30, y0: -30, x1: 120, y1: 190 });
  const grid = gridOf(plan, (x, y) => Math.round((200 + x / 9 + 0.3 * Math.sin(y / 13) + 0.2 * Math.cos((x + y) / 7)) * 100) / 100);
  const topo = buildLotTopo({ grid, plan, origin: ORIGIN, rings: [lot], fine: true });
  const angles = (topo.overlay?.labels ?? []).map((l) => l.angleDeg).filter((a) => Math.abs(a) > 60);
  ok("near-vertical labels share one reading direction", angles.length >= 3 && (angles.every((a) => a > 0) || angles.every((a) => a < 0)), angles.map((a) => a.toFixed(0)).join(" "));
  // Uphill is east; the top of the text faces east → rotation ≈ +90.
  ok("…with the top of the text uphill (east)", angles.every((a) => a > 0), angles.map((a) => a.toFixed(0)).join(" "));
}

// ── grade along a line ──
{
  const plan = planTopoGrid({ x0: -20, y0: -20, x1: 220, y1: 60 });
  const grid = gridOf(plan, (x) => 50 + 0.1 * x);
  const g = lineGradeOnGrid(grid, plan, { x: 0, y: 20 }, { x: 200, y: 20 });
  ok("10% along 200 ft", !!g && near(g.pct, 10, 0.01) && near(g.riseFt, 20, 0.01), g ? `${g.pct.toFixed(2)}% rise ${g.riseFt.toFixed(2)}` : "null");
  ok("…is racked (5.7°)", g?.cls === "racked");
  ok("…along grade ≈ 200.998", !!g && near(g.gradeFt, 200 * Math.hypot(1, 0.1), 0.01), g?.gradeFt.toFixed(3));
  const across = lineGradeOnGrid(grid, plan, { x: 50, y: 0 }, { x: 50, y: 40 });
  ok("across the slope is level", across?.cls === "level" && near(across.pct, 0, 1e-6));
}

// ── profile sampler cap (a many-cornered parcel trace) ──
for (const [segs, len] of [[120, 100], [300, 15], [1, 200]] as const) {
  const pts: PathPoint[] = [];
  for (let i = 0; i <= segs; i++) pts.push({ x: i * len, y: (i % 2) * 3 });
  const s = sampleFencePath(pts, ORIGIN);
  const cap = Math.max(MAX_PROFILE_SAMPLES, 2 * s.segs.length);
  ok(`${segs} × ${len} ft stays within the sample cap`, s.samples.length <= cap, `${s.samples.length} samples`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

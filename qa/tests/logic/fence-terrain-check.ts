// Synthetic check of the fence terrain math — no network, no browser.
//   npx tsx qa/tests/logic/fence-terrain-check.ts
// Verifies the owner's acceptance numbers: 200 ft plan on a 15° grade reads
// ~207 ft along the ground, 20° reads ~213, and flat ground changes nothing;
// plus the class thresholds and the stepped-section step count.
import {
  sampleFencePath,
  terrainFromProfile,
  terrainAssumption,
  LEVEL_MAX_DEG,
  RACKED_MAX_DEG,
} from "../../../src/components/estimator/fence/fenceTerrain";
import type { PathPoint } from "../../../src/components/estimator/fence/fenceTypes";

const ORIGIN = { lat: 47.6, lng: -122.2 };

/** One straight run of `planFt`, profiled at a constant grade of `deg`. */
function run(planFt: number, deg: number) {
  const pts: PathPoint[] = [{ x: 0, y: 0 }, { x: planFt, y: 0 }];
  const s = sampleFencePath(pts, ORIGIN);
  const rise = Math.tan((deg * Math.PI) / 180);
  const seg = s.segs[0];
  const ds = seg.planFt / (seg.count - 1);
  const elev = Array.from({ length: seg.count }, (_, k) => 100 + k * ds * rise);
  return terrainFromProfile(s.segs, elev);
}

let failures = 0;
function check(name: string, got: number, want: number, tol: number) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got.toFixed(2)}, want ${want.toFixed(2)} ±${tol}`);
}
function checkEq(name: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${String(got)}, want ${String(want)}`);
}

// ── the acceptance numbers ──
const t15 = run(200, 15);
check("200 ft @ 15° along grade", t15.gradeFt, 200 / Math.cos((15 * Math.PI) / 180), 0.2); // ≈207.06
checkEq("15° class", t15.segs[0].cls, "racked");

const t20 = run(200, 20);
check("200 ft @ 20° along grade", t20.gradeFt, 200 / Math.cos((20 * Math.PI) / 180), 0.2); // ≈212.84
checkEq("20° class", t20.segs[0].cls, "racked");

const flat = run(200, 0);
check("200 ft flat along grade", flat.gradeFt, 200, 0.01);
checkEq("flat class", flat.segs[0].cls, "level");
checkEq("flat assumption", terrainAssumption(flat, "ok"), "Level ground (measured)");

// ── thresholds ──
checkEq("4° is level", run(200, 4).segs[0].cls, "level");
checkEq("6° is racked", run(200, 6).segs[0].cls, "racked");
checkEq("25° is racked (boundary)", run(200, 25).segs[0].cls, "racked");
const t30 = run(200, 30);
checkEq("30° is stepped", t30.segs[0].cls, "stepped");
checkEq("30° steps (200 ft, 8 ft bays)", t30.segs[0].steps, 25);
check("30° drop per step", t30.segs[0].stepDropFt ?? 0, (200 * Math.tan((30 * Math.PI) / 180)) / 25, 0.05);

// ── a dip inside a segment still buys its footage even with zero net rise ──
{
  const pts: PathPoint[] = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
  const s = sampleFencePath(pts, ORIGIN);
  const seg = s.segs[0];
  const ds = seg.planFt / (seg.count - 1);
  // V-profile: down at 15° to the middle, back up at 15°.
  const rise = Math.tan((15 * Math.PI) / 180);
  const mid = (seg.count - 1) / 2;
  const elev = Array.from({ length: seg.count }, (_, k) => 100 - Math.abs(k - mid) * ds * rise + mid * ds * rise);
  const t = terrainFromProfile(s.segs, elev);
  check("valley: grade > plan despite zero net rise", t.gradeFt, 200 / Math.cos((15 * Math.PI) / 180), 0.5);
  checkEq("valley: net class is level (rise ≈ 0)", t.segs[0].cls, "level");
}

// ── assumption strings ──
console.log("assumption (measured slope):", terrainAssumption(t15, "ok"));
console.log("assumption (failed):", terrainAssumption(null, "failed"));
console.log("assumption (manual):", terrainAssumption(null, "idle"));
console.log("thresholds:", `level < ${LEVEL_MAX_DEG}°, racked ≤ ${RACKED_MAX_DEG}°, stepped above`);

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll checks passed.");

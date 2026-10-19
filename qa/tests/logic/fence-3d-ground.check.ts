// Synthetic check of the fence's ground geometry for the 3D view — no browser.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/fence-3d-ground.check.ts
// Flat ground changes nothing; a racked bay's panel follows the grade; a
// stepped segment's bays are level on the high ground under them, a step where the ground spends a foot (never a bay
// under 2 ft — lib/fence/slope stepStations, 2026-10-18), the count fenceTerrain charges for, and the step posts are
// the tall ones;
// gates hang level; a run that ends on a wall-mount point is a wall mount.
import { computeFenceLayout, POST_SPACING_FT } from "../../../src/components/estimator/fence/fenceGeometry";
import { terrainFromProfile, sampleFencePath } from "../../../src/components/estimator/fence/fenceTerrain";
import { MIN_STEP_BAY_FT, segmentSteps } from "../../../src/lib/fence/slope";
import type { PathPoint, GateSpec } from "../../../src/components/estimator/fence/fenceTypes";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ── flat: identical to the old layout ──
{
  const pts: PathPoint[] = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }];
  const a = computeFenceLayout(pts);
  const b = computeFenceLayout(pts, [], { groundAt: undefined });
  ok("same post count with or without options", a.postCount === b.postCount && a.postCount === 5 + 4 + 1, String(a.postCount));
  ok("flat ground is all zero", [...a.postBase, ...a.postPanel, ...a.picketBase].every((v) => v === 0));
  ok("one bay per post gap (5 + 4)", a.bayCount === 9, String(a.bayCount));
  ok("no stepped bays on flat ground", a.steppedBays === 0);
}

// ── a 10% slope rising east, racked ──
{
  const pts: PathPoint[] = [{ x: 0, y: 0 }, { x: 40, y: 0 }];
  const l = computeFenceLayout(pts, [], { groundAt: (x) => 0.1 * x, segClass: () => "racked" });
  ok("posts stand on the ground", [...l.postBase].every((v, i) => near(v, 0.1 * l.posts[i * 3], 1e-4)));
  ok("racked bays follow the grade", near(l.bays[2], 0, 1e-4) && near(l.bays[5], 0.8, 1e-4));
  const k = 10;
  ok("a picket sits on the grade under it", near(l.picketBase[k], 0.1 * l.pickets[k * 3], 1e-3), `${l.picketBase[k].toFixed(3)} vs ${(0.1 * l.pickets[k * 3]).toFixed(3)}`);
  ok("post panel = its ground when racked", [...l.postPanel].every((v, i) => near(v, l.postBase[i], 1e-4)));
}

// ── the same slope, stepped ──
{
  const pts: PathPoint[] = [{ x: 0, y: 0 }, { x: 40, y: 0 }];
  const l = computeFenceLayout(pts, [], { groundAt: (x) => 0.6 * x, segClass: () => "stepped" });
  // 24 ft of fall over 40 ft wants a step every 1.7 ft; the shortest bay (2 ft) holds — 20 steps, past that a wall.
  const bays = Math.floor(40 / MIN_STEP_BAY_FT);
  ok("a step every 2 ft at most — the shortest bay", l.steppedBays === bays && POST_SPACING_FT === 8, `${l.steppedBays} of ${bays}`);
  let level = true;
  for (let i = 0; i < l.bayCount; i++) {
    const o = i * 7;
    if (!near(l.bays[o + 2], l.bays[o + 5], 1e-6)) level = false;
    if (!near(l.bays[o + 2], 0.6 * l.bays[o + 3], 1e-4)) level = false; // uphill = east end
  }
  ok("stepped bays are level at their uphill end", level);
  // Post 2 carries bay 1 (level at its own spot) and bay 2 (level at bay 2's uphill end): the higher.
  const x2 = l.posts[2 * 3];
  const up2 = l.bays[2 * 7 + 3];
  ok("a step post carries the higher panel", near(l.postPanel[2], 0.6 * up2, 1e-3) && near(l.postBase[2], 0.6 * x2, 1e-3) && up2 > x2, `panel ${l.postPanel[2]} base ${l.postBase[2]}`);
  ok("the end post stands on its ground", near(l.postBase[l.postCount - 1], 24, 1e-3) && near(l.postPanel[l.postCount - 1], 24, 1e-3));
}

// ── classes come from the priced profile ──
{
  const pts: PathPoint[] = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }];
  const ground = (x: number, y: number) => (y > 0 ? 0.7 * y : 0.05 * x); // 2.9° then 35°
  const s = sampleFencePath(pts, { lat: 47.7, lng: -122.1 });
  // The flat sample list as the Elevation call answers it: neighbouring segments share their corner sample, so each
  // sample is written at its own index (a concatenation shifted the second segment's profile).
  const elev: number[] = new Array(Math.max(...s.segs.map((sg) => sg.start + sg.count))).fill(0);
  for (const sg of s.segs) {
    const a = pts[sg.seg];
    const b = pts[sg.seg + 1];
    for (let k = 0; k < sg.count; k++) {
      const t = k / (sg.count - 1);
      elev[sg.start + k] = ground(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    }
  }
  const report = terrainFromProfile(s.segs, elev);
  const classes: Record<number, "level" | "racked" | "stepped"> = {};
  report.segs.forEach((sg) => (classes[sg.seg] = sg.cls));
  const priced = report.segs.find((sg) => sg.cls === "stepped");
  // The page hands the 3D the ticket's count, as fence-estimator-behavior modelSteps does.
  const l = computeFenceLayout(pts, [], { groundAt: ground, segClass: (i) => classes[i], segSteps: (i) => (priced && priced.seg === i ? segmentSteps(priced, POST_SPACING_FT).steps : null) });
  ok("priced classes: level then stepped", classes[0] === "level" && classes[1] === "stepped", JSON.stringify(classes));
  ok("3D steps = priced steps", !!priced && l.steppedBays === segmentSteps(priced, POST_SPACING_FT).steps, `${l.steppedBays} vs ${priced ? segmentSteps(priced, POST_SPACING_FT).steps : "-"}`);
  // Corner post (x = 60, y = 0) carries the level segment's last bay AND the stepped segment's first bay (level on the
  // high ground under it — its uphill end).
  const corner = [...Array(l.postCount).keys()].find((i) => near(l.posts[i * 3], 60, 1e-6) && near(l.posts[i * 3 + 1], 0, 1e-6));
  let firstStep = -1;
  for (let i = 0; i < l.bayCount; i++) if (near(l.bays[i * 7], 60, 1e-6) && near(l.bays[i * 7 + 1], 0, 1e-6) && l.bays[i * 7 + 6]) firstStep = i;
  const want = firstStep >= 0 ? Math.max(3, l.bays[firstStep * 7 + 2]) : NaN;
  ok("the corner post takes the higher panel", corner !== undefined && Number.isFinite(want) && near(l.postPanel[corner], want, 1e-3), corner !== undefined ? `${l.postPanel[corner]} vs ${want}` : "none");
}

// ── gates hang level ──
{
  const pts: PathPoint[] = [{ x: 0, y: 0 }, { x: 40, y: 0 }];
  const gate: GateSpec = { id: "g", segmentIndex: 0, t: 0.5, widthFt: 4, kind: "gate", variant: "single" };
  const l = computeFenceLayout(pts, [gate], { groundAt: (x) => 0.2 * x, segClass: () => "racked" });
  ok("gate base is the uphill edge's ground", l.gateUnits.length === 1 && near(l.gateUnits[0].base, 0.2 * 22, 1e-4), String(l.gateUnits[0]?.base));
}

// ── wall mounts ──
{
  const pts: PathPoint[] = [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }];
  const l = computeFenceLayout(pts, [], { wallMounts: [{ x: 24.1, y: 16 }] });
  const mounted = [...l.postMount].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  ok("the run end on the wall is a wall mount", mounted.length === 1 && near(l.posts[mounted[0] * 3 + 1], 16, 1e-6), JSON.stringify(mounted));
  const l2 = computeFenceLayout(pts, [], { wallMounts: [{ x: 0, y: 0.2 }] });
  ok("the run START can be the wall mount too", l2.postMount[0] === 1 && [...l2.postMount].filter(Boolean).length === 1);
  const loop: PathPoint[] = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 0 }];
  const l3 = computeFenceLayout(loop, [], { wallMounts: [{ x: 0, y: 0 }] });
  ok("a closed loop has no end to mount", [...l3.postMount].every((v) => v === 0));
}

// ── posts where runs meet stand identical ──
{
  // Run 1 steps DOWN a steep bank into P = (0, 0); run 2 leaves P racked along flat ground.
  const pts: PathPoint[] = [{ x: 0, y: -24 }, { x: 0, y: 0 }, { x: 0, y: 0, gap: true }, { x: 30, y: 0 }];
  const ground = (x: number, y: number) => (y < 0 ? -0.8 * y : 0.02 * x);
  const l = computeFenceLayout(pts, [], { groundAt: ground, segClass: (i) => (i === 0 ? "stepped" : "racked") });
  const atP = [...Array(l.postCount).keys()].filter((i) => near(l.posts[i * 3], 0, 1e-6) && near(l.posts[i * 3 + 1], 0, 1e-6));
  ok("two posts at the joint", atP.length === 2, String(atP.length));
  ok("…with one height", atP.length === 2 && l.postPanel[atP[0]] === l.postPanel[atP[1]] && l.postBase[atP[0]] === l.postBase[atP[1]], atP.map((i) => l.postPanel[i]).join(" / "));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

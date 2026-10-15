// The fence in 3D for the client (2026-09-27, lib/fence/scene): a stored plan
// with a scene block stands up with its look, gates, slope classes, land and
// lot line; an older plan without one still stands up flat; the convert
// schema takes the scene and refuses a lattice out of bounds; the lattice cap
// thins evenly. Static imports only (tsx has no top-level await).
import { parseFencePlan, type FencePlan } from "../../../src/lib/fence/planSvg";
import { capTerrain, fenceSceneFromPlan, parseFencePlanScene, SCENE_TERRAIN_MAX_POINTS } from "../../../src/lib/fence/scene";
import { fenceConvertSchema } from "../../../src/lib/fence/convertSchema";
import { fenceBuildFor } from "../../../src/lib/fence/build";
import { fenceType } from "../../../src/lib/fence/catalog";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const grid = (cols: number, rows: number) => Array.from({ length: rows }, (_, j) => Array.from({ length: cols }, (_, i) => Math.round((i * 0.3 + j * 0.2) * 100) / 100));
const plan = {
  points: [{ x: -20, y: 0 }, { x: -20, y: 40 }, { x: 30, y: 40 }, { x: 30, y: 0 }],
  gates: [{ segmentIndex: 1, t: 0.5, widthFt: 4, kind: "gate", label: "Walk gate", x: 5, y: 40 }],
  buildings: [{ ring: [{ x: -10, y: -30 }, { x: 20, y: -30 }, { x: 20, y: -5 }, { x: -10, y: -5 }], role: "subject", heightFt: 22 }, { ring: [{ x: 60, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 20 }], role: "neighbor" }],
  lots: [[{ x: -45, y: -80 }, { x: 45, y: -80 }, { x: 45, y: 60 }, { x: -45, y: 60 }]],
  origin: { lat: 32.83, lng: -96.56 },
  heightFt: 6,
  typeLabel: "Cedar privacy",
  totalLf: 140,
  address: "100 Stand Test Dr",
  scene: {
    family: "vinyl",
    color: "#eef0ee",
    gates: [{ id: "o1", segmentIndex: 1, t: 0.5, widthFt: 4, kind: "gate", variant: "arched", x: 5, y: 40 }],
    segClasses: { "0": "racked", "2": "stepped" },
    wallMounts: [{ x: -20, y: 0 }],
    terrain: { plan: { x0: -60, y0: -90, dx: 8, dy: 8, cols: 20, rows: 25 }, grid: grid(20, 25) },
    lotColor: "#4a9eff",
    build: fenceBuildFor(fenceType("vinyl-privacy"), 6),
  },
};

// ── parse + scene
const parsed = parseFencePlan(JSON.parse(JSON.stringify(plan)));
check("a plan with a scene parses, scene included", !!parsed?.scene && parsed.scene.family === "vinyl" && parsed.scene.gates[0].variant === "arched");
check("the house keeps its height", parsed?.buildings[0].heightFt === 22);
const sc = parsed ? fenceSceneFromPlan(parsed) : null;
check("the scene stands the fence up with its look and colour", !!sc && sc.material === "vinyl" && sc.materialColor === "#eef0ee" && sc.height === 6);
check("only the drawn house is built — never a neighbour", !!sc && sc.buildings.length === 1 && sc.buildings[0].role === "subject" && sc.buildings[0].heightFt === 22);
check("slope classes come back by segment index (numbers)", !!sc && sc.segClasses?.[0] === "racked" && sc.segClasses?.[2] === "stepped");
check("the land, the wall mount, the lot and its colour ride along", !!sc && sc.terrain?.plan.cols === 20 && sc.wallMounts.length === 1 && sc.lots.length === 1 && sc.lotColor === "#4a9eff");
check("the facts line reads for the client", !!sc && /Cedar privacy · 6 ft · 140 ft · 1 gate/.test(sc.facts), sc?.facts);
check("the build rides along: the client's 3D stands the same posts, rails and boards", !!sc && sc.build.kind === "panel" && sc.build.spacingFt === 8 && sc.build.rails === 2 && sc.build.postCap === "pyramid");
check("a stored build that is off is dropped for the look's own", (() => { const p3 = parseFencePlan({ ...JSON.parse(JSON.stringify(plan)), scene: { ...plan.scene, build: { ...plan.scene.build, spacingFt: 99 } } }); const s3 = p3 ? fenceSceneFromPlan(p3) : null; return !!s3 && s3.build.spacingFt === 8 && s3.build.kind === "panel"; })());

// ── an older plan, no scene
const { scene: _drop, ...older } = plan;
void _drop;
const oldParsed = parseFencePlan(JSON.parse(JSON.stringify(older)));
const oldScene = oldParsed ? fenceSceneFromPlan(oldParsed) : null;
check("an older plan gets its look's build (cedar privacy: stick, 8 ft, three rails at 6 ft)", !!oldScene && oldScene.build.kind === "stick" && oldScene.build.spacingFt === 8 && oldScene.build.rails === 3);
check("a plan without a scene still stands up: flat, default look, plain gates", !!oldScene && oldScene.terrain === null && oldScene.material === "cedar" && oldScene.materialColor === "#b07a47" && oldScene.gates[0].variant === "single" && oldScene.segClasses === null);
check("a house without a stored height gets a sensible one", (() => { const p2 = parseFencePlan({ ...JSON.parse(JSON.stringify(older)), buildings: [{ ring: plan.buildings[0].ring, role: "subject" }] }); const s2 = p2 ? fenceSceneFromPlan(p2) : null; return !!s2 && s2.buildings[0].heightFt === 12; })());

// ── defensive parse
check("a broken scene is no scene, never a crash", parseFencePlanScene({ family: "gold", gates: "x", terrain: { plan: { cols: 2 }, grid: [] } })?.family === "cedar" && parseFencePlanScene({ terrain: { plan: { x0: 0, y0: 0, dx: 8, dy: 8, cols: 3, rows: 2 }, grid: [[1, 2, 3], [1, 2]] } })?.terrain === null);
check("a lattice past the cap is refused by the parser", parseFencePlanScene({ terrain: { plan: { x0: 0, y0: 0, dx: 8, dy: 8, cols: 60, rows: 60 }, grid: grid(60, 60) } })?.terrain === null);

// ── the cap thins evenly
const big = { plan: { x0: 0, y0: 0, dx: 4, dy: 4, cols: 120, rows: 90 }, grid: grid(120, 90) };
const capped = capTerrain(big);
check("a big lattice is thinned to the cap with wider, uniform spacing", capped.plan.cols * capped.plan.rows <= SCENE_TERRAIN_MAX_POINTS && capped.plan.dx === capped.plan.dy && capped.plan.dx > 4 && capped.grid.length === capped.plan.rows && capped.grid[0].length === capped.plan.cols && capped.grid[0][1] === big.grid[0][capped.plan.dx / 4], `${capped.plan.cols}×${capped.plan.rows} @ ${capped.plan.dx} ft`);
const small = { plan: { x0: 0, y0: 0, dx: 8, dy: 8, cols: 20, rows: 25 }, grid: grid(20, 25) };
check("a small lattice is untouched", capTerrain(small) === small);

// ── the convert schema
const base = { title: "Fence", materials: [], labor: [], assumptions: [] };
check("the convert schema takes the plan with its scene", fenceConvertSchema.safeParse({ ...base, plan }).success);
check("…and refuses a lattice whose grid does not match its plan", !fenceConvertSchema.safeParse({ ...base, plan: { ...plan, scene: { ...plan.scene, terrain: { plan: { ...plan.scene.terrain.plan, rows: 24 }, grid: plan.scene.terrain.grid } } } }).success);
check("…and refuses an unknown look or a bad colour", !fenceConvertSchema.safeParse({ ...base, plan: { ...plan, scene: { ...plan.scene, family: "gold" } } }).success && !fenceConvertSchema.safeParse({ ...base, plan: { ...plan, scene: { ...plan.scene, color: "red" } } }).success);
check("…and still takes an older plan without a scene", fenceConvertSchema.safeParse({ ...base, plan: older }).success);
check("…takes the build and refuses one out of range", fenceConvertSchema.safeParse({ ...base, plan }).success && !fenceConvertSchema.safeParse({ ...base, plan: { ...plan, scene: { ...plan.scene, build: { ...plan.scene.build, infill: "lasers" } } } }).success && !fenceConvertSchema.safeParse({ ...base, plan: { ...plan, scene: { ...plan.scene, build: { ...plan.scene.build, spacingFt: 99 } } } }).success);

const round = (p: FencePlan) => JSON.parse(JSON.stringify(p)) as FencePlan;
check("what is stored is what comes back", !!parsed && JSON.stringify(parseFencePlan(round(parsed))) === JSON.stringify(parsed));

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);

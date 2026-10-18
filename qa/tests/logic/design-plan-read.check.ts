// Home Design Studio, the plan reader (2026-10-17): a synthetic architect's sheet — a 24 × 16 ft house drawn the way
// CAD exports draw it (each wall as its outline on a layer named for walls, the glazing on a window layer, the door's
// leaf and swing on a door layer, the room names and the scale note as text) — read back into walls, a window, a hung
// door, two rooms with their names and floor areas. Plus the operator-list walker, the scale note, the room finder.
// Real plan sets aren't checked in (the public repo) — the reader was tuned on three city ADU sets on the stand.
//   npx tsx qa/tests/logic/design-plan-read.check.ts
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readVectorSheet, layerRole, type VSeg, type VArc, type VectorSheet } from "../../../src/lib/design/pdfVector";
import { readPlan, scaleFromText, inchesPerPoint, titleCase } from "../../../src/lib/design/planRead";
import { roomsOf, wallLen, wallPieces, polyArea } from "../../../src/lib/design/geometry";
import { normalizeDesign } from "../../../src/lib/design/normalize";
import type { DesignDoc } from "../../../src/lib/design/model";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("── layer names");
const roles: Array<[string, string]> = [
  ["A-WALL", "wall"], ["EJN - WALLS - N", "wall"], ["EJN - WALL HATCH - N", "wallFill"], ["A-DOOR", "door"], ["EJN - DOORS - N", "door"],
  ["A-GLAZ", "window"], ["EJN - WINDOWS - N", "window"], ["EJN - ELEV. - WINDOW", "elevation"], ["A-ELEV-WALL", "elevation"], ["EJN - CABINETS - N", "cabinet"],
  ["EJN - APPLIANCES - N", "appliance"], ["P-FIXT", "plumbing"], ["EJN - ROOM NAMES - N", "roomName"], ["EJN - DIMS", "dims"], ["0", "other"], ["", "other"],
];
for (const [n, r] of roles) check(`"${n}" → ${r}`, layerRole(n) === r, layerRole(n));

console.log("── the scale note");
check(`stacked "1" over "4" beside " = 1'-0"`, scaleFromText([{ str: "FLOOR PLAN", x: 244, y: 70, h: 26 }, { str: "1", x: 246, y: 85, h: 9.7 }, { str: "4", x: 252, y: 92, h: 9.7 }, { str: `" = 1'-0"`, x: 257, y: 90, h: 13.9 }])?.paperInPerFt === 0.25);
check(`"SCALE: 3/16" = 1'-0""`, scaleFromText([{ str: `SCALE: 3/16" = 1'-0"`, x: 10, y: 10 }])?.paperInPerFt === 3 / 16);
check(`"¼" = 1'-0""`, scaleFromText([{ str: `¼" = 1'-0"`, x: 10, y: 10 }])?.paperInPerFt === 0.25);
check(`"1/8" = 1'-0"" text`, scaleFromText([{ str: `1/8" = 1'-0"`, x: 10, y: 10 }])?.text.includes("1/8") === true);
check("no note → null", scaleFromText([{ str: "KITCHEN", x: 1, y: 1 }]) === null);
check("¼\" scale: 2/3 in a point", Math.abs(inchesPerPoint(0.25) - 2 / 3) < 1e-9);
check(`"(N) KITCHEN" → "Kitchen"`, titleCase("(N) KITCHEN") === "Kitchen");

console.log("── the operator-list walker");
const OPS = pdfjs.OPS as unknown as Record<string, number>;
const ol = {
  fnArray: [OPS.save, OPS.transform, OPS.beginMarkedContentProps, OPS.setLineWidth, OPS.constructPath, OPS.stroke, OPS.endMarkedContent, OPS.restore, OPS.constructPath, OPS.endPath],
  argsArray: [null, [2, 0, 0, 2, 10, 0], ["OC", { type: "OCG", id: "L1" }], [0.5], [[OPS.moveTo, OPS.lineTo], [0, 0, 50, 0]], null, null, null, [[OPS.moveTo, OPS.lineTo], [0, 0, 9, 9]], null],
};
// Page 100 pt high: PDF y up → sheet y down.
const vs = readVectorSheet({ ...ol, OPS, viewport: [1, 0, 0, -1, 0, 100], width: 200, height: 100, layerName: (id) => (id === "L1" ? "A-WALL" : "") });
check("one stroked line kept, an unpainted path dropped", vs.segs.length === 1, String(vs.segs.length));
const s0 = vs.segs[0];
check("transforms applied (scale 2, shift 10, y flipped)", !!s0 && s0.x1 === 10 && s0.y1 === 100 && s0.x2 === 110 && s0.y2 === 100, JSON.stringify(s0));
check("the line weight scales with the transform", !!s0 && Math.abs(s0.w - 1) < 1e-9, String(s0?.w));
check("the layer name rides along", s0?.layer === "A-WALL" && vs.layers["A-WALL"] === 1);

console.log("── a synthetic sheet: a 24 × 16 ft house");
// Drawn in plan inches, put on the sheet at ¼" = 1'-0" (1.5 pt an inch), y down, offset on the sheet.
const PT = 1.5;
const OX = 100;
const OY = 80;
let pathNo = 0;
const segs: VSeg[] = [];
const arcs: VArc[] = [];
const line = (x1: number, y1: number, x2: number, y2: number, layer: string, extra: Partial<VSeg> = {}) =>
  segs.push({ x1: OX + x1 * PT, y1: OY + y1 * PT, x2: OX + x2 * PT, y2: OY + y2 * PT, w: 0.48, layer, path: pathNo++, ...extra });
const rect = (x0: number, y0: number, x1: number, y1: number, layer = "A-WALL") => {
  line(x0, y0, x1, y0, layer);
  line(x1, y0, x1, y1, layer);
  line(x1, y1, x0, y1, layer);
  line(x0, y1, x0, y0, layer);
};
// Exterior 6" walls, the top one broken by a 36" window at x 100–136.
rect(0, 0, 100, 6);
rect(136, 0, 288, 6);
for (const y of [1.5, 3, 4.5]) line(100, y, 136, y, "A-GLAZ");
rect(0, 186, 288, 192);
rect(0, 0, 6, 192);
rect(282, 0, 288, 192);
// A 4½" partition at x 144, broken by a 32" door at y 60–92 hung at the top jamb, swinging to the right.
rect(141.75, 6, 146.25, 60);
rect(141.75, 92, 146.25, 186);
const H = { x: 146.25, y: 60 };
line(H.x, H.y, H.x + 32, H.y, "A-DOOR");
const pts = Array.from({ length: 11 }, (_, i) => {
  const a = (i / 10) * (Math.PI / 2);
  return { x: OX + (H.x + 32 * Math.cos(a)) * PT, y: OY + (H.y + 32 * Math.sin(a)) * PT };
});
const arcPath = pathNo++;
arcs.push({ pts, layer: "A-DOOR", path: arcPath });
for (let i = 1; i < pts.length; i++) segs.push({ x1: pts[i - 1].x, y1: pts[i - 1].y, x2: pts[i].x, y2: pts[i].y, w: 0.24, layer: "A-DOOR", curve: true, path: arcPath });
// A base cabinet run along the left room's top wall.
rect(6, 6, 90, 30, "A-CASEWORK");
// Elevations elsewhere on the sheet are never read as the plan.
for (let i = 0; i < 6; i++) line(400 + i * 8, 300, 400 + i * 8, 360, "A-ELEV-WALL");
const sheet: VectorSheet = { width: 2592, height: 1728, segs, arcs, layers: { "A-WALL": 1 } };
const texts = [
  { str: "FLOOR PLAN", x: OX, y: OY - 40, h: 20 },
  { str: `1/4" = 1'-0"`, x: OX, y: OY - 20, h: 10 },
  { str: "LIVING", x: OX + 72 * PT, y: OY + 120 * PT, h: 8 },
  { str: "BEDROOM", x: OX + 216 * PT, y: OY + 120 * PT, h: 8 },
];
const r = readPlan(sheet, texts, { title: "Test house" });
const d = r.doc;
check("the scale comes from the note", r.scaleText?.includes("1/4") === true && Math.abs(r.inPerPt - 2 / 3) < 1e-9, r.scaleText ?? "");
check("CAD layers recognised", r.layered && d.source?.layers === true);
check("five walls: four outside, one partition", d.walls.length === 5, `${d.walls.length}: ${d.walls.map((w) => `${Math.round(wallLen(w))}/${w.thick}`).join(" ")}`);
const ext = d.walls.filter((w) => w.exterior);
check("the outside walls are marked exterior", ext.length === 4, String(ext.length));
check("outside walls 6 in, the partition 4½ in", ext.every((w) => w.thick === 6) && d.walls.some((w) => !w.exterior && w.thick === 4.5));
// The read's own coordinates start six feet before the walls (its margin): the top wall is the highest horizontal one.
const horiz = d.walls.filter((w) => Math.abs(w.a.y - w.b.y) < 0.5);
const top = horiz.sort((a, b) => a.a.y - b.a.y)[0];
check("the top wall runs the house's width through its window", !!top && Math.abs(wallLen(top) - 282) <= 1, top ? String(wallLen(top)) : "none");
const win = d.openings.find((o) => o.kind === "window");
check("a 36 in window in the top wall", !!win && win.width === 36 && win.wallId === top?.id && win.sill > 0, win ? `${win.width}` : "none");
const door = d.openings.find((o) => o.kind === "door");
check("a 32 in door in the partition", !!door && door.width === 32, door ? `${door.kind} ${door.width}` : "none");
check("…hung on its top jamb, swinging into the right-hand room", door?.hinge === "a" && door?.swing === "left", `${door?.hinge} ${door?.swing}`);
const rooms = roomsOf(d);
check("two rooms", rooms.length === 2, rooms.map((x) => `${x.name}:${x.sqft}`).join(" "));
const living = rooms.find((x) => x.name === "Living");
const bed = rooms.find((x) => x.name === "Bedroom");
check("named from the sheet's text", !!living && !!bed);
// Inside the walls: (141.75 − 6) × (186 − 6) in = 169.7 sq ft each side (less the partition's half).
check("floor areas within 2% of inside the walls", !!living && Math.abs(living.sqft - 169.7) / 169.7 < 0.02 && !!bed && Math.abs(bed.sqft - 169.7) / 169.7 < 0.02, `${living?.sqft} / ${bed?.sqft}`);
check("the cabinet run kept as a plan mark", d.marks.some((m) => m.role === "cabinet" && Math.round(m.box.w) === 84));
const xMax = Math.max(...d.walls.flatMap((w) => [w.a.x, w.b.x]));
const xMin = Math.min(...d.walls.flatMap((w) => [w.a.x, w.b.x]));
check("the elevation lines were not read (the walls span the house only)", xMax - xMin < 290, `${Math.round(xMax - xMin)} in`);

console.log("── a wall cut around a window");
const pieces = top ? wallPieces(top, d.openings) : [];
check("beside, below and above the window", pieces.length === 4, JSON.stringify(pieces.map((p) => [Math.round(p.t0), Math.round(p.t1), p.z0, p.z1])));

console.log("── the rooms walls make");
const tDoc: DesignDoc = {
  v: 1,
  title: "T",
  walls: [
    { id: "a", a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, thick: 6, height: 96 },
    { id: "b", a: { x: 200, y: 0 }, b: { x: 200, y: 120 }, thick: 6, height: 96 },
    { id: "c", a: { x: 200, y: 120 }, b: { x: 0, y: 120 }, thick: 6, height: 96 },
    { id: "d", a: { x: 0, y: 120 }, b: { x: 0, y: 0 }, thick: 6, height: 96 },
    // A partition ending on two walls (T-junctions), and a short one off it making a third room.
    { id: "e", a: { x: 120, y: 0 }, b: { x: 120, y: 120 }, thick: 4.5, height: 96 },
    { id: "f", a: { x: 120, y: 60 }, b: { x: 200, y: 60 }, thick: 4.5, height: 96 },
  ],
  openings: [],
  labels: [{ id: "k", name: "Kitchen", at: { x: 60, y: 60 } }],
  marks: [],
};
const tr = roomsOf(tDoc);
check("T-junctions split walls: three rooms", tr.length === 3, tr.map((x) => `${x.name}:${x.sqft}`).join(" "));
check("the label names its room", tr.some((x) => x.name === "Kitchen" && x.labelId === "k"));
check("unnamed rooms are numbered", tr.filter((x) => /^Space \d$/.test(x.name)).length === 2);
check("every room loop runs the same way round", tr.every((x) => polyArea(x.poly) > 0));

console.log("── a saved design is made safe");
const n = normalizeDesign({ walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 1e9, y: "x" }, thick: 999, height: 5 }], openings: [{ id: "o1", wallId: "nope", kind: "door" }, { id: "o2", wallId: "w1", kind: "portal", width: -4 }], labels: [{ name: "<b>Kitchen</b>\u0000", at: { x: 1, y: 1 } }], title: "" });
check("numbers clamped", n.walls[0].b.x === 100000 && n.walls[0].b.y === 0 && n.walls[0].thick === 36 && n.walls[0].height === 36);
check("an opening on a missing wall dropped, an odd kind made a door", n.openings.length === 1 && n.openings[0].kind === "door" && n.openings[0].width === 6);
check("control characters out of names; a title given", !/\u0000/.test(n.labels[0].name) && n.title === "New design");

console.log(bad ? `\n${bad} failed` : "\nall passed");
process.exit(bad ? 1 : 0);

// The wall's steps from the photo's own pixels (2026-10-23 night, lib/deck/wallSteps): on a drawn back wall — two
// storeys of lap siding, three parts (the middle one nearer the camera, its eave higher in the picture), a corner
// board at each corner, windows in both storeys, and a porch roof on a post over the right part's ground storey — the
// corners are where an edge runs up both storeys (not a window's frame, not the porch post), the middle comes out,
// the porch roof makes no step; a recess reads the other way, a flat wall and a wall with no eave say nothing, a
// mirrored photo says the mirror. Pure, no photo in the repo.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-wall-steps.check.ts
import { wallCorners, wallSteps } from "@/lib/deck/wallSteps";
import type { HouseRead } from "@/lib/deck/houseRead";
import type { Gray } from "@/lib/deck/photoSnap";

let bad = 0;
const check = (name: string, ok: boolean, info = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !info ? "" : `  — ${info}`}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const W = 600;
const H = 520;
const BASE = 440;
type Part = { x0: number; x1: number; eave: number };
type Win = { x0: number; x1: number; head: number; sill: number };

/** A back wall drawn in grey: sky, roof, each part's eave shadow band, siding, corner boards, windows, ground. */
function draw(parts: Part[], wins: Win[], porch: boolean): Gray {
  const d = new Float32Array(W * H);
  const partAt = (x: number) => parts.find((p) => x >= p.x0 && x < p.x1) ?? null;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = partAt(x);
      let v = 0.85; // sky
      if (y >= 110 && x >= parts[0].x0 - 20 && x < parts[parts.length - 1].x1 + 20) v = 0.32; // the roof
      if (p) {
        if (y >= p.eave - 4 && y <= p.eave + 4) v = 0.06; // the eave's shadow band (soffit, fascia, gutter)
        else if (y > p.eave + 4 && y < BASE) v = y % 7 === 0 ? 0.44 : 0.5; // lap siding, its lines across
      }
      if (y >= BASE) v = 0.35; // the ground
      d[y * W + x] = v;
    }
  // Corner boards, up the whole wall.
  for (const p of parts)
    for (const cx of [p.x0, p.x1 - 1])
      for (let y = p.eave + 5; y < BASE; y++) for (let x = cx - 2; x <= cx + 1; x++) if (x >= 0 && x < W) d[y * W + x] = 0.92;
  // Windows: a white frame, dark glass.
  for (const w of wins)
    for (let y = w.head; y <= w.sill; y++)
      for (let x = w.x0; x <= w.x1; x++) d[y * W + x] = y - w.head < 3 || w.sill - y < 3 || x - w.x0 < 3 || w.x1 - x < 3 ? 0.92 : 0.22;
  // A porch roof over the right part's ground storey, on one post past the house's corner.
  if (porch) {
    for (let y = 300; y < 318; y++) for (let x = 372; x < 620; x++) d[y * W + x] = 0.15;
    for (let y = 318; y < BASE; y++) for (let x = 608; x < 613; x++) d[y * W + x] = 0.8;
  }
  return { w: W, h: H, data: d };
}

const fx = (x: number) => Math.round((x / W) * 1000) / 1000;
const fy = (y: number) => Math.round((y / H) * 1000) / 1000;
const WINS: Win[] = [
  { x0: 60, x1: 110, head: 340, sill: 400 },
  { x0: 200, x1: 250, head: 240, sill: 290 },
  { x0: 280, x1: 340, head: 340, sill: 410 },
  { x0: 420, x1: 470, head: 240, sill: 290 },
  { x0: 500, x1: 550, head: 240, sill: 290 },
  { x0: 420, x1: 470, head: 340, sill: 410 },
  { x0: 500, x1: 550, head: 340, sill: 410 },
];
const readOf = (parts: Part[], jogs: HouseRead["jogs"] = []): HouseRead => {
  const e = parts.reduce((m, p) => Math.max(m, p.eave), 0);
  return {
    base: { left: { x: fx(parts[0].x0), y: fy(BASE) }, right: { x: fx(parts[parts.length - 1].x1), y: fy(BASE) } },
    eave: { left: { x: fx(parts[0].x0), y: fy(e) }, right: { x: fx(parts[parts.length - 1].x1), y: fy(e) } },
    storeys: 2,
    jogs,
    door: null,
    doors: [],
    windows: WINS.map((w) => ({ x0: fx(w.x0), x1: fx(w.x1), head: fy(w.head), sill: fy(w.sill) })),
    patio: null,
    roof: { kind: "hip", pitch: 5 },
    material: "lap",
    colours: { siding: null, roof: null, trim: null },
    bars: { top: 0, bottom: 0 },
    confidence: 0.8,
    note: null,
  } as unknown as HouseRead;
};

console.log("— a bump-out in the middle, a porch roof on the right —");
const BUMP: Part[] = [
  { x0: 20, x1: 160, eave: 210 },
  { x0: 160, x1: 380, eave: 198 },
  { x0: 380, x1: 580, eave: 210 },
];
const g = draw(BUMP, WINS, true);
// The model's read, as the live one came: one step at the porch roof's side, the wrong way round, 4 ft.
const misread = readOf(BUMP, [{ x: fx(380), y: fy(BASE), dir: "toward", depthFt: 4 }]);
const corners = wallCorners(misread, g);
check("the corners are where an edge runs up both storeys — not a window's frame, not the porch post", corners.length === 2 && near(corners[0], fx(160), 0.01) && near(corners[1], fx(380), 0.01), JSON.stringify(corners));
const st = wallSteps(misread, g, { depthFt: 3 })!;
check("it finds the steps", !!st);
// (The main wall is the widest part — here the middle — so the sides read as back from it: the same wall.)
const plane = (p: (typeof st.parts)[number]) => (p.state === "out" ? 1 : p.state === "back" ? -1 : 0);
check("the middle stands out of both sides, the two sides on one plane", plane(st.parts[1]) > plane(st.parts[0]) && plane(st.parts[1]) > plane(st.parts[2]) && plane(st.parts[0]) === plane(st.parts[2]), JSON.stringify(st.parts));
check("two steps: out at the left corner, back at the right — at the model's depth", st.jogs.length === 2 && st.jogs[0].dir === "toward" && st.jogs[1].dir === "away" && st.jogs.every((j) => j.depthFt === 3), JSON.stringify(st.jogs));
check("the middle's eave sits higher in the picture than the sides' by what was drawn (12 px)", near(st.parts[0].shiftPx - st.parts[1].shiftPx, 12, 1.5) && near(st.parts[2].shiftPx - st.parts[1].shiftPx, 12, 1.5), st.parts.map((p) => p.shiftPx).join(","));
check("without the model's depth, none is made up (the house's usual 2 ft, said to be a guess)", wallSteps(misread, g)!.jogs.every((j) => j.depthFt === null));
check("the read's own steps don't change what the photo says", JSON.stringify(wallSteps(readOf(BUMP), g)!.jogs.map((j) => j.dir)) === JSON.stringify(st.jogs.map((j) => j.dir)));
// The read's eave line a little off (the model's lines are), and the walls' corners a little in.
const off = readOf(BUMP);
const shifted = { ...off, eave: { left: { x: off.eave!.left.x + 0.01, y: off.eave!.left.y - 0.02 }, right: { x: off.eave!.right.x - 0.01, y: off.eave!.right.y - 0.02 } }, base: { left: { x: off.base.left.x + 0.01, y: off.base.left.y + 0.01 }, right: { x: off.base.right.x - 0.01, y: off.base.right.y + 0.01 } } };
const st2 = wallSteps(shifted, g);
check("the read's lines a little off: the same steps", !!st2 && st2.jogs.map((j) => j.dir).join(",") === "toward,away", JSON.stringify(st2?.parts));

console.log("— the other way round, flat, unreadable, mirrored —");
const NOOK: Part[] = [
  { x0: 20, x1: 160, eave: 210 },
  { x0: 160, x1: 380, eave: 222 },
  { x0: 380, x1: 580, eave: 210 },
];
const nook = wallSteps(readOf(NOOK), draw(NOOK, WINS, false));
check("a recess in the middle (its eave lower): back at the left corner, out at the right", !!nook && nook.jogs.map((j) => j.dir).join(",") === "away,toward", JSON.stringify(nook?.parts));
const FLAT: Part[] = BUMP.map((p) => ({ ...p, eave: 210 }));
check("a flat wall with its corner boards says nothing (the model's read stands)", wallSteps(readOf(FLAT), draw(FLAT, WINS, true)) === null);
check("no eave read, nothing said", wallSteps({ ...misread, eave: null }, g) === null);
const blank: Gray = { w: W, h: H, data: new Float32Array(W * H).fill(0.5) };
check("a picture with nothing in it says nothing", wallSteps(misread, blank) === null);
// The same wall, the picture flipped left for right.
const flip: Gray = { w: W, h: H, data: new Float32Array(W * H) };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) flip.data[y * W + x] = g.data[y * W + (W - 1 - x)];
const mx = (x: number) => Math.round((1 - x) * 1000) / 1000;
const m = readOf(BUMP);
const mirror = { ...m, base: { left: { x: mx(m.base.right.x), y: m.base.right.y }, right: { x: mx(m.base.left.x), y: m.base.left.y } }, eave: { left: { x: mx(m.eave!.right.x), y: m.eave!.right.y }, right: { x: mx(m.eave!.left.x), y: m.eave!.left.y } }, windows: m.windows.map((w) => ({ ...w, x0: mx(w.x1), x1: mx(w.x0) })) };
const ms = wallSteps(mirror, flip);
check("the photo mirrored: the steps mirrored", !!ms && ms.jogs.map((j) => j.dir).join(",") === "toward,away" && near(ms.jogs[0].x, mx(fx(380)), 0.01) && near(ms.jogs[1].x, mx(fx(160)), 0.01), JSON.stringify(ms?.jogs));
// Speed: the browser runs it on a picture up to 1000 px across.
const big: Gray = { w: 1000, h: 870, data: new Float32Array(1000 * 870).fill(0.5) };
const t0 = Date.now();
wallSteps({ ...misread, base: { left: { x: 0.05, y: 0.8 }, right: { x: 0.95, y: 0.8 } }, eave: { left: { x: 0.05, y: 0.3 }, right: { x: 0.95, y: 0.3 } } }, big);
check("fast enough for the browser (a 1000-px picture well under a second)", Date.now() - t0 < 800, `${Date.now() - t0} ms`);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);

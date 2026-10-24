// The wall's steps from the photo's own pixels (2026-10-23 night, lib/deck/wallSteps): on a drawn back wall — two
// storeys of lap siding, three parts (the middle one nearer the camera, its eave higher in the picture), a corner
// board at each corner, windows in both storeys, and a porch roof on a post over the right part's ground storey — the
// corners are where an edge runs up both storeys (not a window's frame, not the porch post), the middle comes out,
// the porch roof makes no step; a recess reads the other way, a flat wall and a wall with no eave say nothing, a
// mirrored photo says the mirror; the eave is found by the picture when the model's line is well off it; the model's
// lines leaning change nothing, a square-on shot is told from an angled one by its rows of windows (2026-10-24). Pure,
// no photo in the repo.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-wall-steps.check.ts
import { SQUARE_ON_PCT, levelRead, photoObliqueness, wallCorners, wallSlope, wallSteps } from "@/lib/deck/wallSteps";
import { mapHouseRead, type HouseRead } from "@/lib/deck/houseRead";
import { applyHomography, autoRectify, homography, invertHomography, obliqueness, transformRead } from "@/lib/deck/photoFit";
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
// The model's eave line a good way off — drawn under the soffit (3.5% of the picture low) or up on the roof (5% high),
// as the live model drew it: the eave is found by the picture, not by the line. (2026-10-24: with the line 3% low the
// bump-out's band fell at the edge of the search and nothing was said; the model's one-step read stood.)
for (const dy of [0.035, -0.05]) {
  const far = { ...off, eave: { left: { ...off.eave!.left, y: off.eave!.left.y + dy }, right: { ...off.eave!.right, y: off.eave!.right.y + dy } } };
  const stf = wallSteps(far, g);
  check(`the read's eave line ${dy > 0 ? "well under" : "well above"} the eave (${Math.abs(dy) * 100}% of the picture): the same steps`, !!stf && stf.jogs.length === st.jogs.length && stf.jogs.every((j, i) => j.dir === st.jogs[i].dir && near(j.x, st.jogs[i].x, 0.01)), JSON.stringify(stf?.jogs));
}

console.log("— the model's lines leaning; square-on or angled, by the photo —");
// The live read's eave line leaned (owner's photo, 2026-10-24): read along it, each part's band moved by more than the
// bump-out's step and the middle read level. The rows are read along the windows' heads now.
for (const lean of [0.03, -0.03]) {
  const leant = { ...off, eave: { left: { ...off.eave!.left, y: off.eave!.left.y - lean / 2 }, right: { ...off.eave!.right, y: off.eave!.right.y + lean / 2 } } };
  const sl = wallSteps(leant, g);
  check(`the read's eave line leaning ${lean * 100}% of the picture across the wall: the same steps`, !!sl && sl.jogs.map((j) => j.dir).join(",") === "toward,away" && near(sl.jogs[0].x, fx(160), 0.01) && near(sl.jogs[1].x, fx(380), 0.01), JSON.stringify(sl?.parts));
}
check("the wall's way across the picture, from its windows' heads: level", wallSlope(off, g, corners) === 0, String(wallSlope(off, g, corners)));
// Square-on, the model's lines leaning enough to look like an angled shot (it was "straightened", its corners leaned,
// no step was read): the photo's own rows of windows run parallel — square.
const leaning = { ...off, eave: { left: { ...off.eave!.left, y: off.eave!.left.y - 0.02 }, right: { ...off.eave!.right, y: off.eave!.right.y + 0.02 } } };
const seen = photoObliqueness(leaning, g);
check("square-on, the model's lines leaning as if angled: the photo says square", (obliqueness(leaning) ?? 0) >= 8 && !!seen && seen.obliquePct < SQUARE_ON_PCT, `model ${obliqueness(leaning)}%, photo ${JSON.stringify(seen)}`);
const levelled = levelRead(leaning, seen?.slope ?? 0, g);
check("levelled to the photo's way: the eave and the base run parallel, nothing to straighten", obliqueness(levelled) === 0 && autoRectify(levelled, W, H) === null, `${obliqueness(levelled)}%`);
// A wall shot from one side: the same wall, its right end a fifth shorter in the picture. Still straightened.
const side = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], [{ x: 0, y: 0 }, { x: W, y: H * 0.1 }, { x: W, y: H * 0.9 }, { x: 0, y: H }])!;
const inv = invertHomography(side)!;
const angled: Gray = { w: W, h: H, data: new Float32Array(W * H) };
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const q = applyHomography(inv, { x, y });
    const x0 = Math.floor(q.x);
    const y0 = Math.floor(q.y);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= W || y0 + 1 >= H) continue;
    const ax = q.x - x0;
    const ay = q.y - y0;
    const at = (xx: number, yy: number) => g.data[yy * W + xx];
    angled.data[y * W + x] = at(x0, y0) * (1 - ax) * (1 - ay) + at(x0 + 1, y0) * ax * (1 - ay) + at(x0, y0 + 1) * (1 - ax) * ay + at(x0 + 1, y0 + 1) * ax * ay;
  }
const angledRead = mapHouseRead(off, (r) => transformRead(r, side, W, H, W, H) as never, (p) => {
  const q = applyHomography(side, { x: p.x * W, y: p.y * H });
  return { x: q.x / W, y: q.y / H };
});
const seenAngled = photoObliqueness(angledRead, angled);
const truth = obliqueness(angledRead) ?? 0;
check("a wall shot from one side: the photo says so — nowhere near square", truth >= 15 && !!seenAngled && seenAngled.obliquePct >= SQUARE_ON_PCT * 2 && near(seenAngled.obliquePct, truth, 6), `truth ${truth}%, photo ${JSON.stringify(seenAngled)}`);
check("one row of windows, or none: the photo doesn't say (the model's lines decide)", photoObliqueness({ ...off, windows: off.windows.filter((w) => w.head > fy(300)) }, g) === null && photoObliqueness({ ...off, windows: [] }, g) === null);

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

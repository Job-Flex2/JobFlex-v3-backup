// The read lined up with the photo (2026-10-23, lib/deck/photoSnap) and the wall's steps from its sections
// (lib/deck/houseRead): on a drawn wall — grey lap siding with its courses, framed windows in rows, a wall corner — a
// read off the way the live model was (every box shifted, shrunk, a row of four as one box running past the row) comes
// back on the frames, the row split into its four and the stretch of siding it ran over left out, no two windows
// overlapping; a read already right stays; a plain wall moves nothing. Windows with a rail across them low down come
// back whole, not head-to-rail; the eave isn't pulled onto the window heads. The sections: a bump-out between two stretches of the main wall is two steps, out
// and back; one section is a flat wall whatever steps a model lists; a porch roof makes no section. Pure.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-photo-snap.check.ts
import { snapRead, splitRow, gradients, type Gray } from "@/lib/deck/photoSnap";
import { parseHouseRead, type HouseRead } from "@/lib/deck/houseRead";

let bad = 0;
const check = (name: string, ok: boolean, info = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !info ? "" : `  — ${info}`}`);
};

// ── A drawn wall: 900 × 600 px, siding 0.45 with a darker course every 9 px and a little noise; windows a white frame
// 4 px wide around dark glass; the wall's left corner a dark board at x = 60.
const W = 900;
const H = 600;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function wall(windows: Array<[number, number, number, number]>): Gray {
  const data = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = x < 60 ? 0.78 : 0.45 + (y % 9 === 0 ? -0.06 : 0) + (rnd() - 0.5) * 0.02;
  for (let y = 0; y < H; y++) for (let x = 56; x < 64; x++) data[y * W + x] = 0.2;
  for (const [x0, y0, x1, y1] of windows) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const frame = x < x0 + 4 || x >= x1 - 4 || y < y0 + 4 || y >= y1 - 4;
      data[y * W + x] = frame ? 0.95 : 0.18 + (rnd() - 0.5) * 0.04;
    }
  }
  return { w: W, h: H, data };
}
// Two rows: a row of four at the top (each 50 × 70, frames 8 px apart), three single windows below.
const ROW: Array<[number, number, number, number]> = [0, 1, 2, 3].map((i) => [400 + i * 58, 120, 450 + i * 58, 190]);
const SINGLES: Array<[number, number, number, number]> = [[150, 300, 205, 390], [260, 300, 315, 390], [520, 300, 575, 390]];
const g = wall([...ROW, ...SINGLES]);
const fx = (px: number) => px / W;
const fy = (py: number) => py / H;
const box = ([x0, y0, x1, y1]: [number, number, number, number]) => ({ x0: fx(x0), x1: fx(x1), head: fy(y0), sill: fy(y1) });
const truth = [...ROW, ...SINGLES].map(box);
const read0 = (windows: HouseRead["windows"]): HouseRead =>
  parseHouseRead({ base: { left: { x: fx(60), y: 0.9 }, right: { x: fx(860), y: 0.9 } }, eave: { left: { x: fx(60), y: 0.1 }, right: { x: fx(860), y: 0.1 } }, storeys: 2, jogs: [], doors: [], windows, confidence: 0.6 })!;

// Row by row (a head a pixel or two off is the same row), then left to right.
const sortW = (ws: HouseRead["windows"]) => ws.slice().sort((a, b) => Math.round(a.head * 20) - Math.round(b.head * 20) || a.x0 - b.x0);
const worst = (a: HouseRead["windows"], b: HouseRead["windows"]) => {
  if (a.length !== b.length) return Infinity;
  const A = sortW(a), B = sortW(b);
  return Math.max(...A.map((w, i) => Math.max(Math.abs(w.x0 - B[i].x0) * W, Math.abs(w.x1 - B[i].x1) * W, Math.abs(w.head - B[i].head) * H, Math.abs(w.sill - B[i].sill) * H)));
};

console.log("— a read already right —");
const right = snapRead(read0(truth), g);
check("stays where it is (within 3 px), nothing split", worst(right.read.windows, truth) <= 3 && right.split === 0, String(worst(right.read.windows, truth)));

console.log("— the live model's mistakes —");
// Every single box shifted right 26 px and down 8, shrunk to 80 %; the row of four as ONE box, shifted too, running 30 px past the row.
const off = (w: HouseRead["windows"][number]) => {
  const cx = (w.x0 + w.x1) / 2 + fx(26), cy = (w.head + w.sill) / 2 + fy(8), hw = ((w.x1 - w.x0) / 2) * 0.8, hh = ((w.sill - w.head) / 2) * 0.8;
  return { x0: cx - hw, x1: cx + hw, head: cy - hh, sill: cy + hh };
};
const wrong = read0([...SINGLES.map(box).map(off), { x0: fx(400 + 26), x1: fx(624 + 26 + 30), head: fy(120 + 8 + 6), sill: fy(190 + 8 - 6) }]);
check("the wrong read is far off (the live screenshot's kind of miss)", worst(wrong.windows, truth) === Infinity && wrong.windows.length === 4);
const fixed = snapRead(wrong, g);
check("lined up: the row split into its four, the siding it ran over left out — seven windows", fixed.read.windows.length === 7 && fixed.split >= 3, `${fixed.read.windows.length} windows, ${fixed.split} split`);
check("every window back on its frame (within 4 px)", worst(fixed.read.windows, truth) <= 4, String(worst(fixed.read.windows, truth)));

const sideBySide = sortW(fixed.read.windows).filter((w) => w.head < 0.4);
check("no two windows of the row overlap", sideBySide.every((w, i) => i === 0 || w.x0 >= sideBySide[i - 1].x1), sideBySide.map((w) => `${(w.x0 * W).toFixed(0)}–${(w.x1 * W).toFixed(0)}`).join(" "));
check("the eave stays where the model put it — not on the window heads below it", Math.abs(fixed.read.eave!.left.y - 0.1) < 0.002, String(fixed.read.eave!.left.y));

console.log("— a rail across the window —");
// Four windows 60 × 130 with a 4 px white rail 96 px down (a picture window over an awning sash, the owner's photo's
// lower row): read shrunk to 75 % and 15 px high, each box sits head-to-rail — the whole window must win.
const TALL: Array<[number, number, number, number]> = [150, 300, 450, 600].map((x) => [x, 200, x + 60, 330]);
const railed = wall(TALL);
for (const [x0, y0, x1] of TALL) for (let y = y0 + 94; y < y0 + 98; y++) for (let x = x0; x < x1; x++) railed.data[y * W + x] = 0.95;
const short = read0(TALL.map(box).map((w) => {
  const cx = (w.x0 + w.x1) / 2, cy = (w.head + w.sill) / 2 - fy(15), hw = ((w.x1 - w.x0) / 2) * 0.75, hh = ((w.sill - w.head) / 2) * 0.75;
  return { x0: cx - hw, x1: cx + hw, head: cy - hh, sill: cy + hh };
}));
const whole = snapRead(short, railed);
check("each window back whole, head to sill (within 4 px)", worst(whole.read.windows, TALL.map(box)) <= 4, String(worst(whole.read.windows, TALL.map(box))));

console.log("— a row split, alone —");
const { gx, gy } = gradients(g);
const field = { w: W, h: H, gx, gy };
const parts = splitRow(field, { x0: fx(400), x1: fx(624), top: fy(120), bottom: fy(190) });
check("a box over the row of four comes back as four", parts.length === 4, String(parts.length));
check("one window stays one", splitRow(field, { x0: fx(150), x1: fx(205), top: fy(300), bottom: fy(390) }).length === 1);
const flat = wall([]);
const { gx: fgx, gy: fgy } = gradients(flat);
check("a box over plain siding is not split into windows", splitRow({ w: W, h: H, gx: fgx, gy: fgy }, { x0: fx(400), x1: fx(624), top: fy(120), bottom: fy(190) }).length === 1);
const still = snapRead(read0([{ x0: fx(400), x1: fx(450), head: fy(120), sill: fy(190) }]), flat);
check("on a wall without windows, a box is not dragged anywhere", Math.abs(still.read.windows[0].x0 - fx(400)) * W <= 1 && Math.abs(still.read.windows[0].head - fy(120)) * H <= 1);

console.log("— the wall's corner —");
const corner = snapRead({ ...read0(truth), base: { left: { x: fx(75), y: 0.9 }, right: { x: fx(860), y: 0.9 } } }, g);
check("the wall's left corner moves onto its corner board", Math.abs(corner.read.base.left.x * W - 60) <= 5, String(corner.read.base.left.x * W));

console.log("— rows as rows, the whole window (2026-10-24: 'make windows read right — and shape') —");
// The live model read a row of four one pane to the right (three boxes on panes, the fourth past the row), the lower
// windows short (sills 40 px high), a pane missing from a row, a box past the wall's end.
const rowOf = (ws: HouseRead["windows"]) => ws.filter((w) => w.head < 0.3);
const shiftedRow = snapRead(read0(truth.map((w) => (w.head < 0.3 ? { ...w, x0: w.x0 + 58 / W, x1: w.x1 + 58 / W } : w))), g);
check("a row of four read one pane to the right comes back on its four frames (within 4 px)", shiftedRow.read.windows.length === 7 && worst(shiftedRow.read.windows, truth) <= 4, `${shiftedRow.read.windows.length} windows, worst ${worst(shiftedRow.read.windows, truth)}`);
const squat = snapRead(read0(truth.map((w) => (w.head > 0.3 ? { ...w, sill: w.sill - 40 / H } : w))), g);
check("windows read short — sills 40 px high — grow to their sills (within 4 px)", squat.read.windows.length === 7 && worst(squat.read.windows, truth) <= 4, `${squat.read.windows.length} windows, worst ${worst(squat.read.windows, truth)}`);
const sash = snapRead(read0(truth.map((w) => (w.head > 0.3 ? { ...w, sill: w.head + (w.sill - w.head) * 0.45 } : w))), g);
check("a window read as its upper sash alone comes back whole", worst(sash.read.windows, truth) <= 4, String(worst(sash.read.windows, truth)));
const missing = snapRead(read0(truth.filter((w) => !(w.head < 0.3 && w.x0 * W > 570))), g);
check("a pane the model missed at a row's end is added — four again", rowOf(missing.read.windows).length === 4 && worst(missing.read.windows, truth) <= 4, `${rowOf(missing.read.windows).length} in the row, worst ${worst(missing.read.windows, truth)}`);
const phantom = snapRead(read0([...truth, box([20, 300, 58, 390])]), g);
check("a box past the wall's end is dropped", phantom.read.windows.length === 7 && worst(phantom.read.windows, truth) <= 4, `${phantom.read.windows.length} windows`);
const stillRight = snapRead(read0(truth), g);
check("a read already right still stays (rows and growth change nothing)", worst(stillRight.read.windows, truth) <= 3, String(worst(stillRight.read.windows, truth)));

console.log("— the steps from the wall's sections —");
const base = { base: { left: { x: 0.05, y: 0.8 }, right: { x: 0.95, y: 0.8 } }, eave: { left: { x: 0.05, y: 0.3 }, right: { x: 0.95, y: 0.3 } }, storeys: 2, windows: [], doors: [] };
const bump = parseHouseRead({ ...base, sections: [{ x0: 0.05, x1: 0.2, outFt: 0 }, { x0: 0.2, x1: 0.5, outFt: 2 }, { x0: 0.5, x1: 0.95, outFt: 0 }], jogs: [{ x: 0.55, dir: "toward", depthFt: 6 }] })!;
check("a bump-out between two stretches of the main wall: out 2 ft at 0.2, back 2 ft at 0.5 — the model's own wrong step ignored", bump.jogs.length === 2 && bump.jogs[0].dir === "toward" && bump.jogs[0].depthFt === 2 && Math.abs(bump.jogs[0].x - 0.2) < 0.005 && bump.jogs[1].dir === "away" && Math.abs(bump.jogs[1].x - 0.5) < 0.005, JSON.stringify(bump.jogs));
const one = parseHouseRead({ ...base, sections: [{ x0: 0.05, x1: 0.95, outFt: 0 }], jogs: [{ x: 0.55, dir: "toward", depthFt: 6 }] })!;
check("one section is a flat wall, whatever steps a model lists", one.jogs.length === 0);
const none = parseHouseRead({ ...base, jogs: [{ x: 0.55, dir: "toward", depthFt: 3 }] })!;
check("without sections, the model's own steps stand", none.jogs.length === 1);
const tiny = parseHouseRead({ ...base, sections: [{ x0: 0.05, x1: 0.5, outFt: 0 }, { x0: 0.5, x1: 0.95, outFt: 0.3 }] })!;
check("a section a few inches out is no step", tiny.jogs.length === 0);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);

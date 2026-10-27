// The read lined up with the photo (2026-10-23, lib/deck/photoSnap) and the wall's steps from its sections
// (lib/deck/houseRead): on a drawn wall — grey lap siding with its courses, framed windows in rows, a wall corner — a
// read off the way the live model was (every box shifted, shrunk, a row of four as one box running past the row) comes
// back on the frames, the row split into its four and the stretch of siding it ran over left out, no two windows
// overlapping; a read already right stays; a plain wall moves nothing. Windows with a rail across them low down come
// back whole, not head-to-rail; the eave isn't pulled onto the window heads. The sections: a bump-out between two stretches of the main wall is two steps, out
// and back; one section is a flat wall whatever steps a model lists; a porch roof makes no section. Pure.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-photo-snap.check.ts
import { snapRead, splitRow, gradients, findWindows, type Gray } from "@/lib/deck/photoSnap";
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
check("lined up: the row's four and the three singles — seven windows, the siding the model's box ran over left out (the picture's own windows now, no split needed)", fixed.read.windows.length === 7, `${fixed.read.windows.length} windows, ${fixed.split} split`);
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

console.log("— the windows off the picture itself (2026-10-25: 'why is it still wrong, the windows are from the pic') —");
// With no model boxes at all, the picture's own windows: the row's four and the three singles, each on its frame.
{
  const { gx: wx, gy: wy } = gradients(g);
  const found = findWindows(read0([]), g, { w: W, h: H, gx: wx, gy: wy, lum: g.data });
  const asWins = found.map((b) => ({ x0: b.x0, x1: b.x1, head: b.top, sill: b.bottom }));
  check("the picture alone gives the seven windows, each on its frame (within 4 px)", found.length === 7 && worst(asWins, truth) <= 4, `${found.length} found, worst ${worst(asWins, truth)}`);
  const none = snapRead(read0([]), g);
  check("a read with no windows at all comes back with the picture's seven", none.read.windows.length === 7 && none.found === 7 && worst(none.read.windows, truth) <= 4, `${none.read.windows.length} windows, found ${none.found}`);
  const bad = snapRead(read0([box([100, 150, 180, 230]), box([700, 400, 760, 470]), ...truth.slice(0, 2).map((w) => ({ ...w, x0: w.x0 + 30 / W, x1: w.x1 + 30 / W }))]), g);
  check("the model's boxes over siding and off their frames are left aside for the picture's own", bad.read.windows.length === 7 && worst(bad.read.windows, truth) <= 4, `${bad.read.windows.length} windows, worst ${worst(bad.read.windows, truth)}`);
  const plain = snapRead(read0([box([150, 300, 205, 390])]), wall([[150, 300, 205, 390]]));
  check("on a wall with one window the model's box is still lined up the old way (fewer than three found)", plain.found === 0 && plain.read.windows.length === 1 && worst(plain.read.windows, [box([150, 300, 205, 390])]) <= 4, `found ${plain.found}, worst ${worst(plain.read.windows, [box([150, 300, 205, 390])])}`);
}

console.log("— the scale off the picture: one storey between the rows of windows (2026-10-25) —");
{
  // The drawn wall's two rows: the row of four up top (heads at 120) and the singles below (heads at 300) — one storey
  // of 180 px between their heads, a measure the model's lines can't spoil.
  const sized = snapRead(read0(truth), g);
  const sl = sized.read.scaleLine;
  check("two rows of windows give a measure: one storey, head to head, 9 ft 6 in.", !!sl && sl.kind === "storey" && sl.lengthIn === 114 && Math.abs(sl.a.y * H - 120) <= 3 && Math.abs(sl.b.y * H - 300) <= 3, JSON.stringify(sl));
  check("and the storeys read as two", sized.read.storeys === 2);
  // The drawn wall has no ground line and no eave band: the model's lines stand.
  check("with no ground edge and no eave band in the picture, the model's base and eave stand", Math.abs(sized.read.base.left.y - 0.9) < 0.004 && Math.abs(sized.read.eave!.left.y - 0.1) < 0.004, `${sized.read.base.left.y} ${sized.read.eave!.left.y}`);
  // The model's base read far too high — on a porch roof, above the lower row: the lower windows are still found.
  const highBase = snapRead(read0(truth.slice(0, 4)).base ? { ...read0(truth), base: { left: { x: fx(60), y: 0.45 }, right: { x: fx(860), y: 0.45 } } } : read0(truth), g);
  check("a base read above the lower row still finds all seven windows and the storey", highBase.read.windows.length === 7 && highBase.read.scaleLine?.kind === "storey", `${highBase.read.windows.length} windows, ${JSON.stringify(highBase.read.scaleLine)}`);
  // A door the model drew over the picture's windows is no door.
  const doored = snapRead({ ...read0(truth), doors: [{ x0: fx(150), x1: fx(205), top: fy(300), bottom: fy(390), kind: "slider" }], door: { x0: fx(150), x1: fx(205), top: fy(300), bottom: fy(390) } } as never, g);
  check("a door drawn over a window is dropped", doored.read.doors.length === 0 && doored.read.door === null, `${doored.read.doors.length} doors`);
}

console.log("— a house with a garage (2026-10-26 evening: 'didn't make the door, didn't include all the windows, missed the garage') —");
{
  // The split-level's front: four windows in two rows, an entry door (a white slab with a dark lite) and a two-car
  // garage door (a light panel with six recessed sections) — the GPT-6 read right, on their frames. The pixel pass
  // sees the garage's sections, the door's lite and the siding between as "windows": they must not take the model's
  // place, the door must stay, and the base must not fall to the garage door's foot.
  const WIN: Array<[number, number, number, number]> = [[150, 120, 210, 180], [400, 120, 455, 180], [470, 120, 525, 180], [150, 300, 210, 360]];
  const gar = wall(WIN);
  const DOOR: [number, number, number, number] = [290, 230, 330, 320];
  for (let y = DOOR[1]; y < DOOR[3]; y++) for (let x = DOOR[0]; x < DOOR[2]; x++) gar.data[y * W + x] = 0.92;
  for (let y = DOOR[1] + 12; y < DOOR[1] + 42; y++) for (let x = DOOR[0] + 10; x < DOOR[2] - 10; x++) gar.data[y * W + x] = 0.2;
  const GAR: [number, number, number, number] = [430, 280, 720, 400];
  for (let y = GAR[1]; y < GAR[3]; y++) for (let x = GAR[0]; x < GAR[2]; x++) gar.data[y * W + x] = 0.88;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) for (let y = GAR[1] + 15 + r * 55; y < GAR[1] + 55 + r * 55; y++) for (let x = GAR[0] + 15 + c * 95; x < GAR[0] + 90 + c * 95; x++) gar.data[y * W + x] = 0.62;
  const doors = [{ x0: fx(DOOR[0]), x1: fx(DOOR[2]), top: fy(DOOR[1]), bottom: fy(DOOR[3]), kind: "hinged" as const }, { x0: fx(GAR[0]), x1: fx(GAR[2]), top: fy(GAR[1]), bottom: fy(GAR[3]), kind: "garage" as const }];
  const model = { ...read0(WIN.map(box)), base: { left: { x: fx(60), y: fy(400) }, right: { x: fx(860), y: fy(400) } }, doors, door: { x0: doors[0].x0, x1: doors[0].x1, top: doors[0].top, bottom: doors[0].bottom } } as HouseRead;
  const { gx: ggx, gy: ggy } = gradients(gar);
  const blobs = findWindows(model, gar, { w: W, h: H, gx: ggx, gy: ggy, lum: gar.data });
  check("the pixel pass alone sees more than the four windows (the garage's sections, the lite)", blobs.length > 4, `${blobs.length} blobs`);
  const kept = snapRead(model, gar);
  check("the model's four windows stand, each on its frame (within 4 px) — the picture's blobs do not take their place", kept.found === 0 && kept.read.windows.length === 4 && worst(kept.read.windows, WIN.map(box)) <= 4, `found ${kept.found}, ${kept.read.windows.length} windows, worst ${worst(kept.read.windows, WIN.map(box))}`);
  check("the door stays (its own lite is no window), and so does the garage door", kept.read.doors.length === 2 && kept.read.doors[0].kind === "hinged" && kept.read.doors[1].kind === "garage" && !!kept.read.door, `${kept.read.doors.length} doors`);
  check("the base stays on the wall's foot — not dragged onto the garage door's edge", Math.abs(kept.read.base.left.y * H - 400) <= 6, String(kept.read.base.left.y * H));
}

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

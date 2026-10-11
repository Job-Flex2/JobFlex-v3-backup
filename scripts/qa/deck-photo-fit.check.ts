// The smart fit of the deck on the photo of the house (2026-10-10, lib/deck/photoFit):
// the read checked, the scale from the door, the wall's parts and its recess, the
// crop to the wall, the placement at the door (else the recess, the patio, the
// longest run), an L's notch on the step it wraps, the height the door asks for,
// the window sill in the way, the offer when the house steps into the deck, the
// read kept in the cropped picture, and the black bands of a screenshot. Pure.
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/deck-photo-fit.check.ts
import {
  anchorOn,
  baseYAt,
  cropForWall,
  fitPhoto,
  fitSummary,
  heightFromDoor,
  jogOffer,
  letterboxRows,
  lowestSillIn,
  parseWallRead,
  placeOnWall,
  placedInCrop,
  readInCrop,
  recessOf,
  scaleFromRead,
  shapeWithOffer,
  wallSegments,
  type FitDeck,
} from "../../src/lib/deck/photoFit";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// The stand's synthetic house, already trimmed of its bands: 1600 × 960.
const W = 1600;
const H = 960;
const RAW = {
  base: { left: { x: 0.125, y: 0.8125 }, right: { x: 0.875, y: 0.8125 } },
  eave: { left: { x: 0.125, y: 0.2708 }, right: { x: 0.875, y: 0.2708 } },
  storeys: 1,
  jogs: [{ x: 0.625, y: 0.8125, dir: "toward", depthFt: 4 }],
  door: { x0: 0.35, x1: 0.4375, bottom: 0.6979, top: 0.4271 },
  windows: [
    { x0: 0.5625, x1: 0.65625, sill: 0.5417, head: 0.4167 },
    { x0: 0.71875, x1: 0.8125, sill: 0.5417, head: 0.4167 },
  ],
  patio: null,
  bars: { top: 0, bottom: 0 },
  confidence: 0.86,
  note: null,
};
const rect: FitDeck = { shape: { kind: "rect", widthFt: 16, depthFt: 12 }, depthFt: 12, elevWidthFt: 16, elevHeightFt: 6.5, elevLeftFt: 0 };
const rectOf = (widthFt: number, depthFt = 12): FitDeck => ({ shape: { kind: "rect", widthFt, depthFt }, depthFt, elevWidthFt: widthFt, elevHeightFt: 6.5, elevLeftFt: 0 });

// ── the read, checked
const read = parseWallRead(RAW)!;
check("a good read parses", !!read && read.door !== null && read.windows.length === 2 && read.jogs.length === 1 && read.patio === null);
check("garbage is refused", parseWallRead(null) === null && parseWallRead({ base: { left: { x: 0.2, y: 0.5 } } }) === null && parseWallRead({ base: { left: { x: 0.5, y: 0.8 }, right: { x: 0.55, y: 0.8 } } }) === null);
const swapped = parseWallRead({ ...RAW, base: { left: RAW.base.right, right: RAW.base.left } })!;
check("ends given right-to-left are turned around", swapped.base.left.x === 0.125 && swapped.base.right.x === 0.875);
check("a jog off the wall is dropped", parseWallRead({ ...RAW, jogs: [{ x: 0.05, dir: "toward" }] })!.jogs.length === 0);
check("a 'door' wider than it is tall is not a door", parseWallRead({ ...RAW, door: { x0: 0.3, x1: 0.6, bottom: 0.7, top: 0.68 } })!.door === null);
check("an eave below the base is no eave", parseWallRead({ ...RAW, eave: { left: { x: 0.125, y: 0.9 }, right: { x: 0.875, y: 0.9 } } })!.eave === null);
check("a patio reads as a span", parseWallRead({ ...RAW, patio: { x0: 0.8, x1: 0.6 } })!.patio?.x0 === 0.6);
check("the base y reads along a tilted wall", near(baseYAt(parseWallRead({ ...RAW, base: { left: { x: 0, y: 0.8 }, right: { x: 1, y: 0.9 } } })!, 0.5), 0.85, 1e-6));

// ── the scale
const scale = scaleFromRead(read, W, H);
check("the scale comes from the door: 260 px for 80 in. ≈ 39 px/ft", scale.by === "door" && near(scale.pxPerFt, 39, 0.3), `${scale.by} ${scale.pxPerFt.toFixed(2)}`);
const noDoor = parseWallRead({ ...RAW, door: null })!;
const sEave = scaleFromRead(noDoor, W, H);
check("without a door, the wall's storey to the eave: 520 px for 9 ft ≈ 57.8 px/ft", sEave.by === "eave" && near(sEave.pxPerFt, 57.8, 0.3), `${sEave.by} ${sEave.pxPerFt.toFixed(2)}`);
check("without either, no scale", scaleFromRead(parseWallRead({ ...RAW, door: null, eave: null })!, W, H).by === "none");

// ── the wall's parts and its recess
const segs = wallSegments(read);
check("one 'toward' step makes two parts: the right one 4 ft nearer", segs.length === 2 && segs[0].depthFt === 0 && segs[1].depthFt === 4 && segs[1].x0 === 0.625, JSON.stringify(segs));
const away = parseWallRead({ ...RAW, jogs: [{ x: 0.3, dir: "away" }] })!;
check("an 'away' step without a size steps back the default 2 ft", wallSegments(away)[1].depthFt === -2);
check("the recess is the farthest part — here the left run, 19 ft wide", recessOf(noDoor, sEave, W)?.x0 === 0.125 && recessOf(noDoor, sEave, W)?.x1 === 0.625);
check("a flat wall has no recess", recessOf(parseWallRead({ ...RAW, jogs: [] })!, scale, W) === null);

// ── where the deck's middle goes
check("the door first", anchorOn(read, scale, W).by === "door" && near(anchorOn(read, scale, W).x, 0.394, 0.001));
check("no door: the recess, the covered part a door is usually in", anchorOn(noDoor, sEave, W).by === "recess" && near(anchorOn(noDoor, sEave, W).x, 0.375, 0.001));
const patioOnly = parseWallRead({ ...RAW, door: null, jogs: [], patio: { x0: 0.6, x1: 0.8 } })!;
check("no door, no step: the patio", anchorOn(patioOnly, scaleFromRead(patioOnly, W, H), W).by === "patio" && near(anchorOn(patioOnly, scaleFromRead(patioOnly, W, H), W).x, 0.7, 0.001));
const bare = parseWallRead({ ...RAW, door: null, jogs: [] })!;
check("nothing at all: the wall's middle", anchorOn(bare, scaleFromRead(bare, W, H), W).by === "wall" && near(anchorOn(bare, scaleFromRead(bare, W, H), W).x, 0.5, 0.001));

// ── the placement on the read's picture
const on = placeOnWall(read, scale, rect, W, H)!;
check("16 ft at 39 px/ft is 0.39 of a 1600 px picture", near(on.w, 0.39, 0.005), String(on.w));
check("the deck is centred on the door", near(on.x + on.w / 2, (0.35 + 0.4375) / 2, 0.003), `centre ${(on.x + on.w / 2).toFixed(3)}`);
check("its ground line is the wall's base", near(on.y, 0.8125, 1e-3));
const wide = rectOf(40);
check("a deck wider than the picture still centres on the door", near(placeOnWall(read, scale, wide, W, H)!.x + placeOnWall(read, scale, wide, W, H)!.w / 2, 0.394, 0.003));
const ftX = scale.pxPerFt / W;
const lBackRight: FitDeck = { shape: { kind: "L", widthFt: 20, depthFt: 12, notch: { corner: "back-right", widthFt: 6, depthFt: 4 } }, depthFt: 12, elevWidthFt: 20, elevHeightFt: 6.5, elevLeftFt: 0 };
const onR = placeOnWall(read, scale, lBackRight, W, H)!;
check("an L with a back-right notch puts the notch's edge on the step whose right side is nearer", near(onR.x + 14 * ftX, 0.625, 0.003), `edge at ${(onR.x + 14 * ftX).toFixed(3)}`);
const readAway = parseWallRead({ ...RAW, jogs: [{ x: 0.25, dir: "away", depthFt: 3 }] })!;
const lBackLeft: FitDeck = { ...lBackRight, shape: { kind: "L", widthFt: 20, depthFt: 12, notch: { corner: "back-left", widthFt: 6, depthFt: 4 } } };
const onL = placeOnWall(readAway, scale, lBackLeft, W, H)!;
check("…a back-left notch the step whose left side is nearer", near(onL.x + 6 * ftX, 0.25, 0.003), `edge at ${(onL.x + 6 * ftX).toFixed(3)}`);
check("a back-left notch with no such step to its left stays centred on the door", near(placeOnWall(read, scale, lBackLeft, W, H)!.x + 10 * ftX, 0.394, 0.003));
const lFront: FitDeck = { ...lBackRight, shape: { kind: "L", widthFt: 20, depthFt: 12, notch: { corner: "front-right", widthFt: 6, depthFt: 4 } } };
check("a front notch is the deck's own shape — centred on the door like a rectangle", near(placeOnWall(read, scale, lFront, W, H)!.x + 10 * ftX, 0.394, 0.003));
check("no scale, no placement", placeOnWall(read, { pxPerFt: 0, by: "none" }, rect, W, H) === null);

// ── the crop
const crop = cropForWall(read, scale, on, rect, W, H);
check("the crop frames the wall with a margin: x 0.05…0.95", near(crop.x, 0.05, 0.01) && near(crop.x + crop.w, 0.95, 0.01), JSON.stringify(crop));
check("…from a little above the eave to two feet below the base", crop.y < 0.2708 && crop.y > 0.15 && crop.y + crop.h > 0.8125 + 0.07 && crop.y + crop.h < 0.95, JSON.stringify(crop));
const barred = parseWallRead({ ...RAW, bars: { top: 0.3, bottom: 0.3 } })!;
const cropB = cropForWall(barred, scale, on, rect, W, H);
check("the crop never reaches into the black bands", cropB.y >= 0.3 && cropB.y + cropB.h <= 0.7 + 1e-9, JSON.stringify(cropB));
const tiny = parseWallRead({ ...RAW, base: { left: { x: 0.45, y: 0.8125 }, right: { x: 0.55, y: 0.8125 } }, door: null, eave: null, jogs: [], windows: [] })!;
const cropT = cropForWall(tiny, { pxPerFt: 0, by: "none" }, null, rect, W, H);
check("a sliver of wall still gets three fifths of the picture", cropT.w >= 0.6 - 1e-9 && cropT.h >= 0.5 - 1e-9, JSON.stringify(cropT));
const inCrop = placedInCrop(on, crop);
check("the placement said in the cropped picture's fractions", near(inCrop.x, (on.x - crop.x) / crop.w, 1e-3) && near(inCrop.w, on.w / crop.w, 1e-3) && near(inCrop.y, (on.y - crop.y) / crop.h, 1e-3));
const kept = readInCrop(read, crop);
check("the read said in the crop: the door's left edge moves from 0.35 to (0.35 − 0.05) / 0.9", near(kept.door!.x0, (0.35 - crop.x) / crop.w, 1e-3) && kept.bars.top === 0 && near(kept.jogs[0].x, (0.625 - crop.x) / crop.w, 1e-3));

// ── the height the door asks for, the sill in the way
check("the door's threshold 110 px up at 39 px/ft is 34 in.", heightFromDoor(read, scale, H) === 34, String(heightFromDoor(read, scale, H)));
check("no door, no height", heightFromDoor(noDoor, sEave, H) === null);
check("the lowest sill over the deck's span: the first window's 80 in. (the 16 ft deck reaches it)", lowestSillIn(read, scale, on, H) === 80, String(lowestSillIn(read, scale, on, H)));
check("…none over a 10 ft deck at the door, which stops short of the windows", lowestSillIn(read, scale, placeOnWall(read, scale, rectOf(10, 10), W, H), H) === null);

// ── the house stepping into the deck
check("a 16 ft deck at the door clears the step — no offer", jogOffer(read, scale, on, rect, W) === null);
const wide24 = rectOf(24);
const offer = jogOffer(read, scale, placeOnWall(read, scale, wide24, W, H), wide24, W);
check("a 24 ft deck reaches the bump-out: a back-right notch, 2 ft 6 in. wide, the step's 4 ft deep", offer?.kind === "notch" && offer.corner === "back-right" && offer.widthFt === 2.5 && offer.depthFt === 4, JSON.stringify(offer));
check("…and the offer says so", offer?.kind === "notch" && /steps 4 ft into the deck's right back corner over 2 ft 6 in\./.test(offer.text), offer?.text);
const inRecess = parseWallRead({ ...RAW, jogs: [{ x: 0.3, dir: "away", depthFt: 3 }, { x: 0.7, dir: "toward", depthFt: 3 }] })!;
const wide30 = rectOf(30);
const recessOffer = jogOffer(inRecess, scale, placeOnWall(inRecess, scale, wide30, W, H), wide30, W);
check("a 30 ft deck at a door inside a 16 ft recess: the offer is to fit it in", recessOffer?.kind === "recess" && recessOffer.widthFt === 16 && /fit the deck into the recess/.test(recessOffer.text), JSON.stringify(recessOffer));
check("an L already is not offered another notch", jogOffer(read, scale, onR, lBackRight, W) === null);
check("the shape with the notch taken", JSON.stringify(shapeWithOffer({ kind: "rect", widthFt: 24, depthFt: 12 }, offer!)) === JSON.stringify({ kind: "L", widthFt: 24, depthFt: 12, notch: { corner: "back-right", widthFt: 2.5, depthFt: 4 } }));
check("the shape fitted into the recess", JSON.stringify(shapeWithOffer({ kind: "rect", widthFt: 30, depthFt: 12 }, recessOffer!)) === JSON.stringify({ kind: "rect", widthFt: 16, depthFt: 12 }));

// ── all of it
const fit = fitPhoto(read, rect, 36, W, H);
check("the fit: door, 2 windows, a step, 31 ft of wall, 34 in. suggested, no offer", fit.door && fit.windows === 2 && fit.jog && fit.wallFt === 31 && fit.suggestedHeightIn === 34 && fit.offer === null && !fit.unsure && fit.anchor === "door", JSON.stringify({ wallFt: fit.wallFt, h: fit.suggestedHeightIn }));
check("the notes say what was found and the door's height", /Found the wall, about 31 ft wide, the back door, 2 windows, a step in the wall — scale from the door \(80 in\.\)\./.test(fit.notes[0]) && fit.notes.some((n) => /threshold is 2'-10" above the ground/.test(n) && /design says 3 ft/.test(n)), fit.notes.join(" | "));
const fit34 = fitPhoto(read, rect, 34, W, H);
check("at 34 in. the note says the floor matches", fit34.notes.some((n) => /floor height matches/.test(n)), fit34.notes.join(" | "));
const lowSill = parseWallRead({ ...RAW, windows: [{ x0: 0.3, x1: 0.34, sill: 0.75, head: 0.6 }] })!;
const fitSill = fitPhoto(lowSill, rect, 36, W, H);
check("a sill 18 in. up under a 36 in. floor is called out", fitSill.lowestSillIn === 18 && fitSill.notes.some((n) => /window sill is only 18 in\. up/.test(n)), fitSill.notes.join(" | "));
const fitRecess = fitPhoto(noDoor, rect, 36, W, H);
check("no door: the notes say the deck is set in the recess", fitRecess.anchor === "recess" && fitRecess.notes.some((n) => /set in the house's recess/.test(n)), fitRecess.notes.join(" | "));
const fit24 = fitPhoto(read, wide24, 36, W, H);
check("the offer rides in the fit and its notes", fit24.offer?.kind === "notch" && fit24.notes.some((n) => /notch the deck around it\?/.test(n)));
const unsure = fitPhoto(parseWallRead({ ...RAW, confidence: 0.2 })!, rect, 36, W, H);
check("an unsure read centres the outline, offers nothing and says so", unsure.unsure && unsure.placed.x === 0.1 && unsure.placed.w === 0.8 && unsure.offer === null && /could not be read with confidence/.test(unsure.notes[0]));
const fitL = fitPhoto(read, lBackRight, 36, W, H);
check("an L on a stepped house says its notch is on the step", fitL.notes.some((n) => /notch on the house's step/.test(n)), fitL.notes.join(" | "));

// ── the fit kept with the picture, and fitted again without the model
const summary = fitSummary(fit, read);
check("the summary keeps the read in the cropped picture's fractions", !!summary.read && near(summary.read.door!.x0, (0.35 - fit.crop.x) / fit.crop.w, 1e-3) && summary.offer === null && summary.read.bars.top === 0);
const again = fitPhoto(summary.read!, rect, 36, Math.round(fit.crop.w * W), Math.round(fit.crop.h * H), { recrop: false });
check("fitted again on the cropped picture from the kept read: the same placement, the picture left whole", near(again.placed.x, fit.placed.x, 0.004) && near(again.placed.w, fit.placed.w, 0.004) && near(again.placed.y, fit.placed.y, 0.004) && again.crop.w === 1 && again.crop.x === 0, `${JSON.stringify(again.placed)} vs ${JSON.stringify(fit.placed)}`);
const again24 = fitPhoto(summary.read!, wide24, 36, Math.round(fit.crop.w * W), Math.round(fit.crop.h * H), { recrop: false });
check("…and a wider deck on the kept read gets the same offer", again24.offer?.kind === "notch" && again24.offer.corner === "back-right" && again24.offer.widthFt === 2.5, JSON.stringify(again24.offer));
check("fitSummary on a whole picture keeps the read as is", fitSummary(again, summary.read!).read === summary.read);

// ── the black bands of a screenshot
const rows = (n: number, top: number, bottom: number) => Array.from({ length: n }, (_, i) => (i < top || i >= n - bottom ? 8 : 140));
check("10 dark rows on top and 12 below are the bands", JSON.stringify(letterboxRows(rows(100, 10, 12))) === JSON.stringify({ top: 10, bottom: 12 }));
check("a two-row sliver is not a band", JSON.stringify(letterboxRows(rows(100, 2, 0))) === JSON.stringify({ top: 0, bottom: 0 }));
check("a band stops at a third of the picture", letterboxRows(rows(90, 60, 0)).top === 30);
check("no bands, nothing cut", JSON.stringify(letterboxRows(rows(100, 0, 0))) === JSON.stringify({ top: 0, bottom: 0 }));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);

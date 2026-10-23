// The house built from its photo (2026-10-23, lib/deck/houseRead + lib/deck/houseFromPhoto + lib/deck/house): the
// read checked (more than twelve windows, the back door among the doors, a window on a door dropped, the cladding in a
// model's words, a patio roof's posts, an old deck's floor); the house a two-storey back wall with a full-height
// bump-out, a covered patio and fourteen windows builds (its width by the storeys, a typed width, a door; its steps; the
// deck centred on the door, the old deck, the patio roof, the slab); the 3D's openings and what stands there; the read
// back of a house (and an old one unchanged); the deck slid and widened with the wall kept still; the tear-out of a
// patio roof and a slab priced and said; the review's hand edits; the colours off the pixels. Pure.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-house-photo.check.ts
import { parseHouseRead, mapHouseRead, moveHouseMark, addReadWindow, addReadDoor, addReadJog, removeReadWindow, removeReadDoor, removeReadJog, flipReadJog, blankHouseRead, type HouseRead } from "@/lib/deck/houseRead";
import { houseFromPhoto, houseScale, dominantColour, colourZones, paintable } from "@/lib/deck/houseFromPhoto";
import { defaultHouse, houseScene, normalizeHouse, slideDeck, existingSqFt } from "@/lib/deck/house";
import { defaultDeckDesign, type DeckShape } from "@/lib/deck/design";
import { patchDesign } from "@/lib/deck/edit";
import { priceDeck, deckScope } from "@/lib/deck/pricing";
import { buildStructure } from "@/lib/deck/structure";
import { deckScene, parseDeckScene } from "@/lib/deck/scene";
import { transformRead } from "@/lib/deck/photoFit";

let bad = 0;
const check = (name: string, ok: boolean, info = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !info ? "" : `  — ${info}`}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// A two-storey back wall seen square on (a picture 736 × 840 once its black bands are cut): a 2-ft bump-out in the
// middle that runs the full two storeys, a patio roof on one post over a slab at the right, fourteen windows, no door.
const W = 736;
const H = 840;
const fx = (x: number) => Math.round((x / W) * 1000) / 1000;
const fy = (y: number) => Math.round(((y - 380) / H) * 1000) / 1000;
const win = (x0: number, x1: number, head: number, sill: number) => ({ x0: fx(x0), x1: fx(x1), head: fy(head), sill: fy(sill) });
const RAW = {
  base: { left: { x: fx(25), y: fy(902) }, right: { x: fx(597), y: fy(902) } },
  eave: { left: { x: fx(25), y: fy(645) }, right: { x: fx(597), y: fy(643) } },
  storeys: 2,
  jogs: [{ x: fx(148), y: fy(902), dir: "toward", depthFt: 2 }, { x: fx(372), y: fy(902), dir: "away", depthFt: 2 }],
  door: null,
  doors: [],
  windows: [
    win(100, 146, 778, 827), win(196, 234, 778, 856), win(240, 278, 778, 856), win(283, 321, 778, 856),
    win(172, 251, 657, 709), win(280, 358, 657, 676),
    win(404, 441, 665, 726), win(445, 482, 665, 726), win(486, 523, 665, 726), win(526, 563, 665, 726),
    win(407, 442, 780, 854), win(448, 483, 780, 854), win(488, 523, 780, 854), win(529, 564, 780, 854),
  ],
  patio: { x0: fx(368), x1: fx(659) },
  oldDeck: null,
  cover: { x0: fx(358), x1: fx(655), top: fy(740), bottom: fy(775), posts: [fx(611), 1.4] },
  roof: { kind: "hip", pitch: 5 },
  material: "Fiber cement lap siding",
  colours: { siding: "#7D7B76", roof: "#3c3d40", trim: "not a colour" },
  bars: { top: 0, bottom: 0 },
  confidence: 0.78,
  note: "An electric meter on the wall at the left.",
};

console.log("— the read —");
const read = parseHouseRead(RAW)!;
check("the read parses", !!read);
check("all fourteen windows are kept (the smart fit kept twelve)", read.windows.length === 14, String(read.windows.length));
check("the cladding is read from the model's own words", read.material === "lap", String(read.material));
check("the colours: a hex kept (lower case), a word dropped", read.colours.siding === "#7d7b76" && read.colours.trim === null);
check("the patio roof's post outside it is dropped, the one under it kept", !!read.cover && read.cover.posts.length === 1 && near(read.cover.posts[0], fx(611), 0.001), JSON.stringify(read.cover));
check("the roof is a hip, about 5/12", read.roof.kind === "hip" && read.roof.pitch === 5);
check("nothing without a wall", parseHouseRead({ windows: [] }) === null);
// The same wall with a 6½-ft sliding door on the right, 2 ft above the ground, instead of the lower windows there.
const UPPER = RAW.windows.filter((w) => w.sill < fy(800));
const withDoor = parseHouseRead({ ...RAW, door: { x0: 0.6, x1: 0.77, bottom: 0.585, top: 0.435 }, doors: [], windows: [...UPPER, { x0: 0.61, x1: 0.76, head: 0.45, sill: 0.57 }] })!;
check("the back door read only as `door` is among the doors, a sliding door by its width", withDoor.doors.length === 1 && withDoor.doors[0].kind === "slider", JSON.stringify(withDoor.doors));
check("a window drawn over that door is dropped", withDoor.windows.length === UPPER.length, `${withDoor.windows.length} of ${UPPER.length}`);
const withDeck = parseHouseRead({ ...RAW, oldDeck: { x0: 0.5, x1: 0.85, top: 0.58 } })!;
check("an old deck keeps its floor's edge", !!withDeck.oldDeck && withDeck.oldDeck.top === 0.58);

console.log("— the house it builds —");
const design = defaultDeckDesign({ state: "WA" });
const Wd = design.shape.widthFt;
const b = houseFromPhoto({ read, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house, measured: { siding: "#7a756c", roof: null } })!;
check("it builds", !!b);
check("the wall is about 40 ft, sized by the storeys (said to be rough)", near(b.wallFt, 40, 1) && b.scale.by === "eave" && b.facts.find((f) => f.id === "wall")!.guess, `${b.wallFt} by ${b.scale.by}`);
check("two storeys, a hip roof, lap siding", b.house.storeys === 2 && b.house.roof === "hip" && b.house.material === "lap");
const sat = (hx: string) => { const v = [1, 3, 5].map((k) => parseInt(hx.slice(k, k + 2), 16)); return Math.max(...v) - Math.min(...v); };
check("the wall's colour: lightness off the pixels, the daylight hue of the read (a dusk-brown grey comes out grey); the roof's guess stands in alone", sat(b.house.siding) <= sat("#7d7b76") + 2 && b.house.roofColour === "#3c3d40", `${b.house.siding} ${b.house.roofColour}`);
const dusk = houseFromPhoto({ read, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house, measured: { siding: "#8a6a4a", roof: null } })!;
check("a sunset-orange measure of a grey wall is brought back to grey", sat(dusk.house.siding) < 12, dusk.house.siding);
const only = houseFromPhoto({ read: { ...read, colours: { siding: null, roof: null, trim: null } }, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house, measured: { siding: "#7a756c", roof: null } })!;
check("without a guess, the measure stands as it is; without either, the preset stays", only.house.siding === "#7a756c" && only.house.roofColour === design.house.roofColour);
check("the house spans the wall: its reach past the deck's ends + the deck = the wall", near(b.house.leftFt + Wd + b.house.rightFt, b.wallFt, 0.6), `${b.house.leftFt} + ${Wd} + ${b.house.rightFt}`);
check("the deck is centred under the patio roof (no door), held inside the wall", b.centredOn === "patio roof" && b.house.leftFt >= 0 && b.house.rightFt >= 0);
check("two steps: out 2 ft then back 2 ft", b.house.jogs.length === 2 && b.house.jogs[0].dir === "toward" && b.house.jogs[1].dir === "away" && b.house.jogs.every((j) => j.depthFt === 2));
check("the steps stand where the picture has them (≈ 8.6 and 24.1 ft from the wall's left corner)", near(b.house.jogs[0].atFt + b.deckAtFt, 8.6, 0.6) && near(b.house.jogs[1].atFt + b.deckAtFt, 24.1, 0.6), JSON.stringify(b.house.jogs));
check("the bump-out has an upper window in it, so it is as tall as the house", b.house.bumpOuts === "full");
const ws = b.house.openings!.filter((o) => o.kind === "window");
check("fourteen windows on the house, no door", ws.length === 14 && b.house.openings!.length === 14);
const upper = ws.filter((o) => o.sillFt > 10);
check("six windows on the second storey; the four over the patio about 12 ft up", upper.length === 6 && upper.filter((o) => near(o.sillFt, 12.3, 0.5)).length === 4, upper.map((o) => o.sillFt).join(","));
check("a lower window is about 2.6 × 5.4 ft", ws.some((o) => near(o.widthFt, 2.6, 0.3) && near(o.heightFt, 5.4, 0.4)));
const cover = b.house.existing!.find((e) => e.kind === "cover");
const slab = b.house.existing!.find((e) => e.kind === "slab");
check("the patio roof stands there: its low edge about 9 ft up, its top about 11 ft, one post", !!cover && near(cover.heightFt, 8.9, 0.5) && near(cover.highFt!, 11.3, 0.6) && cover.posts!.length === 1 && !cover.tearOut, JSON.stringify(cover));
check("so does the slab, at the ground", !!slab && slab.heightFt < 0.5 && !slab.tearOut);
check("no door — the deck's height stays as it is", b.heightIn === null && b.checks.some((c) => /No back door/.test(c)));
check("the patio roof's and the slab's depth are said to be guesses", b.checks.some((c) => /can't be seen from the front/.test(c)));

const typed = houseFromPhoto({ read, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house, wallWidthFt: 44 })!;
check("a typed wall width sets the scale", typed.scale.by === "width" && near(typed.wallFt, 44, 0.01) && !typed.facts.find((f) => f.id === "wall")!.guess);
check("houseScale says the same", houseScale(read, W, H, 44).by === "width");
const door = houseFromPhoto({ read: withDoor, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house })!;
check("with a door: sized by it, the deck centred on it", door.scale.by === "door" && door.centredOn === "door");
const dOpen = door.house.openings!.find((o) => o.kind !== "window")!;
check("the door is a sliding door on the deck — at its middle, or as near as the wall's end lets it", dOpen.kind === "slider" && dOpen.xFt > 0 && dOpen.xFt < Wd && (near(dOpen.xFt, Wd / 2, 0.6) || near(door.deckAtFt + Wd, door.wallFt, 0.6)), `${JSON.stringify(dOpen)} deck at ${door.deckAtFt} of ${door.wallFt}`);
check("the deck's floor an inch under the door's threshold", door.heightIn !== null && near(door.heightIn, Math.round(dOpen.sillFt * 12) - 1, 1.5), `${door.heightIn} vs ${dOpen.sillFt}`);
const old = houseFromPhoto({ read: withDeck, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house })!;
check("with an old deck: centred on it, drawn at its floor, and no slab under it", old.centredOn === "old deck" && old.house.existing!.some((e) => e.kind === "deck" && e.heightFt > 1) && !old.house.existing!.some((e) => e.kind === "slab"));
check("nothing to size by → no house", houseFromPhoto({ read: { ...read, eave: null, doors: [], door: null }, photoW: W, photoH: H, deckWidthFt: Wd, house: design.house }) === null);

console.log("— the 3D —");
const built = patchDesign(design, { house: b.house });
check("the deck is still a plain rectangle on the house line", built.shape.kind === "rect");
const hs = houseScene(built.shape, built.house, { deckHeightFt: 3, peakFt: 0, mainEdge: null });
check("fourteen windows drawn where they are, no doors", hs.windows.length === 14 && (hs.doors?.length ?? 0) === 0 && hs.door === null);
check("three blocks, all as tall as the house", hs.blocks.length === 3 && hs.blocks.every((x) => x[4] === hs.blocks[0][4]));
check("the patio roof and the slab stand there in the 3D", hs.existing?.length === 2 && hs.existing.some((e) => e[0] === 1 && e.length === 8) && hs.existing.some((e) => e[0] === 2));
const low = houseScene(built.shape, { ...built.house, bumpOuts: "low" }, { deckHeightFt: 3, peakFt: 0, mainEdge: null });
check("a one-storey bump-out drops the upper windows that would stand over its roof", low.windows.length === 12, String(low.windows.length));
const dScene = houseScene(design.shape, patchDesign(design, { house: door.house }).house, { deckHeightFt: 3, peakFt: 0, mainEdge: null });
check("a door from the photo is drawn on its own threshold and is the deck's door", dScene.doors?.length === 1 && dScene.door !== null && dScene.doors[0][5] === 1);
const scene = deckScene(buildStructure(built));
check("the deck's scene carries the house's windows, cladding look and what stands there", (scene.house?.windows?.length ?? 0) === 14 && scene.house?.existing?.length === 2);
const back = parseDeckScene(JSON.parse(JSON.stringify(scene)));
check("…and they come back from a saved scene (the client's page)", back?.house?.existing?.length === 2 && back.house.windows?.length === 14, JSON.stringify(back?.house?.existing));
const brick = deckScene(buildStructure(patchDesign(design, { house: { ...door.house, material: "brick" } })));
check("brick and its doors come back from a saved scene too", parseDeckScene(JSON.parse(JSON.stringify(brick)))?.house?.material === "brick" && parseDeckScene(JSON.parse(JSON.stringify(brick)))?.house?.doors?.length === 1);

console.log("— kept and read back —");
const n = normalizeHouse(JSON.parse(JSON.stringify(built.house)), built.shape);
check("the photo house reads back as it was", JSON.stringify(n) === JSON.stringify(built.house));
const plain = normalizeHouse(defaultHouse(), design.shape);
check("a house without a photo reads back with none of the new fields", Object.keys(plain).sort().join(",") === "jogs,leftFt,rightFt,roof,roofColour,siding,storeys");
const junk = normalizeHouse({ ...defaultHouse(), siding: "#12345", roofColour: "#ABCDEF", material: "glass", openings: [{ xFt: "x" }, { kind: "door", xFt: 10, widthFt: 99, heightFt: 7, sillFt: 2 }], existing: [{ kind: "pool", x0Ft: 0, x1Ft: 9 }, { kind: "cover", x0Ft: 2, x1Ft: 3 }] }, design.shape);
check("junk is dropped or held: a bad hex, a made-up cladding, an opening without a place, a tiny cover", junk.siding === "cream" && junk.roofColour === "#abcdef" && junk.material === undefined && junk.openings!.length === 1 && junk.openings![0].widthFt === 20 && junk.existing === undefined, JSON.stringify(junk));

console.log("— the deck moved, the wall still —");
// The deck stands at the wall's right end, so it slides left: the house still, everything on it 2 ft right in the deck's feet.
const slid = slideDeck({ ...built.house, photo: { url: "data:image/jpeg;base64,AAAA", w: W, h: H, read: null, wallFt: b.wallFt, by: "eave", deckAtFt: b.deckAtFt, at: "" } }, -2);
check("sliding the deck 2 ft left moves the windows, what stands there and the photo's mark the other way", near(slid.openings![0].xFt, built.house.openings![0].xFt + 2, 0.01) && near(slid.existing![0].x0Ft, built.house.existing![0].x0Ft + 2, 0.01) && (slid.existing![0].posts ?? [])[0] === (built.house.existing![0].posts ?? [])[0] + 2 && slid.photo!.deckAtFt === b.deckAtFt - 2, JSON.stringify(slid.existing![0]));
const withPhoto = patchDesign(built, { house: { photo: { url: "data:image/jpeg;base64,AAAA", w: W, h: H, read, wallFt: b.wallFt, by: b.scale.by, deckAtFt: b.deckAtFt, at: "2026-10-23" } } });
const wider = patchDesign(withPhoto, { shape: { ...withPhoto.shape, widthFt: withPhoto.shape.widthFt - 4 } as DeckShape });
check("a narrower deck on a photo house leaves the wall as long as it was", near(wider.house.leftFt + wider.shape.widthFt + wider.house.rightFt, withPhoto.house.leftFt + withPhoto.shape.widthFt + withPhoto.house.rightFt, 0.01), `${wider.house.rightFt}`);
const plainWider = patchDesign(design, { shape: { ...design.shape, widthFt: design.shape.widthFt + 4 } as DeckShape });
check("a house drawn by rule still grows with the deck (as before)", plainWider.house.rightFt === design.house.rightFt);

console.log("— torn out —");
const kept = priceDeck(built);
check("kept: no tear-out lines", !kept.lines.some((l) => l.id.startsWith("demo-")));
const torn = patchDesign(built, { house: { existing: built.house.existing!.map((e) => ({ ...e, tearOut: true })) } });
const tp = priceDeck(torn);
const roofLine = tp.lines.find((l) => l.id === "demo-patio-roof");
const slabLine = tp.lines.find((l) => l.id === "demo-patio");
check("torn out: the patio roof's tear-out priced by its footprint", !!roofLine && roofLine.quantity === existingSqFt(torn.house.existing![0]) && roofLine.laborCost > 0, JSON.stringify(roofLine));
check("…and the slab's break-out", !!slabLine && slabLine.quantity === existingSqFt(torn.house.existing![1]) && slabLine.unitPrice > 0);
const scope = deckScope(tp).join(" ");
check("the scope says both", /existing patio roof/.test(scope) && /existing concrete patio/.test(scope));
check("torn out, they are gone from the 3D", (houseScene(torn.shape, torn.house, { deckHeightFt: 3, peakFt: 0, mainEdge: null }).existing ?? []).length === 0);

console.log("— the review's hand edits —");
const r0: HouseRead = read;
const mv = moveHouseMark(r0, "base-left", { x: 0.05, y: 0.63 });
check("the base's left corner moves", mv.base.left.x === 0.05 && mv.base.left.y === 0.63 && mv.windows.length === 14);
const ev = moveHouseMark(r0, "eave-right", { x: 0.8, y: 0.9 });
check("the eave cannot be dragged under the base", !!ev.eave && ev.eave.right.y < ev.base.right.y);
const w2 = moveHouseMark(r0, "win-0", { x: 0.5, y: 0.5 });
check("a window moves by its middle, its size kept", near((w2.windows[0].x0 + w2.windows[0].x1) / 2, 0.5, 0.002) && near(w2.windows[0].x1 - w2.windows[0].x0, r0.windows[0].x1 - r0.windows[0].x0, 0.002));
const ad = addReadDoor(r0, W, H);
check("a door put on by hand stands on the base, is the back door, about 80 in. at the picture's scale", ad.doors.length === 1 && !!ad.door && near(ad.doors[0].bottom, r0.base.left.y - 0.008, 0.02) && near(((ad.doors[0].bottom - ad.doors[0].top) * H) / houseScale(r0, W, H).pxPerFt, 80 / 12, 0.2));
const dm = moveHouseMark(ad, "door-0", { x: 0.3, y: 0.6 });
check("moving it moves the back door too", !!dm.door && near((dm.door.x0 + dm.door.x1) / 2, 0.3, 0.002));
check("removing it clears the back door", removeReadDoor(dm, 0).door === null && removeReadDoor(dm, 0).doors.length === 0);
check("a window added and removed", addReadWindow(r0, W, H).windows.length === 15 && removeReadWindow(r0, 0).windows.length === 13);
check("a step added, flipped, removed", addReadJog(r0).jogs.length === 3 && flipReadJog(r0, 0).jogs[0].dir === "away" && removeReadJog(r0, 1).jogs.length === 1);
check("a blank read builds a one-storey house by its storey", !!houseFromPhoto({ read: blankHouseRead(), photoW: W, photoH: H, deckWidthFt: Wd, house: design.house }));
const id = mapHouseRead(withDoor, (x) => transformRead(x, [1, 0, 0, 0, 1, 0, 0, 0, 1], W, H, W, H), (p) => p);
check("carried through a plain warp, the read is the same", id.doors.length === 1 && near(id.doors[0].bottom, withDoor.doors[0].bottom, 0.002) && id.windows.length === withDoor.windows.length && !!id.cover);

console.log("— the colours off the pixels —");
const px: number[] = [];
for (let i = 0; i < 400; i++) px.push(122, 117, 108);
for (let i = 0; i < 120; i++) px.push(240, 238, 230);
for (let i = 0; i < 90; i++) px.push(20, 22, 25);
for (let i = 0; i < 80; i++) px.push(200, 150, 60);
const dom = dominantColour(px)!;
const rgb = [1, 3, 5].map((k) => parseInt(dom.slice(k, k + 2), 16));
check("the wall's colour wins over the trim, the glass and a lamp's glow", near(rgb[0], 122, 6) && near(rgb[1], 117, 6) && near(rgb[2], 108, 6), dom);
check("too few samples → nothing", dominantColour([10, 10, 10, 200, 200, 200]) === null);
const sunset = paintable(230, 140, 60, 0.35);
const [sr, , sb] = [1, 3, 5].map((k) => parseInt(sunset.slice(k, k + 2), 16));
check("a sunset's orange is held to a paint's colour", sr - sb < 140, sunset);
const z = colourZones(read, W, H);
const w0 = read.windows[0];
check("the wall is sampled between its base and its eave, never on a window", z.wall(0.3, 0.585) && !z.wall((w0.x0 + w0.x1) / 2, (w0.head + w0.sill) / 2) && !z.wall(0.4, 0.2) && !!z.roof && z.roof(0.4, read.eave!.left.y - 0.03));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);

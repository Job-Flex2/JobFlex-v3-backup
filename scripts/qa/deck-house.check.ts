// The drawn house (2026-10-11, lib/deck/house): its design read back, the back wall as parts against the house line,
// the deck's shape following a bump-out at its end (and saying why when it cannot), a notch picked in the Shape step
// putting its step in the wall, the blocks and openings the 3D draws, the knobs, and the scene through the client's
// parser. Pure.
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/deck-house.check.ts
import { applyDeckPatch } from "../../src/lib/deck/checks";
import { defaultDeckDesign, normalizeDeckDesign, type DeckShape } from "../../src/lib/deck/design";
import { HOUSE_BODY_FT, STOREY_FT, deckShapeForHouse, defaultHouse, houseForShape, houseHandles, houseScene, normalizeHouse, referenceX, wallParts, type HouseDesign } from "../../src/lib/deck/house";
import { deckScene, parseDeckScene } from "../../src/lib/deck/scene";
import { buildStructure } from "../../src/lib/deck/structure";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const rect: DeckShape = { kind: "rect", widthFt: 16, depthFt: 12 };
const plain = defaultHouse();

// ── the design read back
const n = normalizeHouse({ storeys: 2, roof: "gable", leftFt: 99, rightFt: -3, jogs: [{ atFt: 12, dir: "toward", depthFt: 40 }, { atFt: 12.2, dir: "away", depthFt: 2 }, { atFt: 30, dir: "toward", depthFt: 2 }] }, rect);
check("storeys and roof read; the wall's reach and a step's depth held to their limits", n.storeys === 2 && n.roof === "gable" && n.leftFt === 60 && n.rightFt === 0 && n.jogs[0].depthFt === 12, JSON.stringify(n));
check("a step on top of another, or past the wall's end, is dropped; ids given", n.jogs.length === 1 && n.jogs[0].id === "j1", JSON.stringify(n.jogs));
check("nothing given: one storey, a hip, 4 ft past each end, a straight wall", JSON.stringify(normalizeHouse(undefined, rect)) === JSON.stringify(plain));

// ── the wall as parts, against the house line under the deck's main back edge
const bump: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 12, dir: "toward", depthFt: 3 }] };
const parts = wallParts(bump, rect);
check("a step at 12 ft that comes out 3 ft: the wall from −4 to 12 on the line, 12 to 20 three feet out", parts.length === 2 && parts[0].x0 === -4 && parts[0].x1 === 12 && parts[0].depthFt === 0 && parts[1].x1 === 20 && parts[1].depthFt === 3, JSON.stringify(parts));
const stepBack: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: -1, dir: "away", depthFt: 2 }] };
check("a step past the deck's left end that steps back: the part under the deck stays the house line, the left part comes 2 ft out", wallParts(stepBack, rect)[0].depthFt === 2 && wallParts(stepBack, rect)[1].depthFt === 0, JSON.stringify(wallParts(stepBack, rect)));
check("the reference is the main back edge's middle: 8 ft on a rectangle, 6 ft with a 4 ft back-right notch, 10 ft with a back-left one", referenceX(rect) === 8 && referenceX({ kind: "L", widthFt: 16, depthFt: 12, notch: { corner: "back-right", widthFt: 4, depthFt: 3 } }) === 6 && referenceX({ kind: "L", widthFt: 16, depthFt: 12, notch: { corner: "back-left", widthFt: 4, depthFt: 3 } }) === 10);

// ── the deck fits itself to the wall
const fitR = deckShapeForHouse(rect, bump);
check("a bump-out taking the deck's right end: a back-right notch 4 ft wide, 3 ft deep, no note", fitR.shape.kind === "L" && fitR.shape.notch.corner === "back-right" && fitR.shape.notch.widthFt === 4 && fitR.shape.notch.depthFt === 3 && fitR.note === null, JSON.stringify(fitR));
const bumpLeft: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 5, dir: "away", depthFt: 2 }] };
const fitL = deckShapeForHouse(rect, bumpLeft);
check("the wall stepping back at 5 ft (the left part out): a back-left notch 5 ft wide, 2 ft deep", fitL.shape.kind === "L" && fitL.shape.notch.corner === "back-left" && fitL.shape.notch.widthFt === 5 && fitL.shape.notch.depthFt === 2, JSON.stringify(fitL));
const middle: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 5, dir: "toward", depthFt: 3 }, { id: "j2", atFt: 9, dir: "away", depthFt: 3 }] };
const fitM = deckShapeForHouse(rect, middle);
check("a bump-out inside the deck leaves the shape and says to move it to an end", fitM.shape === rect && !!fitM.note && /inside the deck/.test(fitM.note), fitM.note ?? "");
const recess: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 4, dir: "away", depthFt: 2 }, { id: "j2", atFt: 12, dir: "toward", depthFt: 2 }] };
const fitRecess = deckShapeForHouse(rect, recess);
check("the deck sitting in a recess between two bump-outs: the shape stays, the note says the wall comes out twice", fitRecess.shape === rect && /comes out twice/.test(fitRecess.note ?? ""), fitRecess.note ?? "");
const away: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 12, dir: "away", depthFt: 2 }] };
const fitA = deckShapeForHouse(rect, away);
check("the wall stepping back under the deck's right part: the ledger has nothing behind it, the note says so", fitA.shape === rect && /steps back 2 ft under the deck/.test(fitA.note ?? ""), fitA.note ?? "");
const deep: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 12, dir: "toward", depthFt: 11 }] };
const fitD = deckShapeForHouse(rect, deep);
check("a bump-out deeper than the deck can wrap: the notch held at 9 ft and the note says it", fitD.shape.kind === "L" && fitD.shape.notch.depthFt === 9 && /held at 9 ft/.test(fitD.note ?? ""), fitD.note ?? "");
const l: DeckShape = { kind: "L", widthFt: 16, depthFt: 12, notch: { corner: "back-right", widthFt: 4, depthFt: 3 } };
check("no step under the deck takes a back notch away", deckShapeForHouse(l, plain).shape.kind === "rect");
const sliver: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 15, dir: "toward", depthFt: 3 }] };
check("a bump-out leaving 1 ft at the end: too little to notch, the deck stays a rectangle and the note says so", deckShapeForHouse(rect, sliver).shape.kind === "rect" && /too little to notch/.test(deckShapeForHouse(rect, sliver).note ?? ""));

// ── the Shape step's notch puts its step in the wall; a rectangle takes it away
const h1 = houseForShape(plain, l);
check("a back-right notch 4 × 3 picked in the Shape step: a step at 12 ft that comes out 3 ft", h1.jogs.length === 1 && h1.jogs[0].atFt === 12 && h1.jogs[0].dir === "toward" && h1.jogs[0].depthFt === 3, JSON.stringify(h1.jogs));
check("…and back to a rectangle, the step goes", houseForShape(h1, rect).jogs.length === 0);
check("…a deeper notch deepens the step it already has", houseForShape(h1, { ...l, notch: { ...l.notch, depthFt: 5 } }).jogs[0].depthFt === 5);
const lLeft: DeckShape = { kind: "L", widthFt: 16, depthFt: 12, notch: { corner: "back-left", widthFt: 5, depthFt: 2 } };
const h2 = houseForShape(plain, lLeft);
check("a back-left notch: the wall steps back at 5 ft (the left part is the bump-out)", h2.jogs.length === 1 && h2.jogs[0].atFt === 5 && h2.jogs[0].dir === "away" && h2.jogs[0].depthFt === 2, JSON.stringify(h2.jogs));
check("the design read back leaves the steps as given — a back notch without its step stays stepless (the studio adds it once, on opening), so a removed step stays removed", normalizeDeckDesign({ ...defaultDeckDesign(), shape: l, house: plain }).house.jogs.length === 0 && normalizeDeckDesign({ ...defaultDeckDesign(), shape: l, house: h1 }).house.jogs.length === 1);
const implied = houseScene(l, plain, { deckHeightFt: 3, peakFt: 0, mainEdge: null });
check("…and such a design is still drawn with the bump-out its notch wraps", implied.blocks.length === 2 && implied.blocks[1][0] === 12 && implied.blocks[1][3] === 3, JSON.stringify(implied.blocks));
check("and the two agree both ways: the house's step makes the same notch", JSON.stringify(deckShapeForHouse(l, h1).shape) === JSON.stringify(l));

// ── what the 3D draws
const hs = houseScene(rect, bump, { deckHeightFt: 3, peakFt: 3, mainEdge: { x0: 0, x1: 12 } });
check("one block per part, 24 ft deep behind its face, 12 ft tall over a 3 ft deck (the door needs wall above it)", hs.blocks.length === 2 && hs.blocks[0][1] === -HOUSE_BODY_FT && hs.blocks[1][3] === 3 && hs.blocks[1][1] === 3 - HOUSE_BODY_FT && hs.blocks[0][4] === 12 && hs.heightFt === 12, JSON.stringify(hs.blocks));
check("a low deck: one storey is 10 ft", houseScene(rect, plain, { deckHeightFt: 1, peakFt: 0, mainEdge: null }).heightFt === 10);
check("the door on the deck's main back edge: centred on 0…12, 6 ft wide, on the house line", !!hs.door && hs.door[0] === 6 && hs.door[1] === 6 && hs.door[3] === 0, JSON.stringify(hs.door));
check("windows along every face, clear of the door, sills above the deck's floor", hs.windows.length >= 2 && hs.windows.some((w) => w[1] === 0) && hs.windows.some((w) => w[1] === 3) && hs.windows.every((w) => w[4] >= 4.2 && w[2] === 3) && !hs.windows.some((w) => w[1] === 0 && Math.abs(w[0] - 6) < 6), JSON.stringify(hs.windows));
const two = houseScene(rect, { ...bump, storeys: 2, roof: "gable" }, { deckHeightFt: 3, peakFt: 3, mainEdge: { x0: 0, x1: 12 } });
check("two storeys: the main block 19 ft 6 in., the bump-out one storey (12 ft over this deck), the roof a gable, windows on both floors", two.blocks[0][4] === 2 * STOREY_FT + 0.5 && two.blocks[1][4] === 12 && two.roof === "gable" && two.windows.some((w) => w[4] > STOREY_FT) && two.windows.some((w) => w[4] < STOREY_FT), `${two.blocks.map((b) => b[4]).join("/")} · ${two.windows.length} windows`);
const tall = houseScene(rect, plain, { deckHeightFt: 9, peakFt: 0, mainEdge: null });
check("a walk-out deck 9 ft up: the house stands 18 ft so the door has a wall around it", tall.heightFt === 18);
const knobs = houseHandles(rect, bump, 3.17);
check("knobs: the step at 12 ft on the bump-out's corner, the house's two corners at −4 and 20", knobs.length === 3 && knobs[0].kind === "jog" && knobs[0].x === 12 && knobs[0].y === 3 && knobs[1].kind === "house-left" && knobs[1].x === -4 && knobs[2].kind === "house-right" && knobs[2].x === 20, JSON.stringify(knobs.map((k) => [k.kind, k.x, k.y])));

// ── through the scene and the client's parser
const design = applyDeckPatch(defaultDeckDesign({ state: "WA", frostIn: 18 }), { house: { storeys: 2, jogs: [{ id: "j1", atFt: 12, dir: "toward", depthFt: 3 }] } });
check("the patch notches the deck through the normaliser's own house sync only when the studio asks — here the shape stays a rectangle until the studio reconciles", design.shape.kind === "rect");
const synced = applyDeckPatch(design, { shape: deckShapeForHouse(design.shape, design.house).shape });
const sc = deckScene(buildStructure(synced));
check("the scene's house: two blocks (the bump-out one storey), the door, windows, the roof, the storeys", !!sc.house && sc.house.blocks.length === 2 && sc.house.storeys === 2 && sc.house.roof === "hip" && (sc.house.windows?.length ?? 0) > 0 && !!sc.house.door, JSON.stringify({ blocks: sc.house?.blocks, storeys: sc.house?.storeys }));
check("…and the knobs ride in the scene's handles", sc.handles.some((h) => h.kind === "jog") && sc.handles.some((h) => h.kind === "house-left") && sc.handles.some((h) => h.kind === "house-right"));
const back = parseDeckScene(JSON.parse(JSON.stringify(sc)));
check("the client's parser keeps the five-number blocks, the storeys, the roof and the windows", !!back && !!back.house && back.house.blocks.length === 2 && back.house.blocks[0].length === 5 && back.house.storeys === 2 && back.house.roof === "hip" && (back.house.windows?.length ?? 0) === (sc.house?.windows?.length ?? 0));
check("…and an older scene without them still parses", !!parseDeckScene({ ...JSON.parse(JSON.stringify(sc)), house: { blocks: [[-4, -12, 20, 0]], heightFt: 12, door: [8, 6, 6.67] } }));
check("the 3D's house line is the deck's: the main block's face at y = 0 under the deck", near(sc.house!.blocks[0][3], 0, 1e-9));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);

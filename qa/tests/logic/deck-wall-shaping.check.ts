// SHAPING THE WALL BY THE PAD (2026-10-11 afternoon, lib/deck/house): a part shifted sideways as one piece and held
// clear of its neighbours, a part levelled with the house line, and the one-tap fixes for a wall the deck cannot frame
// around — each one kept only when it makes the note go away. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-wall-shaping.check.ts
import { DECK_LIMITS, type DeckShape } from "../../../src/lib/deck/design";
import { deckShapeForHouse, defaultHouse, levelWallPart, shiftWallPart, wallFixes, wallPartWords, wallParts, type HouseDesign } from "../../../src/lib/deck/house";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const shape: DeckShape = { kind: "rect", widthFt: 16, depthFt: 12 };
const LIM = { minWidthFt: DECK_LIMITS.widthFt.min, maxWidthFt: DECK_LIMITS.widthFt.max };
const at = (h: HouseDesign) => h.jogs.map((j) => j.atFt).join(",");
const resolves = (fixes: ReturnType<typeof wallFixes>) => fixes.every((f) => deckShapeForHouse(f.shape, f.house).note === null);

// A bump-out in the middle of the deck: steps at 6 (out 3) and 10 (back 3).
const mid: HouseDesign = { ...defaultHouse(), jogs: [{ id: "j1", atFt: 6, dir: "toward", depthFt: 3 }, { id: "j2", atFt: 10, dir: "away", depthFt: 3 }] };
const parts = wallParts(mid, shape);
check("the wall is three parts, the middle one out 3 ft", parts.length === 3 && parts[1].depthFt === 3 && parts[0].depthFt === 0, JSON.stringify(parts));
check("a part's words", wallPartWords(parts[1]) === "4 ft wide · comes out 3 ft" && wallPartWords(parts[0]) === "10 ft wide · the house line", wallPartWords(parts[1]));

// Shifting
check("the middle part shifts right as one piece", at(shiftWallPart(mid, shape, 1, 2)) === "8,12");
check("…and left", at(shiftWallPart(mid, shape, 1, -2)) === "4,8");
check("a shift is held a foot clear of the wall's end, the part keeping its width", at(shiftWallPart(mid, shape, 1, 20)) === "15,19" && at(shiftWallPart(mid, shape, 1, -20)) === "-3,1");
const firstR = shiftWallPart(mid, shape, 0, 1);
check("the first part shifts whole: its step and the house's left end together", at(firstR) === "7,10" && firstR.leftFt === mid.leftFt - 1, `${at(firstR)} left ${firstR.leftFt}`);
const firstFar = shiftWallPart(mid, shape, 0, 10);
check("…held a foot short of the next step", at(firstFar) === "9,10" && firstFar.leftFt === 1, `${at(firstFar)} left ${firstFar.leftFt}`);
const oneStep: HouseDesign = { ...defaultHouse(), leftFt: 2, jogs: [{ id: "j1", atFt: 6, dir: "toward", depthFt: 2 }] };
const endHeld = shiftWallPart(oneStep, shape, 0, 10);
check("…and held where the house's left end reaches the deck's (0 ft past)", endHeld.leftFt === 0 && at(endHeld) === "8", `${at(endHeld)} left ${endHeld.leftFt}`);
const lastL = shiftWallPart(mid, shape, 2, -1);
check("the last part shifts whole: its step and the house's right end", at(lastL) === "6,9" && lastL.rightFt === mid.rightFt - 1, `${at(lastL)} right ${lastL.rightFt}`);
check("a straight wall has nothing to shift", shiftWallPart(defaultHouse(), shape, 0, 2) === defaultHouse() || shiftWallPart(defaultHouse(), shape, 0, 2).jogs.length === 0);
check("a zero shift is the same house", shiftWallPart(mid, shape, 1, 0.2) === mid);

// Levelling
const level = levelWallPart(mid, shape, 1);
check("the bump-out levelled: both its steps shrink to nothing", !!level && wallParts(level, shape)[1].depthFt === 0 && level.jogs.every((j) => j.depthFt === 0));
check("the house line cannot be levelled (null); a level part is unchanged", levelWallPart(mid, shape, 0) === null && levelWallPart(level!, shape, 1) === level);

// Fixes: the bump-out inside the deck
const f1 = wallFixes(shape, mid, LIM);
check("inside the deck: a note and fixes that all make it go away", !!deckShapeForHouse(shape, mid).note && f1.length >= 3 && resolves(f1), f1.map((f) => f.id).join(","));
const sh = f1.find((f) => f.id === "shift-to-end");
check("…the bump-out shifted whole to the deck's end (the deck notches), the part levelled, the deck ended at it", !!sh && at(sh.house) === "0,4" && deckShapeForHouse(sh.shape, sh.house).shape.kind === "L" && f1.some((f) => f.id === "level") && f1.some((f) => f.id === "end-at"), sh ? at(sh.house) : "none");
const endAt = f1.find((f) => f.id === "end-at")!;
check("ending the deck at the bump-out leaves the house where it was", endAt.shape.widthFt === 6 && endAt.shape.widthFt + endAt.house.rightFt === shape.widthFt + mid.rightFt && endAt.house.leftFt === mid.leftFt, `w ${endAt.shape.widthFt} right ${endAt.house.rightFt}`);
check("with only 4 ft of wall past the ends the deck cannot slide 6 ft, so no slide is offered", !f1.some((f) => f.id.startsWith("slide")));
const roomy: HouseDesign = { ...mid, leftFt: 10, rightFt: 10 };
const f1b = wallFixes(shape, roomy, LIM);
const slid = f1b.find((f) => f.id.startsWith("slide"));
check("with room past the ends the deck slides so the bump-out sits at its end, the house staying put", !!slid && slid.house.leftFt + slid.house.rightFt === roomy.leftFt + roomy.rightFt && slid.shape === shape && resolves(f1b), f1b.map((f) => f.id).join(","));

// A recess under the deck
const recess: HouseDesign = { ...defaultHouse(), jogs: [{ id: "j1", atFt: 6, dir: "away", depthFt: 2 }, { id: "j2", atFt: 10, dir: "toward", depthFt: 2 }] };
const f2 = wallFixes(shape, recess, LIM);
check("a recess under the deck: levelled, or the deck ended at it / started past it", /steps back/.test(deckShapeForHouse(shape, recess).note ?? "") && f2.some((f) => f.id === "level") && resolves(f2) && f2.length >= 2, f2.map((f) => f.id).join(","));
const recessLeft: HouseDesign = { ...defaultHouse(), rightFt: 8, jogs: [{ id: "j1", atFt: 0, dir: "away", depthFt: 2 }, { id: "j2", atFt: 5, dir: "toward", depthFt: 2 }] };
const f3 = wallFixes(shape, recessLeft, LIM);
check("a recess at the deck's left end, 8 ft of wall past its right end: the deck can slide right past it", f3.some((f) => f.id === "slide-right") && resolves(f3), f3.map((f) => f.id).join(","));
check("with only 4 ft past its right end it cannot (the house's end stops it)", !wallFixes(shape, { ...recessLeft, rightFt: 4 }, LIM).some((f) => f.id === "slide-right"));

// Two bump-outs
const two: HouseDesign = { ...defaultHouse(), jogs: [{ id: "j1", atFt: 2, dir: "toward", depthFt: 2 }, { id: "j2", atFt: 5, dir: "away", depthFt: 2 }, { id: "j3", atFt: 9, dir: "toward", depthFt: 3 }, { id: "j4", atFt: 13, dir: "away", depthFt: 3 }] };
const f4 = wallFixes(shape, two, LIM);
check("two bump-outs inside the deck: every one levelled is the way out", /twice/.test(deckShapeForHouse(shape, two).note ?? "") && f4.some((f) => f.id === "level-all") && resolves(f4), f4.map((f) => f.id).join(","));
const twoEnd: HouseDesign = { ...defaultHouse(), jogs: [{ id: "j1", atFt: 2, dir: "toward", depthFt: 2 }, { id: "j2", atFt: 5, dir: "away", depthFt: 2 }, { id: "j3", atFt: 12, dir: "toward", depthFt: 3 }] };
const f5 = wallFixes(shape, twoEnd, LIM);
check("two bump-outs, one at the end: level the other and the deck wraps the end one", f5.some((f) => f.id === "level-others") && resolves(f5) && deckShapeForHouse(f5.find((f) => f.id === "level-others")!.shape, f5.find((f) => f.id === "level-others")!.house).shape.kind === "L", f5.map((f) => f.id).join(","));

// Nothing to fix
check("a straight wall and a bump-out at the end have no fixes", wallFixes(shape, defaultHouse(), LIM).length === 0 && wallFixes(shape, { ...defaultHouse(), jogs: [{ id: "j1", atFt: 12, dir: "toward", depthFt: 3 }] }, LIM).length === 0);
check("every fix has a distinct id and a label", f1.concat(f2, f3, f4, f5).every((f) => f.label.length > 8) && new Set(f1.map((f) => f.id)).size === f1.length);

console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);

// THE WALL FIELD, SHOWN IN 3D (owner, 2026-10-12: "when I adjust the sides' shape, clicking a box to type in should show
// in the 3D which one it is — make it smart") — pure.
//
// lib/deck/house wallHighlight: the field being typed in (or pointed at) lights its part of the house — boxes on the wall's
// own faces in the scene's feet, and a tag that says what the number is.
//
// Run: npx tsx --tsconfig tsconfig.json qa/tests/logic/deck-wall-highlight.check.ts
import type { DeckShape } from "../../../src/lib/deck/design";
import { defaultHouse, wallHighlight, type HouseDesign } from "../../../src/lib/deck/house";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const deck: DeckShape = { kind: "rect", widthFt: 16, depthFt: 12 };
// The owner's wall: 7'-6" past the left end, 6 ft past the right; at 11 ft the wall steps back 2 ft, at 14 ft it comes out 3 ft.
const house: HouseDesign = { ...defaultHouse(), leftFt: 7.5, rightFt: 6, jogs: [{ id: "j1", atFt: 11, dir: "away", depthFt: 2 }, { id: "j2", atFt: 14, dir: "toward", depthFt: 3 }] };
const heightOf = () => 10;
const words = (h: ReturnType<typeof wallHighlight>) => (h ? `${h.boxes.map((b) => `[${b.map((v) => Math.round(v * 100) / 100).join(", ")}]`).join(" ")} · "${h.tag.text}"` : "null");

const left = wallHighlight(deck, house, { kind: "left" }, heightOf);
check("the wall past the deck's left end: one face from −7.5 ft to the deck's end, on the house line, tagged with its length", !!left && left.boxes.length === 1 && left.boxes[0][0] === -7.5 && left.boxes[0][3] === 0 && Math.abs(left.boxes[0][1]) < 0.1 && left.tag.text === "7'-6\" of wall past the deck's left end", words(left));
const right = wallHighlight(deck, house, { kind: "right" }, heightOf);
check("past the right end: the 6 ft beyond the deck, on the part that comes out (its own face, 1 ft out)", !!right && right.boxes.length === 1 && right.boxes[0][0] === 16 && right.boxes[0][3] === 22 && Math.abs(right.boxes[0][1] - 0.95) < 0.01 && right.tag.text === "6 ft of wall past the deck's right end", words(right));
const step1 = wallHighlight(deck, house, { kind: "step", id: "j1" }, heightOf);
check("Step 1's place: a marker at 11 ft across the return wall (house line to 2 ft back), tagged where it is", !!step1 && step1.boxes.length === 1 && Math.abs((step1.boxes[0][0] + step1.boxes[0][3]) / 2 - 11) < 0.01 && step1.boxes[0][1] <= -2 && step1.tag.text === "Step 1 · 11 ft from the deck's left end", words(step1));
const part1 = wallHighlight(deck, house, { kind: "part", id: "j1" }, heightOf);
check("Step 1's \"the wall to its right\" and \"by\": the stretch from 11 to 14 ft at its face 2 ft back, and the step", !!part1 && part1.boxes.length === 2 && part1.boxes[0][0] === 11 && part1.boxes[0][3] === 14 && Math.abs(part1.boxes[0][1] + 2.05) < 0.01 && part1.tag.text === "Step 1 · the wall to its right steps back 2 ft", words(part1));
const part2 = wallHighlight(deck, house, { kind: "part", id: "j2" }, heightOf);
check("Step 2's: the stretch from 14 ft to the house's end, 1 ft out", !!part2 && part2.boxes[0][0] === 14 && part2.boxes[0][3] === 22 && part2.tag.text === "Step 2 · the wall to its right comes out 3 ft", words(part2));
const flush = wallHighlight(deck, { ...defaultHouse(), leftFt: 0 }, { kind: "left" }, heightOf);
check("no wall past the left end: a marker at the deck's end, \"The wall ends at the deck's left end\"", !!flush && flush.boxes.length === 1 && flush.boxes[0][3] - flush.boxes[0][0] < 0.5 && flush.tag.text === "The wall ends at the deck's left end", words(flush));
const past = wallHighlight(deck, { ...house, jogs: [{ id: "k", atFt: -3, dir: "toward", depthFt: 2 }] }, { kind: "step", id: "k" }, heightOf);
check("a step past the deck's left end says so", !!past && past.tag.text === "Step 1 · 3 ft past the deck's left end", words(past));
check("a step that is gone: nothing lit", wallHighlight(deck, house, { kind: "step", id: "nope" }, heightOf) === null);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);

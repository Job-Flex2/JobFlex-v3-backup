// DRAG THE WALL ANYWHERE (owner, 2026-10-12: "I still don't like how the steps of the house's back wall are made — just
// drag the back wall in or out at any place to make the shape of the house you want; make it smart") — pure.
//
// lib/deck/house pullSectionAt / setSectionDepth: grabbed anywhere on the house line and pulled out (or pushed in), a
// section of the wall comes with the pointer right there — 8 ft wide round the grab, run on to the house's end when
// grabbed near it, its edges snapped to the deck's ends; behind the deck it stays narrower than the house line left on
// either side, so the deck keeps standing on the house line; back to nothing, the wall is straight again.
//
// Run: npx tsx --tsconfig tsconfig.json qa/tests/logic/deck-wall-pull.check.ts
import { HOUSE_LIMITS, defaultHouse, pullSectionAt as pullOrWhy, referencePartIndex, setSectionDepth, wallParts, type HouseDesign, type WallSection } from "../../../src/lib/deck/house";
import type { DeckShape } from "../../../src/lib/deck/design";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const deck: DeckShape = { kind: "rect", widthFt: 16, depthFt: 12 };
const pullSectionAt = (h: HouseDesign, sh: DeckShape, x: number, d: number): { house: HouseDesign; section: WallSection } | null => {
  const r = pullOrWhy(h, sh, x, d);
  return "why" in r ? null : r;
};
const wide: HouseDesign = { ...defaultHouse(), leftFt: 14, rightFt: 10 };
const partsWords = (h: HouseDesign) => wallParts(h, deck).map((p) => `[${p.x0}…${p.x1}${p.depthFt ? ` ${p.depthFt > 0 ? "+" : ""}${p.depthFt}` : ""}]`).join(" ");
const refOf = (h: HouseDesign) => {
  const parts = wallParts(h, deck);
  return parts[referencePartIndex(parts, deck)];
};

// 1. Beside the deck: grabbed 7 ft past its left end, pulled out 4 ft.
const a = pullSectionAt(wide, deck, -7, 4);
const aParts = a ? wallParts(a.house, deck) : [];
const aSec = aParts.find((p) => p.x0 <= -7 && p.x1 >= -7);
check("grabbed 7 ft past the deck's left end and pulled out 4 ft: an 8-ft section round the grab comes out 4 ft, two steps", !!a && a.section.ids.length === 2 && !!aSec && aSec.depthFt === 4 && aSec.x1 - aSec.x0 === 8 && aSec.x0 === -11, a ? partsWords(a.house) : "null");
check("…and the deck still stands on the house line (the part under it at depth 0)", !!a && refOf(a.house).depthFt === 0 && refOf(a.house).x0 <= 0 && refOf(a.house).x1 >= 16);
// The drag goes on: deeper, then pushed in past the wall, then back to nothing.
const a2 = a ? setSectionDepth(a.house, a.section, 6.5) : null;
check("…dragged further: 6½ ft out", !!a2 && wallParts(a2, deck).some((p) => p.x0 === -11 && p.depthFt === 6.5), a2 ? partsWords(a2) : "");
const a3 = a ? setSectionDepth(a.house, a.section, -3) : null;
check("…dragged back past the wall: a nook 3 ft in", !!a3 && wallParts(a3, deck).some((p) => p.x0 === -11 && p.depthFt === -3), a3 ? partsWords(a3) : "");
const a4 = a ? setSectionDepth(a.house, a.section, 0) : null;
check("…and back to nothing: the wall is straight again", !!a4 && a4.jogs.length === 0, a4 ? partsWords(a4) : "");

// 2. Near the house's right end: the section runs on to the end (one step).
const b = pullSectionAt(wide, deck, 24, 5);
const bParts = b ? wallParts(b.house, deck) : [];
check("grabbed 2 ft from the house's right end, pulled out 5 ft: the section runs on to the end, one step", !!b && b.section.ids.length === 1 && bParts[bParts.length - 1].depthFt === 5 && bParts[bParts.length - 1].x1 === 26, b ? partsWords(b.house) : "null");

// 3. Behind the deck, pushed in: a nook, the house line kept on both sides of it.
const c = pullSectionAt(wide, deck, 8, -3);
const cRef = c ? refOf(c.house) : null;
check("grabbed behind the middle of the deck and pushed in 3 ft: a nook there, narrower than the house line left on either side", !!c && !!cRef && cRef.depthFt === 0 && wallParts(c.house, deck).some((p) => p.depthFt === -3 && p.x0 > 0 && p.x1 < 16), c ? partsWords(c.house) : "null");

// 4. Near the deck's right end: the section's edge snaps to it.
const d = pullSectionAt(wide, deck, 19, 4);
check("grabbed 3 ft past the deck's right end: the section's left edge snaps to the deck's end", !!d && wallParts(d.house, deck).some((p) => p.x0 === 16 && p.depthFt === 4), d ? partsWords(d.house) : "null");

// 5. No steps left: nothing.
let full: HouseDesign = wide;
for (const x of [-12, -4, 20]) {
  const m = pullSectionAt(full, deck, x, 2);
  if (m) full = m.house;
}
check(`the wall full of steps (${HOUSE_LIMITS.jogs} at most): one more pull gives nothing`, full.jogs.length >= HOUSE_LIMITS.jogs - 1 && pullSectionAt(full, deck, 8, 2) === null, `${full.jogs.length} steps · ${partsWords(full)}`);

// 6. A nook made behind the deck, then the wall grabbed again beside it: the deck stays on the house line.
const nook = pullSectionAt(wide, deck, 8, -3);
const again = nook ? pullOrWhy(nook.house, deck, 2, 3) : null;
const againRef = again && !("why" in again) ? refOf(again.house) : null;
check("a nook behind the deck, then the house line grabbed again beside it: either a narrower section that leaves the deck on the house line, or a word why not", !!nook && !!again && ("why" in again ? again.why === "line" : !!againRef && againRef.depthFt === 0 && wallParts(again.house, deck).some((q) => q.depthFt === -3)), again ? ("why" in again ? `why: ${again.why}` : partsWords(again.house)) : "null");

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);

// THE DECK FOLLOWS THE HOUSE WALL (owner, 2026-10-19, a 47½ × 18½-ft deck along a wall that steps back 5½ ft for
// 11 ft: "deck should follow house wall when moving wall in set out set, make better"). lib/deck/house
// deckShapeForHouse → shape kind "wall"; lib/deck/design zones / edges / outline; and the whole build on it — framing
// off each part's ledger, decking over the set-back, rails only on the open sides, the 3D, the price. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-wall-follow.check.ts
import { applyDeckPatch, checkSummary, deckChecks } from "../../../src/lib/deck/checks";
import { defaultDeckDesign, hasLowerLevel, normalizeDeckDesign, shapeAreaSqFt, shapeEdges, shapeOutline, shapeZones, sizeWords, spaRectIn, type DeckDesign, type DeckShape } from "../../../src/lib/deck/design";
import { deckShapeForHouse, levelUnderDeck, moveWallPart, wallParts, wallWords, type HouseDesign } from "../../../src/lib/deck/house";
import { priceStructure } from "../../../src/lib/deck/pricing";
import { deckScene } from "../../../src/lib/deck/scene";
import { buildStructure } from "../../../src/lib/deck/structure";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

/** The studio's own rule (deck-studio patch): a change to the house re-fits the deck to it. */
function withHouse(d: DeckDesign, house: Partial<HouseDesign>): DeckDesign {
  let next = applyDeckPatch(d, { house });
  const fit = deckShapeForHouse(next.shape, next.house);
  if (JSON.stringify(fit.shape) !== JSON.stringify(next.shape)) next = applyDeckPatch(next, { shape: fit.shape });
  return next;
}

// The owner's picture: the house line for 29½ ft, then 11 ft set back 5½ ft, then 7½ ft level again.
const base = applyDeckPatch(defaultDeckDesign({ state: "WA", frostIn: 18 }), { shape: { kind: "rect", widthFt: 47.5, depthFt: 18.5 }, heightIn: 30 });
const owner = withHouse(base, { leftFt: 0, rightFt: 0, jogs: [{ id: "j1", atFt: 29.5, dir: "away", depthFt: 5.5 }, { id: "j2", atFt: 40.5, dir: "toward", depthFt: 5.5 }] });
const sh = owner.shape;
console.log("── the shape");
check("the deck follows the wall: three parts — the house line, 5½ ft back for 11 ft, the house line", sh.kind === "wall" && sh.back.map((b) => `${b.x0Ft}-${b.x1Ft}@${b.yFt}`).join(" ") === "0-29.5@0 29.5-40.5@-5.5 40.5-47.5@0", JSON.stringify(sh));
check("its size stays the contractor's: 47½ ft along the house, 18½ ft out from the house line", sh.widthFt === 47.5 && sh.depthFt === 18.5);
check("no note: nothing for the contractor to fix", deckShapeForHouse(owner.shape, owner.house).note === null);
check("the area takes in the set-back: 47½ × 18½ + 11 × 5½ = 939.25 sq ft", Math.abs(shapeAreaSqFt(sh) - 939.25) < 0.01, `${shapeAreaSqFt(sh)}`);
const zones = shapeZones(sh);
check("one framing zone per part, the set-back's starting 66 in. behind the house line", zones.length === 3 && zones[1].y0 === -66 && zones[0].y0 === 0 && zones.every((z) => z.y1 === 222), JSON.stringify(zones));
const edges = shapeEdges(sh, "attached");
const houseEdges = edges.filter((e) => e.house);
check("on the house: the three backs and the set-back's two side faces (47½ + 11 ft of wall)", houseEdges.length === 5 && houseEdges.reduce((a, e) => a + e.lengthIn, 0) / 12 === 58.5, houseEdges.map((e) => `${e.side}:${e.lengthIn}`).join(" "));
check("open to the yard: the front and the two ends", edges.filter((e) => !e.house).map((e) => e.side).sort().join(",") === "front,left,right");
const ring = shapeOutline(sh);
check("the outline steps back with the wall: 8 corners, the deepest at y = -66 in.", ring.length === 8 && Math.min(...ring.map((p) => p.y)) === -66, JSON.stringify(ring));
check("the size in words says so", /following the house wall/.test(sizeWords(owner)), sizeWords(owner));
check("the wall in words: 3 parts, 11 ft reaching 5.5 ft back", /follows the wall, 3 parts — 29\.5 ft on the house line, 11 ft reaching 5\.5 ft back, 7 ft on the house line/.test(wallWords(owner.shape, owner.house)), wallWords(owner.shape, owner.house));
const saved = normalizeDeckDesign(JSON.parse(JSON.stringify(owner)));
check("saved and opened again (a proposal), the shape is the same", JSON.stringify(saved.shape) === JSON.stringify(owner.shape));

console.log("── the build on it");
const s = buildStructure(owner);
const f = s.frame!;
check("a frame is built", !!f && f.zones.length === 3);
const ledgerYs = [...new Set(f.ledgers.map((l) => l.y))].sort((a, b) => a - b);
check("a ledger on each wall the deck meets: the house line and the set-back's wall", ledgerYs.length === 2 && ledgerYs[0] < -60 && Math.abs(ledgerYs[1]) < 3, JSON.stringify(f.ledgers.map((l) => ({ y: l.y, x0: l.x0, x1: l.x1 }))));
check("the ledgers run every back the deck meets — 47½ ft of wall", Math.abs(f.ledgers.reduce((a, l) => a + l.lengthIn, 0) / 12 - 47.5) < 0.6, `${f.ledgers.reduce((a, l) => a + l.lengthIn, 0) / 12} ft`);
const deepJoists = f.joists.filter((j) => j.zoneId === zones[1].id);
check("joists fill the set-back too", deepJoists.length >= 6, `${deepJoists.length} in the set-back`);
const sum = checkSummary(deckChecks(s));
check("nothing in the checks fails", sum.fail === 0, deckChecks(s).filter((c) => c.level === "fail").map((c) => c.text).join(" | ").slice(0, 300));
check("the area the frame prices is the outline's", Math.abs(f.areaSqFt - 939.25) < 1, `${f.areaSqFt}`);
const boards = s.surface!.pieces;
check("deck boards cover the set-back too, right up to its wall (the 3D showed bare joists there)", boards.some((b) => b.cy < -60 && b.cx > 354 && b.cx < 486) && !boards.some((b) => b.cy < -1 && (b.cx + b.sx / 2 <= 354 || b.cx - b.sx / 2 >= 486)), `${boards.filter((b) => b.cy < 0).length} board pieces behind the house line`);
const plainS = buildStructure(base);
const boughtFt = (st: typeof s) => st.surface!.pieces.reduce((a, b) => a + b.sx * b.sy, 0) / 144;
// Board faces only (the gaps between boards are not counted), so compare against the plain deck's own cover.
check("…so the boards cover the set-back's 60½ sq ft more than the plain deck's (within 2%)", Math.abs(boughtFt(s) / boughtFt(plainS) - 939.25 / 878.75) < 0.02, `${boughtFt(plainS).toFixed(0)} → ${boughtFt(s).toFixed(0)} sq ft of board faces`);
const rails = s.rails;
const railOnWall = rails.segments.some((g) => g.y0 === g.y1 && g.y0 < 6 && g.y0 > -80 && g.x0 > 1 && g.x1 < 47.5 * 12 - 1);
check("the rail runs the open sides only — none along the wall or into the set-back", !railOnWall, rails.segments.map((g) => `${Math.round(g.x0)},${Math.round(g.y0)}→${Math.round(g.x1)},${Math.round(g.y1)}`).join(" "));
const sc = deckScene(s);
const minY = Math.min(...sc.boxes.filter((b) => b[0] !== "house").map((b) => (b[2] as number) - (b[5] as number) / 2));
check("the 3D reaches back into the set-back (≈ -5½ ft), no further", minY < -5 && minY > -6.2, `${minY.toFixed(2)} ft`);
const pkg = priceStructure(s);
check("it prices: footings, ledger, framing, decking, fascia and a total", ["deck-footings", "deck-ledger", "deck-framing", "deck-decking"].every((id) => pkg.lines.some((l) => l.id === id)) && pkg.subtotal > 0, `$${Math.round(pkg.subtotal)}`);
const plain = priceStructure(buildStructure(base));
check("…more than the same deck without the set-back (60½ sq ft more deck)", pkg.subtotal > plain.subtotal, `$${Math.round(plain.subtotal)} → $${Math.round(pkg.subtotal)}`);

console.log("── moving the wall: the deck follows");
const parts = wallParts(owner.house, owner.shape);
const deeper = withHouse(owner, moveWallPart(owner.house, owner.shape, 1, -1)!);
check("the set-back pushed 1 ft deeper: the deck reaches 6½ ft back", deeper.shape.kind === "wall" && deeper.shape.back[1].yFt === -6.5, JSON.stringify(deeper.shape));
const out = withHouse(owner, moveWallPart(owner.house, owner.shape, 1, 8.5)!);
check("the same part pulled out 3 ft past the house line: the deck steps around it", out.shape.kind === "wall" && out.shape.back[1].yFt === 3 && deckShapeForHouse(out.shape, out.house).note === null, JSON.stringify(out.shape));
const outS = buildStructure(out);
check("…framed in front of the bump-out on its ledger, nothing failing", !!outS.frame && outS.frame.ledgers.some((l) => Math.abs(l.y - 36) < 3) && checkSummary(deckChecks(outS)).fail === 0, JSON.stringify(outS.frame?.ledgers.map((l) => l.y)));
const outBoards = outS.surface!.pieces;
check("…no deck board runs through the bump-out: the rows break around it", !outBoards.some((b) => b.cy > 0 && b.cy < 36 && b.cx + b.sx / 2 > 355 && b.cx - b.sx / 2 < 485) && outBoards.some((b) => b.cy > 40 && b.cx > 360 && b.cx < 480), `${outBoards.filter((b) => b.cy > 0 && b.cy < 36 && b.cx + b.sx / 2 > 355 && b.cx - b.sx / 2 < 485).length} inside`);
check("…and the area gives up the bump-out (47½ × 18½ − 11 × 3 = 845.75 sq ft)", Math.abs(shapeAreaSqFt(out.shape) - 845.75) < 0.01, `${shapeAreaSqFt(out.shape)}`);
const level = withHouse(owner, levelUnderDeck(owner.house, owner.shape));
check("Straighten the wall under the deck: a plain rectangle again", level.shape.kind === "rect" && wallParts(level.house, level.shape).every((p) => p.depthFt === 0) && parts.length === 3);
const wider = applyDeckPatch(owner, { shape: { ...owner.shape, widthFt: 50 } });
const wfit = deckShapeForHouse(wider.shape, wider.house);
check("a deck made wider keeps following (the last part runs to its new end)", wfit.shape.kind === "wall" && wfit.shape.back[wfit.shape.back.length - 1].x1Ft === 50, JSON.stringify(wfit.shape));

console.log("── what it cannot follow, and the rest of the deck");
const bowed: DeckShape = { kind: "rect", widthFt: 47.5, depthFt: 18.5, front: { kind: "curve", bulgeFt: 2, clipFt: 2 } };
const bowFit = deckShapeForHouse(bowed, owner.house);
check("a bowed front keeps its shape and says why (the deck follows the wall with a straight front)", bowFit.shape === bowed && /straight front/.test(bowFit.note ?? ""));
const sliver = withHouse(base, { leftFt: 0, rightFt: 0, jogs: [{ id: "j1", atFt: 20, dir: "away", depthFt: 2 }, { id: "j2", atFt: 21.5, dir: "toward", depthFt: 2 }] });
check("a set-back under 2 ft wide is bridged — no 18-in. strip of deck to frame", sliver.shape.kind === "rect" && deckShapeForHouse(sliver.shape, sliver.house).note === null, JSON.stringify(sliver.shape));
const chimney = withHouse(base, { leftFt: 0, rightFt: 0, jogs: [{ id: "j1", atFt: 20, dir: "toward", depthFt: 2 }, { id: "j2", atFt: 21.5, dir: "away", depthFt: 2 }] });
check("…but a narrow part that comes out (a chimney) is still stepped around — the deck never runs into the wall", chimney.shape.kind === "wall" && chimney.shape.back.some((b) => b.yFt === 2 && b.x1Ft - b.x0Ft === 1.5), JSON.stringify(chimney.shape));
check("…and framed with nothing failing", checkSummary(deckChecks(buildStructure(chimney))).fail === 0, deckChecks(buildStructure(chimney)).filter((c) => c.level === "fail").map((c) => c.text).join(" | ").slice(0, 300));
const shallow = applyDeckPatch(base, { shape: { kind: "rect", widthFt: 47.5, depthFt: 12 } });
const fat = withHouse(shallow, { leftFt: 0, rightFt: 0, jogs: [{ id: "j1", atFt: 20, dir: "toward", depthFt: 11 }, { id: "j2", atFt: 30, dir: "away", depthFt: 11 }] });
check("a bump-out 11 ft out under a 12-ft deck: held at 9 ft (3 ft kept in front), and the note says so", fat.shape.kind === "wall" && fat.shape.back[1].yFt === 9 && /held at 9 ft/.test(deckShapeForHouse(fat.shape, fat.house).note ?? ""), JSON.stringify(fat.shape));
const spa = applyDeckPatch(owner, { spa: { on: true } });
check("a hot-tub spot on a deck that follows the wall", !!spaRectIn(spa), JSON.stringify(spaRectIn(spa)));
const lower = applyDeckPatch(owner, { lower: { on: true } });
check("a lower level in front of it", hasLowerLevel(lower) && !!buildStructure(lower).lower);
const junk = normalizeDeckDesign({ ...owner, shape: { kind: "wall", widthFt: 20, depthFt: 12, back: [{ x0Ft: 0, x1Ft: 30, yFt: 0 }] } });
check("a wall shape with nothing stepping is read back as a rectangle", junk.shape.kind === "rect");
const wild = normalizeDeckDesign({ ...owner, shape: { kind: "wall", widthFt: 20, depthFt: 12, back: [{ x0Ft: 0, x1Ft: 8, yFt: 0 }, { x0Ft: 8, x1Ft: 14, yFt: 40 }, { x0Ft: 14, x1Ft: 20, yFt: -90 }] } });
check("a wild one is held buildable: a 3-ft leg kept in front, 16 ft of reach at most", wild.shape.kind === "wall" && wild.shape.back[1].yFt === 9 && wild.shape.back[2].yFt === -16, JSON.stringify(wild.shape));

console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);

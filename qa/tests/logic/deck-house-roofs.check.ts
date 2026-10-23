// The house's roofs and what stands against it (2026-10-23, lib/deck/house): one roof over the body the whole length
// of the house and one over each bump-out against it, in every shape (hip, gable either way, shed, flat) at its pitch;
// the body behind its main wall (the widest face), a set-back part under the roof's eave, a one-storey bump-out on a
// two-storey house with the body carrying on behind it; the pieces through the scene and the client's parser; the
// photo's roof shapes and pitch. Pure.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-house-roofs.check.ts
import { HOUSE_BODY_FT, HOUSE_PITCH_DEFAULT, HOUSE_ROOFS, ROOF_PIECE, defaultHouse, houseScene, houseWords, normalizeHouse, roofPitch, type HouseDesign, type HouseRoof } from "@/lib/deck/house";
import { defaultDeckDesign, type DeckShape } from "@/lib/deck/design";
import { applyDeckPatch } from "@/lib/deck/checks";
import { buildStructure } from "@/lib/deck/structure";
import { deckScene, parseDeckScene } from "@/lib/deck/scene";
import { parseHouseRead } from "@/lib/deck/houseRead";
import { houseFromPhoto } from "@/lib/deck/houseFromPhoto";

let bad = 0;
const check = (name: string, ok: boolean, info = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !info ? "" : `  — ${info}`}`);
};

const rect: DeckShape = { kind: "rect", widthFt: 16, depthFt: 12 };
const ctx = { deckHeightFt: 3, peakFt: 0, mainEdge: null };
const plain: HouseDesign = { ...defaultHouse(), leftFt: 6, rightFt: 6 };
const bump: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 18, dir: "toward", depthFt: 4 }] };

console.log("— every roof shape —");
const MAIN: Record<HouseRoof, number> = { hip: ROOF_PIECE.hip, gable: ROOF_PIECE.gable, "gable-end": ROOF_PIECE["gable-end"], shed: ROOF_PIECE.shed, flat: ROOF_PIECE.flat };
const BUMP: Record<HouseRoof, number> = { hip: ROOF_PIECE.bumpHip, gable: ROOF_PIECE.bumpGable, "gable-end": ROOF_PIECE.bumpGable, shed: ROOF_PIECE.bumpShed, flat: ROOF_PIECE.bumpFlat };
for (const roof of HOUSE_ROOFS) {
  const hs = houseScene(rect, { ...bump, roof }, ctx);
  check(`${roof}: one roof over the body (${MAIN[roof]}) the whole house long, the bump-out's own (${BUMP[roof]}) against it`, hs.roofs?.length === 2 && hs.roofs[0][0] === MAIN[roof] && hs.roofs[0][1] === -6 && hs.roofs[0][3] === 22 && hs.roofs[1][0] === BUMP[roof] && hs.roofs[1][1] === 18 && hs.roofs[1][2] === 0 && hs.roofs[1][4] === 4, JSON.stringify(hs.roofs));
}
check("each shape's own pitch by default: 6/12, a shed 3/12, a flat roof a quarter", HOUSE_ROOFS.every((r) => roofPitch({ ...plain, roof: r }) === HOUSE_PITCH_DEFAULT[r]) && HOUSE_PITCH_DEFAULT.shed === 3);
check("a pitch set is the roof's (a flat roof stays flat)", houseScene(rect, { ...plain, pitch: 8 }, ctx).roofs?.[0][6] === 8 && roofPitch({ ...plain, roof: "flat", pitch: 8 }) === 0.25);
check("a pitch is read back held to 1–14 in half inches; none set reads back as none", normalizeHouse({ ...plain, pitch: 40 }, rect).pitch === 14 && normalizeHouse({ ...plain, pitch: 4.3 }, rect).pitch === 4.5 && normalizeHouse(plain, rect).pitch === undefined);
check("every shape reads back; a made-up one is a hip", HOUSE_ROOFS.every((r) => normalizeHouse({ ...plain, roof: r }, rect).roof === r) && normalizeHouse({ ...plain, roof: "mansard" }, rect).roof === "hip");
check("the words say the shape and its pitch", /gable roof, its end to the yard 9\/12/.test(houseWords({ ...plain, roof: "gable-end", pitch: 9 })));

console.log("— the body and its parts —");
const one = houseScene(rect, bump, ctx);
check("one storey: the bump-out as tall as the body", one.blocks.every((b) => b[4] === one.heightFt));
const two = houseScene(rect, { ...bump, storeys: 2 }, ctx);
const bo = two.blocks.find((b) => b[1] === 0)!;
check("two storeys: the body two storeys the whole length — behind the bump-out too — the bump-out one storey under its own roof at its own eave", two.blocks.filter((b) => b[3] === 0).every((b) => b[4] === two.heightFt) && bo[4] < two.heightFt && two.roofs![1][5] === bo[4]);
check("…unless the bump-out was seen as tall as the house", houseScene(rect, { ...bump, storeys: 2, bumpOuts: "full" }, ctx).blocks.every((b, _i, all) => b[4] === all[0][4]));
const recess: HouseDesign = { ...plain, jogs: [{ id: "j1", atFt: 4, dir: "away", depthFt: 3 }, { id: "j2", atFt: 12, dir: "toward", depthFt: 3 }] };
const rs = houseScene({ kind: "rect", widthFt: 20, depthFt: 12 }, recess, ctx);
// The deck stands in the set-back part (its house line), so the main wall — the widest face — is 3 ft out from it.
const main = rs.roofs![0][4];
check("a part set back 3 ft is the body's own wall, set back behind the main wall; one roof runs over it to the main wall", main === 3 && rs.blocks.some((b) => b[0] === 4 && b[3] === main - 3 && b[1] === main - HOUSE_BODY_FT) && rs.roofs!.length === 1, JSON.stringify({ blocks: rs.blocks, roofs: rs.roofs }));
const nook: HouseDesign = { ...plain, leftFt: 4, rightFt: 4, jogs: [{ id: "j1", atFt: 0, dir: "away", depthFt: 6 }, { id: "j2", atFt: 16, dir: "toward", depthFt: 6 }] };
const nk = houseScene(rect, nook, ctx);
check("a deck in a nook: the main wall is the one behind the deck (the widest), the two sides stand out in front, each under its own roof", nk.roofs!.length === 3 && nk.roofs![0][4] === 0 && nk.roofs!.slice(1).every((r) => r[0] === ROOF_PIECE.bumpHip && r[4] === 6), JSON.stringify(nk.roofs));

console.log("— through the scene —");
const d = applyDeckPatch(defaultDeckDesign({ state: "WA" }), { house: { ...bump, storeys: 2, roof: "gable-end", pitch: 7 } });
const sc = deckScene(buildStructure(d));
check("the scene carries the roof pieces", sc.house?.roofs?.length === 2 && sc.house.roofs[0][0] === ROOF_PIECE["gable-end"] && sc.house.roofs[0][6] === 7 && sc.house.roof === "gable-end");
const back = parseDeckScene(JSON.parse(JSON.stringify(sc)));
check("…and the client's parser keeps them and the shape", JSON.stringify(back?.house?.roofs) === JSON.stringify(sc.house?.roofs) && back?.house?.roof === "gable-end");
const broken = JSON.parse(JSON.stringify(sc));
broken.house.roofs[1] = [99, 0, 0, 1, 1, 9, 6];
check("a broken roof piece drops the pieces (a roof per block, as an older scene draws)", parseDeckScene(broken)?.house?.roofs === undefined && !!parseDeckScene(broken)?.house);
const many = JSON.parse(JSON.stringify(sc));
many.house.blocks = Array.from({ length: 14 }, (_, i) => [i * 2, -24, i * 2 + 2, 0, 12]);
check("a house of fourteen blocks still parses (up to sixteen)", parseDeckScene(many)?.house?.blocks.length === 14);

console.log("— the photo's roof —");
const RAW = { base: { left: { x: 0.1, y: 0.8 }, right: { x: 0.9, y: 0.8 } }, eave: { left: { x: 0.1, y: 0.5 }, right: { x: 0.9, y: 0.5 } }, storeys: 1, jogs: [], windows: [], doors: [] };
for (const [kind, want] of [["gable-end", "gable-end"], ["gable-side", "gable"], ["shed", "shed"], ["flat", "flat"], ["hip", "hip"]] as const) {
  const read = parseHouseRead({ ...RAW, roof: { kind, pitch: kind === "flat" ? null : 8 } })!;
  const b = houseFromPhoto({ read, photoW: 1000, photoH: 800, deckWidthFt: 16, house: defaultHouse() })!;
  check(`a ${kind} roof read off the photo is a ${want} roof${kind === "flat" ? "" : " at its 8/12"}`, b.house.roof === want && (kind === "flat" ? b.house.pitch === undefined : b.house.pitch === 8) && !b.checks.some((c) => /drawn as a low hip/.test(c)));
}
const kept = houseFromPhoto({ read: parseHouseRead({ ...RAW, roof: { kind: "hip", pitch: null } })!, photoW: 1000, photoH: 800, deckWidthFt: 16, house: { ...defaultHouse(), pitch: 9 } })!;
check("no pitch seen: the one already set stays while the shape is the same", kept.house.pitch === 9);
const dropped = houseFromPhoto({ read: parseHouseRead({ ...RAW, roof: { kind: "shed", pitch: null } })!, photoW: 1000, photoH: 800, deckWidthFt: 16, house: { ...defaultHouse(), pitch: 9 } })!;
check("…and goes when the shape changes (a shed takes its own 3/12)", dropped.house.pitch === undefined && roofPitch(dropped.house) === 3);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);

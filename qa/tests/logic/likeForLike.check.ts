// Like-for-like defaults for the roof package builder (owner, 2026-09-14): a
// roof the aerial data calls "Tile" must start as tile, the shingle default
// stays for an unknown material, and the underlayment follows the family.
//   npx tsx qa/tests/logic/likeForLike.check.ts
import { BUILTIN_LISTS, familyOfMaterial, likeForLikeSystem } from "../../../src/lib/roofPackage/catalog";
import { defaultSpec, underlaymentForFamily, type RoofFacts } from "../../../src/lib/roofPackage/takeoff";

const facts = (m: string | null): RoofFacts => ({
  squares: 43.1, squaresBasis: "measured", pitchFamilies: [{ pitch12: 5, share: 1 }], pitchBasis: "measured",
  perimeterFt: 240, footprintSqft: 2880, chimney: false, rooftopAcCount: 0, shape: "hip", facetCount: 6, measured: null, existingMaterial: m,
});
let bad = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const words: Array<[string | null, string | null]> = [
  ["Tile", "tile"], ["Concrete Tile", "tile"], ["Clay tile", "tile"], ["Asphalt Shingle", "asphalt"], ["Composition", "asphalt"],
  ["Metal", "metal"], ["Standing seam", "metal"], ["Wood Shake", "shake"], ["Slate", "slate"], ["Flat / Membrane", "low-slope"],
  ["EPDM", "low-slope"], ["Unknown", null], ["Other", null], ["", null], [null, null],
];
for (const [w, fam] of words) check(`"${w}" → ${String(fam)}`, familyOfMaterial(w) === fam, `got ${String(familyOfMaterial(w))}`);

const tile = defaultSpec(facts("Tile"), BUILTIN_LISTS);
check("tile roof starts as concrete tile", tile.systemId === "concrete_tile", tile.systemId);
check("tile roof gets high-temp synthetic", tile.underlaymentId === "synthetic_premium", tile.underlaymentId);
check("tile waste follows the system", tile.wastePct === 12, String(tile.wastePct));
const none = defaultSpec(facts(null), BUILTIN_LISTS);
check("unknown material keeps the shingle default", none.systemId === "architectural" && none.underlaymentId === "synthetic", `${none.systemId}/${none.underlaymentId}`);
const metal = defaultSpec(facts("Metal"), BUILTIN_LISTS);
check("metal roof starts as standing seam", metal.systemId === "standing_seam" && metal.underlaymentId === "synthetic_premium", `${metal.systemId}/${metal.underlaymentId}`);
const flat = defaultSpec(facts("Flat"), BUILTIN_LISTS);
check("flat roof starts as TPO with no underlayment line", flat.systemId === "tpo" && flat.underlaymentId === "none", `${flat.systemId}/${flat.underlaymentId}`);
const noTile = { systems: BUILTIN_LISTS.systems.filter((s) => s.family !== "tile"), underlayments: BUILTIN_LISTS.underlayments };
check("catalog without tile falls back to the shingle default", defaultSpec(facts("Tile"), noTile).systemId === "architectural" && likeForLikeSystem("tile", noTile) === null);
const clayFirst = { systems: [BUILTIN_LISTS.systems.find((s) => s.id === "clay_tile")!, ...BUILTIN_LISTS.systems.filter((s) => s.id !== "clay_tile" && s.id !== "concrete_tile")], underlayments: BUILTIN_LISTS.underlayments };
check("catalog with only clay tile starts as clay", defaultSpec(facts("Tile"), clayFirst).systemId === "clay_tile");
check("underlayment for slate is high-temp", underlaymentForFamily("slate", BUILTIN_LISTS)?.id === "synthetic_premium");
check("underlayment for asphalt is synthetic", underlaymentForFamily("asphalt", BUILTIN_LISTS)?.id === "synthetic");

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);

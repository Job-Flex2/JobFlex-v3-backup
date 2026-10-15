// The fixes from the 2026-09-14 adversarial review of flat roofs and commercial
// pricing: system switches, saved preferences, catalog upgrades, report merges,
// client scope, and the smaller pricing rules.
//   npx tsx qa/tests/logic/roofReview.check.ts
import "../_lib/_server-only"; // `server-only` outside Next — see the file
import { BUILTIN_LISTS, type CatalogLists } from "../../../src/lib/roofPackage/catalog";
import { buildRoofPackage, defaultSpec, likeForLikeFamily, withJobClass, withMeasured, withSystem, type RoofFacts, type RoofPackage, type RoofPackageSpec } from "../../../src/lib/roofPackage/takeoff";
import { applyPickedPrices, applyPrefs, familyFit, pickSystemOn, prefsOf, reconcile, upgradeLists, type Prefs } from "../../../src/components/v3/roof-estimator-blueprint/roof-package-builder";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const has = (p: RoofPackage, re: RegExp) => [...p.materials, ...p.labor].some((l) => re.test(l.name));
const line = (p: RoofPackage, re: RegExp) => [...p.materials, ...p.labor].find((l) => re.test(l.name));
const total = (p: RoofPackage) => [...p.materials, ...p.labor].reduce((a, l) => a + l.quantity * l.unitPrice, 0);
const sys = (id: string) => BUILTIN_LISTS.systems.find((s) => s.id === id)!;
const L = BUILTIN_LISTS;
const house = (over: Partial<RoofFacts> = {}): RoofFacts => ({
  squares: 25, squaresBasis: "measured", pitchFamilies: [{ pitch12: 5, share: 1 }], pitchBasis: "measured", perimeterFt: 200, footprintSqft: 2200,
  chimney: false, rooftopAcCount: 0, shape: "Hip", facetCount: 6, measured: null, existingMaterial: null, facetConfidence: null, buildingUse: null, ...over,
});
const flat = (over: Partial<RoofFacts> = {}) => house({ pitchFamilies: [{ pitch12: 0.5, share: 1 }], shape: "Flat", facetCount: 1, existingMaterial: "Membrane", ...over });
const deck = flat({ squares: 120, footprintSqft: 12000, perimeterFt: 450, rooftopAcCount: 4, buildingUse: "commercial" });

console.log("── system switches keep the assembly whole");
const direct = defaultSpec(deck, L);
const viaCoating = withSystem(withSystem(direct, sys("coat_silicone"), deck, L), sys("tpo"), deck, L);
const same = (k: keyof RoofPackageSpec["flat"]) => viaCoating.flat[k] === direct.flat[k];
check("TPO → coating → TPO restores insulation, cover board, drains, boots and crane", ["insulationId", "coverBoardId", "drains", "secondary", "pipeBoots", "craneHours", "taperedSqft", "warrantyId"].every((k) => same(k as keyof RoofPackageSpec["flat"])), JSON.stringify({ ins: viaCoating.flat.insulationId, drains: viaCoating.flat.drains, crane: viaCoating.flat.craneHours }));
check("and prices the same", Math.abs(total(buildRoofPackage(viaCoating, deck)) - total(buildRoofPackage(direct, deck))) < 1);
const edited = { ...direct, flat: { ...direct.flat, parapetFt: 300, drains: 5 } };
const editedBack = withSystem(withSystem(edited, sys("coat_silicone"), deck, L), sys("tpo"), deck, L);
check("a typed parapet and drain count survive the detour", editedBack.flat.parapetFt === 300 && editedBack.flat.drains === 5);
const resTpo = defaultSpec(flat(), L);
const resTorch = withSystem(resTpo, sys("mod_bit"), flat(), L);
check("a house TPO switched to torch-down drops the HD polyiso board it no longer needs", resTorch.flat.coverBoardId === "none", resTorch.flat.coverBoardId);
const ballast = withSystem(resTpo, sys("epdm_ballast"), flat(), L);
check("switching to ballast brings the crane instead of a ladder hoist", ballast.flat.craneHours > 0 && !ballast.flat.hoistOn);

console.log("── recover, warranty, overburden");
const capOver = withSystem(direct, sys("mod_bit_cap_recover"), deck, L);
const capPkg = buildRoofPackage(capOver, deck);
check("a commercial cap-sheet overlay gets no new insulation, cover board, drains or NDL", !has(capPkg, /insulation · polyiso|cover board ·|roof drain|NDL/i), [...capPkg.materials, ...capPkg.labor].map((l) => l.name).filter((n) => /insulation|cover|drain|NDL/i.test(n)).join(", "));
const coatDeck = withSystem(direct, sys("coat_silicone"), deck, L);
check("a commercial coating carries no 20-yr NDL fee", !has(buildRoofPackage(coatDeck, deck), /NDL/));
const rolledDeck = withSystem(direct, sys("rolled"), deck, L);
check("rolled roofing carries no NDL fee", !has(buildRoofPackage(rolledDeck, deck), /NDL/));
const paver = buildRoofPackage(withSystem(resTpo, sys("ballast_paver"), flat(), L), flat());
check("a paver deck prices the waterproofing under it", has(paver, /waterproofing membrane/i));

console.log("── job class");
const answered = withJobClass({ ...resTpo, flat: { ...resTpo.flat, edgeMetalFt: 150, parapetFt: 40 } }, flat(), L, true);
check("answering commercial keeps a typed parapet/edge split", answered.flat.parapetFt === 40 && answered.flat.edgeMetalFt === 150);
check("but still seeds what was untouched (R-25, NDL 20)", answered.flat.insulationId === "iso_r25" && answered.flat.warrantyId === "ndl_20");
check("answering the class it already has changes nothing", withJobClass(answered, flat(), L, true) === answered);

console.log("── saved preferences");
const tileHouse = house({ existingMaterial: "Tile" });
let prefs: Prefs = prefsOf(defaultSpec(tileHouse, L), {});
check("a like-for-like tile pick is not saved as the usual system", prefs.systemId === undefined);
const plain = familyFit(reconcile(applyPrefs(defaultSpec(house(), L), prefs), L), house(), L, prefs);
check("so the next plain house opens on shingles with synthetic underlayment", plain.systemId === "architectural" && plain.underlaymentId === "synthetic", `${plain.systemId} / ${plain.underlaymentId}`);
const pickedTile = { ...defaultSpec(tileHouse, L), systemAuto: false };
prefs = prefsOf(pickedTile, {});
check("a tile system the contractor picked IS saved as usual", prefs.systemId === "concrete_tile");
// A row-01 price edit writes the catalog row; the next roof reads the row.
const editedLists: CatalogLists = { ...L, systems: L.systems.map((x) => (x.id === "tpo" ? { ...x, matPerSq: 150, laborPerSq: 190 } : x)) };
prefs = prefsOf(resTpo, {});
const reopened = familyFit(reconcile(applyPrefs(defaultSpec(flat(), editedLists), prefs), editedLists), flat(), editedLists, prefs);
check("a flat membrane price edit (on its catalog row) comes back on the next flat roof", reopened.systemMatPerSq === 150 && reopened.systemLaborPerSq === 190, `${reopened.systemMatPerSq}/${reopened.systemLaborPerSq}`);
const oldPrefsWithPrices = prefsOf({ ...defaultSpec(house(), L), systemAuto: false, systemMatPerSq: 99, systemLaborPerSq: 99 }, {});
const manageEdited: CatalogLists = { ...L, systems: L.systems.map((x) => (x.id === "architectural" ? { ...x, matPerSq: 140, laborPerSq: 215 } : x)) };
const afterManage = familyFit(reconcile(applyPrefs(defaultSpec(house(), manageEdited), oldPrefsWithPrices), manageEdited), house(), manageEdited, oldPrefsWithPrices);
check("a price edited in Manage roof types wins over anything saved before", afterManage.systemMatPerSq === 140 && afterManage.systemLaborPerSq === 215, `${afterManage.systemMatPerSq}/${afterManage.systemLaborPerSq}`);
const steepPrefs = prefsOf({ ...defaultSpec(house(), L), systemAuto: false, nailsPerSq: 9, iceWaterPerSqft: 0.9 }, {});
const afterFlat = prefsOf(resTpo, steepPrefs);
check("saving a flat job keeps the shingle defaults", afterFlat.nailsPerSq === 9 && afterFlat.iceWaterPerSqft === 0.9);
const withInsPrice = { ...answered, flat: { ...answered.flat, insulationMatPerSq: 210 } };
const insPrefs = prefsOf(withInsPrice, {});
const nextDeck = familyFit(reconcile(applyPrefs(defaultSpec(deck, L), insPrefs), L), deck, L, insPrefs);
check("an insulation price edit follows that insulation to the next job", nextDeck.flat.insulationMatPerSq === 210, String(nextDeck.flat.insulationMatPerSq));

console.log("── catalog upgrade and removal");
const oldCatalog: CatalogLists = { systems: L.systems.filter((s) => ["architectural", "tpo"].includes(s.id)).map((s) => (s.id === "tpo" ? { ...s, label: "TPO membrane · low slope", matPerSq: 250, laborPerSq: 250 } : s)), underlayments: L.underlayments };
const up = upgradeLists(oldCatalog);
check("a pre-release catalog gets the new flat systems once, and its untouched all-in TPO row is replaced", up.systems.length > 30 && up.systems.find((s) => s.id === "tpo")!.matPerSq === 125);
const trimmed: CatalogLists = { ...up, systems: up.systems.filter((s) => s.id !== "pmma") };
check("a built-in deleted after the upgrade stays deleted", !upgradeLists(trimmed).systems.some((s) => s.id === "pmma"));
const noTpo: CatalogLists = { ...L, systems: L.systems.filter((s) => s.id !== "tpo") };
check("removing the selected flat system falls back to another flat system", reconcile(resTpo, noTpo).systemFamily === "low-slope");

console.log("── a report landing mid-session");
const withCustom = { ...defaultSpec(house(), L), systemId: "metal_panel", custom: [{ id: "c1", name: "Skylight", qty: 1, unit: "each" as const, unitPrice: 900, kind: "material" as const }] };
const merged = withMeasured(withCustom, house({ measured: { reportId: 5, eaveFt: 180, rakeFt: 40, ridgeFt: 50, hipFt: 70, valleyFt: 24, stepFlashFt: 12 } }));
check("keeps custom lines and the system pick, takes the measured edges", merged.custom.length === 1 && merged.systemId === "metal_panel" && merged.eaveFt === 180 && merged.edgesBasis === "measured" && merged.valleyFtEach === 24);

console.log("── client scope");
const scopes = [buildRoofPackage(defaultSpec(house(), L), house()), buildRoofPackage(direct, deck), buildRoofPackage(coatDeck, deck), buildRoofPackage(resTpo, flat())].flatMap((p) => p.scope);
check("the client scope says what is done, never how sure the estimate is", scopes.length > 10 && !scopes.some((x) => /estimat|confirm|photo|check|%|×|contractor|markup|productivity/i.test(x)), scopes.filter((x) => /estimat|confirm|photo|check|%|×|contractor/i.test(x)).join(" | "));
check("a commercial deck's scope names the commercial requirements", buildRoofPackage(direct, deck).scope.some((x) => /commercial project requirements/i.test(x)));

console.log("── smaller rules");
const flatMetal = defaultSpec(flat({ existingMaterial: "Metal" }), L);
check("a low-slope metal building opens on standing seam made for 1:12", flatMetal.systemId === "standing_seam_low");
check("and gets no attic vents or ventilation check", flatMetal.vents.length === 0 && buildRoofPackage(flatMetal, flat({ existingMaterial: "Metal" })).vent === null);
const induction = buildRoofPackage(withSystem(direct, sys("tpo_induction"), deck, L), deck);
check("induction-welded TPO pays for plates once", has(induction, /induction-weld plates/i) && !has(induction, /insulation plates/i));
const torchCover = { ...withSystem(resTpo, sys("mod_bit"), flat(), L) };
const tc = { ...torchCover, flat: { ...torchCover.flat, coverBoardId: "gypsum_14", coverBoardMatPerSq: 80, coverBoardLaborPerSq: 32, coverBoardThicknessIn: 0.25 } };
check("a cover board alone still gets its fasteners", has(buildRoofPackage(tc, flat()), /cover board plates/i));
const steepCustom = { ...defaultSpec(house(), L), custom: [{ id: "x", name: "Chimney rebuild (mason)", qty: 1, unit: "lot" as const, unitPrice: 3000, kind: "labor" as const }] };
const unionSteep = buildRoofPackage(withJobClass({ ...steepCustom, commercial: { ...steepCustom.commercial, wage: "union" } }, house(), L, true), house());
check("a custom labor line is never marked up as crew hours", line(unionSteep, /chimney rebuild/i)?.unitPrice === 3000);
const bonded = buildRoofPackage({ ...direct, commercial: { ...direct.commercial, bondOn: true } }, deck);
const bondLine = line(bonded, /performance bond/i)!;
const beforeBond = total(bonded) - bondLine.unitPrice;
check("the bond is written on the whole contract, permit and general conditions included", bondLine.unitPrice > 0.012 * beforeBond, `${bondLine.unitPrice} on ${Math.round(beforeBond)}`);
const epdmMech = buildRoofPackage(withSystem(resTpo, sys("epdm_mech"), flat(), L), flat());
check("mechanically attached EPDM says its seams are taped", epdmMech.assumptions[0].includes("seams taped") && !epdmMech.assumptions[0].includes("welded"));
check("a coating's perimeter note says the existing coping is kept", buildRoofPackage(coatDeck, deck).assumptions.some((a) => /existing coping kept/.test(a)));

console.log("── re-check fixes");
const savedOptionPrices: Prefs = { flat: { boardPrices: { "ins:iso_r25": { mat: 160, labor: 45 }, "cover:gypsum_14": { mat: 70, labor: 30 } }, warrantyPrices: { ndl_20: 20 } } };
const modCommercial = applyPickedPrices(withSystem(defaultSpec(flat({ squares: 60, footprintSqft: 6000, perimeterFt: 320, buildingUse: "commercial" }), L), sys("mod_bit"), flat({ squares: 60, buildingUse: "commercial" }), L), savedOptionPrices);
const backResidential = withJobClass(modCommercial, flat({ squares: 60, footprintSqft: 6000, perimeterFt: 320 }), L, false);
check("answering residential drops R-25, gypsum and NDL even when their prices were saved", backResidential.flat.insulationId === "none" && backResidential.flat.warrantyId === "none", `${backResidential.flat.insulationId} / ${backResidential.flat.coverBoardId} / ${backResidential.flat.warrantyId}`);
const answeredPriced = applyPickedPrices(withJobClass(resTpo, flat(), L, true), savedOptionPrices);
check("answering commercial prices the seeded options at the contractor's saved prices", answeredPriced.flat.insulationMatPerSq === 160 && answeredPriced.flat.warrantyPerSq === 20);
const usualSteep = prefsOf({ ...defaultSpec(house(), L), systemAuto: false }, {});
const metalBldg = flat({ existingMaterial: "Metal" });
const metalOpened = familyFit(reconcile(applyPrefs(defaultSpec(metalBldg, L), usualSteep), L), metalBldg, L, usualSteep);
check("a flat metal building opens on standing seam even when the usual system is shingles", metalOpened.systemId === "standing_seam_low", metalOpened.systemId);
const flatSplit = defaultSpec(flat(), L);
const reported = withMeasured(flatSplit, flat({ measured: { reportId: 3, eaveFt: 210, rakeFt: 0, ridgeFt: 0, hipFt: 0, valleyFt: 0, stepFlashFt: 18 } }), L);
check("a report moves the untouched flat open edge to the measured perimeter", reported.flat.edgeMetalFt === 210 && reported.eaveFt === 210 && reported.flat.wallFt === 18, `${reported.flat.edgeMetalFt} / ${reported.eaveFt} / ${reported.flat.wallFt}`);
const poisoned = { ...resTpo, systemId: "architectural", systemName: "Architectural shingle · 30-yr", systemFamily: "asphalt" as const, systemAuto: false };
const safePrefs = prefsOf(poisoned, { iceWater: "eaves_valleys", nailsPerSq: 4.5 });
check("a flattened spec on a steep system never saves 'no ice & water, no nails'", safePrefs.iceWater === "eaves_valleys" && safePrefs.nailsPerSq === 4.5);
const backTo = pickSystemOn(defaultSpec(house({ existingMaterial: "Tile" }), L), sys("concrete_tile"), house({ existingMaterial: "Tile" }), L, { auto: true });
check("'Back to tile' stays the roof's choice and is not saved as usual", backTo.systemAuto === true && prefsOf(backTo, {}).systemId === undefined);
const legacyTile = { systemId: "concrete_tile", systemName: "Concrete tile", systemFamily: "tile", systemMatPerSq: 400, systemLaborPerSq: 500, capPerFt: 8, wastePct: 12, underlaymentId: "synthetic_premium", underlaymentName: "Premium synthetic · high-temp", underlaymentPerSq: 48, valleyTypeId: "raised_rib", valleyMatPerFt: 8, valleyLaborPerFt: 10 } as Prefs;
const legacyOpened = reconcile(applyPrefs(defaultSpec(house(), L), legacyTile), L);
check("a legacy usual tile system keeps its own underlayment and valley", legacyOpened.systemId === "concrete_tile" && legacyOpened.underlaymentId === "synthetic_premium" && legacyOpened.valleyTypeId === "raised_rib", `${legacyOpened.underlaymentId} / ${legacyOpened.valleyTypeId}`);
const ventKeep = prefsOf(defaultSpec(metalBldg, L), { ventPrices: { ridge: { each: 6, labor: 4 } } });
check("a vent-less spec does not erase saved vent prices", ventKeep.ventPrices?.ridge?.each === 6);
check("like-for-like: Unknown material is never like-for-like", likeForLikeFamily(house({ existingMaterial: "Unknown" })) === null);
check("like-for-like: shingles on a flat roof are not", likeForLikeFamily(flat({ existingMaterial: "Asphalt shingle" })) === null);
check("like-for-like: a flat metal building is metal; a tile house is tile", likeForLikeFamily(metalBldg) === "metal" && likeForLikeFamily(house({ existingMaterial: "Tile" })) === "tile");
const tileToShingle = withSystem(defaultSpec(house({ existingMaterial: "Tile" }), L), sys("architectural"), house({ existingMaterial: "Tile" }), L);
check("switching a tile house to shingles drops the tile's high-temp underlayment", tileToShingle.underlaymentId === "synthetic", tileToShingle.underlaymentId);
check("an overlay tells the client it goes over the existing layer", buildRoofPackage({ ...defaultSpec(house(), L), tearOffLayers: 0 }, house()).scope.some((x) => /over the existing layer/.test(x)));

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);

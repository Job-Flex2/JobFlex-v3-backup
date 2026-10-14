// Flat roofs, commercial pricing, the valley estimate and the flat rule —
// the behaviour the 2026-09-14 design review asked to be pinned before ship.
//   npx tsx scripts/qa/lowSlope.check.ts
import { BUILTIN_LISTS } from "../../src/lib/roofPackage/catalog";
import { readBuilding } from "../../src/lib/roofPackage/commercial";
import { isFlatRoof } from "../../src/lib/roofPackage/flatRule";
import {
  buildRoofPackage,
  defaultSpec,
  estimateEdges,
  estimateValleys,
  simplifyOutline,
  outlineFeet,
  valleysFromOutline,
  withJobClass,
  withSystem,
  type RoofFacts,
  type RoofPackage,
} from "../../src/lib/roofPackage/takeoff";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const total = (p: RoofPackage) => [...p.materials, ...p.labor].reduce((a, l) => a + l.quantity * l.unitPrice, 0);
const has = (p: RoofPackage, re: RegExp) => [...p.materials, ...p.labor].some((l) => re.test(l.name));
const line = (p: RoofPackage, re: RegExp) => [...p.materials, ...p.labor].find((l) => re.test(l.name));
const sys = (id: string) => BUILTIN_LISTS.systems.find((s) => s.id === id)!;

const house = (over: Partial<RoofFacts> = {}): RoofFacts => ({
  squares: 43.1,
  squaresBasis: "measured",
  pitchFamilies: [{ pitch12: 5, share: 1 }],
  pitchBasis: "measured",
  perimeterFt: 232,
  footprintSqft: 2880,
  chimney: false,
  rooftopAcCount: 0,
  shape: "Hip",
  facetCount: 6,
  measured: null,
  existingMaterial: "Tile",
  facetConfidence: null,
  buildingUse: null,
  ...over,
});
const flatRoof = (over: Partial<RoofFacts> = {}): RoofFacts =>
  house({ pitchFamilies: [{ pitch12: 0.5, share: 1 }], shape: "Flat", facetCount: 1, existingMaterial: "Flat", squares: 22, footprintSqft: 2200, perimeterFt: 196, ...over });

console.log("── valley estimate");
check("simple gable is a confident zero", estimateValleys(house({ shape: "Gable", facetCount: 2, footprintSqft: 1600, perimeterFt: 168, pitchFamilies: [{ pitch12: 6, share: 1 }] }))?.count === 0);
check("simple hip is a confident zero", estimateValleys(house({ facetCount: 4, footprintSqft: 1800, perimeterFt: 178 }))?.count === 0);
check("one extra facet on a hip is not a wing", estimateValleys(house({ facetCount: 5 }))?.count === 0);
const v6 = estimateValleys(house());
check("the asked-about house: 2 valleys, about 42 ft", v6?.count === 2 && Math.abs((v6?.totalFt ?? 0) - 42) < 1.5, JSON.stringify(v6));
check("billed total equals count × each", v6 != null && Math.abs(v6.totalFt - v6.count * v6.ftEach) < 0.051);
const v8 = estimateValleys(house({ facetCount: 8, footprintSqft: 2400, perimeterFt: 210, pitchFamilies: [{ pitch12: 6, share: 1 }] }));
check("8-facet hip: 4 valleys, 50–65 ft", v8?.count === 4 && (v8?.totalFt ?? 0) >= 50 && (v8?.totalFt ?? 0) <= 65, JSON.stringify(v8));
const v12 = estimateValleys(house({ facetCount: 12, shape: "Complex", footprintSqft: 3200, perimeterFt: 300, pitchFamilies: [{ pitch12: 8, share: 1 }] }));
check("12-facet complex: 2–4 ft of valley per square", v12 != null && v12.totalFt / 32 >= 2 && v12.totalFt / 32 <= 4, JSON.stringify(v12));
check("a zero footprint and no perimeter is no figure, never NaN", estimateValleys(house({ footprintSqft: 0, perimeterFt: null })) === null);
// A count the provider scored low still gives a ROUGH figure (owner, 2026-10-13: "at least a rough estimate … about
// the length of the ridge and hips"), never longer than the ridges and hips together.
const low = estimateValleys(house({ facetConfidence: 0.19 }));
check("a low facet confidence gives a rough figure, not a dash", low?.rough === true && (low?.count ?? 0) > 0 && (low?.totalFt ?? 0) > 0, JSON.stringify(low));
const lowBig = estimateValleys(house({ facetCount: 18, shape: "Complex", facetConfidence: 0.2, footprintSqft: 3300, perimeterFt: 260, pitchFamilies: [{ pitch12: 5, share: 0.7 }, { pitch12: 11, share: 0.3 }] }));
const lowEdges = estimateEdges(house({ facetCount: 18, shape: "Complex", facetConfidence: 0.2, footprintSqft: 3300, perimeterFt: 260, pitchFamilies: [{ pitch12: 5, share: 0.7 }, { pitch12: 11, share: 0.3 }] }));
check("an 18-facet two-pitch house scored low (the Sammamish roof): valleys, no longer than ridge + hips", !!lowBig && !!lowEdges && lowBig.totalFt > 0 && lowBig.totalFt <= lowEdges.ridgeFt + lowEdges.hipFt + 0.5 && lowEdges.valleyFt === lowBig.totalFt, `${JSON.stringify(lowBig)} · ridge+hip ${lowEdges ? lowEdges.ridgeFt + lowEdges.hipFt : "—"}`);
check("a trusted score is not capped (not rough)", !estimateValleys(house({ facetConfidence: 0.8 }))?.rough);
check("a trusted facet confidence gives a figure", estimateValleys(house({ facetConfidence: 0.8 }))?.count === 2);
check("facets below the shape's base is no figure", estimateValleys(house({ facetCount: 3 })) === null);
// THE 20-FACET CEILING IS GONE (audit 2026-09-17, documented on
// estimateValleys itself): a 22-facet roof with no report priced ZERO valleys
// — no valley metal, no valley labor, no ice & water band in the valleys — on
// the most cut-up roof in the set. This check pinned that hole; what it pins
// now is the pair of caps that replaced it. The wing model is coarse this far
// out, so the count stops at 12 and the plan run at half the perimeter (the
// billed figure is that run along the slope), and the lines carry the
// "estimated" basis that says so.
const v24 = estimateValleys(house({ facetCount: 24 }));
check("a very cut-up roof still prices valleys", (v24?.count ?? 0) > 0, JSON.stringify(v24));
check("the count stops at 12", v24?.count === 12, JSON.stringify(v24));
check("the run stops at half the perimeter, along the slope", v24 != null && v24.totalFt <= 0.5 * 232 * Math.sqrt(2 + (5 / 12) ** 2) + 0.05, JSON.stringify(v24));
check("12 valleys of 12.5 ft", v24?.ftEach === 12.5 && v24?.totalFt === 150, JSON.stringify(v24));
check("past the cap, more facets change nothing", JSON.stringify(estimateValleys(house({ facetCount: 40 }))) === JSON.stringify(v24));
check("a tiny body is no figure", estimateValleys(house({ footprintSqft: 180, perimeterFt: 54 })) === null);
check("a flat roof has no valleys", estimateValleys(flatRoof({ facetCount: 5 }))?.count === 0);

// ── Valleys read off the footprint (2026-10-13, owner: "never calculating valleys")
console.log("── valleys from the outline");
// A ring in lat/lng from feet about a corner in Snohomish, so the geometry goes through the real projection.
const LAT0 = 47.77, LNG0 = -122.2, R = 20925646.3;
const ring = (pts: Array<[number, number]>, close = true, reverse = false) => {
  const out = pts.map(([x, y]) => ({ lat: LAT0 + (y / R) * (180 / Math.PI), lng: LNG0 + (x / (R * Math.cos((LAT0 * Math.PI) / 180))) * (180 / Math.PI) }));
  if (reverse) out.reverse();
  if (close) out.push(out[0]);
  return out;
};
const rect = ring([[0, 0], [40, 0], [40, 24], [0, 24]]);
// A 16-ft-wide wing, 20 ft deep, at the right end of a 40 × 24 body: one inside corner.
const L = ring([[0, 0], [40, 0], [40, 44], [24, 44], [24, 24], [0, 24]]);
// The same wing in the middle of the body: two inside corners.
const T = ring([[0, 0], [40, 0], [40, 24], [28, 24], [28, 44], [12, 44], [12, 24], [0, 24]]);
const feet = outlineFeet(rect);
check("a lat/lng ring comes back in feet about its first corner, the closing repeat dropped", feet.length === 4 && Math.abs(feet[1][0] - 40) < 0.05 && Math.abs(feet[2][1] - 24) < 0.05, JSON.stringify(feet.map((p) => p.map((v) => Math.round(v * 10) / 10))));
const vRect = valleysFromOutline(rect, 5);
check("a rectangle has no valleys — a confident zero", vRect?.count === 0 && vRect.totalFt === 0);
const vL = valleysFromOutline(L, 5);
// Run: half the 16-ft wing (8 ft) and a foot of eave, along √(2 + (5/12)²) = 1.474 → 13.3 ft.
check("an L-shaped house has one valley, up from its inside corner to the wing's ridge", vL?.count === 1 && Math.abs(vL.totalFt - 13.3) < 0.15, JSON.stringify(vL));
const vT = valleysFromOutline(T, 5);
check("a T-shaped house has two, one each side of the wing", vT?.count === 2 && Math.abs(vT.totalFt - 26.5) < 0.3, JSON.stringify(vT));
check("the ring's direction and its closing point change nothing", JSON.stringify(valleysFromOutline(ring([[0, 0], [40, 0], [40, 44], [24, 44], [24, 24], [0, 24]], false, true), 5)) === JSON.stringify(vL));
check("a steeper roof makes a longer valley", (valleysFromOutline(L, 10)?.totalFt ?? 0) > (vL?.totalFt ?? 0));
// A 1-ft jog in a traced wall and a bend of a few degrees are not corners.
const noisy = ring([[0, 0], [20, 0.4], [40, 0], [40, 11], [41, 11], [41, 12], [40, 12], [40, 24], [0, 24]]);
check("a 1-ft jog and a slight bend are no corners (nor a 40-in. notch a wing)", valleysFromOutline(noisy, 5)?.count === 0, JSON.stringify(simplifyOutline(outlineFeet(noisy)).map((p) => p.map(Math.round))));
check("a wider wing's valley runs to the body's ridge, not past it", (() => { const wide = ring([[0, 0], [40, 0], [40, 44], [8, 44], [8, 24], [0, 24]]); const v = valleysFromOutline(wide, 5); return v?.count === 1 && Math.abs(v.totalFt - (12 + 1) * Math.sqrt(2 + (5 / 12) ** 2)) < 0.2; })());
// Through estimateValleys: the outline wins over a missing or distrusted facet count; a plain rectangle lets the facet model speak.
check("the outline gives the valleys when the facet count is scored low", estimateValleys(house({ outlines: [L], facetConfidence: 0.19 }))?.count === 1);
check("…and when there is no facet count at all", estimateValleys(house({ outlines: [T], facetCount: null }))?.count === 2);
check("a plain rectangle leaves it to the facet model (dormers are not in a footprint)", estimateValleys(house({ outlines: [rect] }))?.count === 2 && estimateValleys(house({ outlines: [rect], facetCount: 4 }))?.count === 0);
check("the house and a ticked outbuilding add their valleys", estimateValleys(house({ outlines: [L, T] }))?.count === 3);
check("the fallback's plane count stands in for a facet count", estimateValleys(house({ facetCount: null, shape: null, facetCountEstimated: 7 }))?.count === 3 && estimateValleys(house({ facetCount: null, shape: null })) === null);
check("the edges carry the outline's valley feet", (() => { const e = estimateEdges(house({ outlines: [L], facetConfidence: 0.1 })); return !!e && e.valleyFt != null && Math.abs(e.valleyFt - 13.3) < 0.15; })());
check("a flat roof's outline makes no valleys", estimateValleys(flatRoof({ outlines: [L] }))?.count === 0);
const measuredZero = defaultSpec(house({ measured: { reportId: 9, eaveFt: 200, rakeFt: 30, ridgeFt: 40, hipFt: 80, valleyFt: 0, stepFlashFt: 0 } }));
check("a report that measured zero valleys stays zero", measuredZero.valleyCount === 0 && measuredZero.valleyBasis === "measured");
const est = defaultSpec(house());
check("the house opens with 2 estimated valleys", est.valleyCount === 2 && est.valleyBasis === "estimated");
check("a tile roof opens on raised-rib valleys", est.valleyTypeId === "raised_rib", est.valleyTypeId);
check("the hero reads the same valley feet", estimateEdges(house())?.valleyFt === v6?.totalFt);

console.log("── flat rule");
check("half the roof under 2/12 is flat", isFlatRoof(house({ pitchFamilies: [{ pitch12: 1, share: 0.6 }, { pitch12: 6, share: 0.4 }] })));
check("3/12 alone is not flat", !isFlatRoof(house({ pitchFamilies: [{ pitch12: 3, share: 1 }], existingMaterial: "Asphalt shingle" })));
check("3/12 with a flat shape word is flat", isFlatRoof(house({ pitchFamilies: [{ pitch12: 3, share: 1 }], shape: "Flat" })));
check("no pitch, TPO material is flat", isFlatRoof(house({ pitchFamilies: [], shape: null, existingMaterial: "TPO" })));
check("a report never overrides a stated 8/12 pitch", !isFlatRoof(house({ pitchFamilies: [{ pitch12: 8, share: 1 }], shape: null, existingMaterial: null, measured: { reportId: 1, eaveFt: 300, rakeFt: 0, ridgeFt: 5, hipFt: 0, valleyFt: 0, stepFlashFt: 0 } })));
const flatEdges = estimateEdges(flatRoof({ shape: "Complex" }));
check("a flat roof the data calls Complex has no ridge or hip", flatEdges?.ridgeFt === 0 && flatEdges?.hipFt === 0 && flatEdges?.rakeFt === 0);

console.log("── residential flat roof");
const rf = flatRoof();
const rs = defaultSpec(rf);
const rp = buildRoofPackage(rs, rf);
check("opens on a flat system", rs.systemFamily === "low-slope" && rs.systemId === "tpo", rs.systemId);
check("carries no shingle lines", !has(rp, /ridge cap|starter|ice & water|ridge vent|roofing nails|soffit|drip edge · f-style|underlayment/i));
check("has fasteners, seam sealant, cover board, edge metal, install, tear-off", has(rp, /membrane fasteners/i) && has(rp, /seam cleaner/i) && has(rp, /cover board/i) && has(rp, /edge metal/i) && has(rp, /^install · tpo/i) && has(rp, /^tear-off/i));
check("a house gets no crane, drains, cores, walkway or NDL warranty", !has(rp, /crane|roof drain|core cut|walkway|NDL/i));
check("a house gets a hoist and fall protection", has(rp, /ladder hoist/i) && has(rp, /fall protection/i));
check("no ventilation check on a membrane deck", rp.vent === null);
check("no commercial lines", !has(rp, /mobilization|general conditions|asbestos/i));
const rsq = total(rp) / (rf.squares * 100);
check("a residential flat TPO reroof lands at $5–11 per sq ft", rsq >= 5 && rsq <= 11, `$${rsq.toFixed(2)}/sq ft`);
const tiny = flatRoof({ squares: 4, footprintSqft: 400, perimeterFt: 84 });
const tp = buildRoofPackage(defaultSpec(tiny), tiny);
check("a 4-square porch roof stays under $8k", total(tp) < 8000, `$${Math.round(total(tp))}`);
check("every quantity is finite and positive", [...tp.materials, ...tp.labor, ...rp.materials, ...rp.labor].every((l) => Number.isFinite(l.quantity) && l.quantity > 0 && Number.isFinite(l.unitPrice) && l.unitPrice >= 0));

console.log("── like-for-like on flat roofs");
check("EPDM stays EPDM", defaultSpec(flatRoof({ existingMaterial: "EPDM rubber" })).systemId === "epdm");
const burSpec = defaultSpec(flatRoof({ existingMaterial: "Built-up gravel" }));
check("gravel built-up stays built-up, priced as gravel tear-off", burSpec.systemId === "bur" && burSpec.tearOffPerSqLayer === 195 && burSpec.disposalPerSqLayer === 110);
const burPkg = buildRoofPackage(burSpec, flatRoof({ existingMaterial: "Built-up gravel" }));
check("hot-mopped built-up gets a kettle and a gravel vacuum", has(burPkg, /kettle/i) && has(burPkg, /gravel vacuum/i));
check("a generic 'Flat' word uses the contractor's usual flat system", defaultSpec(flatRoof(), BUILTIN_LISTS, "mod_bit").systemId === "mod_bit");
check("a silicone-coated roof is recoated like-for-like", defaultSpec(flatRoof({ existingMaterial: "Silicone coating" })).systemId === "coat_silicone");
check("spray foam stays spray foam", defaultSpec(flatRoof({ existingMaterial: "Spray foam" })).systemId === "spf_silicone");
check("stone-coated steel is still metal, not a coating", defaultSpec(house({ existingMaterial: "Stone-coated steel" })).systemFamily === "metal");

console.log("── commercial");
const cf = flatRoof({ squares: 120, footprintSqft: 12000, perimeterFt: 450, rooftopAcCount: 4, existingMaterial: "Membrane", buildingUse: "commercial" });
const cs = defaultSpec(cf);
const cp = buildRoofPackage(cs, cf);
check("commercial deck: R-25 insulation, coping, base flashing, drains with overflows", has(cp, /Insulation · Polyiso R-25/) && has(cp, /coping cap/i) && has(cp, /base flashing/i) && line(cp, /retrofit insert$/i)?.quantity === 3 && has(cp, /overflow scupper/i));
check("commercial deck: RTU curbs from the aerial count, walkway, crane, cores, NDL 20", line(cp, /rooftop unit curb · flashing/i)?.quantity === 4 && has(cp, /walkway/i) && has(cp, /crane & operator/i) && has(cp, /core cuts/i) && has(cp, /NDL · 20-yr/));
check("commercial lines: mobilization, safety plan, asbestos survey, superintendent, valuation permit, general conditions", has(cp, /mobilization · setup/i) && has(cp, /safety plan/i) && has(cp, /asbestos/i) && has(cp, /superintendent/i) && has(cp, /valuation-based/i) && has(cp, /general conditions/i));
check("field install labor goes DOWN on a 120-square deck", line(cp, /^install · tpo/i)?.unitPrice === 140.25, String(line(cp, /^install · tpo/i)?.unitPrice));
check("the residential permit lump is gone", !has(cp, /^permit & inspection$/i));
const gc = line(cp, /general conditions/i)!;
const nonPass = [...cp.materials, ...cp.labor].filter((l) => !/general conditions|asbestos|valuation-based|NDL|manufacturer inspection|bond/i.test(l.name)).reduce((a, l) => a + l.quantity * l.unitPrice, 0);
check("general conditions is 10.5% of everything except the at-cost fees", Math.abs(gc.unitPrice - Math.round(nonPass * 0.105)) <= 1, `${gc.unitPrice} vs ${Math.round(nonPass * 0.105)}`);
const csq = total(cp) / (cf.squares * 100);
check("a commercial R-25 TPO reroof lands at $8–15 per sq ft", csq >= 8 && csq <= 15, `$${csq.toFixed(2)}/sq ft`);
const prevailing = buildRoofPackage({ ...cs, commercial: { ...cs.commercial, wage: "prevailing", shift: "night" } }, cf);
check("prevailing wage at night raises crew labor and adds payroll and light towers", (line(prevailing, /^install · tpo/i)?.unitPrice ?? 0) > 300 && has(prevailing, /certified payroll/i) && has(prevailing, /light towers/i));
check("a steep house is untouched by commercial when the contractor says residential", !has(buildRoofPackage(defaultSpec(house()), house()), /mobilization|general conditions/i));
const aptSteep = buildRoofPackage(withJobClass(defaultSpec(house()), house(), BUILTIN_LISTS, true), house());
check("commercial pricing also works on a steep roof", has(aptSteep, /mobilization/i) && has(aptSteep, /general conditions/i) && has(aptSteep, /^install · concrete tile/i));

console.log("── adhered R-30 regression (review)");
const af = flatRoof({ squares: 40, footprintSqft: 4000, perimeterFt: 260, existingMaterial: "TPO", buildingUse: "residential" });
let as = withSystem(defaultSpec(af), sys("tpo_60_adhered"), af, BUILTIN_LISTS);
as = { ...as, flat: { ...as.flat, insulationId: "iso_r30", insulationMatPerSq: 235, insulationLaborPerSq: 58, insulationThicknessIn: 5.2, taperedSqft: 400, nailersOn: true } };
const ap = buildRoofPackage(as, af);
const asq = total(ap) / 4000;
check("40-square adhered TPO, R-30, tapered, tear-off: $9–14 per sq ft", asq >= 9 && asq <= 14, `$${asq.toFixed(2)}/sq ft`);
check("adhered gets bonding adhesive, not plates", has(ap, /bonding adhesive/i) && !has(ap, /membrane fasteners/i));
check("nailers step up with the insulation height", /4 courses/.test(line(ap, /wood nailers · 2×/i)?.name ?? ""), line(ap, /wood nailers · 2×/i)?.name);

console.log("── switching systems");
const st = defaultSpec(house({ existingMaterial: "Asphalt shingle" }));
const toFlat = withSystem(st, sys("tpo"), house({ existingMaterial: "Asphalt shingle" }), BUILTIN_LISTS);
check("steep to flat drops the shingle package", toFlat.systemFamily === "low-slope" && toFlat.vents.length === 0 && toFlat.iceWater === "none" && !toFlat.starterOn);
const back = withSystem(toFlat, sys("architectural"), house({ existingMaterial: "Asphalt shingle" }), BUILTIN_LISTS);
check("flat back to steep restores the shingle package", back.systemFamily === "asphalt" && back.vents.length > 0 && back.iceWater === "eaves_valleys" && back.starterOn && back.hipFt > 0);
const insulated = { ...defaultSpec(cf) };
const torch = withSystem(insulated, sys("mod_bit"), cf, BUILTIN_LISTS);
check("insulated deck switched to torch-down gets a gypsum cover board", torch.flat.coverBoardId === "gypsum_14");
check("torch-down gets primer and a fire watch", has(buildRoofPackage(torch, cf), /primer · deck/i) && has(buildRoofPackage(torch, cf), /fire watch/i));
const coat = withSystem(defaultSpec(rf), sys("coat_acrylic"), rf, BUILTIN_LISTS);
const coatPkg = buildRoofPackage(coat, rf);
check("a coating goes over the existing roof: no tear-off, insulation or edge metal", coat.tearOffLayers === 0 && !has(coatPkg, /^tear-off|insulation ·|edge metal/i));
check("a coating gets wash, repair, primer (acrylic) and core cuts", has(coatPkg, /power wash/i) && has(coatPkg, /fabric reinforcement/i) && has(coatPkg, /coating primer/i) && coat.flat.coreCuts >= 3);
const backToTpo = withSystem(coat, sys("tpo"), rf, BUILTIN_LISTS);
check("coating back to TPO restores a tear-off", backToTpo.tearOffLayers === 1);
const toggled = withJobClass(rs, rf, BUILTIN_LISTS, true);
check("turning commercial on seeds the commercial deck", toggled.commercial.on && toggled.flat.insulationId === "iso_r25" && toggled.flat.warrantyId === "ndl_20");
check("and off again restores the house defaults", withJobClass(toggled, rf, BUILTIN_LISTS, false).flat.warrantyId === "none");

console.log("── commercial read");
const strong = readBuilding({ facts: cf, mainSquares: 120, minEaveFt: 20, confidence: null, occlusion: null, hasStructure: true });
check("a 120-square flat deck with 4 units and a 20 ft eave reads commercial", strong.level === "confirm", `${strong.score} ${strong.level}`);
const homeRead = readBuilding({ facts: house(), mainSquares: 43, minEaveFt: 10, confidence: null, occlusion: null, hasStructure: true });
check("a tile hip house reads nothing", homeRead.level === null, `${homeRead.score}`);
check("a small structure never gets a read", readBuilding({ facts: cf, mainSquares: 12, minEaveFt: 20, confidence: null, occlusion: null, hasStructure: true }).level === null);
check("no main structure, no read", readBuilding({ facts: cf, mainSquares: 120, minEaveFt: 20, confidence: null, occlusion: null, hasStructure: false }).level === null);
const matOnly = readBuilding({ facts: flatRoof({ pitchFamilies: [], shape: null, existingMaterial: "TPO", squares: 55 }), mainSquares: 55, minEaveFt: 10, confidence: null, occlusion: null, hasStructure: true });
check("the material is not counted twice when it is what made the roof flat", !matOnly.clauses.includes("a membrane surface"), matOnly.clauses.join(", "));
const flatHouse = readBuilding({ facts: flatRoof({ squares: 26 }), mainSquares: 26, minEaveFt: 10, confidence: null, occlusion: null, hasStructure: true });
check("a flat-roofed house alone does not read commercial", flatHouse.level === null, `${flatHouse.score}`);

console.log("── fuzz: no NaN, no negative quantity");
let fuzzBad = 0;
for (const sq of [0, 1, 4, 20, 150, 400]) {
  for (const fp of [null, 0, 300, 5000, 20000]) {
    for (const per of [null, 0, 80, 700]) {
      for (const id of ["tpo", "epdm_ballast", "mod_bit", "bur", "coat_silicone", "spf_silicone", "rolled", "green_roof", "architectural"]) {
        for (const use of ["residential", "commercial"] as const) {
          const facts = flatRoof({ squares: sq, footprintSqft: fp, perimeterFt: per, buildingUse: use, rooftopAcCount: sq > 100 ? 6 : 0 });
          const spec = withSystem(defaultSpec(facts), sys(id), facts, BUILTIN_LISTS);
          const pkg = buildRoofPackage(spec, facts);
          const ok = [...pkg.materials, ...pkg.labor].every((l) => Number.isFinite(l.quantity) && l.quantity >= 0 && Number.isFinite(l.unitPrice) && l.unitPrice >= 0) && Number.isFinite(total(pkg));
          if (!ok) {
            fuzzBad++;
            if (fuzzBad < 4) console.log("   bad:", { sq, fp, per, id, use });
          }
        }
      }
    }
  }
}
check("1,080 roofs priced without a NaN or a negative", fuzzBad === 0, `${fuzzBad} bad`);

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);

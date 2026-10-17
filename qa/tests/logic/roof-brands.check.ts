// Roofing brands by state (owner, 2026-10-16: "show the brands most popular per state … make it smart"): the data
// holds together, each state's picks follow its checkable signals (Florida approvals, Class 4 credits and hail,
// Title 24, plants, where a regional maker sells), the estimate carries the brand on its lines and the client's
// scope, and no reason ever claims a popularity nobody measured.
//   npx tsx qa/tests/logic/roof-brands.check.ts
import { BUILTIN_LISTS, ROOF_SYSTEMS } from "../../../src/lib/roofPackage/catalog";
import {
  CLASS4_CREDIT_STATES, ROOF_BRANDS, ROOF_PRODUCTS, STATE_NAME, STATE_REGION,
  brandHeadline, brandHint, brandPickFor, brandPrice, rankBrandsFor, retailFactor, topPicks, typicalRetail, withBrand, withBrandPrice,
} from "../../../src/lib/roofPackage/brands";
import { buildRoofPackage, defaultSpec, systemDisplayName, type RoofFacts, type RoofPackageSpec } from "../../../src/lib/roofPackage/takeoff";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const ids = (xs: { product: { id: string } }[]) => xs.map((r) => r.product.id);
const top = (sys: string, st: string | null, n = 4) => {
  const fam = ROOF_SYSTEMS.find((s) => s.id === sys)!.family;
  return rankBrandsFor(sys, fam, st).filter((r) => !r.held).slice(0, n);
};
const rank = (sys: string, st: string | null) => rankBrandsFor(sys, ROOF_SYSTEMS.find((s) => s.id === sys)!.family, st);

console.log("── the data");
const systemIds = new Set(ROOF_SYSTEMS.map((s) => s.id));
const brandIds = new Set(ROOF_BRANDS.map((b) => b.id));
check("product ids are unique", new Set(ROOF_PRODUCTS.map((p) => p.id)).size === ROOF_PRODUCTS.length);
check("brand ids are unique", brandIds.size === ROOF_BRANDS.length);
check("every product's brand exists", ROOF_PRODUCTS.every((p) => brandIds.has(p.brand)), ROOF_PRODUCTS.filter((p) => !brandIds.has(p.brand)).map((p) => p.id).join(","));
check("every product names real catalog systems", ROOF_PRODUCTS.every((p) => p.systems.length && p.systems.every((s) => systemIds.has(s))), ROOF_PRODUCTS.filter((p) => !p.systems.every((s) => systemIds.has(s))).map((p) => p.id).join(","));
check("a product's systems are all one family", ROOF_PRODUCTS.every((p) => new Set(p.systems.map((s) => ROOF_SYSTEMS.find((x) => x.id === s)!.family)).size === 1));
const allStates = [
  ...ROOF_BRANDS.flatMap((b) => [...Object.values(b.plants).flat(), ...(b.strongholds ?? []), ...(b.soldIn ?? [])]),
  ...ROOF_PRODUCTS.flatMap((p) => [...(p.plants ?? []), ...(p.soldIn ?? [])]),
];
check("every state code is a real state", allStates.every((s) => !!STATE_NAME[s!] && !!STATE_REGION[s!]), allStates.filter((s) => !STATE_NAME[s!]).join(","));
check("51 states (with D.C.) have a region", Object.keys(STATE_REGION).length === 51 && Object.keys(STATE_NAME).length === 51);
check("a Miami-Dade approval never sits on a line marked 'no Florida approval'", ROOF_PRODUCTS.every((p) => !(p.hvhz && p.flApproved === false)));
check("only three national leaders", ROOF_BRANDS.filter((b) => b.leader).map((b) => b.id).sort().join(",") === "certainteed,gaf,owens_corning");
for (const sys of ["architectural", "three_tab", "impact_resistant", "designer", "standing_seam", "standing_seam_low", "metal_panel", "stone_coated_steel", "metal_shingle", "concrete_tile", "clay_tile", "synthetic_slate", "synthetic_shake", "slate", "mod_bit_sa", "tpo", "epdm", "pvc"])
  check(`${sys}: at least two lines to pick from`, rank(sys, null).length >= 2, String(rank(sys, null).length));
check("no brand data for cedar → no picker there", rank("cedar_shake", "WA").length === 0);

console.log("── nothing claims what nobody measured");
const everyReason = Object.keys(STATE_NAME).flatMap((st) => [...systemIds].flatMap((sys) => rank(sys, st).flatMap((r) => [...r.reasons, r.held ?? ""])));
check("no 'most popular', 'best-selling', '#1' or 'market share' in any state", !everyReason.some((x) => /most popular|best[- ]?sell|#1|number one|market share|top-selling/i.test(x)), everyReason.find((x) => /most popular|best[- ]?sell|#1/i.test(x)) ?? "");
check("'top-3' is only ever said of shingles", Object.keys(STATE_NAME).every((st) => [...systemIds].filter((s) => ROOF_SYSTEMS.find((x) => x.id === s)!.family !== "asphalt").every((sys) => rank(sys, st).every((r) => !r.reasons.some((x) => /top-3/.test(x))))));
check("every line in every state says at least one reason or why it is held", Object.keys(STATE_NAME).every((st) => [...systemIds].every((sys) => rank(sys, st).every((r) => r.reasons.length > 0 || !!r.held))));

console.log("── Florida");
const flArch = rank("architectural", "FL");
const flTop = top("architectural", "FL");
check("FL architectural: the top four all carry a Florida approval", flTop.every((r) => r.product.hvhz || r.product.flApproved), ids(flTop).join(","));
check("FL architectural: the first pick is Miami-Dade approved", !!flTop[0]?.product.hvhz && /Miami-Dade approved/.test(flTop[0].reasons[0]), flTop[0]?.reasons.join(" | "));
check("FL: PABCO and Malarkey (West only) are not offered", !flArch.some((r) => r.brand.id === "pabco" || r.brand.id === "malarkey"));
check("FL: a line known to lack approval is held, last, with the reason", rank("impact_resistant", "FL").every((r) => r.product.flApproved !== false));
const flDesigner = rank("designer", "FL");
const unknownFl = flDesigner.find((r) => r.product.id === "gaf_camelot");
check("FL designer: a line not on our list leads with 'check its Florida approval' and is not held", !!unknownFl && !unknownFl.held && /Check its Florida approval/.test(unknownFl.reasons[0]), unknownFl?.reasons.join(" | "));
check("FL designer: approved CertainTeed lines come before unlisted ones", flDesigner.findIndex((r) => r.brand.id === "certainteed") < flDesigner.findIndex((r) => r.product.id === "gaf_camelot"));
check("FL designer: the auto pick is an approved line", !!brandPickFor("designer", "asphalt", "FL")?.product.flApproved);
check("FL: Landmark PRO's HVHZ note names the plants", rank("architectural", "FL").find((r) => r.product.id === "ct_landmark_pro")!.reasons[0].includes("Georgia"));
check("FL concrete tile: unlisted lines say to check the approval", rank("concrete_tile", "FL").every((r) => r.product.flApproved || r.product.hvhz || /Check its Florida approval/.test(r.reasons[0])));
check("FL slate: no approval rule on natural slate", rank("slate", "FL").every((r) => !r.reasons.some((x) => /Florida approval|Miami-Dade/.test(x))));
check("FL TPO: no approval rule on flat systems", rank("tpo", "FL").every((r) => !r.held && !r.reasons.some((x) => /Florida approval/.test(x))));

console.log("── hail and Class 4 credits");
const txIr = rank("impact_resistant", "TX");
check("TX Class 4: every line says Texas has a discount or grant", txIr.filter((r) => !r.held).every((r) => r.reasons.some((x) => x === "Insurance discount or grant in Texas")));
check("TX Class 4: TAMKO is a local favorite", txIr.find((r) => r.brand.id === "tamko")!.reasons.includes("Local favorite in Texas"));
check("TX Class 4: TAMKO StormFighter FLEX in the top four", ids(top("impact_resistant", "TX")).includes("tamko_stormfighter"), ids(top("impact_resistant", "TX")).join(","));
const climateflexTx = txIr.find((r) => r.product.id === "ct_climateflex");
check("TX Class 4: ClimateFlex (North/East line) is held with 'ask your yard'", !!climateflexTx?.held && /North and East/.test(climateflexTx.held), climateflexTx?.held);
check("TX Class 4: held lines come after the rest", txIr.findIndex((r) => !!r.held) === txIr.filter((r) => !r.held).length);
check("KS (hail, no credit law here): says hail, not a discount", rank("impact_resistant", "KS").every((r) => r.reasons.some((x) => x === "Built for Kansas's hail") && !r.reasons.some((x) => /discount/.test(x))));
check("MN Class 4: ClimateFlex is sold there and says cold winters", rank("impact_resistant", "MN").find((r) => r.product.id === "ct_climateflex")!.reasons.some((x) => /cold winters/.test(x)) && !rank("impact_resistant", "MN").find((r) => r.product.id === "ct_climateflex")!.held);
check("AZ (no Class 4 signal): no Class 4 reason", rank("impact_resistant", "AZ").every((r) => !r.reasons.some((x) => /discount|hail/.test(x))));
check("credit states include TX, OK, AL, MN", ["TX", "OK", "AL", "MN"].every((s) => CLASS4_CREDIT_STATES.has(s)));

console.log("── the West, California, the coast");
const caTop = top("architectural", "CA");
check("CA architectural: the first pick is cool-roof rated", !!caTop[0]?.product.cool && caTop[0].reasons.includes("Cool-roof rated (Title 24)"), ids(caTop).join(","));
check("CA: PABCO and Malarkey are offered", rank("architectural", "CA").some((r) => r.brand.id === "pabco") && rank("architectural", "CA").some((r) => r.brand.id === "malarkey"));
const waArch = rank("architectural", "WA");
check("WA: PABCO says it is made in Washington", waArch.find((r) => r.brand.id === "pabco")!.reasons.includes("Made in Washington"));
check("WA: Malarkey is a local favorite", waArch.find((r) => r.brand.id === "malarkey")!.reasons.includes("Local favorite in Washington"));
check("OK: Malarkey sold (its Oklahoma plant)", rank("architectural", "OK").some((r) => r.brand.id === "malarkey" && r.reasons.includes("Made in Oklahoma")));
check("NY: neither PABCO nor Malarkey", !rank("architectural", "NY").some((r) => r.brand.id === "pabco" || r.brand.id === "malarkey"));
check("LA (hurricane coast): a Miami-Dade-approved line says hurricane-rated", rank("architectural", "LA").some((r) => r.reasons.includes("Miami-Dade wind approval — for the coast")));
check("VT slate: made in Vermont first", rank("slate", "VT")[0].reasons.includes("Made in Vermont"), rank("slate", "VT")[0].name);
check("MA slate: made in New England", rank("slate", "MA").some((r) => r.reasons.includes("Made in New England")));
check("FL standing seam: Berridge (Miami-Dade) first", top("standing_seam", "FL")[0]?.product.id === "berridge_ss", ids(top("standing_seam", "FL")).join(","));
check("TX stone-coated: DECRA made in Texas", rank("stone_coated_steel", "TX")[0].reasons.some((x) => x === "Made in Texas") && rank("stone_coated_steel", "TX")[0].brand.id === "decra");

console.log("── every state has picks");
for (const st of Object.keys(STATE_NAME)) {
  const t = top("architectural", st);
  if (t.length < 4) check(`${st}: four architectural picks`, false, String(t.length));
}
check("every state: four architectural picks, none held", Object.keys(STATE_NAME).every((st) => top("architectural", st).length === 4));
check("no state: the national order — GAF Timberline HDZ first, PABCO still listed", rank("architectural", null)[0].product.id === "gaf_hdz" && rank("architectural", null).some((r) => r.brand.id === "pabco"));
check("an unknown state code ranks like no state", ids(rank("architectural", "ZZ")).join() === ids(rank("architectural", null)).join());
check("lower-case state works", ids(rank("architectural", "fl")).join() === ids(rank("architectural", "FL")).join());

console.log("── four different brands up front");
for (const [sys, st] of [["architectural", "FL"], ["architectural", "TX"], ["architectural", "CA"], ["impact_resistant", "CO"], ["standing_seam", "MT"]] as const) {
  const t = topPicks(rank(sys, st), 4);
  check(`${sys} ${st}: four picks, four brands`, t.length === 4 && new Set(t.map((r) => r.brand.id)).size === 4, t.map((r) => r.name).join(" | "));
}
check("topPicks keeps the ranking's order and skips held lines", (() => { const r = rank("impact_resistant", "TX"); const t = topPicks(r, 9); return t.every((x, i) => i === 0 || r.indexOf(x) > r.indexOf(t[i - 1])) && t.every((x) => !x.held); })());
check("TX architectural: GAF still first (the local favorite doesn't outweigh a top-3 maker made in Texas)", topPicks(rank("architectural", "TX"), 4)[0].brand.id === "gaf" && topPicks(rank("architectural", "TX"), 4).some((r) => r.brand.id === "tamko"), topPicks(rank("architectural", "TX"), 4).map((r) => r.name).join(" | "));
check("TX: the coast reason comes after the made-in reason", rank("architectural", "TX")[0].reasons.indexOf("Made in Texas") < rank("architectural", "TX")[0].reasons.indexOf("Miami-Dade wind approval — for the coast"));
check("WA: 'Made on the West Coast' for a plant in Oregon/California", rank("architectural", "WA").some((r) => r.reasons.includes("Made on the West Coast")));

console.log("── headline and hints");
check("headline names the system and the state", brandHeadline("Architectural shingle · 30-yr", "FL") === "Top picks for architectural shingle in Florida", brandHeadline("Architectural shingle · 30-yr", "FL"));
check("headline without a state", brandHeadline("Standing-seam metal", null) === "Top picks for standing-seam metal");
check("TX architectural hint: Class 4 discount, switch to impact-resistant", brandHint("architectural", "TX")?.switchTo === "impact_resistant" && /discounts or grants/.test(brandHint("architectural", "TX")!.text));
check("KS architectural hint: hail, switch to impact-resistant", brandHint("architectural", "KS")?.switchTo === "impact_resistant" && /hail/.test(brandHint("architectural", "KS")!.text));
check("TX Class 4 itself: no hint to switch", !brandHint("impact_resistant", "TX")?.switchTo);
check("CA: the Title 24 hint", /Title 24/.test(brandHint("architectural", "CA")?.text ?? ""));
check("FL: the HVHZ hint", /HVHZ/.test(brandHint("architectural", "FL")?.text ?? ""));
check("WA: no hint", brandHint("architectural", "WA") === null);

console.log("── the brand on the estimate");
const facts = (state: string | null): RoofFacts => ({
  squares: 32, squaresBasis: "measured", pitchFamilies: [{ pitch12: 6, share: 1 }], pitchBasis: "measured",
  perimeterFt: 220, footprintSqft: 2600, chimney: false, rooftopAcCount: 0, shape: "hip", facetCount: 6, measured: null, existingMaterial: "Asphalt Shingle", state,
});
const base = defaultSpec(facts("FL"), BUILTIN_LISTS);
const flRank = rank(base.systemId, "FL");
const auto = withBrand(base, flRank, undefined);
check("a new estimate takes the state's first line, marked as the state's pick", auto.productId === flTop[0].product.id && auto.productAuto === true && auto.productFor === base.systemId, `${auto.productId} auto=${auto.productAuto}`);
const picked: RoofPackageSpec = { ...base, productId: "ct_landmark", productName: "CertainTeed Landmark", productFor: base.systemId, productAuto: false };
check("the contractor's pick stands", withBrand(picked, flRank, undefined).productId === "ct_landmark");
check("the contractor's pick stands over their usual", withBrand(picked, flRank, "iko_dynasty").productId === "ct_landmark");
check("their usual line is used on a new estimate", withBrand(base, flRank, "iko_dynasty").productId === "iko_dynasty" && withBrand(base, flRank, "iko_dynasty").productAuto === false);
check("their usual 'any brand' leaves the brand off", withBrand(base, flRank, null).productId === null && withBrand(base, flRank, null).productAuto === false);
check("a usual line not sold in this state falls back to the state's first", withBrand(base, flRank, "malarkey_highlander").productId === flTop[0].product.id);
const toClass4: RoofPackageSpec = { ...picked, systemId: "impact_resistant", systemName: "Impact-resistant shingle · Class 4" };
const c4tx = withBrand({ ...picked, productId: "tamko_heritage", productName: "TAMKO Heritage", systemId: "impact_resistant", systemName: "Impact-resistant shingle · Class 4" }, rank("impact_resistant", "TX"), undefined);
check("switching system: TAMKO Heritage → TAMKO's Class 4 line", c4tx.productId === "tamko_stormfighter" && c4tx.productAuto === false, String(c4tx.productId));
const c4ct = withBrand(toClass4, rank("impact_resistant", "TX"), undefined);
check("switching system: CertainTeed's Class 4 is held in TX → not picked; the state's first instead", c4ct.productId !== "ct_climateflex" && !rank("impact_resistant", "TX").find((r) => r.product.id === c4ct.productId)?.held, String(c4ct.productId));
const cedar = withBrand({ ...base, systemId: "cedar_shake", systemName: "Cedar shake", productId: undefined, productFor: undefined }, [], undefined);
check("no brand data: nothing set", cedar.productId === undefined && cedar.productFor === undefined);
check("a held line is never the auto pick in any state", Object.keys(STATE_NAME).every((st) => [...systemIds].every((sys) => !brandPickFor(sys, ROOF_SYSTEMS.find((x) => x.id === sys)!.family, st)?.held)));


console.log("── the price of a line");
const sysOf = (id: string) => ROOF_SYSTEMS.find((s) => s.id === id)!;
const priced = ROOF_PRODUCTS.filter((p) => (p.retailPerSq ?? 0) > 0);
check("every retail price is a sane $/sq (20–2,500)", priced.every((p) => p.retailPerSq! >= 20 && p.retailPerSq! <= 2500), priced.filter((p) => p.retailPerSq! < 20 || p.retailPerSq! > 2500).map((p) => p.id).join(","));
check("architectural, 3-tab, Class 4 and designer each have a typical retail price", ["architectural", "three_tab", "impact_resistant", "designer"].every((s) => typicalRetail(s) != null), ["architectural", "three_tab", "impact_resistant", "designer"].map((s) => `${s}=${typicalRetail(s)}`).join(" "));
check("a typical price sits inside its system's range", ["architectural", "impact_resistant"].every((s) => { const xs = ROOF_PRODUCTS.filter((p) => p.systems.includes(s) && p.retailPerSq).map((p) => p.retailPerSq!); const t = typicalRetail(s)!; return t >= Math.min(...xs) && t <= Math.max(...xs); }));
check("Class 4 lines retail above architectural on the typical line", (typicalRetail("impact_resistant") ?? 0) > (typicalRetail("architectural") ?? 0));
check("the factor is clamped to 0.7–1.6", ROOF_PRODUCTS.every((p) => p.systems.every((sys) => { const f = retailFactor(p.id, sys); return f == null || (f >= 0.7 && f <= 1.6); })));
check("a line with no retail price has no factor", ROOF_PRODUCTS.filter((p) => !p.retailPerSq).every((p) => retailFactor(p.id, p.systems[0]) == null));
const arch = sysOf("architectural");
const archBase = { id: arch.id, label: arch.label, matPerSq: 140, laborPerSq: 210, capPerFt: 2.5 };
const up = ROOF_PRODUCTS.find((p) => p.systems.includes("architectural") && (retailFactor(p.id, "architectural") ?? 1) > 1.04);
const down = ROOF_PRODUCTS.find((p) => p.systems.includes("architectural") && (retailFactor(p.id, "architectural") ?? 1) < 0.96);
check("some architectural line retails above typical and one below", !!up && !!down, `${up?.id} / ${down?.id}`);
if (up) {
  const bp = brandPrice(up.id, archBase, null);
  check("an above-typical line costs more than the contractor's rate, from retail", bp.basis === "retail" && bp.matPerSq === Math.round(140 * retailFactor(up.id, "architectural")!) && bp.matPerSq > 140, `${bp.matPerSq}`);
  check("…its labor and cap stay the contractor's", bp.laborPerSq === 210 && bp.capPerFt === 2.5);
  check("…and it says where the price came from", /moved by retail: this line runs \d+% above a typical architectural shingle/.test(bp.words), bp.words);
}
if (down) check("a below-typical line costs less than the rate", brandPrice(down.id, archBase, null).matPerSq < 140);
const noPrice = ROOF_PRODUCTS.find((p) => !p.retailPerSq)!;
const np = brandPrice(noPrice.id, { ...archBase, id: noPrice.systems[0], label: sysOf(noPrice.systems[0]).label }, null);
check("no public price: the contractor's rate, said so", np.basis === "system" && np.matPerSq === 140 && /No public price/.test(np.words), np.words);
const own = brandPrice("gaf_hdz", archBase, { mat: 150 });
check("the contractor's own material price wins", own.matPerSq === 150 && own.basis === "own" && own.words === "Your price for this line");
const ownLabor = brandPrice("gaf_hdz", archBase, { labor: 230 });
check("own labor only: labor theirs, material still from retail", ownLabor.laborPerSq === 230 && ownLabor.matPerSq === brandPrice("gaf_hdz", archBase, null).matPerSq && ownLabor.basis === "own");
const plainSpec = { ...defaultSpec(facts("TX"), BUILTIN_LISTS), systemMatPerSq: 140, systemLaborPerSq: 210, capPerFt: 2.5 };
check("no line on: the spec keeps its system rates", withBrandPrice({ ...plainSpec, productId: null, productFor: plainSpec.systemId }).systemMatPerSq === 140);
check("a line picked for another system doesn't price this one", withBrandPrice({ ...plainSpec, productId: up?.id ?? "gaf_hdz", productFor: "metal_panel" }).systemMatPerSq === 140);
if (up) {
  const sp = withBrandPrice({ ...plainSpec, productId: up.id, productName: "x", productFor: plainSpec.systemId, productAuto: false });
  check("with a line on: the spec carries the line's price", sp.systemMatPerSq === brandPrice(up.id, { ...archBase, id: plainSpec.systemId, label: plainSpec.systemName }, null).matPerSq, String(sp.systemMatPerSq));
  const a = buildRoofPackage(sp, facts("TX")), b = buildRoofPackage({ ...plainSpec, productId: null, productFor: plainSpec.systemId }, facts("TX"));
  const tot = (p: ReturnType<typeof buildRoofPackage>) => [...p.materials, ...p.labor].reduce((x, l) => x + l.quantity * l.unitPrice, 0);
  check("picking the line changes the estimate's total", tot(a) > tot(b), `${Math.round(tot(a))} vs ${Math.round(tot(b))}`);
  check("…through the system's material line only", a.labor.reduce((x, l) => x + l.quantity * l.unitPrice, 0) === b.labor.reduce((x, l) => x + l.quantity * l.unitPrice, 0));
  const withOwn = withBrandPrice({ ...plainSpec, productId: up.id, productFor: plainSpec.systemId }, { [up.id]: { mat: 199, labor: 260 } });
  check("the contractor's saved line price lands on the spec", withOwn.systemMatPerSq === 199 && withOwn.systemLaborPerSq === 260);
}

console.log("── the lines and the client's scope");
check("display name: brand · system", systemDisplayName(auto) === `${flTop[0].name} · ${base.systemName}`, systemDisplayName(auto));
check("display name: a product for another system is not named", systemDisplayName({ ...auto, productFor: "metal_panel" }) === base.systemName);
check("display name: any brand → the system alone", systemDisplayName({ ...auto, productId: null, productName: null, productAuto: false }) === base.systemName);
const pkg = buildRoofPackage(auto, facts("FL"));
check("the material line names the brand", pkg.materials.some((l) => l.name.startsWith(flTop[0].name)), pkg.materials[0]?.name);
check("the install line names the brand", pkg.labor.some((l) => l.name.includes(flTop[0].name)), pkg.labor[0]?.name);
check("the client's scope names the brand", pkg.scope.some((x) => x.includes(flTop[0].name)), pkg.scope.find((x) => /Install/.test(x)));
const plain = buildRoofPackage({ ...auto, productId: null, productName: null, productAuto: false }, facts("FL"));
check("the brand never changes the price", plain.materials.reduce((a, l) => a + l.quantity * l.unitPrice, 0) === pkg.materials.reduce((a, l) => a + l.quantity * l.unitPrice, 0));
const scopes = ROOF_PRODUCTS.flatMap((p) => {
  const sys = ROOF_SYSTEMS.find((s) => s.id === p.systems[0])!;
  const f = { ...facts("TX"), existingMaterial: null };
  const sp = { ...defaultSpec(f, BUILTIN_LISTS), systemId: sys.id, systemName: sys.label, systemFamily: sys.family, productId: p.id, productName: rank(sys.id, null).find((r) => r.product.id === p.id)!.name, productFor: sys.id, productAuto: false };
  return buildRoofPackage(sp, f).scope;
});
check("every line's scope passes the client-scope words rule", !scopes.some((x) => /estimat|confirm|photo|check|%|×|contractor|markup|productivity/i.test(x)), scopes.find((x) => /estimat|confirm|photo|check|%|×|contractor|markup|productivity/i.test(x)) ?? "");

console.log(bad ? `\n${bad} failed` : "\nall passed");
process.exit(bad ? 1 : 0);

// A contractor's ticket (2026-10-26): "wrong building — the apartment building needs to be measured, not the garage,
// and the apartment has mansards on the sides as well that need to be shingled". Held here, pure: the building the
// contractor's pin (or their pick on the page) stands on is the main one, ahead of the vendor's point on the garage;
// a pin on no building gives way to the vendor's; and the mansard sides price on either kind of roof, at their own
// shingle and the near-vertical install rate, kept across a switch between a flat top and a pitched one.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/roof-mansard.check.ts
import { pickMainStructureAt, pointInRing, pointOnRing } from "../../../src/lib/roofDiagram/instantTotals";
import type { InstantStructure } from "../../../src/lib/eagleview";
import { BUILTIN_LISTS, NAILS_PER_SQ } from "../../../src/lib/roofPackage/catalog";
import {
  MANSARD_DEFAULT_HEIGHT_FT,
  MANSARD_LABOR_FACTOR,
  buildRoofPackage,
  defaultSpec,
  mansardSqft,
  mansardSystem,
  withSystem,
  type RoofFacts,
  type RoofPackageSpec,
} from "../../../src/lib/roofPackage/takeoff";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// ── which building ──
const PIN = { lat: 42.89, lng: -78.87 };
const M_LAT = 1 / 111320;
const M_LNG = 1 / (111320 * Math.cos((PIN.lat * Math.PI) / 180));
const at = (east: number, north: number) => ({ lat: PIN.lat + north * M_LAT, lng: PIN.lng + east * M_LNG });
const box = (east: number, north: number, w: number) => {
  const h = w / 2;
  return [at(east - h, north - h), at(east + h, north - h), at(east + h, north + h), at(east - h, north + h)];
};
const st = (areaSqft: number, outline: Array<{ lat: number; lng: number }> | null): InstantStructure => ({ areaSqft, outline } as unknown as InstantStructure);

// An L-shaped roof whose centroid falls in the crook of the L, outside it.
const ell = [at(0, 0), at(40, 0), at(40, 6), at(6, 6), at(6, 40), at(0, 40)];
const inEll = pointOnRing(ell);
check("an L-shaped roof: the point sent stands on the roof, though its centroid is in the yard", pointInRing(inEll, ell) && !pointInRing({ lat: ell.reduce((a, p) => a + p.lat, 0) / ell.length, lng: ell.reduce((a, p) => a + p.lng, 0) / ell.length }, ell));
check("a plain box: its centre", pointInRing(pointOnRing(box(10, 10, 12)), box(10, 10, 12)));

// The lot: a garage under the vendor's address point, the apartment building 30 m away, another building beyond.
const garage = st(600, box(0, 0, 8));
const apartment = st(5200, box(30, 0, 22));
const third = st(900, box(0, 35, 10));
const lot = [garage, apartment, third];
const vendor = at(0, 0);
check("as before: no pin of the contractor's — the vendor's point, on the garage", JSON.stringify(pickMainStructureAt(lot, { vendor, parcelKnown: true })) === JSON.stringify({ index: 0, how: "at-pin" }));
const confirmed = pickMainStructureAt(lot, { pin: at(30, 2), vendor, parcelKnown: true });
check("the pin the contractor confirmed stands on the apartment: the apartment", confirmed.index === 1 && confirmed.how === "at-pin", JSON.stringify(confirmed));
const chosen = pickMainStructureAt(lot, { pin: pointOnRing(apartment.outline as never), vendor, chosen: true, parcelKnown: true });
check("“Measure this one” on the apartment: the apartment, said as the contractor's choice", chosen.index === 1 && chosen.how === "chosen", JSON.stringify(chosen));
const third3 = pickMainStructureAt(lot, { pin: pointOnRing(third.outline as never), vendor, chosen: true, parcelKnown: true });
check("…or the third building, if that is the one", third3.index === 2 && third3.how === "chosen");
const street = pickMainStructureAt(lot, { pin: at(15, -40), vendor, parcelKnown: true });
check("a pin on no building (a street-side geocode) gives way to the vendor's point", street.index === 0 && street.how === "at-pin", JSON.stringify(street));
const neither = pickMainStructureAt(lot, { pin: at(15, -40), vendor: at(15, -45), parcelKnown: true });
check("…and with neither on a building, the largest on the lot, as before", neither.index === 1 && neither.how === "area+parcel");
check("a chosen building the lot check put outside the lot is not taken", pickMainStructureAt(lot, { pin: pointOnRing(third.outline as never), vendor, chosen: true, foreign: [2], parcelKnown: true }).index === 0);

// ── the mansard sides ──
const facts = (over: Partial<RoofFacts> = {}): RoofFacts => ({
  squares: 40, squaresBasis: "measured", pitchFamilies: [{ pitch12: 6, share: 1 }], pitchBasis: "measured", perimeterFt: 300, footprintSqft: 3600,
  chimney: false, rooftopAcCount: 0, shape: "Hip", facetCount: 4, measured: null, existingMaterial: "Asphalt shingle", facetConfidence: null, buildingUse: null, ...over,
});
const f = facts();
const base = defaultSpec(f, BUILTIN_LISTS);
const lines = (spec: RoofPackageSpec, fx: RoofFacts = f) => {
  const p = buildRoofPackage(spec, fx);
  return [...p.materials, ...p.labor];
};
const total = (spec: RoofPackageSpec, fx: RoofFacts = f) => lines(spec, fx).reduce((a, l) => a + l.quantity * l.unitPrice, 0);
const mansardOf = (spec: RoofPackageSpec, fx: RoofFacts = f) => lines(spec, fx).filter((l) => /mansard/i.test(l.name));
check("a new estimate opens with no mansard: 0 ft, 8 ft up the face, the roof's own shingle ready", base.mansardFt === 0 && base.mansardHeightFt === MANSARD_DEFAULT_HEIGHT_FT && base.mansardName === base.systemName && mansardOf(base).length === 0);
check("…its install at the near-vertical rate, 1.5× the roof's", base.mansardLaborPerSq === Math.round(base.systemLaborPerSq * MANSARD_LABOR_FACTOR) && base.mansardMatPerSq === base.systemMatPerSq, `${base.mansardLaborPerSq} vs ${base.systemLaborPerSq}`);
const old = { ...base } as Partial<RoofPackageSpec>;
for (const k of ["mansardFt", "mansardHeightFt", "mansardName", "mansardSystemId", "mansardMatPerSq", "mansardLaborPerSq", "mansardUnderPerSq"] as const) delete old[k];
check("an estimate saved before mansards existed prices as it did", Math.abs(total(old as RoofPackageSpec) - total(base)) < 0.005 && mansardOf(old as RoofPackageSpec).length === 0);

const m = { ...base, mansardFt: 180, mansardHeightFt: 10 };
check("180 ft around × 10 ft up = 1,800 sq ft", mansardSqft(m) === 1800 && mansardSqft({ mansardFt: 180, mansardHeightFt: 0 }) === 0);
const ml = mansardOf(m);
const shingle = ml.find((l) => l.name.endsWith("· mansard sides") && l.kind === "material" && l.unitPrice === m.mansardMatPerSq);
check("the shingle on the mansard: 18 squares with the roof's waste", !!shingle && Math.abs(shingle.quantity - Math.round(18 * (1 + m.wastePct / 100) * 10) / 10) < 0.051, `${shingle?.quantity} sq`);
const install = ml.find((l) => l.name.startsWith("Install ·"));
check("its install: 18 squares at the mansard rate", !!install && install.quantity === 18 && install.unitPrice === m.mansardLaborPerSq, `${install?.quantity} × ${install?.unitPrice}`);
check("underlayment, drip edge & starter along the bottom, flashing along the top, fasteners", ["Underlayment · mansard sides", "Drip edge & starter · mansard bottom edge", "Transition flashing · mansard top edge", "Fasteners · mansard sides"].every((n) => ml.some((l) => l.name === n)) && ml.find((l) => l.name.startsWith("Drip edge"))?.quantity === 180);
check("the old shingles off the mansard with the roof's tear-off", m.tearOffLayers > 0 ? ml.some((l) => l.name.startsWith("Tear-off · mansard sides")) : !ml.some((l) => l.name.startsWith("Tear-off")), `${m.tearOffLayers} layer(s)`);
check("an overlay: no mansard tear-off", !mansardOf({ ...m, tearOffLayers: 0 }).some((l) => /tear-off|disposal/i.test(l.name)));
check("the mansard adds to the total, and the roof's own lines stay as they were", total(m) > total(base) && Math.abs(total(m) - total(base) - ml.reduce((a, l) => a + l.quantity * l.unitPrice, 0)) < 0.005);
const p = buildRoofPackage(m, f);
check("…said in the scope and the assumptions", p.scope.some((s) => /Shingle the mansard sides — 180 ft around and 10 ft tall/.test(s)) && p.assumptions.some((s) => /aerial measurement does not see near-vertical faces/.test(s)));
const tall = mansardOf(m, facts({ storeys: 3 })).find((l) => l.name.startsWith("Install ·"));
check("a three-storey building: the height factor on the mansard install too", !!tall && tall.unitPrice === Math.round((m.mansardLaborPerSq ?? 0) * 1.15) && /3-storey/.test(tall.name), tall?.name);

const slate = BUILTIN_LISTS.systems.find((s) => s.family === "slate") ?? BUILTIN_LISTS.systems.find((s) => s.family !== "asphalt" && s.family !== "low-slope")!;
const ms = { ...m, ...mansardSystem(slate) };
check("another shingle picked for the mansard: its name, its price, its install × 1.5", ms.mansardName === slate.label && ms.mansardMatPerSq === slate.matPerSq && ms.mansardLaborPerSq === Math.round(slate.laborPerSq * MANSARD_LABOR_FACTOR) && mansardOf(ms).some((l) => l.name === `${slate.label} · mansard sides`));

// The classic apartment block: a flat top over shingled mansards.
const tpo = BUILTIN_LISTS.systems.find((s) => s.id === "tpo")!;
const flatFacts = facts({ pitchFamilies: [{ pitch12: 0.25, share: 1 }], existingMaterial: "TPO", buildingUse: "commercial" });
const flat = withSystem(m, tpo, flatFacts, BUILTIN_LISTS);
check("switched to a flat top: the mansard entries stay as typed", flat.systemFamily === "low-slope" && flat.mansardFt === 180 && flat.mansardHeightFt === 10 && flat.mansardName === m.mansardName && flat.mansardLaborPerSq === m.mansardLaborPerSq);
const fl = mansardOf(flat, flatFacts);
check("…and price there: the shingle, the install, the edges — fasteners at the shingle rate though the flat spec carries none", flat.nailsPerSq === 0 && fl.some((l) => l.name.startsWith("Install ·")) && fl.find((l) => l.name === "Fasteners · mansard sides")?.unitPrice === NAILS_PER_SQ, fl.map((l) => l.name).join(" | "));
check("…at 12% waste on a flat roof's job", Math.abs((fl.find((l) => l.kind === "material" && l.name.endsWith("· mansard sides") && l.unitPrice === flat.mansardMatPerSq)?.quantity ?? 0) - 20.2) < 0.051);
const commercial = { ...flat, commercial: { ...flat.commercial, on: true } };
const big = { ...flatFacts, squares: 320 };
const cInstall = mansardOf(commercial, big).find((l) => l.name.startsWith("Install ·"));
check("priced as commercial on a big deck: the deck's productivity discount does not touch the mansard's upright lay", !!cInstall && cInstall.unitPrice >= (flat.mansardLaborPerSq ?? 0), `${cInstall?.unitPrice} vs ${flat.mansardLaborPerSq}`);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);

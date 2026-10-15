// Synthetic check of the HVAC ledger — no network, no browser.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-ledger.check.ts
// The same engine result and rate card give the same lines twice; a gas house
// gets a furnace + coil, an all-electric one an air handler + strips; a failed
// panel check adds the circuit and the caveat; a shop cost beats the default;
// the CSV import reads a realistic sheet and reports the bad rows.
import { runEngine } from "../../../src/lib/hvac/engine";
import { buildLedger, DEFAULT_RATE_CARD, parseCatalogCsv, STARTER_CATALOG } from "../../../src/lib/hvac/ledger";
import { modelFromSite } from "../../../src/lib/hvac/intake";
import type { BuildingModel, CatalogItem } from "../../../src/lib/hvac/types";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

function house(over: Partial<BuildingModel> = {}): BuildingModel {
  const m = modelFromSite({ address: "4518 Bluestem Hollow Dr, Frisco, TX 75034", state: "TX", county: "Collin", footprintSqft: 2000, storeys: 1, yearBuilt: 1998, sources: {} });
  m.existing = { kind: "split-ac-furnace", tons: 3.5, fuel: "gas", refrigerant: "R-22", yearMade: 2004 };
  m.electrical = { mainAmps: 200, freeSlots: 4, electricDryer: true };
  m.ducts = { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 700 };
  m.gas = { available: true, pipeIn: 0.75, longestRunFt: 30 };
  return Object.assign(m, over);
}

const gas = house();
const r1 = runEngine(gas, { catalog: STARTER_CATALOG });
const l1 = buildLedger(r1, gas, DEFAULT_RATE_CARD, STARTER_CATALOG);
const l1b = buildLedger(r1, gas, DEFAULT_RATE_CARD, STARTER_CATALOG);
ok("Deterministic: same inputs, same subtotal", l1.subtotal === l1b.subtotal && l1.materials.length === l1b.materials.length, `$${l1.subtotal}`);
ok("Gas house: AC first; a heat pump still fits, marked as the dual-fuel offer", r1.selection.chosen?.item.kind === "air-conditioner" && r1.selection.candidates.some((c) => !c.disqualified && c.item.kind === "heat-pump" && c.reasons.some((x) => /dual fuel/i.test(x))), `${r1.selection.chosen?.item.model}`);
ok("Gas house: condenser + furnace + coil", l1.materials.some((l) => l.id === "eq-main") && l1.materials.some((l) => l.id === "eq-furnace") && l1.materials.some((l) => l.id === "eq-coil"), l1.materials.map((l) => l.id).join(","));
ok("Furnace covers the heating load", (() => { const f = l1.materials.find((l) => l.id === "eq-furnace"); return !!f && /\d+k BTU/.test(f.name); })(), l1.materials.find((l) => l.id === "eq-furnace")?.name);
ok("Starter rows price from the rate-card default and say so", l1.materials[0].basis === "estimated" && /rate-card default/.test(l1.materials[0].note ?? ""));
ok("Line set defaults to the card's length, estimated", (() => { const s = l1.materials.find((l) => l.id === "m-lineset"); return !!s && s.quantity === 25 && s.basis === "estimated"; })());
ok("Attic unit adds the condensate pump / pan", l1.materials.some((l) => l.id === "m-pump"));
ok("Gas flex kit for an AC + furnace", l1.materials.some((l) => l.id === "m-gasflex"));
ok("Labour: remove, outdoor, indoor (furnace), lineset, electrical, tstat, startup", ["l-remove", "l-outdoor", "l-indoor", "l-lineset", "l-elec", "l-tstat", "l-startup"].every((id) => l1.labor.some((l) => l.id === id)), l1.labor.map((l) => l.id).join(","));
ok("Furnace + coil set is one each at the two tasks' amounts", (() => { const s = l1.labor.find((l) => l.id === "l-indoor"); return !!s && s.unit === "each" && s.quantity === 1 && s.unitPrice === DEFAULT_RATE_CARD.labor.setFurnace + DEFAULT_RATE_CARD.labor.setCoil; })());
ok("No labor line is priced by the hour", l1.labor.every((l) => l.unit !== "hour"));
ok("Permit and disposal at the card's fees", l1.labor.some((l) => l.id === "l-permit" && l.unitPrice === 250) && l1.labor.some((l) => l.id === "l-disposal" && l.unitPrice === 150));
ok("No crane on a split system", !l1.labor.some((l) => l.id === "l-crane"));
ok("Subtotal in a realistic band for an AC + furnace", l1.subtotal >= 7000 && l1.subtotal <= 18000, `$${l1.subtotal} · ${r1.selection.targetTons} t`);
ok("Scope names the load and the design temps", /BTU\/h cooling/.test(l1.scope) && /design conditions/.test(l1.scope) && /Collin County/.test(l1.scope), l1.scope.slice(0, 160));
ok("Title names the kind and street", /^AC \+ furnace replacement — 4518 Bluestem Hollow Dr$/.test(l1.title), l1.title);
ok("Assumptions carry the rate card line", l1.assumptions.some((a) => /rate card/.test(a)));

// all-electric, heat pump
const elec = house({ gas: { available: false }, preferences: { allElectric: true }, existing: { kind: "split-heat-pump", tons: 3, fuel: "electric" }, electrical: { mainAmps: 100, freeSlots: 0, electricRange: true, electricDryer: true, electricWaterHeater: true } });
const r2 = runEngine(elec, { catalog: STARTER_CATALOG });
const l2 = buildLedger(r2, elec, DEFAULT_RATE_CARD, STARTER_CATALOG);
ok("All-electric picks a heat pump", r2.selection.chosen?.item.kind === "heat-pump", r2.selection.chosen?.item.kind);
ok("Heat pump: air handler + backup strips, no furnace", l2.materials.some((l) => l.id === "eq-ah") && l2.materials.some((l) => l.id === "eq-strips") && !l2.materials.some((l) => l.id === "eq-furnace"));
ok("100 A panel with everything electric fails the NEC count", r2.checks.find((c) => c.id === "service")?.status === "fix", r2.checks.find((c) => c.id === "service")?.detail);
ok("Failed panel → circuit line + caveat + the new-circuit task", l2.materials.some((l) => l.id === "m-breaker" && /separately/.test(l.name)) && l2.assumptions.some((a) => /service upgrade/.test(a)) && l2.labor.find((l) => l.id === "l-elec")?.unitPrice === DEFAULT_RATE_CARD.labor.electricalCircuit);
ok("No gas flex on an electric house", !l2.materials.some((l) => l.id === "m-gasflex"));

// package unit
const pkg = house({ existing: { kind: "package-unit", tons: 3, fuel: "gas" } });
const r3 = runEngine(pkg, { catalog: [...STARTER_CATALOG, { id: "pk", kind: "package", brand: "Starter", model: "PK-036", tons: 3, coolingBtuh: 36000, seer2: 14.3, refrigerant: "R-454B", staging: "single", source: "shop" }] });
const l3 = buildLedger(r3, pkg, DEFAULT_RATE_CARD, STARTER_CATALOG);
ok("Package unit: crane, no line set, no pad", l3.labor.some((l) => l.id === "l-crane") && !l3.materials.some((l) => l.id === "m-lineset") && !l3.materials.some((l) => l.id === "m-pad"), r3.selection.chosen?.item.kind);

// shop cost beats the default
const tt = r1.selection.targetTons;
const priced: CatalogItem = { id: "shop-1", kind: "air-conditioner", brand: "Carrier", model: `24SCA5${tt * 12}A003`, tons: tt, coolingBtuh: tt * 12000, seer2: 15.2, refrigerant: "R-454B", staging: "single", cost: 2100, source: "shop" };
const r4 = runEngine(gas, { catalog: [priced, ...STARTER_CATALOG.filter((c) => c.kind !== "air-conditioner")] });
const l4 = buildLedger(r4, gas, DEFAULT_RATE_CARD, STARTER_CATALOG);
ok("Shop cost + markup on the equipment line", r4.selection.chosen?.item.id === "shop-1" && l4.materials[0].unitPrice === 2835 && l4.materials[0].basis === "entered", `${r4.selection.chosen?.item.id} $${l4.materials[0].unitPrice}`);
ok("Entered line set length is entered", buildLedger(r4, gas, DEFAULT_RATE_CARD, STARTER_CATALOG, { linesetFt: 42 }).materials.find((l) => l.id === "m-lineset")?.basis === "entered");

// poor ducts and a small return
const ducty = house({ ducts: { location: "crawl", condition: "poor", insulated: false, returnGrilleSqIn: 200 } });
const r5 = runEngine(ducty, { catalog: STARTER_CATALOG });
const l5 = buildLedger(r5, ducty, DEFAULT_RATE_CARD, STARTER_CATALOG);
ok("Small return → upsize line + hours", l5.materials.some((l) => l.id === "m-return") && l5.labor.some((l) => l.id === "l-return"), r5.checks.find((c) => c.id === "return")?.status);
ok("Poor ducts → sealing kit + hours", l5.materials.some((l) => l.id === "m-seal") && l5.labor.some((l) => l.id === "l-seal"));
ok("Crawl ducts: no attic pump", !l5.materials.some((l) => l.id === "m-pump"));

// CSV
const csv = `kind,brand,model,tons,coolingBtuh,heat47Btuh,heat17Btuh,heat5Btuh,btuInput,afue,seer2,eer2,hspf2,refrigerant,staging,coldClimate,ahriRef,mcaAmps,ratedStaticInWc,cost
heat pump,Mitsubishi,"SUZ-KA36NAHZ",3,36000,38000,30000,25000,,,18.5,12.5,10,R-410A,variable,yes,209876543,25,,"$3,450"
AC,Goodman,GSXN403610,3,36000,,,,,,14.3,11.7,,R-454B,single,,,20,,1150
furnace,Goodman,GM9S960803BN,,,,,,80000,96,,,,,,,,,0.5,1290
coil,Goodman,CAPTA3626C3,3,,,,,,,,,,,,,,,,310
air handler,Goodman,AMST36CU1400,3,,,,,,,,,,,,,,,0.5,890
,Nobody,X
widget,Acme,W-1`;
const parsed = parseCatalogCsv(csv);
ok("CSV: 5 good rows, 2 reported", parsed.items.length === 5 && parsed.errors.length === 2, `${parsed.items.length} / ${parsed.errors.join(" | ")}`);
ok("CSV: kinds normalised", parsed.items.map((i) => i.kind).join(",") === "heat-pump,air-conditioner,furnace,coil,air-handler", parsed.items.map((i) => i.kind).join(","));
ok("CSV: quoted money and AFUE percent parse", parsed.items[0].cost === 3450 && parsed.items[2].afue === 0.96 && parsed.items[0].coldClimate === true && parsed.items[0].staging === "variable");
ok("CSV: ids are stable slugs", parsed.items[1].id === "air-conditioner-goodman-gsxn403610", parsed.items[1].id);
const r6 = runEngine(gas, { catalog: parsed.items });
const l6 = buildLedger(r6, gas, DEFAULT_RATE_CARD, parsed.items);
ok("Imported catalog prices with its own furnace and coil", l6.materials.find((l) => l.id === "eq-furnace")?.name.includes("GM9S960803BN") === true && l6.materials.find((l) => l.id === "eq-coil")?.name.includes("CAPTA3626C3") === true, l6.materials.map((l) => l.name.slice(0, 30)).join(" | "));


{
  const csv = "kind,brand,model,btuInput,afue,noxNgJ\nfurnace,Acme,ULN-060,60000,96,14\nfurnace,Acme,STD-060,60000,96,";
  const out = parseCatalogCsv(csv);
  ok("CSV: the NOx class reads in (14 = ultra-low; blank = the 40 ng/J class)", out.items[0]?.noxNgJ === 14 && out.items[1]?.noxNgJ === undefined, JSON.stringify(out.items.map((i) => i.noxNgJ)));
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

// Synthetic check of the directory importer and the calibration arithmetic.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-directory.check.ts
// An AHRI-style export and a NEEP-style export (the column names seen on
// published extracts) become catalog rows with the right kinds and figures;
// the shop template is refused here and sent to the shop parser; the
// recognised columns are reported. The calibration stats answer known rows.
import { detectDirectory, parseDirectoryCsv } from "../../../src/lib/hvac/directory";
import { calibrationLine, calibrationStats } from "../../../src/lib/hvac/calibration";
import { runEngine } from "../../../src/lib/hvac/engine";
import { modelFromSite } from "../../../src/lib/hvac/intake";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const ahri = `AHRI Certified Reference Number,Outdoor Unit Brand Name,Outdoor Unit Model Number,Indoor Unit Model Number,Furnace Model Number,Cooling Capacity (A2) - Single or High Stage (95F),EER2 (A2) - Single or High Stage (95F),SEER2,HSPF2 (Region IV),Heating Capacity (H1) - Single or High Stage (47F),Heating Capacity (H3) - Single or High Stage (17F),Refrigerant Type,Status
209876543,GOODMAN,GSZH503610,AMST36CU1400,,36000,12.5,15.2,7.8,35400,21000,R-454B,Active
209876544,CARRIER,24SCA536A003,CAPTA3626C3,59SC5A060,34600,11.7,14.3,,,,R-454B,Active
209876545,LENNOX,XC16-036-230,CBA38MV-036,,35000,12.0,16.0,,,,R-410A,Discontinued
,,,,,,,,,,,,`;
const a = parseDirectoryCsv(ahri);
ok("AHRI export detected", a.source === "ahri", String(a.source));
ok("AHRI: 2 active rows, discontinued skipped, blank reported", a.items.length === 2 && a.errors.some((e) => /1 discontinued/.test(e)) && a.errors.some((e) => /Row 5/.test(e)), a.errors.join(" | "));
const gsz = a.items.find((i) => i.model.startsWith("GSZH503610"));
ok("AHRI: heat pump by HSPF2/47F capacity, with 47/17 and refrigerant", !!gsz && gsz.kind === "heat-pump" && gsz.heat47Btuh === 35400 && gsz.heat17Btuh === 21000 && gsz.refrigerant === "R-454B" && gsz.seer2 === 15.2 && gsz.tons === 3 && gsz.ahriRef === "209876543", JSON.stringify(gsz));
ok("AHRI: AC by absence of heating figures", a.items.find((i) => i.model.startsWith("24SCA536A003"))?.kind === "air-conditioner");
ok("AHRI: indoor model rides on the model string", a.items[0].model === "GSZH503610 + AMST36CU1400", a.items[0].model);
ok("AHRI: recognised columns reported", /AHRI Certified Reference Number/.test(a.recognised.ahriRef ?? "") && /Outdoor Unit Model Number/.test(a.recognised.model ?? "") && /47F/.test(a.recognised.heat47Btuh ?? ""), JSON.stringify(a.recognised));
ok("AHRI: ids are stable from the reference number", a.items[0].id === "ahri-209876543");

const neep = `Brand,Outdoor Unit Model,Indoor Unit Model,AHRI Certified Reference Number,Duct Configuration,Rated Cooling Capacity (Btu/h),SEER2,EER2,HSPF2,Max Capacity at 47F (Btu/h),Max Capacity at 17F (Btu/h),Max Capacity at 5F (Btu/h),COP at 5F,Refrigerant,Compressor Type
Mitsubishi Electric,SUZ-KA36NAHZ,SVZ-KP36NA,210012345,Ducted,36000,17.2,12.5,10.0,38000,30000,25000,2.1,R-410A,Variable Speed
Daikin,RXT36,FTXT36,210012346,Ductless,34000,18.0,12.0,10.5,36000,29000,24500,2.0,R-32,Inverter`;
const n = parseDirectoryCsv(neep);
ok("NEEP export detected by the 5°F column", n.source === "neep", String(n.source));
ok("NEEP: cold-climate heat pumps with 47/17/5", n.items.length === 2 && n.items.every((i) => i.kind === "heat-pump" || i.kind === "ductless") && n.items[0].heat5Btuh === 25000 && n.items[0].coldClimate === true && n.items[0].staging === "variable", JSON.stringify(n.items[0]));
ok("NEEP: ductless rows keep their kind", n.items[1].kind === "ductless" && n.items[1].refrigerant === "R-32");
ok("Shop template is refused here", detectDirectory(["kind", "brand", "model"]) === "shop" && parseDirectoryCsv("kind,brand,model\nfurnace,X,Y").source === null);
ok("Unknown header is refused with a reason", parseDirectoryCsv("a,b,c\n1,2,3").errors[0].includes("Couldn't recognise"));

// the imported rows feed the engine
const m = modelFromSite({ address: "1 Elm St, Duluth, MN 55802", state: "MN", county: "St. Louis", footprintSqft: 1600, storeys: 1, yearBuilt: 1990, sources: {} });
m.gas = { available: false };
m.preferences = { allElectric: true };
m.existing = { kind: "split-heat-pump", fuel: "electric" };
const r = runEngine(m, { catalog: n.items });
ok("Engine runs on the imported NEEP rows", r.selection.candidates.length >= 1 && (r.selection.chosen === null || r.selection.chosen.item.source === "neep"), r.selection.chosen?.item.model ?? r.selection.candidates.map((c) => c.disqualified).join(" | "));

// calibration
const stats = calibrationStats([
  { sizedTons: 3, subtotal: 12000, actualTons: 3, actualPrice: 11000 },
  { sizedTons: 3.5, subtotal: 14000, actualTons: 4, actualPrice: 14000 },
  { sizedTons: 2, subtotal: 9000, actualTons: 3, actualPrice: 10000 },
  { sizedTons: 4, subtotal: 15000, actualTons: null, actualPrice: null },
]);
ok("Calibration counts rows with actuals", stats.n === 3 && stats.tonsN === 3 && stats.priceN === 3, JSON.stringify(stats));
ok("Tons within half a ton on 2 of 3", Math.abs(stats.tonsWithinHalf - 2 / 3) < 0.001 && stats.tonsMae === 0.5, `${stats.tonsWithinHalf} ${stats.tonsMae}`);
ok("Price MAPE and bias", stats.priceMape === 6.4 && stats.priceBiasPct === -0.3, `${stats.priceMape} ${stats.priceBiasPct}`);
ok("Line names the gate", /3 jobs with actuals/.test(calibrationLine(stats)) && /17 more/.test(calibrationLine(stats)), calibrationLine(stats));
ok("Empty line invites actuals", /No actuals/.test(calibrationLine(calibrationStats([]))));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

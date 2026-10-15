// Synthetic check of the catalog page's reading of the rows (lib/hvac/catalogView) — no network, no browser.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-catalog-view.check.ts
import { US_CATALOG } from "../../../src/lib/hvac/data/usCatalog";
import { CATEGORIES, catalogSummary, familyKey, groupCatalog, offForState, ratingLine, shopItemId, sizeOf, stateFit, stateName } from "../../../src/lib/hvac/catalogView";
import type { CatalogItem } from "../../../src/lib/hvac/types";

let failures = 0, passes = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (cond) passes++; else failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
const row = (p: Partial<CatalogItem> & Pick<CatalogItem, "kind" | "brand" | "model">): CatalogItem => ({ id: shopItemId(p.kind, p.brand, p.model), source: "shop", ...p });

// ── families ────────────────────────────────────────────────────────────────
ok("A US row carries its product line", US_CATALOG.every((c) => c.family), US_CATALOG.find((c) => !c.family)?.model ?? "");
ok("A shop row's line is its model with the size code stripped", familyKey(row({ kind: "air-conditioner", brand: "Goodman", model: "GLXS4BA4810" })) === "GLXS4BA" && familyKey(row({ kind: "furnace", brand: "Carrier", model: "59SU5-080" })) === "59SU5" && familyKey(row({ kind: "furnace", brand: "Goodman", model: "GR9S80-060-U" })) === "GR9S80-U");
ok("A model with no digits is its own line", familyKey(row({ kind: "coil", brand: "X", model: "CASED" })) === "CASED");

// ── sizes and ratings ───────────────────────────────────────────────────────
ok("Sizes read in the contractor's units", sizeOf(row({ kind: "heat-pump", brand: "T", model: "A036", tons: 3 })).label === "3 ton" && sizeOf(row({ kind: "furnace", brand: "T", model: "F080", btuInput: 80000 })).label === "80 kBTU" && sizeOf(row({ kind: "water-heater", brand: "T", model: "W50", gallons: 50, whType: "tank" })).label === "50 gal" && sizeOf(row({ kind: "water-heater", brand: "T", model: "TL", whType: "tankless" })).label === "tankless" && sizeOf(row({ kind: "air-conditioner", brand: "T", model: "H", tons: 2.5 })).label === "2.5 ton");
ok("The rating line reads like a submittal", ratingLine(row({ kind: "heat-pump", brand: "T", model: "A", seer2: 17.2, hspf2: 8.1, refrigerant: "R-32", staging: "two-stage" })) === "17.2 SEER2 · 8.1 HSPF2 · R-32 · two-stage" && ratingLine(row({ kind: "furnace", brand: "T", model: "F", afue: 0.96, staging: "single", noxNgJ: 14 })) === "96% AFUE · single · ultra-low NOx");

// ── grouping ────────────────────────────────────────────────────────────────
const summary = catalogSummary(US_CATALOG);
ok("The US list sums to its categories", summary.total === US_CATALOG.length && CATEGORIES.reduce((n, c) => n + summary.byKind[c.kind].total, 0) === US_CATALOG.length && summary.on === US_CATALOG.length && summary.costed === 0, `${summary.total} rows · ${summary.brands} brands`);
const ac = groupCatalog(US_CATALOG, "air-conditioner");
ok("Air conditioners group by brand, then line, sizes ascending", ac.length >= 5 && ac.every((b) => b.families.every((f) => f.rows.every((r, i, a) => i === 0 || sizeOf(a[i - 1]).n <= sizeOf(r).n))) && ac[0].total >= ac[ac.length - 1].total, ac.map((b) => `${b.brand} ${b.families.length} lines / ${b.total}`).join(", "));
ok("Lines sort Good → Better → Best inside a brand", ac.every((b) => b.families.every((f, i, a) => i === 0 || ({ value: 0, mid: 1, premium: 2 }[a[i - 1].tier ?? "mid"] <= { value: 0, mid: 1, premium: 2 }[f.tier ?? "mid"]))));
ok("Turning a row off moves the counts, not the row", (() => { const items = US_CATALOG.map((c, i) => (i === 0 ? { ...c, offList: true } : c)); const s = catalogSummary(items); return s.total === US_CATALOG.length && s.on === US_CATALOG.length - 1 && s.off === 1; })());

// ── state fit ───────────────────────────────────────────────────────────────
const txAc134 = row({ kind: "air-conditioner", brand: "T", model: "A", tons: 3, coolingBtuh: 36000, seer2: 13.4, refrigerant: "R-454B" });
ok("Texas (Southeast): a 13.4 SEER2 condenser is ruled out, a 14.3 is fine", stateFit(txAc134, "TX").level === "no" && stateFit({ ...txAc134, seer2: 14.3 }, "TX").level === "ok", stateFit(txAc134, "TX").text);
ok("Ohio (North): 13.4 SEER2 is enough", stateFit(txAc134, "OH").level === "ok");
ok("Arizona (Southwest): the EER2 floor applies, with the lower one for a 15.2+ SEER2 unit", stateFit({ ...txAc134, seer2: 14.3, eer2: 11.0 }, "AZ").level === "no" && stateFit({ ...txAc134, seer2: 16, eer2: 10.0 }, "AZ").level === "ok" && stateFit({ ...txAc134, seer2: 14.3 }, "AZ").level === "confirm");
ok("Split heat pumps answer to 14.3 SEER2 and 7.5 HSPF2 everywhere", stateFit(row({ kind: "heat-pump", brand: "T", model: "H", tons: 3, coolingBtuh: 36000, seer2: 14.0, hspf2: 7.5, refrigerant: "R-32" }), "OH").level === "no" && stateFit(row({ kind: "heat-pump", brand: "T", model: "H", tons: 3, coolingBtuh: 36000, seer2: 15.2, hspf2: 7.0, refrigerant: "R-32" }), "OH").level === "no");
ok("New York: R-410A is out; elsewhere it is a confirm", stateFit({ ...txAc134, seer2: 15, refrigerant: "R-410A" }, "NY").level === "no" && stateFit({ ...txAc134, seer2: 15, refrigerant: "R-410A" }, "OH").level === "confirm");
ok("California and Washington: R-410A is over the 750 GWP cap", stateFit({ ...txAc134, seer2: 15, eer2: 12, refrigerant: "R-410A" }, "CA").level === "no" && stateFit({ ...txAc134, seer2: 15, refrigerant: "R-410A" }, "WA").level === "no");
const f40 = row({ kind: "furnace", brand: "T", model: "F", btuInput: 80000, afue: 0.96, noxNgJ: 40 });
ok("California: a 40 ng/J furnace is a district question, a 14 ng/J one is clear, Texas does not care", stateFit(f40, "CA").level === "confirm" && stateFit({ ...f40, noxNgJ: 14 }, "CA").level === "ok" && stateFit(f40, "TX").level === "ok");
ok("A row sold only in California is out in Texas", stateFit({ ...f40, states: ["CA"] }, "TX").level === "no" && stateFit({ ...f40, states: ["CA"] }, "CA").level === "confirm");
ok("No state picked: nothing to say", stateFit(txAc134, "").level === "ok" && stateFit(txAc134, "").text === "");
ok("State names", stateName("tx") === "Texas" && stateName("ZZ") === "ZZ");

// ── set up for a state ──────────────────────────────────────────────────────
const offTx = offForState(US_CATALOG, "TX"), offNy = offForState(US_CATALOG, "NY"), offCa = offForState(US_CATALOG, "CA"), offOh = offForState(US_CATALOG, "OH");
ok("Texas: the built-in list already meets the Southeast floor, so nothing is ruled out", offTx.length === 0, `${offTx.length} off in TX`);
ok("…but a 13.4 SEER2 condenser added to it would be", offForState([...US_CATALOG, txAc134], "TX").length === 1);
ok("New York turns off every R-410A cooling row", offNy.filter((c) => c.refrigerant === "R-410A").length === US_CATALOG.filter((c) => c.refrigerant === "R-410A" && ["air-conditioner", "heat-pump", "ductless", "package", "coil"].includes(c.kind)).length, `${offNy.length} off in NY`);
ok("California keeps the ultra-low-NOx furnaces on", !offCa.some((c) => c.kind === "furnace" && (c.noxNgJ ?? 40) <= 14), `${offCa.length} off in CA`);
ok("Ohio (North) rules out nothing either", offOh.length === 0, `${offOh.length} off in OH`);
ok("Rows already off are not counted twice", offForState(US_CATALOG.map((c) => ({ ...c, offList: true })), "TX").length === 0);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

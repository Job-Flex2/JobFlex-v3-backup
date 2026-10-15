// The standard stock items per trade (2026-09-20) come off the estimators
// themselves: every material line the fence, roof and HVAC engines price
// over their own catalogs. No database, no model call.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/inventory-presets.check.ts
import { presetItems } from "../../../src/lib/inventoryPresets";
import { stockKey } from "../../../src/lib/inventory";
import { explodeLines, fenceTypeForLine } from "../../../src/lib/inventoryBom";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const names = (t: "fence" | "roof" | "hvac") => presetItems(t).map((i) => i.name);
const has = (t: "fence" | "roof" | "hvac", re: RegExp) => names(t).some((n) => re.test(n));
const UNITS = new Set(["each", "linear ft", "sqft", "square", "lot", "bag", "box", "gal", "roll", "bundle", "hour"]);

const fence = names("fence");
check(`the fence list is the fence estimator's own materials (${fence.length} items)`, fence.length >= 12, fence.slice(0, 8).join(" | "));
check("posts, rails, pickets or boards, concrete, screws and gate posts are on it — components, never a 'package'", has("fence", /post/i) && has("fence", /rail|2x4|2 x 4|2×4/i) && has("fence", /picket|board|panel|1x6|1×6/i) && has("fence", /concrete/i) && has("fence", /screw|nail|fastener/i) && has("fence", /gate/i) && !has("fence", /package/i), fence.filter((n) => /post|rail|picket|board|concrete|gate/i.test(n)).slice(0, 8).join(" | "));
check("cedar and pressure-treated both appear", has("fence", /cedar/i) && has("fence", /pressure|PT\b|treated/i));

const roof = names("roof");
check(`the roof list is the roof estimator's own materials (${roof.length} items)`, roof.length >= 15, roof.slice(0, 8).join(" | "));
check("shingles, starter, underlayment, ice & water, drip edge and nails are on it", has("roof", /shingle/i) && has("roof", /starter/i) && has("roof", /underlayment/i) && has("roof", /ice/i) && has("roof", /drip edge/i) && has("roof", /nail|fastener/i));
check("metal and flat systems bring their own lines", has("roof", /metal|standing seam|panel/i) && has("roof", /membrane|tpo|epdm/i));

const hvac = names("hvac");
check(`the HVAC list is the HVAC estimator's own materials (${hvac.length} items)`, hvac.length >= 12, hvac.slice(0, 8).join(" | "));
check("equipment, line set, thermostat and a pad or bracket are on it", has("hvac", /condenser|heat pump|furnace|air handler/i) && has("hvac", /line ?set/i) && has("hvac", /thermostat/i) && has("hvac", /pad|bracket|stand/i));

for (const t of ["fence", "roof", "hvac"] as const) {
  const items = presetItems(t);
  check(`${t}: no labor, fees or rentals on the shelf list`, items.every((i) => !/permit|fee|labor|install|dumpster|disposal|rental|crane|hoist|warranty/i.test(i.name)), items.filter((i) => /permit|fee|labor|install|dumpster|disposal|rental|crane|hoist|warranty/i.test(i.name)).map((i) => i.name).join(" | "));
  check(`${t}: every unit is one the warehouse counts in, no duplicates by meaning`, items.every((i) => UNITS.has(i.unit)) && new Set(items.map((i) => stockKey(i.name))).size === items.length, [...new Set(items.map((i) => i.unit))].join(","));
}

// A fence proposal's package line, read back through the estimator's takeoff.
const parts = explodeLines("fence", [{ name: "Cedar privacy — 6' fence package", quantity: 104, unit: "ln ft" }, { name: "Single gate — framed & hung", quantity: 1, unit: "ea" }, { name: "Stain & seal (both faces)", quantity: 600, unit: "sqft" }]);
check("a 104 ft cedar privacy package with a gate becomes its posts, rails, pickets, concrete, nails, caps and the gate kit", fenceTypeForLine("Cedar privacy — 6' fence package")?.id === "cedar-privacy" && parts.some((l) => /line posts/i.test(l.name) && l.quantity >= 8) && parts.some((l) => /gate posts/i.test(l.name)) && parts.some((l) => /concrete/i.test(l.name) && l.quantity > 20) && parts.some((l) => /screw|nail/i.test(l.name)) && parts.some((l) => /gate kit|hinge/i.test(l.name)) && parts.some((l) => /post caps/i.test(l.name)) && !parts.some((l) => /package|single gate/i.test(l.name)), parts.map((l) => `${l.quantity} ${l.unit} ${l.name}`).slice(0, 8).join(" | "));
check("a line that is not a package passes through untouched", parts.some((l) => l.name === "Stain & seal (both faces)" && l.quantity === 600));
check("the components are named exactly as the standard items, so they match on the shelf", parts.filter((l) => !/stain/i.test(l.name)).every((l) => presetItems("fence").some((p) => stockKey(p.name) === stockKey(l.name))), parts.filter((l) => !presetItems("fence").some((p) => stockKey(p.name) === stockKey(l.name))).map((l) => l.name).join(" | "));

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);

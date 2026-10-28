// The Lead Center's suggested price on automatic routing (lib/leadCenter/autoPrice, 2026-10-27): off until the owner
// turns it on, per trade; on, an unpriced lead with an estimate goes out at the suggestion. Pure parts.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/lead-auto-price.check.ts
import { AUTO_PRICE_KEY, PRICED_TRADES, isPricedTrade, offerPriceFor } from "../../../src/lib/leadCenter/autoPrice";
import { leadEstimateFromWeb, type LeadEstimate } from "../../../src/lib/leadCenter/estimate";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const e = { v: 1, trade: "roof", range: { low: 14200, mid: 16000, high: 19800 }, material: "architectural", materialLabel: "Architectural shingle", tearOffLayers: 1, storeys: 2, squares: 21, pitchLabel: "6/12", basis: "solar", budgetCents: null, answers: { existing: "asphalt", storeys: 2, material: "architectural", tearOffLayers: 1, leaks: false, skylights: false, solarPanels: false }, cityFactor: 1, guideRange: null, at: "2026-10-27T12:00:00Z", hidden: { facts: {} as never, spec: {} as never, materials: [], labor: [], assumptions: [], scopeText: "" } } as LeadEstimate;

check("the switch's key names the trade", AUTO_PRICE_KEY("roof") === "leadCenter:autoPrice:roof");
check("an unpriced lead with an estimate gets the suggestion only with the switch on", offerPriceFor({ priceCents: null, estimate: e, exclusive: false, autoOn: true }) === 3500 && offerPriceFor({ priceCents: null, estimate: e, exclusive: false, autoOn: false }) === null);
check("an admin's own price always wins; exclusive doubles the suggestion", offerPriceFor({ priceCents: 5000, estimate: e, exclusive: true, autoOn: true }) === 5000 && offerPriceFor({ priceCents: null, estimate: e, exclusive: true, autoOn: true }) === 7000);
check("no estimate: nothing to suggest", offerPriceFor({ priceCents: null, estimate: null, exclusive: false, autoOn: true }) === null);

// The house estimators (2026-10-28): a switch per trade, five of them; a web estimate is suggested like the roof's.
const web = leadEstimateFromWeb({ token: "t", organizationId: "o", trade: "hvac", at: "2026-10-28T10:00:00Z", address: "418 Linden Ave", city: "Buffalo", state: "NY", zip: "14216", summary: "3-ton system", choice: "Air conditioner + furnace, the better tier", cents: 1180000, band: { low: 10400, high: 13200 }, show: "range", facts: {} }, null);
check("five priced trades, one key each", PRICED_TRADES.join() === "roof,deck,fence,hvac,smart" && AUTO_PRICE_KEY("fence") === "leadCenter:autoPrice:fence" && isPricedTrade("hvac") && !isPricedTrade("roofing") && !isPricedTrade(null));
check("a web estimate gets the suggestion with its trade's switch on", offerPriceFor({ priceCents: null, estimate: web, exclusive: true, autoOn: true }) === 7000 && offerPriceFor({ priceCents: null, estimate: web, exclusive: false, autoOn: false }) === null);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);

// THE HOME DEPOT PRESET (2026-10-12, lib/deck/storePrices): every surveyed price belongs to a material row of the
// price book, inside its rails, from a homedepot.com listing, in the row's unit (no price 3× off its old example — the
// mark of a unit slip); it is the default where it exists, scaled to the market, and the shop's own number wins. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json scripts/qa/deck-store-prices.check.ts
import { STORE_PRICES, STORE_SURVEY } from "../../src/lib/deck/storePrices";
import { DECK_RATES, deckRate, deckRateRows } from "../../src/lib/deck/rates";
import { defaultDeckDesign, defaultRoofDesign, defaultStair } from "../../src/lib/deck/design";
import { applyDeckPatch } from "../../src/lib/deck/checks";
import { priceDeck } from "../../src/lib/deck/pricing";
import { materialList } from "../../src/lib/deck/materialList";
import { resolveMarket } from "../../src/lib/fence/market";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const keys = Object.keys(STORE_PRICES);
const def = (k: string) => DECK_RATES.find((r) => r.key === k);
check("the survey names its store and date", STORE_SURVEY.store === "Home Depot" && /^\d{4}-\d{2}-\d{2}$/.test(STORE_SURVEY.asOf));
check("most material rows carry a Home Depot price (what it sells, surveyed in two rounds)", keys.length >= 130, `${keys.length} of ${DECK_RATES.filter((r) => r.basis !== "labor").length}`);
const unknown = keys.filter((k) => !def(k));
check("every surveyed key is a row of the price book", unknown.length === 0, unknown.join(", "));
const labor = keys.filter((k) => def(k)?.basis === "labor");
check("no labor row carries a store price", labor.length === 0, labor.join(", "));
const rails = keys.filter((k) => { const d = def(k); const p = STORE_PRICES[k].price; return !d || !(p > 0) || p < d.min || p > d.max; });
check("every store price is positive and inside its row's rails", rails.length === 0, rails.map((k) => `${k} $${STORE_PRICES[k].price}`).join(", "));
const noSource = keys.filter((k) => !/^https:\/\/(www\.)?homedepot\.com\//.test(STORE_PRICES[k].url) || STORE_PRICES[k].product.trim().length < 6);
check("every store price names its listing and links homedepot.com", noSource.length === 0, noSource.join(", "));
// Checked by hand on 2026-10-12: the plies of a curved rim are a $44 sheet of ground-contact plywood ÷ 40 ft; an ABU66Z
// post base showed $62.98 on three listings (steel); a 10-square underlayment roll is $119; Simpson's LSC stringer
// connector is $2.45–$2.98; Screen Tight's strips and screen, bordered vinyl lattice, vinyl privacy panels and
// beadboard panels are what Home Depot sells for those walls and ceilings; its only glass railing is PEAK's framed panels.
// The old examples were off.
const REVIEWED = new Set(["rim.curved", "hw.postBase", "roof.underlayment", "hw.stringerConnector", "trim.screen", "trim.lattice", "trim.privacy", "trim.ceiling.bead", "rail.glass.material"]);
const slips = keys.filter((k) => { const d = def(k)!; const r = STORE_PRICES[k].price / d.price; return !REVIEWED.has(k) && (r > 3 || r < 1 / 3); });
check("no store price is 3× off its old example (a unit slip), but the three checked by hand", slips.length === 0, slips.map((k) => `${k}: $${STORE_PRICES[k].price} vs example $${def(k)!.price}`).join(" | "));

// Resolution
const k0 = keys[0];
if (k0) {
  check("a surveyed row resolves to the store's price", deckRate(k0).source === "store" && deckRate(k0).price === STORE_PRICES[k0].price, `${k0}: ${JSON.stringify(deckRate(k0))}`);
  check("…and the shop's own number wins", deckRate(k0, { [k0]: def(k0)!.min + 0.01 }).source === "book");
  const nyc = resolveMarket({ state: "NY", zip: "10001" });
  const scaled = deckRate(k0, undefined, nyc);
  check("…scaled to the job's market like an example", scaled.source === "store" && scaled.price > 0, `${k0} in NYC: $${scaled.price}`);
}
const unsurveyed = DECK_RATES.find((r) => r.basis !== "labor" && !STORE_PRICES[r.key]);
if (unsurveyed) check("a row Home Depot does not sell stays an example", deckRate(unsurveyed.key).source === "example", unsurveyed.key);
check("labor stays an example", deckRate("labor.framing").source !== "store");
const rows = deckRateRows();
const r0 = rows.find((r) => r.key === k0);
check("the price book's rows show the store price as the default, the example kept", !k0 || (!!r0 && r0.store && r0.price === STORE_PRICES[k0].price && r0.example === def(k0)!.price));

// A real deck
const d = applyDeckPatch(defaultDeckDesign({ state: "TX" }), { heightIn: 48, rail: { type: "composite" }, stairs: [defaultStair("s1", "front", 8)] });
const pkg = priceDeck(d);
check("a railed deck with stairs: its framing lumber at Home Depot prices, and nearly all of its materials", pkg.bom.filter((l) => l.step === "framing" && l.kind === "lumber").every((l) => l.source === "store") && pkg.storeShare >= 0.85, `${Math.round(pkg.storeShare * 100)}% of materials`);
const compositeDeck = priceDeck(applyDeckPatch(d, { decking: { product: "composite-better" } }));
check("a composite deck: its boards, railing, concrete and fasteners at Home Depot prices", ["decking", "rails", "footings"].every((st) => compositeDeck.bom.filter((l) => l.step === st && !l.byClient).every((l) => l.source === "store")), compositeDeck.bom.filter((l) => ["decking", "rails", "footings"].includes(l.step) && l.source !== "store").map((l) => `${l.step}:${l.rateKey}`).join(", "));
check("…the example share now counts labor and the unsurveyed only", pkg.exampleShare < 1 && pkg.exampleShare >= 0, `${Math.round(pkg.exampleShare * 100)}% of the price on examples`);
const list = materialList(pkg);
check("…the material list marks the store's lines apart from the examples", list.groups.flatMap((g) => g.lines).some((l) => l.store && !l.example));
const covered = priceDeck(applyDeckPatch(defaultDeckDesign({ state: "TX" }), { structure: "covered-deck", roof: { ...defaultRoofDesign("covered-deck"), kind: "gable" } }));
check("a covered deck prices its roofing at Home Depot prices too", covered.bom.some((l) => l.step === "roofing" && l.source === "store"));

console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);

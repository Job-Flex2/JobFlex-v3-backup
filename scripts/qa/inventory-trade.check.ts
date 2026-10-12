// Which board a proposal belongs to, and which shelf an item sits on (2026-09-20).
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/inventory-trade.check.ts
import { proposalTrade } from "../../src/lib/inventoryTrade";
import { groupByCategory, itemCategory } from "../../src/lib/inventoryCategories";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const L = (name: string, quantity = 1) => ({ name, quantity });

check("a stamped trade is taken as it is", proposalTrade({ trade: "hvac", title: "Roof repair", lines: [L("Architectural shingle · 30-yr", 20)] }) === "hvac");
check("an HVAC estimate converted into the proposal makes it HVAC", proposalTrade({ trade: null, title: "Estimate", lines: [], hvacEstimate: true }) === "hvac");
check("a roof measurement's site photo makes it roofing", proposalTrade({ trade: null, title: "Estimate", lines: [], roofMeasurement: true }) === "roof");
check("roof lines whose names drifted from the estimator's still read as roofing",
  proposalTrade({ trade: null, title: "Estimate #4412", lines: [L("Architectural shingles (30-yr)", 24), L("Synthetic underlayment", 24), L("Ice & water shield", 400), L("Ridge vent system", 60), L("Drip edge + flashing", 1)] }) === "roof");
check("a fence package line is a fence", proposalTrade({ trade: null, title: "Backyard", lines: [L("Cedar privacy — 6' fence package", 104), L("Single gate", 1)] }) === "fence");
check("HVAC equipment lines are HVAC", proposalTrade({ trade: null, title: "Replacement", lines: [L("Starter G96V-040 — 40k BTU furnace · 97% AFUE", 1), L("Line set, insulated copper", 30), L("Permit", 1)] }) === "hvac");
check("with no lines, the title decides: a roof replacement is roofing", proposalTrade({ trade: null, title: "Roof replacement — 32 sq architectural", lines: [] }) === "roof");
// Decks became a trade of their own with the deck inventory (2026-10-10, M3): such a proposal is a deck now.
check("a deck with a gate on it is not a fence — it is a deck", proposalTrade({ trade: null, title: "Deck rebuild", description: "Composite deck with a gate at the stairs", lines: [L("Composite deck boards", 400), L("Joist hangers", 40), L("Gate hinge + latch sets", 1), L("Stair stringers", 6)] }) === "deck");
check("a kitchen is nobody's", proposalTrade({ trade: null, title: "Kitchen backsplash", lines: [L("Ceramic tile", 40), L("Thinset", 2)] }) === null);
check("one drifted roof line on a two-line repair is enough", proposalTrade({ trade: null, title: "Repair", lines: [L("Shingles, bundle", 6), L("Sealant", 1)] }) === "roof");
check("a fence proposal with one lumber line among many is still a fence by its words",
  proposalTrade({ trade: null, title: "Side yard", lines: [L("1×6 western red cedar pickets · 6'", 210), L("Line posts · 4×4 pressure-treated pine post · 8'", 14), L("2×4 cedar rails", 42), L("Concrete · 60 lb bags", 28)] }) === "fence");

check("roof items land on the shelf a roofer would look on",
  itemCategory("roof", "Architectural shingle · 30-yr") === "Shingles & coverings" && itemCategory("roof", "Synthetic underlayment") === "Underlayment" && itemCategory("roof", "Eave starter course · slate") === "Flashing, edge & trim" && itemCategory("roof", "Ridge vent") === "Ventilation" && itemCategory("roof", "Roofing nails & fasteners") === "Fasteners, adhesives & sealants" && itemCategory("roof", "TPO 60 mil · mech attached") === "Low-slope roofing" && itemCategory("roof", "Silicone coating · 20-yr") === "Coatings & restoration" && itemCategory("roof", "Metal panel · exposed fastener") === "Shingles & coverings");
check("fence items: posts, rails, pickets, gates, concrete, fasteners",
  itemCategory("fence", "Gate posts · heavy-set · 8'") === "Posts & caps" && itemCategory("fence", "split cedar rails, tapered into the post mortises") === "Rails & framing" && itemCategory("fence", "1×6 ranch boards, face-nailed to the posts") === "Pickets, panels & fabric" && itemCategory("fence", "Walk gate kit") === "Gates & hardware" && itemCategory("fence", "Gravel backfill · 50 lb bags") === "Concrete & backfill" && itemCategory("fence", "Aluminum ties · 100 ct bags") === "Fasteners & ties");
check("HVAC items: equipment, line sets, electrical, controls, venting, drains",
  itemCategory("hvac", "Starter CCHP18-036 — 3-ton heat pump · 18 SEER2 · R-454B") === "Equipment" && itemCategory("hvac", "A2L refrigerant-detection sensor + mitigation board for the existing furnace") === "Refrigerant & line sets" && itemCategory("hvac", "2-pole breaker for the new circuit") === "Electrical" && itemCategory("hvac", "Dual-fuel thermostat") === "Controls & safety" && itemCategory("hvac", "Gas flex connector, shutoff and drip leg") === "Venting & gas" && itemCategory("hvac", "Condensate neutralizer and drain for the condensing furnace") === "Drains, pads & plumbing");
const grouped = groupByCategory("roof", ["Ridge vent", "Cedar shake", "Roofing nails & fasteners", "Mystery widget", "Clay tile"], (n) => n);
check("grouping walks the shelves in order and puts the unknown last", grouped.map((g) => `${g.label}:${g.items.length}`).join("|") === "Shingles & coverings:2|Ventilation:1|Fasteners, adhesives & sealants:1|Other:1", grouped.map((g) => g.label).join("|"));

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);

// Synthetic check of the Smart Proposal's trade detector — no network, no model.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/specialty-detect.check.ts
// 2026-10-09: briefs were filed under the wrong trade, and the trade decides
// the procedure, the price book, the range, the intake questions and the
// permit. A re-roof with "architectural shingles" went to architect (the
// word-substring bias), "asphalt shingles" to asphalt paving, a deck "on
// existing framing" to framing, new circuits "in the garage" to garage
// building; "shingles", "furnace" and "mini-split" voted for roofing and HVAC
// and the vote was dropped whenever the trade's own description shared no
// word with the brief; AC, lights, switches and sod named no trade at all.
import { detectSpecialty } from "../../../src/lib/estimate/legacy/specialtyDetector";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const CASES: Array<[string, string]> = [
  // roofing
  ["Replace 2400 sqft architectural shingle roof, tear off one layer, new synthetic underlayment.", "roofing"],
  ["Tear off one layer and re-roof 2,400 sq ft (24 squares) with 30-year architectural shingles, synthetic underlayment and 3 new pipe boots.", "roofing"],
  ["Re-roof 24 squares with asphalt shingles", "roofing"],
  ["Reroof the house, 30 squares, laminated shingles, ice and water at the eaves", "roofing"],
  ["My roof is 15 years old and leaking around the chimney after storms, need it replaced", "roofing"],
  // paving / concrete
  ["Pave the driveway with asphalt, 1,200 sq ft", "asphalt-paving"],
  // decks / fences
  ["Rebuild 320 sqft composite deck on existing framing", "decking"],
  ["Build a new 16x20 composite deck attached to the house, 6 ft off the ground", "decking"],
  ["Stain and seal the deck", "decking"],
  ["Replace the deck railing with aluminum balusters", "decking"],
  ["Install 180 linear ft cedar privacy fence, 7ft tall, one gate, sloped yard.", "fencing"],
  ["Build a 6 ft cedar privacy fence around the backyard, about 180 feet with one gate", "fencing"],
  // framing / structure
  ["Frame a 12x14 interior wall partition with a door opening", "framing-contractor"],
  // electrical
  ["Add two new circuits in the garage", "electrical"],
  ["Add outlets in the garage and replace the old breaker panel", "electrical"],
  ["Upgrade the electrical panel to 200 amp service", "electrical"],
  ["Install 20 recessed lights in the living room", "electrical"],
  ["Replace 6 light fixtures and 10 switches, same locations", "electrical"],
  ["Install an EV charger in the garage", "ev-charger"],
  ["Rewire the house, knob and tube to modern wiring", "electrical"],
  // hvac
  ["Furnace tune-up and filter change", "hvac"],
  ["Install a new mini-split in the bedroom", "hvac"],
  ["AC not cooling, diagnose and repair, likely capacitor", "hvac"],
  ["Central AC stopped cooling, probably needs a new condenser unit", "hvac"],
  ["Replace the furnace and AC with a heat pump system", "hvac"],
  // plumbing
  ["Replace the water heater, 50 gallon gas", "water-heater-replacement"],
  ["Unclog the main drain and snake the kitchen sink", "drain-cleaning"],
  ["Install 300 lineal feet of 8 inch sewer pipe and patch the asphalt road", "sanitary-sewer"],
  // kitchen / bath / interior
  ["Full kitchen remodel: move the sink to the island, new circuits, new cabinets", "kitchen-remodel"],
  ["Remodel the hall bathroom: new tub surround tile, vanity, toilet, floor tile", "bathroom-remodel"],
  ["Gut the master bathroom down to the studs and rebuild", "bathroom-remodel"],
  ["Convert the tub to a walk-in shower", "bathroom-remodel"],
  ["Finish the basement: framing, drywall, a bathroom and electrical", "interior-remodel"],
  ["Replace the tile floor in the kitchen, 200 sq ft", "tile-stone"],
  ["Install 900 sq ft LVP flooring in the living room and halls", "flooring-installation"],
  ["Replace the carpet in three bedrooms with luxury vinyl plank flooring", "flooring-installation"],
  ["Install drywall in the garage, tape and texture", "drywall"],
  ["Paint the interior of a 3 bedroom house, walls and ceilings", "painting"],
  ["Paint the whole interior, walls and ceilings, about 1800 sq ft", "painting"],
  ["install 400 sq ft full flake epoxy with polyaspartic top coat make 10$ per sq", "epoxy-flooring"],
  // windows / doors / exterior
  ["I need to replace entry door with a new 36 inch pre-hung fiberglass door, new hardware and trim.", "window-door"],
  ["Replace 8 vinyl windows, same size, retrofit install.", "window-replacement"],
  ["Replace the garage door and opener", "garage-door"],
  ["Replace all siding with fiber cement, 2,200 sq ft", "siding-installation"],
  ["Replace gutters and downspouts on a two-story colonial, add leaf guards.", "gutter-installation"],
  // site
  ["Plant 12 shrubs and lay 1,000 sq ft of sod", "landscaping"],
  ["Install a drip irrigation system for the garden beds, 4 zones", "irrigation-contractor"],
  // words that mean other things in other trades
  ["Replace 4 vinyl fence panels", "fencing"],
  ["Replace the water heater; the furnace shares the flue", "water-heater-replacement"],
  ["Commercial TPO reroof, 20,000 sq ft", "commercial-roofing"],
  ["Replace the electrical panel", "electrical"],
  ["Install wainscoting panels in the dining room", "wainscoting"],
  ["Replace the inverter on the solar panels", "solar"],
  ["Garage door panel replacement, one dented section", "garage-door"],
  ["Replace the heat pump water heater", "water-heater-replacement"],
  ["Paint the living room 450 square feet of wall, two coats, $2.50 a sq ft", "painting"],
  ["Gas furnace in the garage closet, natural gas meter on the west wall.", "hvac"],
  // other
  ["Install solar panels, 8 kW", "solar"],
  ["Install a new above-ground pool with a deck around it", "pool-spa"],
];

for (const [brief, want] of CASES) {
  const got = detectSpecialty(brief)?.specialty.id ?? "none";
  ok(`${want.padEnd(26)} ${brief.slice(0, 70)}`, got === want, got === want ? "" : `got ${got}`);
}

// A word inside another word is not the trade: "architect" in "architectural".
ok("No whole-word match, no base-trade bonus", detectSpecialty("architectural shingles on the garage")?.specialty.id !== "architect");

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

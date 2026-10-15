// Synthetic check of the permit decision — no network, no model.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/permits.check.ts
// The owner (2026-10-09): a door swap came back with "Permit and inspection".
// Not every job takes a permit — electrical, plumbing, gas, HVAC equipment,
// structure, additions and full remodels do; a door or window in its opening,
// tile, paint, flooring, a fixture swap and a repair do not; a roof or a
// re-side is the city's call. This holds the call on 55 briefs, on the prompt
// (decision block last, permit step gone from the procedure), on the
// validator (no permit demanded unless required, one inserted when it is) and
// on the final estimate (a stray permit line dropped, the reason said once).
import { buildLegacyEstimatePrompt, specialtyFor } from "../../../src/lib/estimate/legacy-estimate";
import { briefScope } from "../../../src/lib/estimate/remodel-method";
import { holdPermitDecision, isPermitLine, permitCall, permitNote, permitPromptBlock, permitSummary, type PermitNeed } from "../../../src/lib/estimate/permits";
import { applyRepairs, validateEstimate, type CheckedItem } from "../../../src/lib/estimate/validate-estimate";
import { detectTrade } from "../../../src/lib/estimate/trade-knowledge";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

/** The call the prompt builder makes for a brief. */
const callFor = (d: string) => {
  const text = ` ${d}`;
  const id = specialtyFor({ description: d, projectType: "" }).specialty.id;
  return { id, call: permitCall({ text, specialtyId: id, scope: briefScope(text, id) }) };
};

// ── The decision, brief by brief ─────────────────────────────────────────────
{
  const cases: Array<[string, PermitNeed | null]> = [
    // the owner's own examples
    ["I need to replace entry door with a new 36 inch pre-hung fiberglass door, new hardware and trim.", "not-needed"],
    ["Replace 8 vinyl windows, same size, retrofit install.", "not-needed"],
    ["Replace the tile floor in the kitchen, 200 sq ft", "not-needed"],
    ["Paint the interior of a 3 bedroom house, walls and ceilings", "not-needed"],
    ["Full kitchen remodel: move the sink to the island, new circuits, new cabinets", "required"],
    ["Build a 400 sq ft addition off the back of the house", "required"],
    // openings
    ["Enlarge the bedroom window to an egress window", "required"],
    ["Cut in a new patio door opening in the back wall", "required"],
    ["Replace the garage door and opener", "not-needed"],
    // finish work
    ["Paint the exposed ceiling beams and trim", "not-needed"],
    ["Retile the shower walls, 90 sq ft, keep the valve", "not-needed"],
    ["Install 900 sq ft LVP flooring in the living room and halls", "not-needed"],
    ["Replace kitchen cabinets and quartz countertops, same layout", "not-needed"],
    ["Install drywall in the garage, tape and texture", "not-needed"],
    ["Patch drywall holes and paint, in addition touch up the trim", "not-needed"],
    ["Insulate the attic, blown-in R-49", "not-needed"],
    ["Pressure wash the house and driveway", "not-needed"],
    ["Plant 12 shrubs and lay 1,000 sq ft of sod", "not-needed"],
    // remodels
    ["Remodel the hall bathroom: new tub surround tile, vanity, toilet, floor tile", "required"],
    ["Replace the bathroom vanity and faucet", "not-needed"],
    ["Gut the master bathroom down to the studs and rebuild", "required"],
    ["Convert the tub to a walk-in shower", "required"],
    ["Remove the wall between the kitchen and living room", "required"],
    ["Finish the basement: framing, drywall, a bathroom and electrical", "required"],
    ["Add a half bath under the stairs", "required"],
    // plumbing and gas
    ["Replace the water heater, 50 gallon gas", "required"],
    ["Replace a leaking kitchen faucet", "not-needed"],
    ["Replace a toilet and the wax ring", "not-needed"],
    ["Unclog the main drain and snake the kitchen sink", "not-needed"],
    // electrical
    ["Add two new circuits in the garage", "required"],
    ["Install an EV charger in the garage", "required"],
    ["Upgrade the electrical panel to 200 amp service", "required"],
    ["Install 20 recessed lights in the living room", "required"],
    ["Replace 6 light fixtures and 10 switches, same locations", "depends"],
    ["Install solar panels, 8 kW", "required"],
    // HVAC
    ["Replace the furnace and AC with a heat pump system", "required"],
    ["Install a new mini-split in the bedroom", "required"],
    ["Furnace tune-up and filter change", "not-needed"],
    ["AC not cooling, diagnose and repair, likely capacitor", "not-needed"],
    // fences, walls, decks, flatwork (IRC R105.2: 7 ft, 4 ft)
    ["Install 180 linear ft cedar privacy fence, 7ft tall, one gate, sloped yard.", "not-needed"],
    ["Build an 8 ft tall privacy fence along the back, 120 ft", "required"],
    ["Repair 3 fence panels and a gate", "not-needed"],
    ["Build a 3 ft stone retaining wall in the front yard", "not-needed"],
    ["Build a 6 ft concrete block retaining wall", "required"],
    ["Rebuild 320 sqft composite deck on existing framing", "not-needed"],
    ["Build a new 16x20 composite deck attached to the house, 6 ft off the ground", "required"],
    ["Stain and seal the deck", "not-needed"],
    ["Pour a new 600 sq ft concrete patio", "not-needed"],
    // roofs and siding: the city's call; a repair is not a replacement
    ["Replace 2400 sqft architectural shingle roof, tear off one layer", "depends"],
    ["Tear off one layer and re-roof 2,400 sq ft (24 squares) with 30-year architectural shingles.", "depends"],
    ["Re-roof 24 squares with asphalt shingles", "depends"],
    ["Repair a roof leak around the chimney flashing", "not-needed"],
    ["Replace gutters and downspouts on a two-story colonial, add leaf guards.", "not-needed"],
    ["Replace all siding with fiber cement, 2,200 sq ft", "depends"],
    // a design service carries the permit as its own step
    ["Design and permit drawings for a 2-story addition", "required"],
  ];
  for (const [d, want] of cases) {
    const { id, call } = callFor(d);
    const got = call ? call.need : null;
    ok(`${String(want).padEnd(10)} ${d.slice(0, 70)}`, got === want, got === want ? "" : `got ${got} (${id}: ${call?.reason})`);
  }
  ok("A pure design service with no work in its brief is left to its own procedure", permitCall({ text: "Feasibility study for a lot split", specialtyId: "feasibility-study", scope: "full" }) === null);
}

// ── The prompt ───────────────────────────────────────────────────────────────
{
  const door = buildLegacyEstimatePrompt({ description: "I need to replace entry door with a new 36 inch pre-hung fiberglass door", location: "Lynnwood, WA", projectType: "", qualityTier: "standard" }, { withTradeRules: true });
  ok("Door: the call rides on the build", door.permit?.need === "not-needed", JSON.stringify(door.permit));
  ok("Door: the procedure no longer offers the permit step", !/Permit and inspection at the jurisdiction's fee/.test(door.prompt));
  const at = door.prompt.lastIndexOf("PERMIT DECISION FOR THIS JOB");
  ok("Door: the decision says no permit line, and comes after every procedure word on permits", at > 0 && /does NOT need a permit/.test(door.prompt.slice(at)) && at > door.prompt.lastIndexOf("PROCEDURE —"));
  ok("The master prompt no longer says every remodel carries a permit", !/Every remodel carries: permit/.test(door.prompt) && /A job that needs a permit/.test(door.prompt));

  const heater = buildLegacyEstimatePrompt({ description: "Replace the water heater, 50 gallon gas", location: "Seattle, WA", projectType: "", qualityTier: "standard" }, { withTradeRules: true });
  ok("Water heater: the decision asks for ONE permit line at the city's fee", heater.permit?.need === "required" && /Write ONE permit line[\s\S]*Seattle's building department/.test(heater.prompt));

  const roof = buildLegacyEstimatePrompt({ description: "Replace 2400 sqft architectural shingle roof, tear off one layer", location: "Bothell, WA", projectType: "", qualityTier: "standard" }, { withTradeRules: true });
  ok("Roof: the city decides, and the prompt says so by name", roof.permit?.need === "depends" && /up to Bothell's building department/.test(roof.prompt));

  const bath = buildLegacyEstimatePrompt({ description: "Remodel the hall bathroom: new tub surround tile, vanity, toilet, floor tile", location: "Kirkland, WA", projectType: "", qualityTier: "standard" }, { withTradeRules: true });
  ok("A full bath remodel keeps every core step, the permit among them", bath.permit?.need === "required" && bath.procedureCoreSteps > 0);
  ok("No block for a service the procedure decides", permitPromptBlock(null, "Seattle, WA") === null);
}

// ── The validator ────────────────────────────────────────────────────────────
const line = (name: string, material: number, labor: number, unit = "unit", quantity = 1): CheckedItem => ({ name, unit, quantity, materialUnitPrice: material, laborUnitPrice: labor, searchQuery: null });
{
  const bathTrade = detectTrade("remodel the bathroom");
  const items = [line("Demolish the tub surround and haul away", 0, 900, "fixed"), line("Tile the tub surround, 3x12 ceramic", 6, 14, "sqft", 90)];
  const askFor = (permit: PermitNeed | null | undefined) =>
    validateEstimate({ items, description: "Retile the tub surround", location: "Kirkland, WA", assumptions: [], trade: bathTrade, permit }).violations.some((v) => v.code === "missing-required" && /permit/.test(v.message));
  ok("Bathroom trade, no decision: the old rule still asks for a permit", askFor(undefined) === true);
  ok("Bathroom trade, not needed: no permit asked for (no re-ask, no inserted line)", askFor("not-needed") === false);
  ok("Bathroom trade, the city decides: no permit asked for", askFor("depends") === false);

  const windowTrade = detectTrade("replace the windows");
  const report = validateEstimate({ items: [line("Set the new window", 600, 300)], description: "Replace a window and add a new circuit", location: "Seattle, WA", assumptions: [], trade: windowTrade, permit: "required" });
  ok("Window trade, required: the permit is asked for though the trade has no permit phase", report.blocking.some((v) => /permit/.test(v.message)));
  const repaired = applyRepairs({ items: [line("Set the new window", 600, 300)], description: "Replace a window and add a new circuit", location: "Seattle, WA", assumptions: [], trade: windowTrade, permit: "required" }, report);
  const added = repaired.items.find((it) => isPermitLine(it.name));
  ok("…and inserted at the minor-permit band when the trade has no permit anchor", !!added && added.flag === "auto" && added.materialUnitPrice >= 300 && added.laborUnitPrice === 0, JSON.stringify(added));
}

// ── The final estimate ───────────────────────────────────────────────────────
{
  const items = [
    { name: "Field measure existing exterior door opening", laborUnitPrice: 168 },
    { name: "Permit and inspection for exterior door replacement per Seattle jurisdiction", laborUnitPrice: 0 },
    { name: "Final cleanup and site tidy on completion", laborUnitPrice: 281 },
    { name: "Remove the old door; obtain owner sign-off on the permit-free swap", laborUnitPrice: 104 },
  ];
  const scope = "Replace the entry door with a pre-hung fiberglass unit. Pull the permit and schedule the final inspection.\n- Remove the old door\n- Obtain permits and inspections\n- Set the new door";
  const call = callFor("I need to replace entry door with a new 36 inch pre-hung fiberglass door").call;
  const held = holdPermitDecision({ items, assumptions: ["Permits and inspections are included.", "Existing framing is sound."], scope }, call, "Lynnwood, WA");
  ok("The door's permit line is dropped", held.dropped.length === 1 && /Permit and inspection/.test(held.dropped[0]), held.dropped.join(" | "));
  ok("Final cleanup is not a permit line", held.items.some((it) => /Final cleanup/.test(it.name)));
  ok("A line of real work that names a permit keeps its work", held.items.some((it) => /Remove the old door/.test(it.name)));
  ok("The promise of a permit leaves the assumptions, the reason joins them once", !held.assumptions.includes("Permits and inspections are included.") && held.assumptions.filter((a) => /^No permit included/.test(a)).length === 1, held.assumptions.join(" | "));
  ok("The scope loses its permit sentence and bullet, keeps the work", !/permit/i.test(held.scope) && /Set the new door/.test(held.scope) && /pre-hung fiberglass/.test(held.scope), JSON.stringify(held.scope));
  ok("The city's call names the city", /Lynnwood's building department/.test(permitNote({ need: "depends", reason: "a roof replacement" }, "Lynnwood, WA") ?? ""));
  const required = holdPermitDecision({ items, assumptions: [], scope }, { need: "required", reason: "a full remodel" }, "Seattle, WA");
  ok("The note under the ledger says it either way", permitSummary({ need: "required", reason: "a water heater replacement" }) === "Permit included: a water heater replacement needs one." && /^No permit included/.test(permitSummary(call, "Lynnwood, WA") ?? "") && permitSummary(null) === null);
  ok("A required permit is left alone", required.items.length === items.length && required.scope === scope && required.dropped.length === 0);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

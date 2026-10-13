// Any job off the plans, priced by the specialty that does it — no network, no model.
//   npx tsx --tsconfig tsconfig.json scripts/qa/plans-specialties.check.ts
// The real permit set (plans-eagle.fixture), asked for sixty-odd jobs a contractor might
// want from a house's plans — the house's own trades and the work around it (a fence, a
// deck, pavers, solar, a pool, fire sprinklers). Each is planned the way the server plans
// it when the model gives nothing back (the keyword reading, else the specialty the
// words name), and every group of its lines must be priced by a specialty that builds
// it, with a procedure, as new construction.
import { buildLegacyEstimatePrompt, effectiveProcedure } from "../../src/lib/estimate/legacy-estimate";
import { cleanScope, scopeByRules, sheetLite, applyFocus, jobItems, type JobScope } from "../../src/lib/plans/ask";
import { cleanSheetRead } from "../../src/lib/plans/sheet";
import { BUILD_SPECIALTIES, bucketOf, isBuildSpecialty, scopeBySpecialty, settleSpecialties, specialtyForWords, unitOfSpecialty } from "../../src/lib/plans/specialties";
import { computeTakeoff, PLAN_TRADES, type PlanTrade } from "../../src/lib/plans/takeoff";
import { houseBriefOf, tradeBrief } from "../../src/lib/plans/tradeBrief";
import { newBuildProcedure, planTradeRun, TRADE_SETUP } from "../../src/lib/plans/tradeSetup";
import { tradePriceInput } from "../../src/lib/plans/wire";
import { EAGLE_READS } from "./plans-eagle.fixture";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const sheets = EAGLE_READS.map(([p, r]) => cleanSheetRead(p, r));
const lite = sheets.map(sheetLite);
const t = computeTakeoff(sheets);
const items = t.items;
const house = houseBriefOf(t.house);
const tradeOf = new Map(items.map((i) => [i.id, i.trade]));

/** The server's plan with no model answer (actions/planEstimator askPlan). */
function plan(request: string): JobScope | null {
  const s = scopeByRules(request, items, lite) ?? scopeBySpecialty(request, lite);
  if (!s || s.wholeHouse) return s;
  return settleSpecialties(s, request, new Set(s.itemIds.map((id) => tradeOf.get(id)).filter((x): x is PlanTrade => !!x)));
}
/** The specialty each group of a job's lines is priced by. */
function pricedBy(s: JobScope): Array<[PlanTrade, string]> {
  const groups = new Set<PlanTrade>([...s.itemIds.map((id) => tradeOf.get(id)!), ...s.measure.map((m) => m.trade)]);
  return PLAN_TRADES.filter((x) => groups.has(x)).map((x) => [x, s.specialties[x] ?? TRADE_SETUP[x].specialtyId]);
}

ok(`the estimator's building specialties: ${BUILD_SPECIALTIES.length}, every one with a procedure`, BUILD_SPECIALTIES.length >= 90 && BUILD_SPECIALTIES.every((x) => !!effectiveProcedure(x.id, null)));
ok("engineers, surveyors, studies and repair shops do not price a build", !["structural-engineer", "land-surveyor", "feasibility-study", "residential-roof-repair", "kitchen-remodel", "demolition"].some((id) => isBuildSpecialty(id)));

// ── 1. sixty-odd jobs: each one planned and priced by a specialty that builds it
const EXPECT: Array<[string, string | null]> = [
  ["granite countertops", "countertop-installer"],
  ["quartz countertops and backsplash", "countertop-installer"],
  ["kitchen cabinets and bathroom vanities", null],
  ["drywall with texture and paint", "drywall"],
  ["just the drywall", "drywall"],
  ["interior paint", "painting"],
  ["exterior paint only", "painting"],
  ["hardwood flooring", "flooring-installation"],
  ["carpet in the bedrooms", "flooring-installation"],
  ["LVP flooring throughout", "flooring-installation"],
  ["tile showers and bathroom floors", "tile-stone"],
  ["roofing", "roofing"],
  ["metal roof", "roofing"],
  ["gutters and downspouts", "gutter-installation"],
  ["Hardie siding", "siding-installation"],
  ["stucco", "stucco-eifs"],
  ["brick veneer on the front", "masonry"],
  ["windows", "window-door"],
  ["exterior doors", "window-door"],
  ["garage doors and openers", "window-door"],
  ["interior doors and trim", "finish-carpentry"],
  ["insulation", "insulation-weatherization"],
  ["framing package", "framing-contractor"],
  ["foundation and concrete", "concrete-contractor"],
  ["concrete driveway and walks", "concrete-contractor"],
  ["excavation and grading", "excavation-grading"],
  ["plumbing rough-in and finish", "plumbing"],
  ["electrical", "residential-electrical"],
  ["HVAC", "residential-hvac"],
  ["fireplace", null],
  ["cedar fence along the property line", "fencing"],
  ["composite deck off the back", "decking"],
  ["paver patio", "hardscape"],
  ["retaining wall", "foundation-retaining"],
  ["septic system", "septic-installer"],
  ["low voltage, security cameras and alarm", "security-lowvoltage"],
  ["EV charger in the garage", "ev-charger"],
  ["solar panels on the roof", "solar"],
  ["mini split heat pumps", null],
  ["covered porch and a pergola", "patio-cover"],
  ["closet systems", "built-in-cabinetry"],
  ["stair railings", "finish-carpentry"],
  ["roof trusses", "framing-contractor"],
  ["standby generator", null],
  ["irrigation system", null],
  ["gas line to the range and fireplace", "plumbing"],
  ["radiant floor heating", "radiant-floor-heating"],
  ["fire sprinklers", "fire-protection"],
  ["landscaping and irrigation", "landscaping"],
  ["swimming pool", "pool-spa"],
  ["outdoor kitchen", "outdoor-kitchen"],
  ["shower glass doors", "shower-mirror"],
  ["garage epoxy floor", "epoxy-flooring"],
  ["elevator", "elevator-lift"],
  ["attic ventilation", "attic-ventilation"],
  ["waterproofing the basement", "waterproofing"],
  ["asphalt driveway", "asphalt-paving"],
  ["the whole house", null],
];
const rows: string[] = [];
let planned = 0;
for (const [ask, want] of EXPECT) {
  const s = plan(ask);
  if (!s) {
    ok(`«${ask}» is planned`, false, "no plan");
    continue;
  }
  planned++;
  const groups = s.wholeHouse ? [] : pricedBy(s);
  const allBuild = groups.every(([, id]) => isBuildSpecialty(id) || id === TRADE_SETUP.general.specialtyId);
  ok(`«${ask}» → ${s.title}: priced by ${groups.map(([g, id]) => `${id}${g !== bucketOf(id) ? ` (${g})` : ""}`).join(", ") || "every trade's own"}`, allBuild && (s.wholeHouse || groups.length > 0) && (!want || groups.some(([, id]) => id === want)), want ? `wanted ${want}` : "");
  rows.push(`${ask} → ${groups.map(([, id]) => id).join(", ")}`);
}
ok(`every job planned without the model: ${planned} of ${EXPECT.length}`, planned === EXPECT.length);

// ── 2. a job the build list has no line for: measured on the sheets, priced by its specialty
const fence = plan("cedar fence along the property line")!;
const site = sheets.find((x) => x.kind === "site")!.page;
ok("a fence is measured in linear ft on the site plan", fence.measure.length === 1 && fence.measure[0].unit === "linear ft" && fence.measure[0].pages.includes(site), JSON.stringify(fence.measure.map((m) => [m.unit, m.pages])));
ok("…filed under the site work, headed Fencing, priced by fencing", fence.measure[0].trade === "sitework" && fence.specialties.sitework === "fencing" && /fenc/i.test(fence.labels?.sitework ?? ""), fence.labels?.sitework);
const read = { page: site, answers: [{ n: 1, qty: 412, unit: "linear ft" as const, asWritten: "N 140.0' + E 132.0' + S 140.0' along the lot lines", where: "lot lines", confidence: "high" as const }], extra: [], notes: [] };
const found = applyFocus(fence, [read], items);
const fenceLines = jobItems(fence, items, found.added);
ok("the measured fence is the job's one line", fenceLines.length === 1 && fenceLines[0].qty === 412 && fenceLines[0].source === "plan");
const run = planTradeRun({ trade: "sitework", house, items: fenceLines, alsoPriced: ["sitework"], ask: { request: "cedar fence along the property line", title: fence.title, partial: true, specialtyId: fence.specialties.sitework, label: fence.labels?.sitework } });
ok("priced by fencing, headed Fencing, its own permit left to the city", run.setup.specialtyId === "fencing" && /fenc/i.test(run.label) && run.setup.permit.need === "depends", `${run.setup.specialtyId} · ${run.label} · ${run.setup.permit.need}`);
ok("the estimator is told the fence's quantities under its own heading", /THIS TRADE'S QUANTITIES \(Fenc/i.test(run.block) && run.block.includes("412"));
const own = effectiveProcedure(run.setup.specialtyId, null);
const legacy = buildLegacyEstimatePrompt(
  { description: run.brief, location: "Kirkland, WA", projectType: fence.title, companyName: "QA Builders" },
  { overrides: { specialties: { [run.setup.specialtyId]: { procedure: own ? newBuildProcedure(own) : undefined } } }, specialtyId: run.setup.specialtyId, newBuild: { permit: run.setup.permit, benchmarkQty: run.benchmarkQty } },
);
ok("the fence prompt is the fencing specialty's, as new construction", legacy.specialty.id === "fencing" && /Project type: New construction/.test(legacy.prompt) && legacy.scope === "full");

const deck = plan("composite deck off the back")!;
ok("a deck: decking, filed under framing, measured in sq ft", deck.specialties.framing === "decking" && deck.measure[0]?.unit === unitOfSpecialty("decking"), `${deck.measure[0]?.unit} · ${JSON.stringify(deck.specialties)}`);

// ── 3. the model's plan may name any building specialty — and only those
const fromModel = cleanScope(
  {
    title: "Paver patio",
    measure: [{ label: "Paver patio", unit: "sq ft", replaces: null, trade: "sitework", pages: [site], combine: "sum", how: "the patio's outline" }],
    specialties: { sitework: "hardscape", plumbing: "structural-engineer", roofing: "no-such-thing" },
  },
  items,
  lite,
  isBuildSpecialty,
);
ok("the model names hardscape for pavers: kept; an engineer and a made-up id: dropped", fromModel?.specialties.sitework === "hardscape" && Object.keys(fromModel?.specialties ?? {}).length === 1, JSON.stringify(fromModel?.specialties));
ok("a specialty id the catalog lacks reaches the server as text and is ignored there", tradePriceInput.safeParse({ token: "x", trade: "sitework", house, items: fenceLines, alsoPriced: ["sitework"], ask: { request: "x", title: "x", partial: true, specialtyId: "rocket-science" } }).success && planTradeRun({ trade: "sitework", house, items: fenceLines, alsoPriced: ["sitework"], ask: { request: "x", title: "x", partial: true, specialtyId: "rocket-science" } }).setup.specialtyId === TRADE_SETUP.sitework.specialtyId);
ok("words name a specialty the way Smart Proposal reads a brief (solar, pool, sprinklers)", specialtyForWords("solar panels") === "solar" && specialtyForWords("swimming pool") === "pool-spa" && specialtyForWords("fire sprinklers") === "fire-protection");
ok("the job's own words head the brief, not the house's trade", /Fencing for a new house: cedar fence along the property line/i.test(tradeBrief("sitework", house, fenceLines, ["sitework"], { request: "cedar fence along the property line", title: "Fencing" }).brief));

if (process.env.PRINT) console.log("\n" + rows.join("\n"));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

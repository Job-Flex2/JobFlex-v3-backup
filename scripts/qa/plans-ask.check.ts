// Asking the plans for one job — no network, no model.
//   npx tsx --tsconfig tsconfig.json scripts/qa/plans-ask.check.ts
// The real permit set (plans-eagle.fixture) read and taken off, then asked the way a
// contractor asks: "granite countertops", "drywall with texture or primer and paint",
// "just the drywall". The keyword reading, the model's plan checked against the build
// list, the sheets' measurements folded back in (materials following them), and the
// trade brief the estimator gets for one job.
import { readBrief } from "../../src/lib/estimate/brief";
import { applyFocus, cleanFocus, cleanScope, finishAsked, focusPrompt, jobItems, partialTrades, scopeByRules, scopeExtras, sheetIndex, sheetLite, withFinish, type JobScope, type SheetLite } from "../../src/lib/plans/ask";
import { isBuildSpecialty, scopeBySpecialty } from "../../src/lib/plans/specialties";
import { cleanSheetRead } from "../../src/lib/plans/sheet";
import { computeTakeoff } from "../../src/lib/plans/takeoff";
import { houseBriefOf, tradeBrief, wordsOnly } from "../../src/lib/plans/tradeBrief";
import { planTradeRun } from "../../src/lib/plans/tradeSetup";
import { askPlanInput, tradePriceInput } from "../../src/lib/plans/wire";
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
const ids = (s: JobScope | null) => new Set(s?.itemIds ?? []);
const mainFloor = sheets.find((s) => s.kind === "floor" && s.level === "Main")!.page;

// ── 1. the keyword reading
const counters = scopeByRules("Granite countertop installation", items, lite);
const c = ids(counters);
ok("granite countertops: the tops, island top, vanity tops, template, cutouts", ["cabinets.tops-kitchen", "cabinets.island-top", "cabinets.vanity-tops", "cabinets.template", "cabinets.cutouts"].every((id) => c.has(id)), Array.from(c).join(" "));
ok("…not the cabinets themselves, nor the plumbing", !c.has("cabinets.base-kitchen") && !c.has("cabinets.install") && ![...c].some((id) => id.startsWith("plumbing.")));
ok("…priced by the countertop installer", counters?.specialties.cabinets === "countertop-installer");
ok("…the kitchen counters measured on the main floor plan", counters?.measure.some((m) => m.replaces === "cabinets.tops-kitchen" && m.pages.includes(mainFloor)) === true, JSON.stringify(counters?.measure.map((m) => [m.label, m.pages])));
ok("…the vanity tops measured on every floor that has baths, added up", counters?.measure.some((m) => m.replaces === "cabinets.vanity-tops" && m.combine === "sum" && m.pages.length >= 2) === true);
ok("…sink cutouts replace the build list's cutouts, not a second line", counters?.measure.some((m) => m.replaces === "cabinets.cutouts") === true);
const withCut = scopeByRules("granite countertops with the sink cutouts", items, lite);
ok("\"sink cutouts\" is the countertop's work, not plumbing", ![...ids(withCut)].some((id) => id.startsWith("plumbing.")));

const dw = scopeByRules("I need to estimate drywall with texture or primer and paint", items, lite);
const d = ids(dw);
ok("drywall with texture, primer and paint: board, texture, primer, wall and ceiling paint", ["drywall.walls", "drywall.ceilings", "drywall.regular", "drywall.mud", "drywall.texture", "painting.interior", "painting.primer", "painting.wall-paint", "painting.ceiling-paint"].every((id) => d.has(id)));
ok("…not the exterior paint, the siding or the trim", !d.has("painting.exterior") && ![...d].some((id) => id.startsWith("siding.") || id.startsWith("interior-trim.")));

const only = scopeByRules("just drywall", items, lite);
const o = ids(only);
ok("just drywall: hang, tape and finish with its board, mud, tape and screws", ["drywall.walls", "drywall.ceilings", "drywall.regular", "drywall.typex", "drywall.mud", "drywall.tape", "drywall.screws"].every((id) => o.has(id)));
ok("…no texture and no paint", !o.has("drywall.texture") && ![...o].some((id) => id.startsWith("painting.")), only?.summary);

const prime = scopeByRules("drywall and primer", items, lite)!;
const p = ids(prime);
ok("primer without paint: the primer, not the finish coats", p.has("painting.primer") && !p.has("painting.interior") && !p.has("painting.wall-paint"));
const primeExtra = scopeExtras("drywall and primer", prime, items);
ok("…and a priming line of its own on the walls and ceilings", primeExtra.length === 1 && primeExtra[0].qty === items.find((i) => i.id === "painting.interior")!.qty && primeExtra[0].role === "labor");

const whole = scopeByRules("price the whole house", items, lite);
ok("the whole house: every line, nothing to measure", whole?.wholeHouse === true && whole.itemIds.length === items.length && whole.measure.length === 0);
ok("exterior paint only stays outside", (() => {
  const x = ids(scopeByRules("exterior paint only", items, lite));
  return x.has("painting.exterior") && !x.has("painting.interior");
})());
ok("a walk-in closet is not a concrete walk", ![...ids(scopeByRules("shelving for the walk-in closet", items, lite))].some((id) => id.startsWith("foundation.")));
ok("roofing takes the roof's lines", (() => {
  const x = ids(scopeByRules("new roof", items, lite));
  return x.has("roofing.area") && x.has("roofing.shingles") && ![...x].some((id) => !id.startsWith("roofing."));
})());
ok("a request no trade answers is null (the model reads it; else the contractor is asked)", scopeByRules("build me a spaceship", items, lite) === null);

// ── 2. the model's plan, checked against the build list
const modelPlan = cleanScope(
  {
    title: "Granite countertops",
    summary: "Kitchen, island and vanity tops in 3cm granite.",
    itemIds: ["cabinets.tops-kitchen", "cabinets.template", "no.such-line", "cabinets.cutouts"],
    measure: [
      { label: "Kitchen countertops", unit: "linear ft", replaces: "cabinets.tops-kitchen", trade: "cabinets", role: "material", pages: [mainFloor, 999], combine: "best", how: "runs × 25.5\"" },
      { label: "Bar top", unit: "sq ft", replaces: null, trade: "cabinets", role: "both", pages: [mainFloor], combine: "sum", how: "" },
      { label: "Nowhere", unit: "sq ft", replaces: null, trade: "cabinets", pages: [999] },
    ],
    specialties: { cabinets: "countertop-installer", plumbing: "rocket-science" },
    notIncluded: ["Cabinets"],
  },
  items,
  lite,
  isBuildSpecialty,
);
ok("unknown ids and pages are dropped", !!modelPlan && !modelPlan.itemIds.includes("no.such-line") && modelPlan.measure.length === 2 && modelPlan.measure[0].pages.join() === String(mainFloor));
ok("a measurement that replaces a line is in that line's unit (sq ft, not the model's LF)", modelPlan?.measure[0].unit === "sq ft");
ok("only specialties the estimator builds with pass", modelPlan?.specialties.cabinets === "countertop-installer" && !("plumbing" in (modelPlan?.specialties ?? {})));
ok("junk from the model is null (the keyword reading stands)", cleanScope({ nothing: true }, items, lite) === null && cleanScope("nope", items, lite) === null);

// ── 3. the sheets' measurements back into the build list
const read = cleanFocus(mainFloor, {
  answers: [
    { n: 1, found: true, qty: "62.5", unit: "sf", asWritten: "10'-6\" + 12'-0\" + 6'-9\" runs × 25½\"", where: "kitchen", confidence: "high" },
    { n: 2, found: true, qty: 30, unit: "sq ft", asWritten: "8'-0\" × 3'-9\"", where: "kitchen" },
    { n: 3, found: false },
    { n: 9, found: true, qty: 5, unit: "sq ft" },
  ],
  extra: [{ label: "Bar countertop", qty: 9, unit: "sq ft", asWritten: "4'-6\" × 2'", where: "great room" }],
}, [1, 2, 3, 4]);
ok("a sheet's answers: unasked and not-found ones are dropped, units read", read.answers.length === 2 && read.answers[0].qty === 62.5 && read.answers[0].unit === "sq ft");
const job = counters!;
const n1 = job.measure.findIndex((m) => m.replaces === "cabinets.tops-kitchen") + 1;
const n2 = job.measure.findIndex((m) => m.replaces === "cabinets.island-top") + 1;
const upper = sheets.find((s) => s.kind === "floor" && s.level === "Upper")!.page;
const reads = [
  { page: mainFloor, answers: [{ n: n1, qty: 62.5, unit: "sq ft" as const, asWritten: "10'-6\" + 12'-0\" + 6'-9\" × 25½\"", where: "kitchen", confidence: "high" as const }, { n: n2, qty: 30, unit: "sq ft" as const, asWritten: "8'-0\" × 3'-9\"", where: "kitchen", confidence: "high" as const }], extra: [{ label: "Bar countertop", qty: 9, unit: "sq ft" as const, asWritten: "4'-6\" × 2'", where: "great room" }], notes: [] },
  { page: upper, answers: [{ n: n1, qty: 40, unit: "sq ft" as const, asWritten: "(the upper floor has no kitchen — a misread)", where: "", confidence: "low" as const }], extra: [], notes: [] },
];
const folded = applyFocus(job, reads, items);
ok("best of two sheets for one thing: the confident reading, not the sum", folded.measured["cabinets.tops-kitchen"]?.qty === 62.5, JSON.stringify(folded.measured["cabinets.tops-kitchen"]));
ok("the measured line says where it was read", /p\. \d+ \(kitchen\): 10'-6"/.test(folded.measured["cabinets.tops-kitchen"]?.basis ?? ""));
ok("what a sheet showed beyond the plan is a line of its own", folded.added.some((a) => a.label === "Bar countertop" && a.qty === 9 && a.source === "plan"));
ok("a measure no sheet answered keeps the build list's number, and says so", folded.rows.some((r) => r.status === "kept" && /not drawn/.test(r.asWritten)));
const t2 = computeTakeoff(sheets, {}, {}, folded.measured);
const q2 = (id: string) => t2.items.find((i) => i.id === id);
ok("the measured counters replace the rule of thumb, marked from the plans", q2("cabinets.tops-kitchen")?.qty === 62.5 && q2("cabinets.tops-kitchen")?.source === "plan" && q2("cabinets.tops-kitchen")?.measured === true);
ok("…and the template-and-install line follows them (62.5 + 30 island + vanity tops)", q2("cabinets.template")?.qty === Math.round(62.5 + 30 + (q2("cabinets.vanity-tops")?.qty ?? 0)), String(q2("cabinets.template")?.qty));
const lines = jobItems(job, t2.items, folded.added);
ok("the job's lines: its build-list lines and its own", lines.some((i) => i.id === "cabinets.tops-kitchen") && lines.some((i) => i.label === "Bar countertop") && !lines.some((i) => i.id === "cabinets.base-kitchen"));
ok("countertops are part of the cabinet trade — no whole-trade benchmark", partialTrades(job, items).has("cabinets"));
const granite = withFinish(lines, "granite countertops");
ok("a granite job's tops are granite, not the build list's quartz", granite.filter((i) => /^cabinets\.(tops-|island-top|vanity-tops)/.test(i.id)).every((i) => /granite/i.test(i.label) && !/quartz\b/i.test(i.label)), granite.find((i) => i.id === "cabinets.tops-kitchen")?.label);
ok("quartzite is quartzite; no finish named leaves the label alone", finishAsked("quartzite tops") === "quartzite" && withFinish(lines, "countertops") === lines);
ok("the contractor's own number still wins over a measurement", computeTakeoff(sheets, {}, { "cabinets.tops-kitchen": 70 }, folded.measured).items.find((i) => i.id === "cabinets.tops-kitchen")?.qty === 70);

// ── 4. what the estimator is told
const ask = { request: "Granite countertop installation, 3cm, eased edge, 10' island", title: "Granite countertops" };
const tb = tradeBrief("cabinets", house, lines, ["cabinets"], ask);
ok("the brief is the job in words — no number for the brief binding to grab", readBrief(tb.brief).area === undefined && readBrief(tb.brief).length === undefined && !/\d/.test(tb.brief.split(". New ")[0]), tb.brief);
ok("the takeoff block carries the request as written and prices only this job", /THE CONTRACTOR'S REQUEST: «Granite countertop installation, 3cm, eased edge, 10' island»/.test(tb.takeoffBlock) && /PRICE ONLY THIS JOB/.test(tb.takeoffBlock));
ok("…and lists the measured lines", tb.takeoffBlock.includes("Bar countertop") && /62\.5 sqft/.test(tb.takeoffBlock));
const run = planTradeRun({ trade: "cabinets", house, items: lines, alsoPriced: ["cabinets"], ask: { ...ask, partial: true, specialtyId: "countertop-installer" } });
ok("priced by the countertop installer, no whole-trade benchmark", run.setup.specialtyId === "countertop-installer" && run.benchmarkQty === null);
ok("a whole trade keeps its own specialty", planTradeRun({ trade: "roofing", house, items, alsoPriced: ["roofing"] }).setup.specialtyId === "roofing");
ok("words only: \"12' island, 3cm\" keeps the words", wordsOnly("granite 12' island and 45 sq ft of vanity tops") === "granite island and of vanity tops", wordsOnly("granite 12' island and 45 sq ft of vanity tops"));

// ── 4b. the first look kept in mind: what each sheet shows, and the notes that specify a job
const detailPage = sheets.find((x) => x.kind === "detail")!.page;
const indexed: SheetLite[] = lite.map((x) =>
  x.page === detailPage ? { ...x, contents: ["KITCHEN INTERIOR ELEVATIONS", "COUNTERTOP EDGE DETAIL", "note: countertops 3cm quartz, eased edge, undermount sinks"] } : x.kind === "structural" ? { ...x, contents: ["SHEAR WALL SCHEDULE", "note: HDU8 hold-downs"] } : x,
);
ok("the planner sees what each sheet shows", sheetIndex(indexed).includes(`p.${detailPage} · detail`) && /shows: KITCHEN INTERIOR ELEVATIONS; COUNTERTOP EDGE DETAIL/.test(sheetIndex(indexed)));
const withNotes = scopeByRules("granite countertops", items, indexed)!;
ok("a countertop job goes back to the details sheet that speaks of counters", withNotes.specPages.includes(detailPage) && !withNotes.specPages.some((pg) => indexed.find((x) => x.page === pg)?.kind === "structural"), JSON.stringify(withNotes.specPages));
const plan2 = cleanScope({ title: "Countertops", itemIds: ["cabinets.tops-kitchen"], measure: [{ label: "Kitchen countertops", unit: "sq ft", replaces: "cabinets.tops-kitchen", trade: "cabinets", pages: [mainFloor] }], specPages: [detailPage, mainFloor, 999] }, items, indexed, isBuildSpecialty);
ok("the model's spec pages: known sheets only, not the ones already measured", JSON.stringify(plan2?.specPages) === JSON.stringify([detailPage]), JSON.stringify(plan2?.specPages));
ok("a sheet with nothing to measure is read for what it specifies", /NOTHING TO MEASURE HERE/.test(focusPrompt({ request: "granite countertops", title: "Countertops", page: detailPage, pages: 18, sheetTitle: "A3", asks: [], textLayer: "", tiles: 4 })));
const specRead = cleanFocus(detailPage, { answers: [], specs: ["Note 12: countertops 3cm quartz, eased edge, undermount sinks", "Detail 4/A3: 4\" full-height backsplash", ""] }, []);
const again = cleanFocus(mainFloor, { answers: [], specs: ["NOTE 12: Countertops 3cm quartz, eased edge, undermount sinks"] }, []);
const specFold = applyFocus(withNotes, [again, specRead], items);
ok("the specs, each once, in sheet order (the same note on a later sheet is not repeated)", specFold.specs.length === 2 && specFold.specs.every((x) => x.page === Math.min(detailPage, mainFloor)) && /full-height backsplash/.test(specFold.specs[1].text), JSON.stringify(specFold.specs));
const tbSpecs = tradeBrief("cabinets", house, lines, ["cabinets"], { request: "granite countertops", title: "Countertops", specs: specFold.specs.map((x) => `${x.text} (p. ${x.page})`) });
ok("the estimator is told what the plans specify, to price it as called for", /WHAT THE PLANS SPECIFY FOR THIS JOB[\s\S]*3cm quartz, eased edge, undermount sinks \(p\. \d+\)/.test(tbSpecs.takeoffBlock));
const fenceNotes = scopeBySpecialty("cedar fence along the property line", indexed.map((x) => (x.kind === "site" ? { ...x, contents: ["SITE PLAN", "note: 6' cedar fence at the property line"] } : x)));
ok("a job no rule knows still finds the sheets that speak of it", !!fenceNotes && fenceNotes.specPages.length === 0 && fenceNotes.measure[0].pages.length > 0);

// ── 5. on the wire
ok("the ask goes over the wire", askPlanInput.safeParse({ token: "x", request: "granite countertops", house, sheets: lite, items }).success);
ok("a job's trade goes over the wire with its request", tradePriceInput.safeParse({ token: "x", trade: "cabinets", house, items: lines, alsoPriced: ["cabinets"], ask: { request: ask.request, title: ask.title, partial: true, specialtyId: "countertop-installer" } }).success);
ok("…and refuses a specialty id that is not an id at all", !tradePriceInput.safeParse({ token: "x", trade: "cabinets", house, items: lines, alsoPriced: ["cabinets"], ask: { request: "x", title: "x", partial: true, specialtyId: "Rocket Science!" } }).success);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

// Synthetic check of the way to a pass (lib/hvac/fixes) — no network, no browser.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-fixes.check.ts
// Every check that is not a pass gets a plan; the plan's actions name the
// field, the unit or the job that gets the estimate to a pass; the strip on
// top is short and never repeats itself; the install notes fold away.
import { runEngine } from "../../../src/lib/hvac/engine";
import { nextSteps, planFor } from "../../../src/lib/hvac/fixes";
import { US_CATALOG } from "../../../src/lib/hvac/data/usCatalog";
import type { BuildingModel, CatalogItem } from "../../../src/lib/hvac/types";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

function house(over: Partial<BuildingModel> = {}): BuildingModel {
  return {
    address: "test", state: "TX", county: "Dallas",
    conditionedSqft: 2000, storeys: 1, ceilingHeightFt: 8, yearBuilt: 1995,
    windowToFloor: 0.14, windowType: "double", wallInsulation: "r13", ceilingInsulation: "r30",
    foundation: "slab", tightness: "average", roofColor: "medium", shading: "some", occupants: 4,
    existing: { kind: "split-ac-furnace", tons: 3, fuel: "gas", refrigerant: "R-410A" },
    electrical: { mainAmps: 200, freeSlots: 6, electricRange: true, electricDryer: true },
    ducts: { location: "attic", condition: "unknown", insulated: true },
    gas: { available: true, pipeIn: 0.75, longestRunFt: 40 },
    preferences: {},
    provenance: {},
    ...over,
  };
}
const hp = (tons: number, over: Partial<CatalogItem> = {}): CatalogItem => ({ id: `hp${tons}`, kind: "heat-pump", brand: "Acme", model: `HP${tons * 12}`, refrigerant: "R-454B", staging: "single", tons, seer2: 15, hspf2: 8, source: "shop", ...over });

// ── nothing measured on the ducts: the plan is the three measurements ──
{
  const m = house();
  const e = runEngine(m, { catalog: US_CATALOG });
  const ctx = { model: m, engine: e, job: "replace-system" as const };
  const air = e.checks.find((c) => c.title === "Airflow not verified")!;
  const plan = planFor(air, ctx);
  ok("'Airflow not verified' → a measure plan with the static, the trunk and the return duct", plan.group === "measure" && plan.actions.length === 3 && plan.actions.every((a) => a.kind === "field") && JSON.stringify(plan.actions.map((a) => (a.kind === "field" ? a.path : ""))) === JSON.stringify(["ducts.measuredTespInWc", "ducts.supplyTrunk", "ducts.returnDuct"]), JSON.stringify(plan.actions));
  const steps = nextSteps(e.checks, ctx);
  ok("the strip is short, starts with the static, and never repeats a field", steps.length >= 1 && steps.length <= 4 && steps[0].kind === "field" && steps[0].path === "ducts.measuredTespInWc" && new Set(steps.map((a) => JSON.stringify(a.kind === "field" ? a.path : a))).size === steps.length, JSON.stringify(steps.map((a) => a.label)));
  const groups = e.checks.filter((c) => c.status !== "pass").map((c) => [c.title, planFor(c, ctx).group]);
  ok("the install rule for the Southeast is a code note, not a fix to click", groups.some(([t, g]) => /Southeast minimum/.test(t) && g === "code"), JSON.stringify(groups));
  ok("the duct condition that was never seen is a measure plan with Good / Fair / Poor", (() => { const p = planFor(e.checks.find((c) => c.id === "duct-cond")!, ctx); return p.group === "measure" && p.actions.length === 3 && p.actions.every((a) => a.kind === "field" && a.path === "ducts.condition" && a.value !== undefined); })());
  ok("every check that is not a pass gets a plan with a lead", e.checks.filter((c) => c.status !== "pass").every((c) => planFor(c, ctx).lead.length > 0));
}

// ── a hand-picked 3.5-ton on a 15 in. trunk (~1,090 CFM): the plan offers the 3-ton the ducts carry ──
{
  const m = house({ ducts: { location: "attic", condition: "fair", insulated: true, supplyTrunk: "15" }, existing: { kind: "split-heat-pump", tons: 3, fuel: "electric" }, gas: { available: false } });
  const e = runEngine(m, { catalog: [hp(3), hp(3.5)], pick: "hp3.5" });
  const ctx = { model: m, engine: e, job: "replace-system" as const };
  const size = e.checks.find((c) => c.id === "duct-size");
  ok("the hand-picked 3.5-ton (1,225 CFM) fails the duct capacity", size?.status === "fix" && e.selection.chosen?.item.id === "hp3.5", `${size?.status} · chosen ${e.selection.chosen?.item.id} · ${e.airflow?.capacityCfm} CFM`);
  const plan = planFor(size!, ctx);
  const pick = plan.actions.find((a) => a.kind === "pick");
  ok("…and the plan's first click is the 3-ton the ducts carry", plan.group === "fix" && pick?.kind === "pick" && pick.candidateId === "hp3" && /3-ton/.test(pick.label), JSON.stringify(plan.actions));
  ok("…with the priced upsize as the other way", plan.actions.some((a) => a.kind === "ledger" && /upsize/.test(a.label)));
  const hand = e.checks.find((c) => c.title === "Unit chosen by hand");
  ok("a hand pick the engine ruled out gets 'Back to the engine's pick'", !hand || (planFor(hand, ctx).actions[0]?.kind === "pick" && (planFor(hand, ctx).actions[0] as { candidateId: string | null }).candidateId === null));
}

// ── Washington: the permit wants the approved calc; the lockout names the balance point ──
{
  const m = house({ state: "WA", county: "King", existing: { kind: "split-heat-pump", tons: 3, fuel: "electric" }, gas: { available: false } });
  const e = runEngine(m, { catalog: US_CATALOG });
  const ctx = { model: m, engine: e, job: "replace-system" as const };
  const mjs = e.checks.find((c) => c.id === "wa-manual-s");
  ok("WA 'Manual J load and Manual S selection' is a pass covered by the design card — no report to attach", !!mjs && mjs.status === "pass" && /design card carries both/.test(mjs.detail) && planFor(mjs, ctx).lead === "Passed." && !nextSteps(e.checks, ctx).some((a) => a.kind === "permit"), mjs ? `${mjs.status}: ${mjs.detail.slice(0, 80)}` : "no flag");
  const lock = e.checks.find((c) => c.id === "wa-hp-lockout");
  const bp = e.selection.chosen?.balancePointF;
  ok("WA 'Supplementary heat lockout' names the balance point to set", !!lock && (!bp || planFor(lock, ctx).actions.some((a) => a.kind === "note" && a.label.includes(`${bp} °F`))), lock ? planFor(lock, ctx).actions[0]?.label : "no flag");
  const cap = e.checks.find((c) => c.id === "wa-hfc-750");
  ok("the refrigerant cap reads 'Met' for an R-454B / R-32 unit", !cap || !["R-454B", "R-32"].includes(e.selection.chosen?.item.refrigerant ?? "") || /^Met:/.test(planFor(cap, ctx).lead), cap ? planFor(cap, ctx).lead : "no flag");
}

// ── the record-vs-walk question: a field per conflict ──
{
  const m = house({ conflicts: [{ path: "conditionedSqft", kept: "1850", walk: "2400" }] });
  const e = runEngine(m, { catalog: US_CATALOG });
  const ctx = { model: m, engine: e, job: "replace-system" as const };
  const rv = e.checks.find((c) => c.title === "Record vs walk")!;
  const plan = planFor(rv, ctx);
  ok("'Record vs walk' → one field button per conflict, naming both figures", plan.group === "measure" && plan.actions.length === 1 && plan.actions[0].kind === "field" && plan.actions[0].path === "conditionedSqft" && /record 1850, walk 2400/.test(plan.actions[0].label), JSON.stringify(plan.actions));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

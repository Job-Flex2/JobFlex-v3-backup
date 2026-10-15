// Smart Proposal procedures (lib/estimate/procedures) and the prompt they
// ride in (2026-09-18): every AI specialty has a procedure, every step
// carries a legal unit, the text form round-trips, the admin's checks hold,
// and the sewer brief that came back thin now composes a prompt with the
// procedure block, the override slots and the line-item rules.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/procedures.check.ts
import { getAiSpecialtiesSync, AI_SPECIALTY_GROUPS } from "../../../src/lib/estimate/legacy/specialties";
import {
  coreStepCount,
  shortOfProcedure,
  formatProcedureBlock,
  PROCEDURE_RULES,
  PROCEDURE_UNITS,
  procedureFor,
  procedureFromText,
  procedureToText,
  SPECIALTY_PROCEDURES,
  validateProcedure,
} from "../../../src/lib/estimate/procedures";
import { buildLegacyEstimatePrompt, procedureBlockFor, GENERAL_CONTRACTING } from "../../../src/lib/estimate/legacy-estimate";
import { ESTIMATOR_MASTER_PROMPT } from "../../../src/lib/estimate/master-prompt";
import { checkOverride } from "../../../src/lib/estimate/promptAdmin";
import { parseOverrideRows } from "../../../src/lib/estimate/promptOverrides";
import { OVERRIDE_KEYS } from "../../../src/lib/estimate/promptKeys";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ── Coverage ────────────────────────────────────────────────────────────────
const specialties = getAiSpecialtiesSync();
const ids = new Set(specialties.map((s) => s.id));
const missing = specialties.filter((s) => !procedureFor(s.id)).map((s) => s.id);
check(`every one of the ${specialties.length} specialties has a procedure`, missing.length === 0, missing.join(", "));
const orphans = Object.keys(SPECIALTY_PROCEDURES).filter((id) => !ids.has(id));
check("no procedure is keyed to a specialty that does not exist", orphans.length === 0, orphans.join(", "));
check("the general-contracting fallback has one", !!procedureFor(GENERAL_CONTRACTING.id));
const groupIds = new Set(AI_SPECIALTY_GROUPS.flatMap((g) => g.specialtyIds));
check("every specialty sits in a group", specialties.every((s) => groupIds.has(s.id)));

// ── Every procedure passes the shared rules ─────────────────────────────────
const professional = new Set(AI_SPECIALTY_GROUPS.filter((g) => g.id === "engineering-design" || g.id === "development-consulting").flatMap((g) => g.specialtyIds));
let problems: string[] = [];
let steps = 0;
let conditional = 0;
const unitTally: Record<string, number> = {};
for (const [id, p] of Object.entries(SPECIALTY_PROCEDURES)) {
  const issues = validateProcedure(p, professional.has(id) ? { minSteps: 6, maxSteps: 16 } : { minSteps: 8, maxSteps: 22 });
  problems.push(...issues.map((i) => `${id} ${i.path}: ${i.message}`));
  steps += p.steps.length;
  for (const s of p.steps) {
    unitTally[s.unit] = (unitTally[s.unit] ?? 0) + 1;
    if (s.when) conditional++;
  }
}
check(`every procedure passes validateProcedure (${steps} steps, ${conditional} conditional)`, problems.length === 0, problems.slice(0, 5).join(" | "));
check("every unit used is in the vocabulary", Object.keys(unitTally).every((u) => (PROCEDURE_UNITS as readonly string[]).includes(u)), JSON.stringify(unitTally));
check("real quantities dominate: fewer than half the steps are fixed", (unitTally.fixed ?? 0) < steps / 2, `${unitTally.fixed} fixed of ${steps}`);
check("length, area, volume and count units all appear", ["linear ft", "sqft", "cu yards", "unit", "hour"].every((u) => (unitTally[u] ?? 0) > 20), JSON.stringify(unitTally));

// No two specialties share a whole procedure (template with the noun swapped).
const signatures = new Map<string, string>();
const clones: string[] = [];
for (const [id, p] of Object.entries(SPECIALTY_PROCEDURES)) {
  const sig = p.steps.map((s) => s.item.toLowerCase()).join("|");
  const other = signatures.get(sig);
  if (other) clones.push(`${id}=${other}`);
  signatures.set(sig, id);
}
check("no two specialties carry the same procedure", clones.length === 0, clones.join(", "));
// Siblings differ: at most 3 shared step items between any two specialties of a group.
problems = [];
for (const g of AI_SPECIALTY_GROUPS) {
  const list = g.specialtyIds.filter((id) => SPECIALTY_PROCEDURES[id]);
  for (let i = 0; i < list.length; i++) {
    const a = new Set(SPECIALTY_PROCEDURES[list[i]].steps.map((s) => s.item.toLowerCase()));
    for (let j = i + 1; j < list.length; j++) {
      const shared = SPECIALTY_PROCEDURES[list[j]].steps.filter((s) => a.has(s.item.toLowerCase())).length;
      if (shared > 3) problems.push(`${list[i]}~${list[j]}:${shared}`);
    }
  }
}
check("siblings in a group share at most 3 identical steps", problems.length === 0, problems.slice(0, 6).join(" "));

// ── The owner's case: sanitary sewer ────────────────────────────────────────
const sewer = procedureFor("sanitary-sewer")!;
const items = sewer.steps.map((s) => s.item.toLowerCase());
const has = (re: RegExp) => items.some((i) => re.test(i));
check("sewer: utility locate, permits, trench, bedding, pipe, cleanouts, tap, backfill, camera/pressure test, restoration are all steps",
  [/811|locate/, /permit/, /trench/, /bedding/, /sdr-35|pvc/, /cleanout/, /tap|main/, /backfill/, /camera|hydrostatic|air/, /restoration|sod|patch/].every(has));
const pipe = sewer.steps.find((s) => /sewer pipe supplied/i.test(s.item))!;
check("sewer: the pipe is linear ft, the bedding cu yards, the cleanouts unit, the test fixed",
  pipe.unit === "linear ft" && sewer.steps.find((s) => /bedding/i.test(s.item))!.unit === "cu yards" && sewer.steps.find((s) => /cleanout/i.test(s.item))!.unit === "unit" && sewer.steps.find((s) => /testing:/i.test(s.item))!.unit === "fixed");
check("sewer: pavement cut, dewatering, traffic control are conditional", sewer.steps.filter((s) => /saw-cut|dewatering|traffic control/i.test(s.item)).every((s) => !!s.when));

// ── The block ───────────────────────────────────────────────────────────────
const block = formatProcedureBlock("Sanitary Sewer Contractor", sewer);
check("the block names the specialty, the basis, numbered steps with [core]/[when …] tags and the unit after a dash",
  /PROCEDURE — SANITARY SEWER CONTRACTOR/.test(block) && /Measured and sold by: linear feet/.test(block) && /^\s+1\. \[core\] .* — fixed$/m.test(block) && /\[when the run crosses asphalt or concrete\] .* — sqft$/m.test(block));
check("the block states the core and conditional counts and the minimum line count", new RegExp(`This procedure has ${coreStepCount(sewer)} core steps and ${sewer.steps.length - coreStepCount(sewer)} conditional ones\\. A complete answer has AT LEAST ${coreStepCount(sewer)} line items`).test(block) && coreStepCount(sewer) === 13);
check("a thin answer is recognised: 8 lines for 18 core steps is short, 13 is not, a tiny procedure never is", shortOfProcedure(8, 18) && !shortOfProcedure(13, 18) && !shortOfProcedure(1, 3) && shortOfProcedure(6, 13) && !shortOfProcedure(10, 13));
check("buildLegacyEstimatePrompt reports the core step count", buildLegacyEstimatePrompt({ description: "full bathroom remodel, Kirkland WA" }).procedureCoreSteps === coreStepCount(procedureFor("bathroom-remodel")) && buildLegacyEstimatePrompt({ description: "full bathroom remodel" }).specialty.id === "bathroom-remodel");
check("the block carries the avoid list, the notes and the rules", /NEVER write these lines/.test(block) && /STATE IN NOTES/.test(block) && block.endsWith(PROCEDURE_RULES));
check("custom rules replace the default paragraph", formatProcedureBlock("X", sewer, "MY RULES").endsWith("MY RULES") && !formatProcedureBlock("X", sewer, "MY RULES").includes("LINE-ITEM DISCIPLINE"));

// ── Text form round trip ────────────────────────────────────────────────────
const text = procedureToText(sewer);
const back = procedureFromText(text);
check("procedureToText → procedureFromText is lossless", back.issues.length === 0 && JSON.stringify(back.procedure) === JSON.stringify(sewer), back.issues.map((i) => i.message).join(" | "));
let roundTrips = 0;
for (const p of Object.values(SPECIALTY_PROCEDURES)) {
  const r = procedureFromText(procedureToText(p));
  if (r.issues.length === 0 && JSON.stringify(r.procedure) === JSON.stringify(p)) roundTrips++;
}
check("every procedure round-trips through the text form", roundTrips === Object.keys(SPECIALTY_PROCEDURES).length, `${roundTrips}`);
const loose = procedureFromText(`basis: feet of fence\n\n1. Set 4x4 posts in concrete, 8 ft on center | ea\n- Hang 1x6 cedar pickets on three rails | lf | when the fence is wood\n- Build and hang the gates with hardware | each\n- Stain two coats, both faces | sq ft\n- Haul away the old fence and clean up | LS\navoid: a bare 'Fence' line; or 'Materials'\nnote: posts are 4x4 cedar`);
check("the parser takes numbered lines, unit aliases (ea, lf, each, sq ft, LS), strips a leading 'when' and keeps a semicolon inside an avoid entry",
  loose.issues.length === 0 && loose.procedure.steps.map((s) => s.unit).join(",") === "unit,linear ft,unit,sqft,fixed" && loose.procedure.steps[1].when === "the fence is wood" && loose.procedure.avoid.length === 1, loose.issues.map((i) => `${i.path}: ${i.message}`).join(" | "));
const broken = procedureFromText(`basis: x\n- Dig a hole | furlongs\nsomething else entirely\n- Labor | hour`);
check("the parser reports a bad unit, a stray line and a bare word", broken.issues.some((i) => /furlongs/.test(i.message)) && broken.issues.some((i) => /not a step/.test(i.message)) && broken.issues.some((i) => /bare category/.test(i.message)));

// ── Overrides ───────────────────────────────────────────────────────────────
const now = new Date();
const o = parseOverrideRows([
  { key: OVERRIDE_KEYS.master, body: "MASTER OVERRIDE", updatedAt: now },
  { key: OVERRIDE_KEYS.preamble("sanitary-sewer"), body: "Sewer preamble override.", updatedAt: now },
  { key: OVERRIDE_KEYS.procedure("sanitary-sewer"), body: text.replace("Utility locate (811 one-call ticket)", "Locate call (811)"), updatedAt: now },
  { key: OVERRIDE_KEYS.procedure("roofing"), body: "basis: nope\n- x | y", updatedAt: now },
  { key: OVERRIDE_KEYS.procedureRules, body: "RULES OVERRIDE", updatedAt: now },
  { key: "  ", body: "", updatedAt: now },
]);
check("overrides parse: master, rules, a specialty's preamble and procedure; a broken procedure is skipped",
  o.master === "MASTER OVERRIDE" && o.procedureRules === "RULES OVERRIDE" && o.specialties["sanitary-sewer"]?.preamble === "Sewer preamble override." && o.specialties["sanitary-sewer"]?.procedure?.steps[0].item.startsWith("Locate call (811)") && !o.specialties["roofing"] && !o.savedAt[OVERRIDE_KEYS.procedure("roofing")]);

const brief = { description: "Sewer line installation, 300 ft from the house to the city main, Lynnwood WA", location: "Lynnwood, WA", companyName: "Ridgeline" };
const plain = buildLegacyEstimatePrompt(brief, { withTradeRules: true });
check("the sewer brief detects sanitary-sewer and the prompt carries the procedure block before the trade block",
  plain.specialty.id === "sanitary-sewer" && plain.procedure && plain.prompt.indexOf("PROCEDURE — SANITARY SEWER") > 0 && plain.prompt.indexOf("PROCEDURE — SANITARY SEWER") < plain.prompt.indexOf("TRADE PROFILE:") && plain.prompt.includes(ESTIMATOR_MASTER_PROMPT.slice(0, 60)));
check("the block sits after the price book and before the output rules", plain.prompt.indexOf("PROCEDURE — SANITARY SEWER") < plain.prompt.indexOf("Return a JSON object with the following structure"));
const withO = buildLegacyEstimatePrompt(brief, { withTradeRules: false, overrides: o });
check("overrides land: master replaced, preamble replaced, edited step in the block, custom rules, no trade block",
  withO.prompt.startsWith("MASTER OVERRIDE") && withO.prompt.includes("Sewer preamble override.") && withO.prompt.includes("Locate call (811)") && withO.prompt.includes("RULES OVERRIDE") && !withO.prompt.includes("LINE-ITEM DISCIPLINE") && !withO.prompt.includes("TRADE PROFILE:") && !withO.prompt.includes(ESTIMATOR_MASTER_PROMPT.slice(0, 60)));
const chosen = buildLegacyEstimatePrompt({ description: "something vague" }, { specialtyId: "roofing" });
check("a chosen specialty skips detection (the admin preview)", chosen.specialty.id === "roofing" && chosen.procedure);
check("procedureBlockFor answers null for a specialty with no procedure", procedureBlockFor({ ...GENERAL_CONTRACTING, id: "no-such" }) === null);
const every = specialties.filter((s) => !buildLegacyEstimatePrompt({ description: "x" }, { specialtyId: s.id }).procedure).map((s) => s.id);
check("every specialty composes a prompt with its block", every.length === 0, every.join(", "));

// ── The admin's save checks ─────────────────────────────────────────────────
check("checkOverride: the default text clears the row", checkOverride(OVERRIDE_KEYS.master, ESTIMATOR_MASTER_PROMPT + "\n").ok && (checkOverride(OVERRIDE_KEYS.master, ESTIMATOR_MASTER_PROMPT) as { clear: boolean }).clear);
check("checkOverride: an empty box clears the row", (checkOverride(OVERRIDE_KEYS.preamble("roofing"), "   ") as { clear: boolean }).clear);
check("checkOverride: a changed master is stored", !(checkOverride(OVERRIDE_KEYS.master, "New master") as { clear: boolean }).clear);
const badProc = checkOverride(OVERRIDE_KEYS.procedure("roofing"), "basis: roof\n- Tear off | squares\n- Shingles | acres");
check("checkOverride: a procedure with a bad unit is refused with the line named", !badProc.ok && /line 3/.test((badProc as { error: string }).error) && /acres/.test((badProc as { error: string }).error), JSON.stringify(badProc));
check("checkOverride: an unknown specialty or key is refused", !checkOverride(OVERRIDE_KEYS.preamble("nope"), "x").ok && !checkOverride("garbage", "x").ok);
check("checkOverride: a procedure restating the default clears", (checkOverride(OVERRIDE_KEYS.procedure("sanitary-sewer"), procedureToText(sewer)) as { clear: boolean }).clear);

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);

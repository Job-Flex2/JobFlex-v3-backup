// The questions the intake gate asks before pricing (2026-09-19): chosen by
// the money each answer moves — the job's own measure first, then the
// procedure's conditional steps priced by the price book. No model call.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/intake-questions.check.ts
import { costQuestionBlock, costQuestions } from "../../../src/lib/estimate/intake-questions";
import { procedureFor } from "../../../src/lib/estimate/procedures";
import { specialtyFor } from "../../../src/lib/estimate/legacy-estimate";
import { readBrief } from "../../../src/lib/estimate/brief";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const ask = (brief: string, location: string) => {
  const s = specialtyFor({ description: brief }).specialty;
  return { specialty: s.id, questions: costQuestions(s.id, procedureFor(s.id), readBrief(brief), location, { brief }) };
};
const show = (qs: ReturnType<typeof ask>["questions"]) => qs.map((q) => `${q.id} $${Math.round(q.impact)} ${q.question.slice(0, 40)}`).join(" | ");

// ── The job's own measure comes first ───────────────────────────────────────
const noRun = ask("install sewer 8 inch pipe in the street and the asphalt road", "Lynnwood, WA");
const first = noRun.questions[0];
check("a sewer with no run stated is asked for the run first, in linear ft, with the money on it",
  noRun.specialty === "sanitary-sewer" && first?.id === "job-measure" && first.kind === "number" && first.unit === "linear ft" &&
  /priced by the linear ft/.test(first.why) && first.impact > 5000, show(noRun.questions));
const withRun = ask("install 300 lineal feet of sewer 8 inch pipe and the asphalt road", "Lynnwood, WA");
check("with the run stated it is never asked again", withRun.questions.every((q) => q.id !== "job-measure") && withRun.questions.length > 0, show(withRun.questions));
check("a roof brief that states its area is not asked for one, in sqft or in squares",
  ask("Replace the roof, 2400 sqft architectural shingles", "Bothell, WA").questions.every((q) => q.id !== "job-measure") &&
  ask("Replace the roof, 30 squares, architectural shingles", "Bothell, WA").questions.every((q) => q.id !== "job-measure"));
check("a roof brief with no size at all is asked for it", ask("Replace the roof, architectural shingles, tear off one layer", "Bothell, WA").questions[0]?.id === "job-measure", show(ask("Replace the roof, architectural shingles, tear off one layer", "Bothell, WA").questions));

// ── Conditional steps, priced on this job ───────────────────────────────────
const roof = ask("Replace the roof, 2400 sqft architectural shingles", "Bothell, WA");
check("the roof is asked about deck repair, the costliest thing the brief leaves open",
  /deck repair/i.test(roof.questions[0]?.question ?? "") && roof.questions[0].impact > 800 && /the estimate carries it when the tear-off exposes rotted/.test(roof.questions[0].why), show(roof.questions));
const bath = ask("Full bathroom remodel, 8x10 hall bath", "Kirkland, WA");
check("an 8x10 bath is asked about heated floors — the room's size prices the step", bath.questions.some((q) => /radiant floor heat/i.test(q.question) && q.impact > 1000), show(bath.questions));
const sewer = ask("install 300 lineal feet of sewer 8 inch pipe and the asphalt road", "Lynnwood, WA");
check("a crossing is priced as part of the run, not all of it", sewer.questions.some((q) => /bore or hand-dig/i.test(q.question) && q.impact < 300 * 110 * 0.5), show(sewer.questions));

// ── One question per choice ─────────────────────────────────────────────────
const fence = ask("Build a 6 ft cedar privacy fence around the backyard, about 180 feet with one gate", "Spokane, WA");
const choice = fence.questions.find((q) => q.id.startsWith("choice-"));
check("the fence's three material steps become one question with its options, worth their spread",
  !!choice && /^Which fence\?$/.test(choice.question) && (choice.options?.length ?? 0) === 3 && /price changes by about/.test(choice.why) && choice.impact > 1000, show(fence.questions));

// ── What the brief rules out is never asked ─────────────────────────────────
const inside = ask("Paint the whole interior, walls and ceilings, about 1800 sq ft", "Denver, CO");
check("an interior paint job is never asked about exterior siding", inside.questions.every((q) => !/exterior/i.test(q.question)), show(inside.questions));

// ── The shape of the list ───────────────────────────────────────────────────
const all = [noRun, withRun, roof, bath, fence, inside].map((r) => r.questions);
check("at most three, most money first, every one worth asking",
  all.every((qs) => qs.length <= 3 && qs.every((q, i) => i === 0 || qs[i - 1].impact >= q.impact) && qs.every((q) => q.impact >= 300 && q.question.length > 8 && q.why.length > 8)));
check("a select always offers a way out; a measure asks for a number", all.flat().every((q) => (q.kind === "select" ? (q.options?.length ?? 0) >= 2 : q.kind !== "number" || !!q.unit)));
check("no procedure or no price book, no questions", costQuestions("no-such-specialty", procedureFor("roofing"), readBrief("x"), "Bothell, WA").length === 0 && costQuestions("roofing", null, readBrief("x"), "Bothell, WA").length === 0);

// ── The block the gate carries ──────────────────────────────────────────────
const block = costQuestionBlock(noRun.questions)!;
check("the block ranks them with their ids and tells the model to keep them",
  /COST-CRITICAL UNKNOWNS/.test(block) && /1\. id "job-measure"/.test(block) && /keeping each id exactly/.test(block) && /ONE more question of your own/.test(block), block.slice(0, 80));
check("no questions, no block", costQuestionBlock([]) === null);

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);

// The AI desk and Wisetack (lib/aiDesk/profile withFinancingAnswer, 2026-10-28): an approved contractor's desk says
// yes to "Do you offer financing?" — unless the owner wrote their own answer, which the desk keeps.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/financing-desk.check.ts
import { EMPTY_PROFILE, MAX_FAQS, financingAnswerOf, withFinancingAnswer, type DeskProfile } from "../../../src/lib/aiDesk/profile";
import { FINANCING_PRESET_ANSWERS } from "../../../src/lib/aiDesk/tradePresets";
import { FIN } from "../../../src/lib/financing/words";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra ? `\n     ${extra}` : ""}`);
};

const ours = { q: FIN.deskQ, a: FIN.deskA };
const withFaqs = (faqs: DeskProfile["faqs"]): DeskProfile => ({ ...EMPTY_PROFILE, faqs });
const hours = { q: "What are your hours?", a: "Weekdays 8 to 5." };

check("not approved → the profile as it was", JSON.stringify(withFinancingAnswer(withFaqs([hours]), null)) === JSON.stringify(withFaqs([hours])));
const added = withFinancingAnswer(withFaqs([hours]), ours);
check("no financing question yet → the Wisetack answer is added", added.faqs.length === 2 && added.faqs[1].q === FIN.deskQ && added.faqs[1].a === FIN.deskA, JSON.stringify(added.faqs));
check("the stock answers are known", FINANCING_PRESET_ANSWERS.length === 3 && FINANCING_PRESET_ANSWERS.every((a) => typeof a === "string" && a.length > 10));
for (const preset of FINANCING_PRESET_ANSWERS) {
  const r = withFinancingAnswer(withFaqs([hours, { q: "Do you offer financing?", a: preset }]), ours);
  check(`a stock answer ("${preset.slice(0, 32)}…") → replaced by the Wisetack line`, r.faqs.length === 2 && r.faqs[1].a === FIN.deskA);
}
const own = { q: "Do you have payment plans?", a: "Yes — 12 months same as cash through our bank." };
check("the owner's own answer → kept, nothing added", JSON.stringify(withFinancingAnswer(withFaqs([hours, own]), ours).faqs) === JSON.stringify([hours, own]));
const full = withFaqs(Array.from({ length: MAX_FAQS }, (_, i) => ({ q: `Question ${i}?`, a: "An answer." })));
check("a full list stays within the limit", withFinancingAnswer(full, ours).faqs.length === MAX_FAQS);

check("financingAnswerOf: the owner's own → theirs", financingAnswerOf(withFaqs([own]), FIN.deskA) === "theirs");
check("financingAnswerOf: a stock answer, none, or ours → ours", financingAnswerOf(withFaqs([{ q: "Do you offer financing?", a: FINANCING_PRESET_ANSWERS[0] }]), FIN.deskA) === "ours" && financingAnswerOf(withFaqs([hours]), FIN.deskA) === "ours" && financingAnswerOf(withFaqs([ours]), FIN.deskA) === "ours");

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);

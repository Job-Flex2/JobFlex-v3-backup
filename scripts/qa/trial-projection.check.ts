// The trial projection on /admin/traffic's signups list (2026-10-05,
// lib/trialProjection): the tier each trial reads as, its chance, the shop's
// own record calibrating the uncertain tiers, prices per month, the totals.
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/trial-projection.check.ts
import { PRIOR_RATE, TIER_CHANCE, calibrate, dollars, monthlyCents, projectTrials, trialChance, trialTier, valueTrial, type TrialSignals } from "../../src/lib/trialProjection";
import { signupState } from "../../src/lib/traffic-live";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const base: TrialSignals = { hasCard: false, over: false, ageHours: 48, proposals: 0, records: 0, activeDays: 0, views: 0 };
const t = (p: Partial<TrialSignals>) => trialTier({ ...base, ...p });

console.log("── tiers");
check("a card on file wins over everything, even an expired date", t({ hasCard: true, over: true }) === "card");
check("set to cancel wins over a card on file — nothing is charged unless they resume", t({ hasCard: true, canceling: true }) === "canceling" && trialChance("canceling", 2.5) === 0.05);
check("a trial over without a card is 'over', whatever it did", t({ over: true, proposals: 5 }) === "over");
check("one proposal, three records or three active days is 'working'", t({ proposals: 1 }) === "working" && t({ records: 3 }) === "working" && t({ activeDays: 3 }) === "working");
check("one record, a second day or ten screens is 'trying'", t({ records: 1 }) === "trying" && t({ activeDays: 2 }) === "trying" && t({ views: 10 }) === "trying");
check("under a day old with nothing yet is 'just started'; a day and nothing is 'quiet'", t({ ageHours: 5 }) === "new" && t({ ageHours: 30 }) === "quiet");
check("chances fall in order: card > working > trying > new > quiet > over", TIER_CHANCE.card > TIER_CHANCE.working && TIER_CHANCE.working > TIER_CHANCE.trying && TIER_CHANCE.trying > TIER_CHANCE.new && TIER_CHANCE.new > TIER_CHANCE.quiet && TIER_CHANCE.quiet > TIER_CHANCE.over);

console.log("── the shop's record");
const none = calibrate({ converted: 0, lapsed: 0 });
check("no finished trials: the starting chances stand (×1)", none.observedRate === null && none.factor === 1 && near(none.blendedRate, PRIOR_RATE));
const lucky = calibrate({ converted: 2, lapsed: 0 });
check("two lucky trials do not triple the forecast: 2 of 2 → blended 43%, ×2.14", near(lucky.blendedRate, 3 / 7) && near(lucky.factor, (3 / 7) / 0.2, 0.001) && lucky.factor < 2.5);
const poor = calibrate({ converted: 1, lapsed: 19 });
check("one of twenty: blended (1 + 1) / 25 = 8%, the uncertain tiers drop to ×0.4", near(poor.blendedRate, 2 / 25) && near(poor.factor, 0.4) && poor.observedRate === 0.05);
const fair = calibrate({ converted: 3, lapsed: 12 });
check("three of fifteen (20%) matches the start: ×1", near(fair.factor, 1));
check("the factor is held between 0.4 and 2.5", calibrate({ converted: 0, lapsed: 500 }).factor === 0.4 && calibrate({ converted: 500, lapsed: 0 }).factor === 2.5);
check("card and over keep their chance whatever the record says", trialChance("card", 2.5) === 0.9 && trialChance("over", 0.4) === 0.05);
check("a calibrated chance never passes 85%", trialChance("working", 2.5) === 0.85 && trialChance("trying", 2) === 0.4);

console.log("── money");
check("a yearly price counts as a twelfth: $790/yr → $65.83/mo", monthlyCents(79000, "YEAR") === 6583 && monthlyCents(7900, "MONTH") === 7900 && monthlyCents(7900, "month") === 7900);
const vals = [valueTrial(7900, "working"), valueTrial(14900, "card"), valueTrial(4900, "quiet"), valueTrial(null, "trying")];
check("each trial's expected value is price × chance", vals[0].expectedCents === Math.round(7900 * 0.45) && vals[1].expectedCents === Math.round(14900 * 0.9) && vals[3].expectedCents === 0);
const proj = projectTrials(vals, none, [7900, null, 14900]);
check("the projection sums the trials; the most is every priced trial paying", proj.expectedCents === vals.reduce((a, v) => a + v.expectedCents, 0) && proj.maxCents === 7900 + 14900 + 4900 && proj.trials === 4 && proj.unpriced === 1);
check("by tier: counts and money", proj.byTier.working.count === 1 && proj.byTier.card.expectedCents === vals[1].expectedCents && proj.byTier.over.count === 0);
check("paying accounts at list price: $79 + $149, an unpriced one counted as 0", proj.payingCents === 22800 && proj.paying === 3);
check("dollars read as a person writes them", dollars(1747500) === "$17,475" && dollars(658) === "$6.58" && dollars(0) === "$0");

console.log("── the state");
check("a card-less trial that ran out is lapsed, not 'no plan row'", signupState("TRIAL_ENDED") === "lapsed" && signupState("trial_ended") === "lapsed");

function near(a: number, b: number, tol = 1e-9) { return Math.abs(a - b) <= tol; }
console.log(bad === 0 ? "\nAll trial projection checks passed." : `\n${bad} trial projection check(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);

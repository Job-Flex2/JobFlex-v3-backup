// Wisetack financing words (lib/financing/words, 2026-10-28): Wisetack's disclosure word for word, and no rate,
// APR or monthly figure JobFlex made up anywhere a contractor or a client reads — those are lending terms only
// Wisetack may state.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/financing-words.check.ts
import { FIN, clientLoanWords, loanLine, lockWords, merchantWords, readinessLabel } from "../../../src/lib/financing/words";
import type { Loan, LoanState, LockReason, MerchantState, ReadinessItem } from "../../../src/lib/financing/state";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra ? `\n     ${extra}` : ""}`);
};

const money = (minor: number) => `$${Math.round(minor / 100).toLocaleString("en-US")}`;
const at = "2026-10-28T12:00:00.000Z";
const loan = (o: Partial<Loan> = {}): Loan => ({ ref: "t1", state: "sent", amountMinor: 2_000_000, approvedMinor: 1_400_000, fundings: [], url: "u", createdAt: at, expiresAt: null, history: [], nudgedAt: null, ...o });

const MERCHANT: MerchantState[] = ["none", "started", "review", "needs_info", "approved", "declined", "paused"];
const LOAN: LoanState[] = ["sent", "started", "needs_action", "approved", "accepted", "done_asked", "paid", "declined", "expired", "canceled", "refunded"];
const LOCK: LockReason[] = ["not_open", "not_set_up", "waiting", "declined", "paused", "off", "under_min", "over_max", "paid", "nothing_owed", "plan_ended"];
const READY: ReadinessItem["key"][] = ["name", "phone", "email", "address", "website", "trade", "year"];
const limits = { minMinor: 50_000, maxMinor: 6_500_000 };

check(
  "the disclosure is Wisetack's, word for word",
  FIN.disclosure === "All financing is subject to credit approval. Your terms may vary. Payment options through Wisetack are provided by our lending partners.",
);
check("the button and its line", FIN.button === "Pay over time" && FIN.buttonSub === "Check your rate — it won't affect your credit score.");
check("the desk's answer names Wisetack and credit approval, no rate", FIN.deskQ === "Do you offer financing?" && /Wisetack/.test(FIN.deskA) && /credit approval/.test(FIN.deskA));

const all: string[] = [
  ...Object.values(FIN).filter((v): v is string => typeof v === "string"),
  FIN.restLabel("$6,000"),
  FIN.coveredLine("$14,000"),
  ...MERCHANT.flatMap((s) => [merchantWords(s).title, merchantWords(s).sub]),
  ...LOCK.map((w) => lockWords(w, limits, money)),
  ...LOAN.map((s) => loanLine(loan({ state: s }), money)),
  ...LOAN.flatMap((s) => [clientLoanWords(loan({ state: s }), money).title, clientLoanWords(loan({ state: s }), money).sub]),
  ...READY.map(readinessLabel),
];
const banned = /\bAPR\b|as low as|%|\/mo\b|per month/i;
const hits = all.filter((w) => banned.test(w));
check("no APR, no 'as low as', no percent, no monthly figure in any word", hits.length === 0, hits.join(" | "));
check("every word is filled in", all.every((w) => w.trim().length > 0));
check("the limits are in the limit words", lockWords("under_min", limits, money).includes("$500") && lockWords("over_max", limits, money).includes("$65,000"));
check("approved names the amount", loanLine(loan({ state: "approved" }), money).includes("$14,000") && clientLoanWords(loan({ state: "approved" }), money).title.includes("$14,000"));
const part = loan({ state: "accepted", fundings: [{ id: "f1", amountMinor: 700_000, at }] });
check("a part payout reads 'Paid $7,000 of $14,000'", loanLine(part, money) === "Paid $7,000 of $14,000", loanLine(part, money));
check("paid in full reads 'Paid $14,000 through Wisetack'", loanLine(loan({ state: "paid", fundings: [{ id: "f1", amountMinor: 1_400_000, at }] }), money) === "Paid $14,000 through Wisetack");
check("each merchant state has a tone", MERCHANT.every((s) => ["ok", "wait", "warn", "off"].includes(merchantWords(s).tone)) && merchantWords("approved").tone === "ok");

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);

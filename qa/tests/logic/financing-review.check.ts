// Wisetack financing — the whole-branch review's findings (2026-10-28), pinned: an old loan's late word never touches
// the client's current loan (its payouts still land), a loan approved for more than asked reads Paid when it is paid,
// an accepted loan takes every open stage (no card payment the loan will also pay), the row's Send button only where
// a client can act, and a Wisetack payout named as Wisetack's.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/financing-review.check.ts
import { coverMinor, loanEventFor, nextLoanState, type Loan, type LoanSnapshot } from "../../../src/lib/financing/state";
import { portalFinancingFrom, rowFinancing } from "../../../src/lib/financing/view";
import { EMPTY_ORG_FINANCING } from "../../../src/lib/financing/state";
import { providerName, providerWord } from "../../../src/lib/payments/providerWords";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra ? `\n     ${extra}` : ""}`);
};
const at = "2026-10-28T12:00:00.000Z";
const usd = (m: number) => `$${Math.round(m / 100).toLocaleString("en-US")}`;
const loan = (o: Partial<Loan> = {}): Loan => ({ ref: "t-new", state: "sent", amountMinor: 1_000_000, approvedMinor: null, fundings: [], url: "u", createdAt: at, expiresAt: null, history: [], nudgedAt: null, ...o });
const snap = (o: Partial<LoanSnapshot> = {}): LoanSnapshot => ({ state: "sent", approvedMinor: null, fundings: [], expiresAt: null, ...o });

// #1 — an old loan's word
check("the current loan's own word → apply", loanEventFor(loan(), "t-new", snap({ state: "approved" })) === "apply");
check("an old loan, declined or expired late → ignore (the new loan is untouched)", loanEventFor(loan(), "t-old", snap({ state: "expired" })) === "ignore");
check("an old loan that paid out → settle its payout anyway", loanEventFor(loan(), "t-old", snap({ state: "paid", fundings: [{ id: "f", amountMinor: 5, at }] })) === "stale_settle");
check("no current loan on the proposal → ignore", loanEventFor(null, "t-old", snap({ state: "approved" })) === "ignore");

// #3 — approved for more than asked
const more = loan({ state: "accepted", approvedMinor: 1_500_000 });
check("approved $15,000 for a $10,000 job covers $10,000", coverMinor(more) === 1_000_000);
check("…and reads Paid when $10,000 lands", nextLoanState(more, snap({ state: "paid", fundings: [{ id: "f1", amountMinor: 1_000_000, at }] }), at).state === "paid");

// #2 — an accepted loan takes every open stage; the shortfall is paid after Wisetack pays
const stages = [
  { id: "a", amountMinor: 300_000, status: "UNPAID" },
  { id: "b", amountMinor: 700_000, status: "UNPAID" },
];
const org = { ...EMPTY_ORG_FINANCING, state: "approved" as const, prequalUrl: "https://w/prequal" };
const pf = portalFinancingFrom({ offered: true, signed: true, org, loan: loan({ state: "accepted", approvedMinor: 800_000 }), stages, owedMinor: 1_000_000, monthly: null, money: usd });
check("approved $8,000 of $10,000 (stages $3,000 / $7,000) → both stages wait for the loan, the rest $2,000", pf?.coveredIds.join(",") === "a,b" && pf?.rest === "$2,000", JSON.stringify(pf));
const paidOut = portalFinancingFrom({ offered: true, signed: true, org, loan: loan({ state: "paid", approvedMinor: 800_000, fundings: [{ id: "f", amountMinor: 800_000, at }] }), stages: [{ id: "c", amountMinor: 200_000, status: "UNPAID" }], owedMinor: 200_000, monthly: null, money: usd });
check("after Wisetack pays → nothing held, the $2,000 stage pays as usual", paidOut?.coveredIds.length === 0 && paidOut?.rest === null);

// #6 — Send financing link only where the client can act
const rf = (status: string, prequal: boolean) => rowFinancing({ offered: true, loan: null, canBill: true, status, hasPrequal: prequal, money: usd })?.canSend;
check("a draft or an expired proposal → no Send button", rf("DRAFT", true) === false && rf("EXPIRED", true) === false);
check("sent / viewed with the contractor's prequal link → Send", rf("SENT", true) === true && rf("VIEWED", true) === true);
check("sent without a prequal link → no Send (the client would land on nothing)", rf("SENT", false) === false);
check("signed → Send", rf("ACCEPTED", false) === true && rf("COMPLETED", false) === true);

// #5 — a Wisetack payout is named as one
check("the activity and refund words name Wisetack", providerWord("WISETACK", "financing") === "Wisetack financing" && providerName("WISETACK") === "Wisetack");

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);

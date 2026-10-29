// Wisetack's webhook (lib/financing/state loanSideEffects, 2026-10-28): which office notices and which payouts follow a
// change in a client's loan — each payout settled once, never again for the same funding, nothing for a repeat.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/financing-events.check.ts
import { loanSideEffects, nextLoanState, type Loan, type LoanSnapshot } from "../../../src/lib/financing/state";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra ? `\n     ${extra}` : ""}`);
};

const at = "2026-10-28T12:00:00.000Z";
const loan = (o: Partial<Loan> = {}): Loan => ({ ref: "t1", state: "sent", amountMinor: 2_000_000, approvedMinor: null, fundings: [], url: "u", createdAt: at, expiresAt: null, history: [], nudgedAt: null, ...o });
const snap = (o: Partial<LoanSnapshot> = {}): LoanSnapshot => ({ state: "sent", approvedMinor: null, fundings: [], expiresAt: null, ...o });
const kinds = (fx: ReturnType<typeof loanSideEffects>) => fx.map((f) => `${f.kind}${f.fundings.length ? `:${f.fundings.map((x) => x.id).join("+")}` : ""}`).join(",");

const sent = loan();
const approved = nextLoanState(sent, snap({ state: "approved", approvedMinor: 1_400_000 }), at);
check("sent → approved: the office hears of the approval", kinds(loanSideEffects(sent, approved)) === "approved", kinds(loanSideEffects(sent, approved)));
const accepted = nextLoanState(approved, snap({ state: "accepted" }), at);
check("approved → accepted: the office hears the loan was accepted", kinds(loanSideEffects(approved, accepted)) === "accepted");
const f1 = { id: "f1", amountMinor: 700_000, at };
const half = nextLoanState(accepted, snap({ state: "paid", fundings: [f1] }), at);
check("a half payout: one part payment with that funding", kinds(loanSideEffects(accepted, half)) === "paid_part:f1", kinds(loanSideEffects(accepted, half)));
const full = nextLoanState(half, snap({ state: "paid", fundings: [f1, { id: "f2", amountMinor: 700_000, at }] }), at);
check("the rest paid: 'paid' with the new funding only — f1 is not paid twice", kinds(loanSideEffects(half, full)) === "paid:f2", kinds(loanSideEffects(half, full)));
check("the same word again: nothing", kinds(loanSideEffects(full, nextLoanState(full, snap({ state: "paid", fundings: [f1] }), at))) === "");
check("declined: the office hears it", kinds(loanSideEffects(sent, nextLoanState(sent, snap({ state: "declined" }), at))) === "declined");
check("expired: the office hears it", kinds(loanSideEffects(accepted, nextLoanState(accepted, snap({ state: "expired" }), at))) === "expired");
const oneGo = nextLoanState(accepted, snap({ state: "paid", fundings: [{ id: "f9", amountMinor: 1_400_000, at }] }), at);
check("paid in one go: one 'paid' carrying that funding", kinds(loanSideEffects(accepted, oneGo)) === "paid:f9");

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);

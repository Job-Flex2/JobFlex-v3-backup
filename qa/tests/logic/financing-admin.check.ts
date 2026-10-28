// JobFlex's financing board (lib/financing/view boardSummary, 2026-10-28): contractors and loans counted by state,
// the money Wisetack actually paid out, and JobFlex's share only from the agreement's rate — never guessed.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/financing-admin.check.ts
import { EMPTY_ORG_FINANCING, type Loan, type OrgFinancing } from "../../../src/lib/financing/state";
import { boardSummary, pilotFromText } from "../../../src/lib/financing/view";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra ? `\n     ${extra}` : ""}`);
};

const org = (state: OrgFinancing["state"]) => ({ rec: { ...EMPTY_ORG_FINANCING, state } });
const loan = (state: Loan["state"]): Loan => ({ ref: "t", state, amountMinor: 100, approvedMinor: null, fundings: [], url: "", createdAt: "", expiresAt: null, history: [], nudgedAt: null });

const b = boardSummary([org("approved"), org("approved"), org("review"), org("declined")], [loan("accepted"), loan("paid"), loan("paid"), loan("declined")], 2_800_000, 150);
check("contractors by state", b.byState.approved === 2 && b.byState.review === 1 && b.byState.declined === 1 && b.byState.none === 0, JSON.stringify(b.byState));
check("loans by state", b.loansByState.paid === 2 && b.loansByState.accepted === 1 && b.loansByState.declined === 1 && b.loansByState.sent === 0);
check("paid out as measured; the share from the agreement's rate (1.5% of $28,000 = $420)", b.paidCents === 2_800_000 && b.shareCents === 42_000);
check("no agreement rate → no share figure", boardSummary([], [], 2_800_000, null).shareCents === null);
check("rounded to the cent", boardSummary([], [], 333, 150).shareCents === 5);

const t = pilotFromText("a@x.com, B@Y.com\n  c@z.com ; not-an-email  a@x.com");
check("pilot emails: split on commas, spaces, lines; lower case; duplicates once; junk dropped", JSON.stringify(t) === JSON.stringify(["a@x.com", "b@y.com", "c@z.com"]), JSON.stringify(t));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);

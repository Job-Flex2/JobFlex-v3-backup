// Wisetack financing (lib/financing/state, 2026-10-28): the pure rules — who may offer it, what a proposal's switch
// does, how a loan moves through its states (never backwards, each funding once), which stages a loan covers, when
// the office is reminded.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/financing-rules.check.ts
import {
  EMPTY_ORG_FINANCING,
  coverMinor,
  coveredStageIds,
  fundedMinor,
  nextLoanState,
  offerFor,
  orgLetIn,
  parseLoan,
  parseOrgFinancing,
  parseSwitch,
  readiness,
  reminderDue,
  restMinor,
  reuseLoan,
  type Loan,
  type LoanSnapshot,
  type OrgFinancing,
} from "../../../src/lib/financing/state";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra ? `\n     ${extra}` : ""}`);
};

const at = "2026-10-28T12:00:00.000Z";
const now = new Date(at);
const days = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();
const loan = (o: Partial<Loan> = {}): Loan => ({
  ref: "t1",
  state: "sent",
  amountMinor: 2_000_000,
  approvedMinor: null,
  fundings: [],
  url: "https://wisetack.example/apply/t1",
  createdAt: at,
  expiresAt: null,
  history: [{ state: "sent", at }],
  nudgedAt: null,
  ...o,
});
const snap = (o: Partial<LoanSnapshot> = {}): LoanSnapshot => ({ state: "sent", approvedMinor: null, fundings: [], expiresAt: null, ...o });
const approvedOrg: OrgFinancing = { ...EMPTY_ORG_FINANCING, merchantRef: "m1", state: "approved", minMinor: 50_000, maxMinor: 6_500_000, feeBps: 390 };

// ---- parsing ----
check("an empty or broken record reads as nothing set up, offering on by default", JSON.stringify(parseOrgFinancing(null)) === JSON.stringify(EMPTY_ORG_FINANCING) && JSON.stringify(parseOrgFinancing("{nope")) === JSON.stringify(EMPTY_ORG_FINANCING) && EMPTY_ORG_FINANCING.state === "none" && EMPTY_ORG_FINANCING.offerByDefault === true);
check("a stored record keeps its fields; a missing default reads as on", (() => {
  const r = parseOrgFinancing(JSON.stringify({ merchantRef: "m9", state: "review", needs: ["Bank account"], minMinor: 50_000 }));
  return r.merchantRef === "m9" && r.state === "review" && r.needs.length === 1 && r.minMinor === 50_000 && r.offerByDefault === true && r.maxMinor === null;
})());
check("an unknown state reads as none", parseOrgFinancing(JSON.stringify({ state: "bogus" })).state === "none");
check("a loan record round-trips; junk is null", parseLoan(JSON.stringify(loan()))?.ref === "t1" && parseLoan("x") === null && parseLoan(JSON.stringify({ ref: "" })) === null);

// ---- the admin switch ----
check("the switch is off when never set", JSON.stringify(parseSwitch(undefined)) === JSON.stringify({ mode: "off", pilot: [] }) && JSON.stringify(parseSwitch("junk")) === JSON.stringify({ mode: "off", pilot: [] }));
check("pilot lets in only the listed accounts; everyone lets all in; off lets none", orgLetIn({ mode: "pilot", pilot: ["o1"] }, "o1") && !orgLetIn({ mode: "pilot", pilot: ["o1"] }, "o2") && orgLetIn({ mode: "all", pilot: [] }, "o2") && !orgLetIn({ mode: "off", pilot: ["o1"] }, "o1"));

// ---- offerFor ----
const base = { letIn: true, org: approvedOrg, proposalOn: null as boolean | null, owedMinor: 1_200_000, status: "SENT", planEnded: false };
const why = (o: Partial<typeof base>) => {
  const r = offerFor({ ...base, ...o });
  return r.offered ? "offered" : r.why;
};
check("an approved contractor, the default on, $12,000 owed → offered", why({}) === "offered");
check("not let in by the admin switch → not_open (before anything else)", why({ letIn: false, org: EMPTY_ORG_FINANCING }) === "not_open");
check("never applied → not_set_up", why({ org: EMPTY_ORG_FINANCING }) === "not_set_up");
check("started / under review / needs info → waiting", ["started", "review", "needs_info"].every((s) => why({ org: { ...approvedOrg, state: s as OrgFinancing["state"] } }) === "waiting"));
check("declined → declined; paused → paused", why({ org: { ...approvedOrg, state: "declined" } }) === "declined" && why({ org: { ...approvedOrg, state: "paused" } }) === "paused");
check("plan ended → plan_ended (before paid)", why({ planEnded: true, status: "PAID" }) === "plan_ended");
check("a paid proposal → paid", why({ status: "PAID" }) === "paid");
check("nothing owed → nothing_owed", why({ owedMinor: 0 }) === "nothing_owed");
check("the proposal's switch off → off", why({ proposalOn: false }) === "off");
check("the default off and the proposal following it → off; the proposal on overrides it", why({ org: { ...approvedOrg, offerByDefault: false } }) === "off" && why({ org: { ...approvedOrg, offerByDefault: false }, proposalOn: true }) === "offered");
check("under the minimum → under_min; over the maximum → over_max", why({ owedMinor: 49_999 }) === "under_min" && why({ owedMinor: 6_500_001 }) === "over_max");
check("no limits on file → no limit check", why({ org: { ...approvedOrg, minMinor: null, maxMinor: null }, owedMinor: 10 }) === "offered");

// ---- readiness ----
const full = { name: "Summit Ridge Roofing", phone: "+15551230000", email: "office@summit.example", address: "12 Main St, Provo, UT 84601", website: "https://summit.example", trade: "roofing", yearStarted: 2015 };
const r1 = readiness(full);
check("everything on file → 7 of 7", r1.ready === 7 && r1.total === 7 && r1.items.map((i) => i.key).join(",") === "name,phone,email,address,website,trade,year");
const r2 = readiness({ ...full, website: null, yearStarted: null });
check("no website, no year → 5 of 7, those two not ok", r2.ready === 5 && r2.items.filter((i) => !i.ok).map((i) => i.key).join(",") === "website,year");
check("blank strings and a silly year are not ok", readiness({ ...full, phone: "  ", yearStarted: 1700 }).ready === 5);

// ---- nextLoanState ----
const a1 = nextLoanState(loan(), snap({ state: "approved", approvedMinor: 1_400_000 }), at);
check("sent → approved keeps the approved amount and writes history", a1.state === "approved" && a1.approvedMinor === 1_400_000 && a1.history.length === 2 && a1.history[1].state === "approved");
const acc = loan({ state: "accepted", approvedMinor: 1_400_000 });
check("accepted never goes back to approved", nextLoanState(acc, snap({ state: "approved", approvedMinor: 1_400_000 }), at).state === "accepted");
const f1 = { id: "f1", amountMinor: 700_000, at };
const once = nextLoanState(nextLoanState(acc, snap({ state: "paid", fundings: [f1] }), at), snap({ state: "paid", fundings: [f1] }), at);
check("the same funding twice is kept once; a part funding stays accepted", once.fundings.length === 1 && fundedMinor(once) === 700_000 && once.state === "accepted", JSON.stringify(once));
const full2 = nextLoanState(once, snap({ state: "paid", fundings: [f1, { id: "f2", amountMinor: 700_000, at }] }), at);
check("fundings reaching what the loan covers → paid", full2.state === "paid" && fundedMinor(full2) === 1_400_000);
check("declined after paid is ignored; refunded after paid is taken", nextLoanState(full2, snap({ state: "declined" }), at).state === "paid" && nextLoanState(full2, snap({ state: "refunded" }), at).state === "refunded");
check("a declined loan stays declined", nextLoanState(loan({ state: "declined" }), snap({ state: "approved", approvedMinor: 5 }), at).state === "declined");
check("done_asked holds against an accepted snapshot", nextLoanState(loan({ state: "done_asked", approvedMinor: 1_400_000 }), snap({ state: "accepted" }), at).state === "done_asked");
check("what a loan covers: nothing before approval; the approved amount after", coverMinor(loan()) === 0 && coverMinor(acc) === 1_400_000 && coverMinor(loan({ state: "accepted" })) === 2_000_000);

// ---- covered stages and the rest ----
const stages = [
  { id: "a", amountMinor: 600_000, status: "UNPAID" },
  { id: "b", amountMinor: 1_400_000, status: "UNPAID" },
];
check("$14,000 covers the last stage", coveredStageIds(stages, 1_400_000).join(",") === "b");
check("$20,000 covers both, in order", coveredStageIds(stages, 2_000_000).join(",") === "a,b");
check("$15,000 covers the last stage only (no half stages)", coveredStageIds(stages, 1_500_000).join(",") === "b");
check("a paid stage is skipped", coveredStageIds([{ ...stages[0], status: "PAID" }, stages[1]], 2_000_000).join(",") === "b");
check("the rest: $20,000 owed, $14,000 accepted → $6,000", restMinor(2_000_000, acc) === 600_000);
check("the rest with no loan or a declined loan is all of it", restMinor(2_000_000, null) === 2_000_000 && restMinor(2_000_000, loan({ state: "declined", approvedMinor: 1_400_000 })) === 2_000_000);
check("the rest after a funding counts only what is still to come", restMinor(1_300_000, { ...acc, fundings: [f1] }) === 600_000);

// ---- reuse ----
check("no loan → make one", !reuseLoan(null, 2_000_000, now));
check("an open loan for the same amount is reused", ["sent", "started", "approved"].every((s) => reuseLoan(loan({ state: s as Loan["state"] }), 2_000_000, now)));
check("an open loan for another amount is not", !reuseLoan(loan({ state: "approved" }), 2_100_000, now));
check("an accepted loan is always kept", reuseLoan(loan({ state: "accepted" }), 2_100_000, now));
check("declined / expired / canceled / past its date → make a new one", ["declined", "expired", "canceled"].every((s) => !reuseLoan(loan({ state: s as Loan["state"] }), 2_000_000, now)) && !reuseLoan(loan({ expiresAt: days(-1) }), 2_000_000, now));

// ---- reminders ----
const approved3 = loan({ state: "approved", approvedMinor: 1_400_000, history: [{ state: "sent", at: days(-4) }, { state: "approved", at: days(-3) }] });
check("approved 3 days ago, never nudged → accept_nudge", reminderDue(approved3, now) === "accept_nudge");
check("approved 1 day ago → nothing yet", reminderDue({ ...approved3, history: [{ state: "approved", at: days(-1) }] }, now) === null);
check("nudged already → nothing", reminderDue({ ...approved3, nudgedAt: days(-1) }, now) === null);
check("accepted, approval ends in 6 days → expiring", reminderDue(loan({ state: "accepted", expiresAt: days(6) }), now) === "expiring");
check("expiring and told yesterday → nothing", reminderDue(loan({ state: "accepted", expiresAt: days(6), nudgedAt: days(-1) }), now) === null);
check("an old accept nudge does not stop the expiring one", reminderDue(loan({ state: "accepted", expiresAt: days(6), nudgedAt: days(-20) }), now) === "expiring");
check("paid → nothing", reminderDue(loan({ state: "paid", expiresAt: days(2) }), now) === null);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);

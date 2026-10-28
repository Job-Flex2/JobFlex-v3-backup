// WISETACK FINANCING — the rules (owner, 2026-10-28: "make it super smart where they can set it up and get the
// approval … each proposal can have the button that apply for financing and in the proposal you should have a switch
// in the contractor side"). Wisetack approves the contractor once and each client per job; Wisetack's lending partners
// lend; the contractor is paid in full when the client confirms the job is done. JobFlex keeps the states, never a
// client's credit.
//
// Pure: settings panes, the editor, both portal trees, the webhook and the checks share it. Wisetack's own status
// names are mapped onto these in ./wisetack.ts — the one file that changes when Wisetack's partner docs arrive.
// Spec: docs/superpowers/specs/2026-10-28-wisetack-financing-design.md

export type MerchantState = "none" | "started" | "review" | "needs_info" | "approved" | "declined" | "paused";
export type LoanState =
  | "sent"
  | "started"
  | "needs_action"
  | "approved"
  | "accepted"
  | "done_asked"
  | "paid"
  | "declined"
  | "expired"
  | "canceled"
  | "refunded";

const MERCHANT_STATES: readonly MerchantState[] = ["none", "started", "review", "needs_info", "approved", "declined", "paused"];
const LOAN_STATES: readonly LoanState[] = ["sent", "started", "needs_action", "approved", "accepted", "done_asked", "paid", "declined", "expired", "canceled", "refunded"];

/** The contractor's record — SyncState `financing:<orgId>`. */
export type OrgFinancing = {
  merchantRef: string | null;
  state: MerchantState;
  appliedAt: string | null;
  decidedAt: string | null;
  /** What Wisetack asked for, in its words (needs_info). */
  needs: string[];
  note: string | null;
  /** Wisetack's per-merchant job limits and fee — never hard-coded. */
  minMinor: number | null;
  maxMinor: number | null;
  feeBps: number | null;
  /** The contractor's general "check your rate" link. */
  prequalUrl: string | null;
  /** Wisetack's application page, to finish an application that is started or needs more. */
  applyUrl: string | null;
  /** "Offer monthly payments on every new proposal". */
  offerByDefault: boolean;
  yearStarted: number | null;
  checkedAt: string | null;
};

export const EMPTY_ORG_FINANCING: OrgFinancing = {
  merchantRef: null,
  state: "none",
  appliedAt: null,
  decidedAt: null,
  needs: [],
  note: null,
  minMinor: null,
  maxMinor: null,
  feeBps: null,
  prequalUrl: null,
  applyUrl: null,
  offerByDefault: true,
  yearStarted: null,
  checkedAt: null,
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const json = (raw: string | null | undefined): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export function parseOrgFinancing(raw: string | null | undefined): OrgFinancing {
  const o = json(raw);
  if (!o) return { ...EMPTY_ORG_FINANCING };
  return {
    merchantRef: str(o.merchantRef),
    state: MERCHANT_STATES.includes(o.state as MerchantState) ? (o.state as MerchantState) : "none",
    appliedAt: str(o.appliedAt),
    decidedAt: str(o.decidedAt),
    needs: Array.isArray(o.needs) ? o.needs.filter((n): n is string => typeof n === "string" && !!n.trim()).slice(0, 20) : [],
    note: str(o.note),
    minMinor: num(o.minMinor),
    maxMinor: num(o.maxMinor),
    feeBps: num(o.feeBps),
    prequalUrl: str(o.prequalUrl),
    applyUrl: str(o.applyUrl),
    offerByDefault: o.offerByDefault !== false,
    yearStarted: num(o.yearStarted),
    checkedAt: str(o.checkedAt),
  };
}

export type Funding = { id: string; amountMinor: number; at: string };

/** One client loan per proposal — SyncState `financingLoan:<proposalId>`. */
export type Loan = {
  ref: string;
  state: LoanState;
  /** What was asked for: the amount owed when the client pressed Pay over time. */
  amountMinor: number;
  approvedMinor: number | null;
  /** Wisetack's payouts to the contractor — more than one with progress payments. */
  fundings: Funding[];
  url: string;
  createdAt: string;
  expiresAt: string | null;
  history: { state: LoanState; at: string }[];
  /** The office's last reminder about this loan. */
  nudgedAt: string | null;
};

export function parseLoan(raw: string | null | undefined): Loan | null {
  const o = json(raw);
  const ref = o ? str(o.ref) : null;
  if (!o || !ref) return null;
  const state = LOAN_STATES.includes(o.state as LoanState) ? (o.state as LoanState) : "sent";
  const fundings = Array.isArray(o.fundings)
    ? o.fundings
        .map((f) => (f && typeof f === "object" ? (f as Record<string, unknown>) : null))
        .filter((f): f is Record<string, unknown> => !!f && !!str(f.id) && num(f.amountMinor) !== null)
        .map((f) => ({ id: String(f.id), amountMinor: Number(f.amountMinor), at: str(f.at) ?? "" }))
    : [];
  const history = Array.isArray(o.history)
    ? o.history
        .map((h) => (h && typeof h === "object" ? (h as Record<string, unknown>) : null))
        .filter((h): h is Record<string, unknown> => !!h && LOAN_STATES.includes(h.state as LoanState))
        .map((h) => ({ state: h.state as LoanState, at: str(h.at) ?? "" }))
    : [];
  return {
    ref,
    state,
    amountMinor: num(o.amountMinor) ?? 0,
    approvedMinor: num(o.approvedMinor),
    fundings,
    url: str(o.url) ?? "",
    createdAt: str(o.createdAt) ?? "",
    expiresAt: str(o.expiresAt),
    history,
    nudgedAt: str(o.nudgedAt),
  };
}

// The forward order a loan walks; the finals sit outside it.
const RANK: Partial<Record<LoanState, number>> = { sent: 0, started: 1, needs_action: 2, approved: 3, accepted: 4, done_asked: 5, paid: 6 };
const STOPPED: readonly LoanState[] = ["declined", "expired", "canceled", "refunded"];
const rank = (s: LoanState) => RANK[s] ?? -1;

export function fundedMinor(l: Loan): number {
  return l.fundings.reduce((n, f) => n + f.amountMinor, 0);
}

/** What the loan pays for: nothing until the client is approved, then the approved amount — never more than was
 *  asked (a client approved for more than the job still owes only the job). */
export function coverMinor(l: Loan): number {
  return rank(l.state) >= RANK.approved! ? Math.min(l.approvedMinor ?? l.amountMinor, l.amountMinor) : 0;
}

/** Still to come from Wisetack on a loan the client accepted (0 before that). */
function committedMinor(l: Loan | null): number {
  if (!l || rank(l.state) < RANK.accepted!) return 0;
  return Math.max(0, coverMinor(l) - fundedMinor(l));
}

export type FinancingSwitch = { mode: "off" | "pilot" | "all"; pilot: string[] };

export function parseSwitch(raw: string | null | undefined): FinancingSwitch {
  const o = json(raw);
  const mode = o && (o.mode === "pilot" || o.mode === "all") ? o.mode : "off";
  const pilot = o && Array.isArray(o.pilot) ? o.pilot.filter((p): p is string => typeof p === "string" && !!p) : [];
  return { mode, pilot };
}

export function orgLetIn(sw: FinancingSwitch, orgId: string): boolean {
  return sw.mode === "all" || (sw.mode === "pilot" && sw.pilot.includes(orgId));
}

export type LockReason =
  | "not_open"
  | "not_set_up"
  | "waiting"
  | "declined"
  | "paused"
  | "off"
  | "under_min"
  | "over_max"
  | "paid"
  | "nothing_owed"
  | "plan_ended";

export type Offer = { offered: true } | { offered: false; why: LockReason };

/** Whether this proposal offers Pay over time, or the one reason it does not. */
export function offerFor(i: { letIn: boolean; org: OrgFinancing; proposalOn: boolean | null; owedMinor: number; status: string; planEnded: boolean }): Offer {
  const no = (why: LockReason): Offer => ({ offered: false, why });
  if (!i.letIn) return no("not_open");
  const s = i.org.state;
  if (s === "none") return no("not_set_up");
  if (s === "started" || s === "review" || s === "needs_info") return no("waiting");
  if (s === "declined") return no("declined");
  if (s === "paused") return no("paused");
  if (i.planEnded) return no("plan_ended");
  if (i.status === "PAID") return no("paid");
  if (i.owedMinor <= 0) return no("nothing_owed");
  if (!(i.proposalOn ?? i.org.offerByDefault)) return no("off");
  if (i.org.minMinor !== null && i.owedMinor < i.org.minMinor) return no("under_min");
  if (i.org.maxMinor !== null && i.owedMinor > i.org.maxMinor) return no("over_max");
  return { offered: true };
}

export type ReadinessItem = { key: "name" | "phone" | "email" | "address" | "website" | "trade" | "year"; ok: boolean };

/** What lenders usually look at, from what JobFlex has on file — guidance, never a promise. */
export function readiness(f: {
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  trade: string | null;
  yearStarted: number | null;
}): { items: ReadinessItem[]; ready: number; total: number } {
  const has = (v: string | null) => !!v && !!v.trim();
  const thisYear = new Date().getFullYear();
  const items: ReadinessItem[] = [
    { key: "name", ok: has(f.name) },
    { key: "phone", ok: has(f.phone) },
    { key: "email", ok: has(f.email) },
    { key: "address", ok: has(f.address) },
    { key: "website", ok: has(f.website) },
    { key: "trade", ok: has(f.trade) },
    { key: "year", ok: f.yearStarted !== null && f.yearStarted >= 1900 && f.yearStarted <= thisYear },
  ];
  return { items, ready: items.filter((i) => i.ok).length, total: items.length };
}

/** What Wisetack says about a loan right now (a webhook or a read). */
export type LoanSnapshot = { state: LoanState; approvedMinor: number | null; fundings: Funding[]; expiresAt: string | null };

/** The loan after Wisetack's latest word: never backwards, each funding once, paid only when paid in full. */
export function nextLoanState(l: Loan, s: LoanSnapshot, at: string): Loan {
  if (l.state === "refunded" || l.state === "declined" || l.state === "expired" || l.state === "canceled") return l;

  const fundings = [...l.fundings];
  for (const f of s.fundings) if (!fundings.some((g) => g.id === f.id)) fundings.push(f);
  const merged: Loan = {
    ...l,
    approvedMinor: s.approvedMinor ?? l.approvedMinor,
    expiresAt: s.expiresAt ?? l.expiresAt,
    fundings,
  };

  let state: LoanState = l.state;
  if (l.state === "paid") {
    if (s.state === "refunded") state = "refunded";
  } else if (STOPPED.includes(s.state)) {
    state = s.state;
  } else if (s.state === "paid") {
    // Wisetack's word for a payout; a progress payment is not the whole loan.
    state = rank(l.state) >= RANK.accepted! ? l.state : "accepted";
  } else if (rank(s.state) > rank(l.state)) {
    state = s.state;
  }
  if (!STOPPED.includes(state) && state !== "paid" && rank(state) >= RANK.accepted! && coverMinor({ ...merged, state }) > 0 && fundedMinor(merged) >= coverMinor({ ...merged, state })) {
    state = "paid";
  }
  return state === l.state ? merged : { ...merged, state, history: [...l.history, { state, at }] };
}

/** The stages a loan pays for: whole stages from the end of the schedule while the loan still covers them. */
export function coveredStageIds(stages: { id: string; amountMinor: number; status: string }[], coverLeftMinor: number): string[] {
  const out = new Set<string>();
  let left = coverLeftMinor;
  for (let i = stages.length - 1; i >= 0; i--) {
    const s = stages[i];
    if (s.status === "PAID" || s.status === "WAIVED") continue;
    if (s.amountMinor > left) break;
    out.add(s.id);
    left -= s.amountMinor;
  }
  return stages.filter((s) => out.has(s.id)).map((s) => s.id);
}

/** Owed that the loan will not pay — paid the usual way. */
export function restMinor(owedMinor: number, l: Loan | null): number {
  return Math.max(0, owedMinor - committedMinor(l));
}

/** Pressing Pay over time again: keep the live loan, or make a new one. */
export function reuseLoan(l: Loan | null, owedMinor: number, now: Date): boolean {
  if (!l) return false;
  if (l.state === "paid" || STOPPED.includes(l.state)) return false;
  if (l.expiresAt && Date.parse(l.expiresAt) <= now.getTime()) return false;
  if (rank(l.state) >= RANK.accepted!) return true;
  return l.amountMinor === owedMinor;
}

const DAY = 86_400_000;

/** The office's reminders: a client approved 3 days ago who has not accepted; an approval ending within 7 days. */
export function reminderDue(l: Loan, now: Date): "accept_nudge" | "expiring" | null {
  const t = now.getTime();
  if (l.state === "approved" && !l.nudgedAt) {
    const approvedAt = [...l.history].reverse().find((h) => h.state === "approved")?.at;
    if (approvedAt && t - Date.parse(approvedAt) >= 3 * DAY) return "accept_nudge";
    return null;
  }
  if ((l.state === "approved" || l.state === "accepted" || l.state === "done_asked") && l.expiresAt) {
    const ends = Date.parse(l.expiresAt);
    const windowOpens = ends - 7 * DAY;
    if (t >= windowOpens && t < ends && !(l.nudgedAt && Date.parse(l.nudgedAt) >= windowOpens)) return "expiring";
  }
  return null;
}

export type LoanEffect = { kind: "approved" | "accepted" | "declined" | "expired" | "paid_part" | "paid"; fundings: Funding[] };

/** What follows a change in a client's loan: the office's notices, and each new payout to settle — once. */
export function loanSideEffects(before: Loan, after: Loan): LoanEffect[] {
  const out: LoanEffect[] = [];
  const fresh = after.fundings.filter((f) => !before.fundings.some((g) => g.id === f.id));
  const changed = after.state !== before.state;
  if (after.state === "paid" && (changed || fresh.length)) out.push({ kind: "paid", fundings: fresh });
  else if (fresh.length) out.push({ kind: "paid_part", fundings: fresh });
  if (changed && (after.state === "approved" || after.state === "accepted" || after.state === "declined" || after.state === "expired")) {
    out.push({ kind: after.state, fundings: [] });
  }
  return out;
}

/** Wisetack's word on a loan the proposal no longer tracks (the client applied again; two tabs raced) never touches the
 *  current loan — but a payout on it is real money and still lands. */
export function loanEventFor(current: Loan | null, ref: string, s: LoanSnapshot): "apply" | "stale_settle" | "ignore" {
  if (!current) return "ignore";
  if (current.ref === ref) return "apply";
  return s.fundings.length ? "stale_settle" : "ignore";
}

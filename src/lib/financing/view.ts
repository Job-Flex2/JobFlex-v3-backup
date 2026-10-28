// WISETACK FINANCING — what each surface shows, from the rules (./state) and the words (./words): the editor's
// switch, the client's page, the proposals row, the admin board. Pure; one place so the surfaces cannot disagree.

import { coverMinor, coveredStageIds, fundedMinor, offerFor, restMinor, type Loan, type LoanState, type Offer, type OrgFinancing } from "./state";
import { FIN, clientLoanWords, loanLine } from "./words";

type Money = (minor: number) => string;

export type EditorFinancing = {
  proposalId: string;
  /** What the switch shows: the proposal's own choice, else the company's default. */
  on: boolean;
  followsDefault: boolean;
  offer: Offer;
  preview: string;
  loanLine: string | null;
  /** The loan and the total no longer match (a change order, a price edit). */
  notice: string | null;
  limits: { minMinor: number | null; maxMinor: number | null };
};

const LIVE_OR_DONE = new Set(["accepted", "done_asked", "paid"]);

export function editorFinancing(i: {
  proposalId: string;
  letIn: boolean;
  org: OrgFinancing;
  proposalOn: boolean | null;
  owedMinor: number;
  status: string;
  planEnded: boolean;
  loan: Loan | null;
  money: Money;
}): EditorFinancing | null {
  if (!i.letIn && !i.loan) return null;
  const cover = i.loan ? coverMinor(i.loan) : 0;
  const total = i.owedMinor + (i.loan ? fundedMinor(i.loan) : 0);
  const notice =
    i.loan && LIVE_OR_DONE.has(i.loan.state) && cover > 0 && total !== cover
      ? `The client's loan is for ${i.money(cover)}; the new total is ${i.money(total)} — the difference is paid another way, or send a new financing link.`
      : null;
  return {
    proposalId: i.proposalId,
    on: i.proposalOn ?? i.org.offerByDefault,
    followsDefault: i.proposalOn === null,
    offer: offerFor(i),
    preview: FIN.proposalPreview,
    loanLine: i.loan ? loanLine(i.loan, i.money) : null,
    notice,
    limits: { minMinor: i.org.minMinor, maxMinor: i.org.maxMinor },
  };
}

/** The client's page: Pay over time, what they qualify for before signing, or where their loan stands. */
export type PortalFinancing = {
  mode: "prequal" | "apply" | "status";
  prequalUrl: string | null;
  loan: { state: LoanState; title: string; sub: string; url: string | null } | null;
  /** Stages the accepted loan pays — their card/bank buttons give way to the loan line. */
  coveredIds: string[];
  covered: string | null;
  /** What the loan does not pay, paid the usual way. */
  rest: string | null;
  /** Wisetack's own monthly wording, or null. */
  monthly: string | null;
  disclosure: string;
};

const DEAD: readonly LoanState[] = ["declined", "expired", "canceled"];
const ON_WISETACK: readonly LoanState[] = ["sent", "started", "needs_action", "approved"];
const COMMITTED: readonly LoanState[] = ["accepted", "done_asked"];

export function portalFinancingFrom(i: {
  offered: boolean;
  signed: boolean;
  org: OrgFinancing;
  loan: Loan | null;
  stages: { id: string; amountMinor: number; status: string }[];
  owedMinor: number;
  monthly: string | null;
  money: Money;
}): PortalFinancing | null {
  const words = i.loan ? clientLoanWords(i.loan, i.money) : null;
  const loanView = i.loan && words ? { state: i.loan.state, ...words, url: ON_WISETACK.includes(i.loan.state) && i.loan.url ? i.loan.url : null } : null;
  const base = { prequalUrl: i.org.prequalUrl, monthly: i.monthly, disclosure: FIN.disclosure, coveredIds: [] as string[], covered: null, rest: null };

  if (i.loan && !DEAD.includes(i.loan.state)) {
    const committed = COMMITTED.includes(i.loan.state);
    const left = committed ? coverMinor(i.loan) - fundedMinor(i.loan) : 0;
    const rest = committed ? restMinor(i.owedMinor, i.loan) : 0;
    return {
      ...base,
      mode: "status",
      loan: loanView,
      coveredIds: committed ? coveredStageIds(i.stages, left) : [],
      covered: committed && left > 0 ? FIN.coveredLine(i.money(left)) : null,
      rest: committed && rest > 0 ? i.money(rest) : null,
    };
  }
  if (!i.offered) return null;
  if (!i.signed) return i.org.prequalUrl ? { ...base, mode: "prequal", loan: null } : null;
  return { ...base, mode: "apply", loan: loanView };
}

// WISETACK FINANCING — what each surface shows, from the rules (./state) and the words (./words): the editor's
// switch, the client's page, the proposals row, the admin board. Pure; one place so the surfaces cannot disagree.

import { coverMinor, fundedMinor, offerFor, type Loan, type Offer, type OrgFinancing } from "./state";
import { FIN, loanLine } from "./words";

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

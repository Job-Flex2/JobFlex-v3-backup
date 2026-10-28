// The client-facing payment view of a proposal: which stages exist, which is
// payable next, what "pay remaining" means, and which buttons this contractor
// can offer. Built ONCE on the server by both portal entry points (desktop
// /portal/q and the handheld route) so the two trees cannot disagree, and
// serialisable so the client components just render it.
import type { PaymentConnection } from "@prisma/client";
import { getStripeMode } from "@/lib/stripeMode";
import { contractSchedule, type ContractCo } from "@/lib/contractTotal";
import { parsePaymentSettings } from "@/lib/settings";
import {
  fromMinor,
  isBelowMin,
  resolveSchedule,
  stageShare,
  type StageInput,
} from "@/lib/paymentSchedule";
import { resolvePayOptions, type PayBlockReason } from "./payOptions";
import { portalFinancing } from "@/lib/financing/service";
import type { PortalFinancing } from "@/lib/financing/view";

export type PortalStage = {
  id: string;
  /** "01", "02", … */
  no: string;
  label: string;
  /** "40%" or "" for a fixed stage. */
  share: string;
  amount: string;
  amountMinor: number;
  status: "UNPAID" | "PENDING" | "PAID" | "WAIVED";
  paidOn: string | null;
  /** The earliest open stage — the only one with buttons. Says nothing about
   *  the proposal's status: the trees gate on acceptance themselves (they know
   *  about an accept that is still in flight), and the checkout refuses an
   *  unaccepted proposal on the server (lib/payments/createCheckout). */
  payable: boolean;
  belowMin: { stripe: boolean; square: boolean; stax: boolean };
  /** No DB row (implicit full-payment / balance line). */
  synthetic: boolean;
  /** Paid by the client's accepted Wisetack loan — no card/bank buttons (lib/financing). */
  financed?: boolean;
};

export type PortalPayModel = {
  publicId: string;
  /** Proposal.status at render time. */
  status: string;
  stages: PortalStage[];
  paid: string;
  paidMinor: number;
  remaining: string;
  remainingMinor: number;
  /** Money owed that no stage is holding (under-scheduled). */
  balance: string;
  balanceMinor: number;
  nextPayableId: string | null;
  /** More than one thing left to pay → offer "pay everything". */
  showRemaining: boolean;
  providers: {
    stripe: { ok: boolean; reason?: PayBlockReason; ach: boolean };
    square: { ok: boolean; reason?: PayBlockReason };
    stax: { ok: boolean; reason?: PayBlockReason };
  };
  bankTransfer: { ok: boolean; instructions: string };
  anyHosted: boolean;
  /** Anything a client can act on: a hosted button or bank details. */
  anyWay: boolean;
  /** Pay over time through Wisetack (lib/financing): the button, what they qualify for, or where the loan stands. */
  financing: PortalFinancing | null;
};

type ProposalLike = {
  /** Present on every caller's row; financing reads the proposal by it. */
  id?: string;
  organizationId?: string;
  status: string;
  total: number;
  currency: string;
  /** Approved change orders — the contract value is total + these (lib/contractTotal). */
  changeOrders: ContractCo[];
  installments: Array<
    StageInput & { paidAt?: Date | null; status?: string | null; paidAmount?: number | null }
  >;
};

type OrgLike = {
  paymentSettingsJson: string | null;
  paymentConnections: PaymentConnection[];
};

export async function buildPortalPayModel(
  publicId: string,
  proposal: ProposalLike,
  org: OrgLike,
  fmt: { money: (n: number) => string; longDate: (d: Date | null | undefined) => string },
): Promise<PortalPayModel> {
  const mode = await getStripeMode();
  const settings = parsePaymentSettings(org.paymentSettingsJson);
  const options = resolvePayOptions({
    settings,
    stripeConn: org.paymentConnections.find((c) => c.provider === "STRIPE") ?? null,
    squareConn: org.paymentConnections.find((c) => c.provider === "SQUARE") ?? null,
    staxConn: org.paymentConnections.find((c) => c.provider === "STAX") ?? null,
    proposalCurrency: proposal.currency,
    stripeMode: mode,
  });
  const schedule = resolveSchedule({
    ...contractSchedule(proposal.total, proposal.changeOrders),
    currency: proposal.currency,
    installments: proposal.installments,
  });
  const paidAtById = new Map(proposal.installments.map((i) => [i.id, i.paidAt ?? null]));

  // Whether the client may ACT is not decided here. Both trees flip to
  // "accepted" the instant the client taps Accept — before the accept POST
  // (which waits on two emails) returns and before router.refresh() brings a
  // re-rendered model — so a status gate in this model left the deposit with
  // no pay button for the seconds that matter most (owner, on a phone,
  // 2026-09-14). The trees gate on their own settled state; the checkout
  // route refuses anything not ACCEPTED/COMPLETED regardless.
  const stages: PortalStage[] = schedule.stages.map((s, i) => ({
    id: s.id,
    no: String(i + 1).padStart(2, "0"),
    label: s.label,
    share: stageShare(s, schedule.totalMinor),
    amount: fmt.money(fromMinor(s.amountMinor)),
    amountMinor: s.amountMinor,
    status: s.status,
    paidOn: s.status === "PAID" ? fmt.longDate(paidAtById.get(s.id) ?? null) || null : null,
    payable: s.payable,
    belowMin: {
      stripe: isBelowMin(s.amountMinor, "STRIPE"),
      square: isBelowMin(s.amountMinor, "SQUARE"),
      stax: isBelowMin(s.amountMinor, "STAX"),
    },
    synthetic: s.synthetic,
  }));
  if (schedule.hasBalanceRow) {
    stages.push({
      id: "__balance__",
      no: String(stages.length + 1).padStart(2, "0"),
      label: "Balance",
      share: "",
      amount: fmt.money(fromMinor(schedule.balanceMinor)),
      amountMinor: schedule.balanceMinor,
      status: "UNPAID",
      paidOn: null,
      payable: false,
      belowMin: { stripe: false, square: false, stax: false },
      synthetic: true,
    });
  }

  // Wisetack financing: an accepted loan pays the last stages; those lose their buttons.
  const financing =
    proposal.id && proposal.organizationId
      ? await portalFinancing({ orgId: proposal.organizationId, proposalId: proposal.id, status: proposal.status, stages, owedMinor: schedule.remainingMinor })
      : null;
  const financed = new Set(financing?.coveredIds ?? []);
  for (const s of stages) {
    if (!financed.has(s.id)) continue;
    s.financed = true;
    s.payable = false;
  }
  const nextPayableId = schedule.nextPayableId && financed.has(schedule.nextPayableId) ? null : schedule.nextPayableId;

  const openCount = stages.filter((s) => (s.status === "UNPAID" || s.status === "PENDING") && !s.financed).length;
  const anyHosted = options.anyHosted;
  return {
    publicId,
    status: proposal.status,
    stages,
    paid: fmt.money(fromMinor(schedule.paidMinor)),
    paidMinor: schedule.paidMinor,
    remaining: fmt.money(fromMinor(schedule.remainingMinor)),
    remainingMinor: schedule.remainingMinor,
    balance: fmt.money(fromMinor(schedule.balanceMinor)),
    balanceMinor: schedule.balanceMinor,
    nextPayableId,
    showRemaining: schedule.remainingMinor > 0 && openCount > 1 && financed.size === 0,
    providers: { stripe: options.stripe, square: options.square, stax: options.stax },
    bankTransfer: options.bankTransfer,
    anyHosted,
    anyWay: anyHosted || options.bankTransfer.ok,
    financing,
  };
}

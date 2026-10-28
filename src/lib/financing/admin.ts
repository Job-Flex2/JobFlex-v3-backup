// WISETACK FINANCING — JobFlex's own board (/admin/financing): the switch, who applied, the open loans, what Wisetack
// paid out (measured from Payment rows), and JobFlex's share at the agreement's rate when one is set
// (WISETACK_PARTNER_SHARE_BPS — never a guess). Server only.

import { db } from "@/lib/db";
import { OWNER_ROLE } from "@/lib/orgContext";
import { getProvider } from "./provider";
import type { FinancingSwitch, LoanState, MerchantState } from "./state";
import { listLoans, listOrgFinancing, readSwitch, writeSwitch } from "./store";
import { boardSummary, pilotFromText } from "./view";
import { loanLine } from "./words";

const usd = (minor: number) => `$${Math.round(minor / 100).toLocaleString("en-US")}`;

export function partnerShareBps(env: NodeJS.ProcessEnv = process.env): number | null {
  const n = Number.parseInt(env.WISETACK_PARTNER_SHARE_BPS ?? "", 10);
  return Number.isFinite(n) && n >= 0 && n <= 10_000 ? n : null;
}

export type FinancingBoard = {
  connected: boolean;
  sw: FinancingSwitch;
  pilot: Array<{ orgId: string; name: string; email: string | null }>;
  contractors: Array<{ orgId: string; name: string; state: MerchantState; appliedAt: string | null; decidedAt: string | null }>;
  loans: Array<{ proposalId: string; title: string; company: string; client: string; state: LoanState; line: string; amount: string }>;
  summary: ReturnType<typeof boardSummary>;
  paidCount: number;
  shareSet: boolean;
};

async function ownerEmails(orgIds: string[]): Promise<Map<string, string>> {
  if (!orgIds.length) return new Map();
  const seats = await db.membership.findMany({ where: { organizationId: { in: orgIds }, role: OWNER_ROLE }, select: { organizationId: true, user: { select: { email: true } } } });
  return new Map(seats.filter((s) => s.user.email).map((s) => [s.organizationId, s.user.email as string]));
}

export async function financingBoard(): Promise<FinancingBoard> {
  const [sw, orgs, loans, paid] = await Promise.all([
    readSwitch(),
    listOrgFinancing(),
    listLoans(),
    db.payment.aggregate({ where: { provider: "WISETACK", status: "PAID" }, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const orgIds = [...new Set([...orgs.map((o) => o.orgId), ...sw.pilot])];
  const [names, emails, proposals] = await Promise.all([
    db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }).then((r) => new Map(r.map((o) => [o.id, o.name]))),
    ownerEmails(sw.pilot),
    db.proposal
      .findMany({ where: { id: { in: loans.map((l) => l.proposalId) } }, select: { id: true, title: true, organization: { select: { name: true } }, client: { select: { name: true } } } })
      .then((r) => new Map(r.map((p) => [p.id, p]))),
  ]);
  const paidCents = Math.round((paid._sum.amount ?? 0) * 100);
  const bps = partnerShareBps();
  return {
    connected: getProvider() !== null,
    sw,
    pilot: sw.pilot.map((orgId) => ({ orgId, name: names.get(orgId) ?? orgId, email: emails.get(orgId) ?? null })),
    contractors: orgs
      .filter((o) => o.rec.state !== "none")
      .map((o) => ({ orgId: o.orgId, name: names.get(o.orgId) ?? o.orgId, state: o.rec.state, appliedAt: o.rec.appliedAt, decidedAt: o.rec.decidedAt })),
    loans: loans.map(({ proposalId, loan }) => {
      const p = proposals.get(proposalId);
      return { proposalId, title: p?.title ?? "(deleted proposal)", company: p?.organization.name ?? "—", client: p?.client?.name ?? "—", state: loan.state, line: loanLine(loan, usd), amount: usd(loan.approvedMinor ?? loan.amountMinor) };
    }),
    summary: boardSummary(orgs, loans.map((l) => l.loan), paidCents, bps),
    paidCount: paid._count._all,
    shareSet: bps !== null,
  };
}

/** The switch: off, a pilot list of companies (by their owners' emails), or everyone. */
export async function saveSwitch(mode: FinancingSwitch["mode"], pilotText: string): Promise<{ sw: FinancingSwitch; missing: string[] }> {
  const emails = pilotFromText(pilotText);
  const users = emails.length
    ? await db.user.findMany({ where: { email: { in: emails } }, select: { email: true, memberships: { where: { role: OWNER_ROLE }, select: { organizationId: true } } } })
    : [];
  const found = new Map(users.map((u) => [String(u.email).toLowerCase(), u.memberships.map((m) => m.organizationId)]));
  const pilot = [...new Set(emails.flatMap((e) => found.get(e) ?? []))];
  const missing = emails.filter((e) => !(found.get(e)?.length));
  const sw: FinancingSwitch = { mode: mode === "pilot" || mode === "all" ? mode : "off", pilot };
  await writeSwitch(sw);
  return { sw, missing };
}

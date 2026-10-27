// Everything the homeowner's request page (/request/[token]) shows, read
// through the request's capability token — the same authorization the page
// itself rests on (no homeowner account exists; the emailed link IS the key).
//
// Owner, 2026-10-02: "the client's dashboard — show the status, render the
// proposal the contractor sent, request another contractor at any time, and
// update when a new contractor is matched."
//
// How a shop's proposal finds its way back here: a proposal belongs to a
// Client, and the Lead Center's own rule says the client a homeowner request
// became is the shop's client with the same email (case aside) or phone
// (lib/leadClient findClientForLead — the hand-off from a lead to an estimator
// files under exactly that record). So: every shop this request was matched
// with → that shop's client for the homeowner → the proposals the shop SENT
// (never a draft) since the request was made.
//
// ONLY A CLIENT RECORD BORN OF THIS REQUEST COUNTS. The intake is public and
// unverified — anyone can type someone else's email or phone into a request,
// and the "Track your request" link is handed over on the spot. A shop's
// client that already existed before the request may be that someone else,
// so their proposals and visits are never read through this page; only a
// record the shop made after the request came in (the lead hand-off makes it,
// lib/leadClient) is taken to be this homeowner. A returning customer of the
// shop still gets every proposal by email — they just don't see it here.
//
// Plain server module — imported only by the page.
import { db } from "@/lib/db";
import { guessTrade } from "@/lib/tradeGuess";
import { getStripeMode } from "@/lib/stripeMode";
import { parsePaymentSettings } from "@/lib/settings";
import { resolvePayOptions } from "@/lib/payments/payOptions";
import { contractSchedule, contractTotal } from "@/lib/contractTotal";
import { fromMinor, resolveSchedule } from "@/lib/paymentSchedule";
import { orgReplyTo } from "@/lib/email/orgSend";
import { findClientForLead } from "@/lib/leadClient";
import { orgRatingsByIds } from "@/lib/reviews/publicSummary";
import { estimateShort, readLeadEstimates } from "@/lib/leadCenter/estimate";

/** What the homeowner reads on a proposal card. */
export type ProposalStage = "NEW" | "OPENED" | "ACCEPTED" | "DECLINED" | "PAID" | "COMPLETED";

export interface PortalOrg {
  id: string;
  name: string;
  slug: string;
  phoneDisplay: string | null;
  /** tel: / sms: targets, E.164 when the number is a US one. */
  telHref: string | null;
  smsHref: string | null;
  /** The address the shop's client emails reply to (lib/email/orgSend). */
  email: string | null;
  place: string | null;
  timeZone: string;
  /** Published reviews only; null when the shop has none yet. */
  rating: { avg: number; count: number } | null;
}

export interface PortalProposal {
  publicId: string;
  title: string;
  /** The proposal's own total (what the email showed). */
  total: number;
  /** The first lines, name + price, as the proposal email lists them. */
  lines: Array<{ name: string; total: number }>;
  /** The lines past `lines`, folded into one row. */
  more: { count: number; total: number } | null;
  taxRate: number;
  taxTotal: number;
  /** Σ approved change orders (0 when none) — the contract is total + this. */
  approvedChanges: number;
  /** Money so far on an accepted proposal (lib/paymentSchedule); zeros before acceptance. */
  paid: number;
  remaining: number;
  /** The stage payable next, when one is scheduled. */
  nextDue: { label: string; amount: number } | null;
  /**
   * The shop takes this payment online (a card processor or bank-transfer details) — the same answer the
   * proposal page gives (lib/payments/payOptions). False: "the team will be in touch about payment", so the
   * dashboard never offers a Pay button that leads nowhere (2026-10-14).
   */
  payOnline: boolean;
  stage: ProposalStage;
  sentAt: string | null;
  validUntil: string | null;
  orgId: string;
  orgName: string;
  /** From the contractor the request is matched with right now. */
  current: boolean;
}

export interface PortalVisit {
  title: string;
  startsAt: string;
  endsAt: string;
  orgName: string;
  timeZone: string;
}

export interface PortalChangeOrder {
  token: string;
  title: string;
  number: number | null;
  total: number | null;
  proposalTitle: string;
}

export interface PortalEvent {
  at: string;
  text: string;
  note?: string | null;
}

export interface RequestPortalView {
  token: string;
  /** MATCHING | OFFERED | MATCHED | MANUAL_QUEUE */
  status: string;
  trade: string | null;
  firstName: string;
  submittedAt: string;
  place: string | null;
  scope: string | null;
  /** The range the homeowner priced before asking (2026-10-27), when they did. */
  estimate: { range: string; material: string; basis: string } | null;
  /** Fallback zone for times shown before the viewer's own clock takes over. */
  timeZone: string;
  /** The homeowner's home dashboard key (/home/[key]); null for a request with no home yet. */
  homeKey: string | null;
  /** The request's status in one word, for a list of projects. */
  status2: "WAITING" | "MATCHED" | "PROPOSAL" | "HIRED" | "DONE";
  /** Each involved shop's client record for this homeowner (born after the request). */
  clients: Array<{ orgId: string; clientId: string }>;
  current: { org: PortalOrg; matchedAt: string | null } | null;
  previous: Array<{ org: PortalOrg; endedAt: string | null; reason: string | null }>;
  proposals: PortalProposal[];
  visits: PortalVisit[];
  changeOrders: PortalChangeOrder[];
  events: PortalEvent[];
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "");
/** Lines a proposal card lists before folding the rest into "N more items". */
const LINE_CAP = 6;

/** "(425) 772-6587" for a US number, the raw string otherwise. */
export function phoneParts(raw: string | null | undefined): { display: string | null; e164: string | null } {
  const d = digits(raw);
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d.length === 10 ? d : null;
  if (ten) return { display: `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`, e164: `+1${ten}` };
  const t = (raw ?? "").trim();
  return { display: t || null, e164: d.length >= 7 ? `+${d}` : null };
}

function stageOf(p: { status: string; viewedAt: Date | null }): ProposalStage {
  switch (p.status) {
    case "ACCEPTED":
      return "ACCEPTED";
    case "DECLINED":
      return "DECLINED";
    case "PAID":
      return "PAID";
    case "COMPLETED":
      return "COMPLETED";
    case "VIEWED":
      return "OPENED";
    default:
      return p.viewedAt ? "OPENED" : "NEW";
  }
}

/** The request row with its offers, as the view is built from it. */
export type RequestLeadRow = NonNullable<Awaited<ReturnType<typeof findRequestLead>>>;

export function findRequestLead(token: string) {
  return db.platformLead.findUnique({
    where: { accessToken: token },
    include: { offers: { orderBy: { createdAt: "asc" } }, home: { select: { accessToken: true } } },
  });
}

export async function loadRequestPortal(token: string): Promise<RequestPortalView | null> {
  const pl = await findRequestLead(token);
  if (!pl) return null;
  return buildRequestPortal(pl);
}

/** The view for one request row (the home dashboard builds one per project). */
export async function buildRequestPortal(pl: RequestLeadRow): Promise<RequestPortalView> {
  const token = pl.accessToken ?? "";

  const currentOrgId = pl.status === "MATCHED" ? pl.matchedOrgId : null;
  // The shops the homeowner already moved on from ("find me another
  // contractor"): their proposals stay readable here, side by side.
  const left = pl.offers.filter((o) => o.status === "REJECTED_BY_CLIENT" && o.organizationId !== currentOrgId);
  const orgIds = [...new Set([...(currentOrgId ? [currentOrgId] : []), ...left.map((o) => o.organizationId)])];

  const [orgRows, ratings] = await Promise.all([
    orgIds.length
      ? db.organization.findMany({
          where: { id: { in: orgIds }, deletedAt: null },
          select: { id: true, name: true, slug: true, phone: true, billingEmail: true, gmailSettingsJson: true, address: true, timezone: true, paymentSettingsJson: true, paymentConnections: true },
        })
      : Promise.resolve([]),
    orgRatingsByIds(orgIds),
  ]);
  const orgs = new Map<string, PortalOrg>();
  // Whether each shop can take a payment online — the proposal page's own rule.
  const stripeMode = orgRows.length ? await getStripeMode().catch(() => null) : null;
  const payOnlineByOrg = new Map<string, boolean>();
  for (const o of orgRows) {
    try {
      const opts = resolvePayOptions({
        settings: parsePaymentSettings(o.paymentSettingsJson),
        stripeConn: o.paymentConnections.find((c) => c.provider === "STRIPE") ?? null,
        squareConn: o.paymentConnections.find((c) => c.provider === "SQUARE") ?? null,
        staxConn: o.paymentConnections.find((c) => c.provider === "STAX") ?? null,
        proposalCurrency: "USD",
        stripeMode: stripeMode ?? "test",
      });
      payOnlineByOrg.set(o.id, opts.anyHosted || opts.bankTransfer.ok);
    } catch {
      payOnlineByOrg.set(o.id, false);
    }
  }
  for (const o of orgRows) {
    const ph = phoneParts(o.phone);
    const r = ratings.get(o.id);
    orgs.set(o.id, {
      id: o.id,
      name: o.name,
      slug: o.slug,
      phoneDisplay: ph.display,
      telHref: ph.e164 ? `tel:${ph.e164}` : null,
      smsHref: ph.e164 ? `sms:${ph.e164}` : null,
      // Where the shop's own emails to clients reply to — the address it reads.
      email: orgReplyTo(o)?.trim() || null,
      place: o.address?.trim() || null,
      timeZone: o.timezone || "America/New_York",
      rating: r && r.avg != null && r.count > 0 ? { avg: Math.round(r.avg * 10) / 10, count: r.count } : null,
    });
  }

  // Each shop's client for this homeowner — only one the shop made after the
  // request came in (see the header) — then what that shop SENT them.
  const found = (
    await Promise.all([...orgs.keys()].map(async (orgId) => ({ orgId, c: await findClientForLead(orgId, { email: pl.email, phone: pl.phone }) })))
  ).flatMap(({ orgId, c }) => (c ? [{ orgId, id: c.id }] : []));
  const born = found.length
    ? await db.client.findMany({ where: { id: { in: found.map((f) => f.id) }, createdAt: { gte: pl.createdAt } }, select: { id: true } })
    : [];
  const bornIds = new Set(born.map((c) => c.id));
  const clientByOrg = new Map(found.filter((f) => bornIds.has(f.id)).map((f) => [f.orgId, f.id] as const));
  const proposalRows = clientByOrg.size
    ? await db.proposal.findMany({
        where: {
          OR: [...clientByOrg.entries()].map(([organizationId, clientId]) => ({ organizationId, clientId })),
          status: { not: "DRAFT" },
          createdAt: { gte: pl.createdAt },
        },
        orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          publicId: true,
          organizationId: true,
          title: true,
          total: true,
          taxRate: true,
          taxTotal: true,
          status: true,
          sentAt: true,
          viewedAt: true,
          acceptedAt: true,
          declinedAt: true,
          validUntil: true,
          createdAt: true,
          currency: true,
          installments: { orderBy: { position: "asc" }, select: { id: true, label: true, amount: true, isPercent: true, position: true, status: true, paidAmount: true, changeOrderId: true } },
          lineItems: { orderBy: { position: "asc" }, select: { name: true, total: true } },
          changeOrders: {
            where: { status: { in: ["SENT", "APPROVED", "DECLINED"] } },
            select: { status: true, total: true, number: true, title: true, sentAt: true, approvedAt: true, declinedAt: true },
          },
        },
      })
    : [];
  const proposals: PortalProposal[] = proposalRows.map((p) => {
    const rest = p.lineItems.slice(LINE_CAP);
    const st = stageOf(p);
    // Money only once the proposal is theirs to pay on: the same resolver the
    // proposal page and the payment emails use.
    let paid = 0;
    let remaining = 0;
    let nextDue: PortalProposal["nextDue"] = null;
    if (st === "ACCEPTED" || st === "PAID" || st === "COMPLETED") {
      try {
        const sched = resolveSchedule({ ...contractSchedule(p.total, p.changeOrders.filter((c) => c.status === "APPROVED")), currency: p.currency, installments: p.installments });
        paid = fromMinor(sched.paidMinor);
        remaining = fromMinor(sched.remainingMinor);
        const due = sched.stages.find((x) => x.payable);
        nextDue = due ? { label: due.label, amount: fromMinor(due.amountMinor) } : null;
      } catch {
        // A schedule that cannot be read costs the money line, never the page.
      }
    }
    return {
      publicId: p.publicId,
      title: p.title,
      total: p.total,
      lines: p.lineItems.slice(0, LINE_CAP).map((li) => ({ name: li.name, total: li.total })),
      more: rest.length ? { count: rest.length, total: Math.round(rest.reduce((n, li) => n + li.total, 0) * 100) / 100 } : null,
      taxRate: p.taxRate,
      taxTotal: p.taxTotal,
      approvedChanges: Math.round((contractTotal(p.total, p.changeOrders) - p.total) * 100) / 100,
      paid,
      remaining,
      nextDue,
      payOnline: payOnlineByOrg.get(p.organizationId) ?? false,
      stage: st,
      sentAt: (p.sentAt ?? p.createdAt).toISOString(),
      validUntil: p.validUntil?.toISOString() ?? null,
      orgId: p.organizationId,
      orgName: orgs.get(p.organizationId)?.name ?? "Your contractor",
      current: p.organizationId === currentOrgId,
    };
  });

  // What needs the homeowner now: a change order waiting for their ok, and the
  // next visit the matched shop has on its calendar for them.
  const currentIds = proposalRows.filter((p) => p.organizationId === currentOrgId).map((p) => p.id);
  const now = new Date();
  const currentClientId = currentOrgId ? clientByOrg.get(currentOrgId) ?? null : null;
  const [coRows, visitRows] = await Promise.all([
    currentIds.length
      ? db.changeOrder.findMany({
          where: { proposalId: { in: currentIds }, status: "SENT" },
          orderBy: { createdAt: "asc" },
          select: { publicToken: true, title: true, number: true, total: true, proposal: { select: { title: true } } },
        })
      : Promise.resolve([]),
    currentOrgId && (currentClientId || pl.matchedLeadId)
      ? db.appointment.findMany({
          where: {
            organizationId: currentOrgId,
            status: "SCHEDULED",
            endsAt: { gte: now },
            OR: [
              ...(currentClientId ? [{ clientId: currentClientId }] : []),
              ...(pl.matchedLeadId ? [{ leadId: pl.matchedLeadId }] : []),
            ],
          },
          orderBy: { startsAt: "asc" },
          take: 3,
          select: { title: true, startsAt: true, endsAt: true },
        })
      : Promise.resolve([]),
  ]);
  const currentOrg = currentOrgId ? orgs.get(currentOrgId) ?? null : null;

  // The request's story, oldest first.
  const events: PortalEvent[] = [
    { at: pl.createdAt.toISOString(), text: `You sent your ${(pl.detectedTrade ?? pl.projectType ?? "project").toLowerCase()} request` },
  ];
  for (const o of left) {
    const org = orgs.get(o.organizationId);
    if (org && o.respondedAt) events.push({ at: o.respondedAt.toISOString(), text: "You asked for another contractor", note: `Instead of ${org.name}${o.declineReason ? ` · “${o.declineReason}”` : ""}` });
  }
  if (currentOrg && pl.matchedAt) events.push({ at: pl.matchedAt.toISOString(), text: `Matched with ${currentOrg.name}` });
  for (const p of proposalRows) {
    const name = orgs.get(p.organizationId)?.name ?? "Your contractor";
    if (p.sentAt) events.push({ at: p.sentAt.toISOString(), text: `${name} sent a proposal`, note: p.title });
    if (p.acceptedAt) events.push({ at: p.acceptedAt.toISOString(), text: `You accepted ${name}'s proposal`, note: p.title });
    if (p.declinedAt) events.push({ at: p.declinedAt.toISOString(), text: `You declined ${name}'s proposal`, note: p.title });
    for (const c of p.changeOrders) {
      const co = c.number ? `Change order #${c.number} · ${c.title}` : c.title;
      if (c.sentAt) events.push({ at: c.sentAt.toISOString(), text: `${name} sent a change order`, note: co });
      if (c.approvedAt) events.push({ at: c.approvedAt.toISOString(), text: "You approved a change order", note: co });
      if (c.declinedAt) events.push({ at: c.declinedAt.toISOString(), text: "You declined a change order", note: co });
    }
  }
  events.sort((a, b) => a.at.localeCompare(b.at));

  const place = [pl.city, pl.state].filter(Boolean).join(", ") || pl.zip || null;
  // The range they priced on /price before asking (2026-10-27) — shown above "what you asked for".
  const est = (await readLeadEstimates([pl.id])).get(pl.id) ?? null;
  const estimateView = est
    ? { range: estimateShort(est).split(" · ")[0], material: est.materialLabel.toLowerCase(), basis: est.measurementId ? "measured" : est.basis === "solar" ? "read from aerial data" : "from your home's size" }
    : null;
  const won = proposals.some((p) => p.current && (p.stage === "ACCEPTED" || p.stage === "PAID"));
  const done = proposals.some((p) => p.current && p.stage === "COMPLETED");
  const status2: RequestPortalView["status2"] = done ? "DONE" : won ? "HIRED" : proposals.some((p) => p.current) ? "PROPOSAL" : currentOrg ? "MATCHED" : "WAITING";
  return {
    token,
    status: pl.status,
    homeKey: pl.home?.accessToken ?? null,
    status2,
    clients: [...clientByOrg.entries()].map(([orgId, clientId]) => ({ orgId, clientId })),
    // The classifier's word, else the homeowner's own (lib/tradeGuess, 2026-10-14): never "Project · 98033".
    trade: pl.detectedTrade ?? pl.projectType ?? guessTrade(pl.description),
    firstName: (pl.name || "").trim().split(/\s+/)[0] || "",
    submittedAt: pl.createdAt.toISOString(),
    place,
    scope: (pl.scope ?? pl.description ?? "").trim() || null,
    estimate: estimateView,
    timeZone: currentOrg?.timeZone ?? [...orgs.values()][0]?.timeZone ?? "America/New_York",
    current: currentOrg ? { org: currentOrg, matchedAt: pl.matchedAt?.toISOString() ?? null } : null,
    previous: left.flatMap((o) => {
      const org = orgs.get(o.organizationId);
      return org ? [{ org, endedAt: o.respondedAt?.toISOString() ?? null, reason: o.declineReason }] : [];
    }),
    proposals,
    visits: visitRows.map((v) => ({
      title: v.title,
      startsAt: v.startsAt.toISOString(),
      endsAt: v.endsAt.toISOString(),
      orgName: currentOrg?.name ?? "Your contractor",
      timeZone: currentOrg?.timeZone ?? "America/New_York",
    })),
    changeOrders: coRows.map((c) => ({
      token: c.publicToken,
      title: c.title,
      number: c.number,
      total: c.total,
      proposalTitle: c.proposal?.title ?? "",
    })),
    events,
  };
}

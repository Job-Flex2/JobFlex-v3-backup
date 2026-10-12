import "server-only";
// The rows behind the trials board (lib/trialBoard, 2026-10-12) and, for one account, everything it did.
//
// Reads only what the database already keeps — Organization, its Subscription, the card-less trial's record
// (`cardlessTrial:<org>`), the projection's price and odds (lib/trialProjectionRead), and the work: proposals, estimates,
// Smart Proposal briefs, clients, leads, jobs, the activity trail and the trial watch's page views. Every count stands
// alone and fails quietly — a missing table (PageView is pushed to Neon by hand) costs that count, never the board.
// Accounts an admin took out of the statistics (lib/statsHidden) are left out entirely, as on the signups list.
import { db } from "@/lib/db";
import { statsHiddenIds } from "@/lib/statsHidden";
import { cardlessKey, type CardlessRecord } from "@/lib/trialState";
import { valueSignups } from "@/lib/trialProjectionRead";
import { TIER_LABEL } from "@/lib/trialProjection";
import { signupSource, signupState } from "@/lib/traffic-live";
import { TRAFFIC_SINCE_MS } from "@/lib/traffic-visitor";
import { sessionsOf } from "@/lib/trialWatch";
import { NAV_SECTIONS, activeHref, flattenNavItems } from "@/components/v3/blueprint-shell/nav-map";
import { buildTrialBoard, DAY_MS, type BoardAccount, type TrialBoard } from "@/lib/trialBoard";

/** The calendar's fourteen days and a month of payers, with room. */
const WINDOW_DAYS = 45;
const LIMIT = 800;

const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p;
  } catch {
    return fallback;
  }
};
const parse = <T>(text: string | null | undefined): T | null => {
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
};
const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};
const planWords = (plan: string) => {
  const p = (plan || "").trim();
  return p && p.toUpperCase() !== "FREE" ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
};
const countBy = (rows: ReadonlyArray<{ organizationId: string; _count: { _all: number } }>) => new Map(rows.map((r) => [r.organizationId, r._count._all]));

export async function readTrialBoard(now = Date.now()): Promise<TrialBoard> {
  const since = new Date(Math.max(now - WINDOW_DAYS * DAY_MS, TRAFFIC_SINCE_MS));
  const hidden = new Set(await safe(statsHiddenIds(), []));
  const found = await db.organization.findMany({
    // The window's accounts, and every trial still running however old it is.
    where: { deletedAt: null, OR: [{ createdAt: { gte: since } }, { subscription: { is: { status: "TRIALING" } } }] },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      name: true,
      createdAt: true,
      utmSource: true,
      utmMedium: true,
      utmCampaign: true,
      memberships: { orderBy: { createdAt: "asc" }, take: 1, select: { user: { select: { email: true, name: true } } } },
      subscription: { select: { plan: true, status: true, provider: true, externalSubId: true, trialEndsAt: true, canceledAt: true, stripePriceId: true, updatedAt: true } },
    },
  });
  const orgs = found.filter((o) => !hidden.has(o.id));
  const ids = orgs.map((o) => o.id);
  const inOrgs = { organizationId: { in: ids } };
  const has = ids.length > 0;

  const [cardlessRows, proposals, sent, roofs, hvacs, briefs, clients, leads, jobs, views, lastActs, valued] = await Promise.all([
    has ? safe(db.syncState.findMany({ where: { key: { in: ids.map(cardlessKey) } }, select: { key: true, cursor: true } }), []) : [],
    has ? safe(db.proposal.groupBy({ by: ["organizationId"], where: inOrgs, _count: { _all: true } }), []) : [],
    has ? safe(db.proposal.groupBy({ by: ["organizationId"], where: { ...inOrgs, sentAt: { not: null } }, _count: { _all: true } }), []) : [],
    has ? safe(db.roofMeasurement.groupBy({ by: ["organizationId"], where: inOrgs, _count: { _all: true } }), []) : [],
    has ? safe(db.hvacEstimate.groupBy({ by: ["organizationId"], where: inOrgs, _count: { _all: true } }), []) : [],
    has ? safe(db.aiDraft.groupBy({ by: ["organizationId"], where: inOrgs, _count: { _all: true } }), []) : [],
    has ? safe(db.client.groupBy({ by: ["organizationId"], where: { ...inOrgs, deletedAt: null }, _count: { _all: true } }), []) : [],
    has ? safe(db.lead.groupBy({ by: ["organizationId"], where: inOrgs, _count: { _all: true } }), []) : [],
    has ? safe(db.job.groupBy({ by: ["organizationId"], where: inOrgs, _count: { _all: true } }), []) : [],
    has ? safe(db.pageView.findMany({ where: { ...inOrgs, at: { gte: since } }, select: { organizationId: true, at: true }, take: 100_000 }), []) : [],
    has ? safe(db.activityEvent.groupBy({ by: ["organizationId"], where: { ...inOrgs, actorId: { not: null } }, _max: { createdAt: true } }), []) : [],
    // The plan's monthly price and, for a trial, its odds — the signups list's own figures.
    safe(
      valueSignups(
        orgs.map((o) => ({
          orgId: o.id,
          createdAt: o.createdAt,
          state: signupState(o.subscription?.status ?? ""),
          sub: o.subscription
            ? { plan: o.subscription.plan, status: o.subscription.status, trialEndsAt: o.subscription.trialEndsAt, stripePriceId: o.subscription.stripePriceId, externalSubId: o.subscription.externalSubId, provider: o.subscription.provider }
            : null,
        })),
        now,
      ),
      null,
    ),
  ]);

  const cardless = new Map<string, CardlessRecord>();
  for (const row of cardlessRows) {
    const rec = parse<CardlessRecord>(row.cursor);
    if (rec?.subId) cardless.set(row.key.slice("cardlessTrial:".length), rec);
  }
  const proposalsBy = countBy(proposals);
  const sentBy = countBy(sent);
  const roofBy = countBy(roofs);
  const hvacBy = countBy(hvacs);
  const briefsBy = countBy(briefs);
  const clientsBy = countBy(clients);
  const leadsBy = countBy(leads);
  const jobsBy = countBy(jobs);
  const seen = new Map<string, { views: number; days: Set<number>; last: number }>();
  for (const v of views) {
    const t = v.at.getTime();
    const e = seen.get(v.organizationId) ?? { views: 0, days: new Set<number>(), last: 0 };
    e.views += 1;
    e.days.add(Math.floor(t / DAY_MS));
    e.last = Math.max(e.last, t);
    seen.set(v.organizationId, e);
  }
  const actedBy = new Map(lastActs.map((r) => [r.organizationId, r._max.createdAt?.getTime() ?? 0]));

  const accounts: BoardAccount[] = orgs.map((o) => {
    const sub = o.subscription;
    const owner = o.memberships[0]?.user;
    const src = signupSource({ utmSource: o.utmSource ?? "", utmMedium: o.utmMedium ?? "" });
    const rec = cardless.get(o.id);
    const value = valued?.values.get(o.id);
    const v = seen.get(o.id);
    const last = Math.max(v?.last ?? 0, actedBy.get(o.id) ?? 0);
    return {
      orgId: o.id,
      orgName: o.name,
      ownerName: owner?.name ?? "",
      ownerEmail: owner?.email ?? "",
      createdAt: o.createdAt.getTime(),
      source: src.label,
      fromAd: src.fromAd,
      campaign: o.utmCampaign ?? "",
      status: sub?.status ?? "",
      plan: planWords(sub?.plan ?? ""),
      provider: sub?.provider ?? "",
      hasStripeSub: !!sub?.externalSubId,
      trialEndsAt: sub?.trialEndsAt?.getTime() ?? null,
      canceledAt: sub?.canceledAt?.getTime() ?? null,
      subUpdatedAt: sub?.updatedAt?.getTime() ?? null,
      cardless: rec
        ? { startedAt: ms(rec.startedAt), endsAt: ms(rec.endsAt), cardAt: ms(rec.cardAt), endedAt: ms(rec.endedAt), restartedAt: ms(rec.restartedAt), test: rec.mode === "test" }
        : null,
      monthlyCents: value?.monthlyCents ?? null,
      chance: value?.chance ?? null,
      tierLabel: value?.tier ? TIER_LABEL[value.tier] : null,
      work: {
        proposals: proposalsBy.get(o.id) ?? 0,
        sent: sentBy.get(o.id) ?? 0,
        estimates: (roofBy.get(o.id) ?? 0) + (hvacBy.get(o.id) ?? 0),
        aiAsks: briefsBy.get(o.id) ?? 0,
        clients: clientsBy.get(o.id) ?? 0,
        leads: leadsBy.get(o.id) ?? 0,
        jobs: jobsBy.get(o.id) ?? 0,
        activeDays: v?.days.size ?? 0,
        views: v?.views ?? 0,
        lastSeen: last > 0 ? last : null,
      },
    };
  });
  return buildTrialBoard(accounts, now);
}

// ── one account, everything it did ──────────────────────────────────────────

export type ActivityKind = "action" | "client" | "proposal" | "estimate" | "brief" | "session";
export interface ActivityItem {
  id: string;
  at: string;
  kind: ActivityKind;
  text: string;
  /** Who did it, when the trail knows (a member's name). */
  who?: string;
  proposalId?: string;
}
export interface ProposalLook {
  id: string;
  title: string;
  status: string;
  clientName: string | null;
  address: string | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  createdAt: string;
  sentAt: string | null;
  viewedAt: string | null;
  viewCount: number;
  acceptedAt: string | null;
  lines: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
}
export interface TrialActivity {
  orgId: string;
  orgName: string;
  items: ActivityItem[];
  proposals: Record<string, ProposalLook>;
  /** False when the page views could not be read (the table is not in this database). */
  viewsAvailable: boolean;
}

const LABEL_BY_HREF = new Map(NAV_SECTIONS.flatMap((s) => flattenNavItems(s.items)).map((i) => [i.href, i.label]));
/** A recorded screen (lib/trialWatch routePattern, ids as `*`) in the sidebar's words. */
export function screenWords(route: string): string {
  const path = route.replace(/\*/g, "x");
  const href = activeHref(path);
  const label = href ? LABEL_BY_HREF.get(href) : undefined;
  if (label) {
    const rest = path.slice(href!.length).split("/").filter((seg) => seg && seg !== "x");
    return rest.length ? `${label} · ${rest.join(" ").replace(/-/g, " ")}` : label;
  }
  const words = route.split("/").filter((seg) => seg && seg !== "*" && seg !== "dashboard");
  return words.length ? words.join(" ").replace(/-/g, " ") : "Overview";
}
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export async function readTrialActivity(orgId: string): Promise<TrialActivity | null> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } }).catch(() => null);
  if (!org) return null;
  const where = { organizationId: orgId };
  let viewsAvailable = true;
  const [events, proposals, roofs, hvacs, briefs, aiEstimates, views] = await Promise.all([
    safe(
      db.activityEvent.findMany({
        where: { ...where, kind: { not: "TEST" } },
        orderBy: { createdAt: "desc" },
        take: 250,
        select: { id: true, kind: true, summary: true, createdAt: true, actorId: true, proposalId: true, actor: { select: { name: true, email: true } } },
      }),
      [],
    ),
    safe(
      db.proposal.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 40,
        select: {
          id: true,
          title: true,
          status: true,
          address: true,
          subtotal: true,
          discountTotal: true,
          taxTotal: true,
          total: true,
          createdAt: true,
          sentAt: true,
          viewedAt: true,
          viewCount: true,
          acceptedAt: true,
          client: { select: { name: true } },
          lineItems: { select: { name: true, quantity: true, unitPrice: true, total: true }, orderBy: { position: "asc" }, take: 60 },
        },
      }),
      [],
    ),
    safe(db.roofMeasurement.findMany({ where, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, createdAt: true, address: true, city: true, state: true, squares: true, predominantPitch: true } }), []),
    safe(db.hvacEstimate.findMany({ where, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, createdAt: true, address: true, state: true, sizedTons: true, subtotal: true } }), []),
    safe(db.aiDraft.findMany({ where, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, createdAt: true, prompt: true } }), []),
    safe(db.aiEstimate.findMany({ where, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, createdAt: true, projectType: true, location: true, total: true } }), []),
    db.pageView.findMany({ where, orderBy: { at: "desc" }, take: 3000, select: { route: true, at: true } }).catch(() => {
      viewsAvailable = false;
      return [] as Array<{ route: string; at: Date }>;
    }),
  ]);

  const items: ActivityItem[] = [];
  const withEvents = new Set<string>();
  for (const e of events) {
    if (e.proposalId) withEvents.add(e.proposalId);
    items.push({
      id: `event:${e.id}`,
      at: e.createdAt.toISOString(),
      // No member behind it: the client's side — opened, signed, paid.
      kind: e.actorId ? (e.proposalId ? "proposal" : "action") : "client",
      text: e.summary,
      who: e.actor ? e.actor.name?.trim() || e.actor.email || undefined : undefined,
      proposalId: e.proposalId ?? undefined,
    });
  }
  const look: Record<string, ProposalLook> = {};
  for (const p of proposals) {
    look[p.id] = {
      id: p.id,
      title: p.title,
      status: p.status,
      clientName: p.client?.name ?? null,
      address: p.address ?? null,
      subtotal: p.subtotal,
      discountTotal: p.discountTotal,
      taxTotal: p.taxTotal,
      total: p.total,
      createdAt: p.createdAt.toISOString(),
      sentAt: p.sentAt?.toISOString() ?? null,
      viewedAt: p.viewedAt?.toISOString() ?? null,
      viewCount: p.viewCount,
      acceptedAt: p.acceptedAt?.toISOString() ?? null,
      lines: p.lineItems.map((li) => ({ name: li.name, quantity: li.quantity, unitPrice: li.unitPrice, total: li.total })),
    };
    // A proposal the trail never mentioned (older paths wrote no event) still shows where it was made.
    if (!withEvents.has(p.id)) items.push({ id: `proposal:${p.id}`, at: p.createdAt.toISOString(), kind: "proposal", text: `Made a proposal: ${p.title} — ${money(p.total)}`, proposalId: p.id });
  }
  for (const r of roofs) {
    const where = [r.address, r.city, r.state].filter(Boolean).join(", ") || "an address";
    const figs = [r.squares != null ? `${r.squares.toFixed(1)} squares` : "", r.predominantPitch ? `${r.predominantPitch} pitch` : ""].filter(Boolean).join(" · ");
    items.push({ id: `roof:${r.id}`, at: r.createdAt.toISOString(), kind: "estimate", text: `Measured the roof at ${where}${figs ? ` — ${figs}` : ""}` });
  }
  for (const h of hvacs) {
    const where = [h.address, h.state].filter(Boolean).join(", ") || "an address";
    const figs = [h.sizedTons ? `${h.sizedTons} tons` : "", h.subtotal ? money(h.subtotal) : ""].filter(Boolean).join(" · ");
    items.push({ id: `hvac:${h.id}`, at: h.createdAt.toISOString(), kind: "estimate", text: `Sized an HVAC system at ${where}${figs ? ` — ${figs}` : ""}` });
  }
  for (const b of briefs) items.push({ id: `brief:${b.id}`, at: b.createdAt.toISOString(), kind: "brief", text: `Gave Smart Proposal a brief: “${clip(b.prompt.replace(/\s+/g, " ").trim(), 220)}”` });
  for (const a of aiEstimates) items.push({ id: `aiest:${a.id}`, at: a.createdAt.toISOString(), kind: "brief", text: `AI estimate: ${a.projectType}${a.location ? ` in ${a.location}` : ""} — ${money(a.total)}` });
  // The sittings: when they were in the app, how long, and which screens, in the order first opened.
  const sessions = sessionsOf(views.map((v) => ({ route: v.route, at: v.at.toISOString() })));
  for (const s of sessions) {
    const screens: string[] = [];
    for (const r of s.routes) {
      const w = screenWords(r);
      if (screens[screens.length - 1] !== w) screens.push(w);
    }
    const shown = screens.slice(0, 8).join(" → ") + (screens.length > 8 ? ` → … ${screens.length - 8} more` : "");
    items.push({ id: `session:${s.start}`, at: s.start, kind: "session", text: `In the app ${s.minutes} min · ${s.views} ${s.views === 1 ? "screen" : "screens"} — ${shown}` });
  }
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { orgId: org.id, orgName: org.name, items: items.slice(0, 400), proposals: look, viewsAvailable };
}

import "server-only";
// THE OFFICE SCREEN'S FACTS (2026-10-13) — read for /admin/office every thirty seconds. Every figure is one the other
// admin pages already stand behind: the trial board for trials, cards and payers; the stored health sweep for the
// systems; the PostHog totals the traffic page shows for website visitors; the PageView beacon for who is in the app.
// Accounts hidden from stats (lib/statsHidden) and test trials are left out of everything, as on those pages. Each
// part is read on its own: a part that cannot be read is named in `gaps` and the board goes on.
import { db } from "@/lib/db";
import { statsHiddenIds } from "@/lib/statsHidden";
import { readTrialBoard, screenWords } from "@/lib/trialBoardRead";
import { readIntegrationsHealth } from "@/lib/integrationsHealth";
import { fetchLiveTotals } from "@/lib/traffic-server";
import { TRAFFIC_TZ, trafficDayStartMs } from "@/lib/traffic-visitor";
import { DECK_PLAN_EVENT } from "@/lib/deck/convertSchema";
import { FENCE_PLAN_EVENT } from "@/lib/fence/planSvg";
import { readInvestorOffers, readInvestorVisitors } from "@/lib/investorVisitors";
import { buildAttention, orderFeed, type OfficeFeedItem, type OfficeHealthRow, type OfficeScreenData, type OfficeTile } from "@/lib/officeScreen";

const HOUR = 3_600_000;
const ONLINE_MS = 10 * 60_000;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const TRADE_WORDS: Record<string, string> = { roof: "roof", fence: "fence", hvac: "HVAC", deck: "deck" };

/** A part of the board that may fail on its own; its failure is a line in `gaps`, never the whole board. */
async function part<T>(name: string, gaps: string[], fallback: T, run: () => Promise<T>, timeoutMs = 8000): Promise<T> {
  try {
    return await Promise.race([run(), new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), timeoutMs))]);
  } catch {
    gaps.push(name);
    return fallback;
  }
}

/** The town out of an address line: "12103 202nd St SE, Snohomish, WA 98296" → "Snohomish". */
function townOf(address: string | null | undefined, city?: string | null): string {
  if (city?.trim()) return city.trim();
  const parts = (address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 2] : parts.length === 2 ? parts[1].replace(/\s+[A-Z]{2}(\s+\d{5}.*)?$/, "") : "";
}

export async function readOfficeScreen(now = Date.now()): Promise<OfficeScreenData> {
  const gaps: string[] = [];
  const dayStart = trafficDayStartMs(now);
  const yStart = trafficDayStartMs(dayStart - HOUR);
  const ySame = yStart + (now - dayStart); // yesterday, at this clock time
  const dayEnd = trafficDayStartMs(dayStart + 30 * HOUR);
  const tomorrowEnd = trafficDayStartMs(dayEnd + 30 * HOUR);
  const T = { gte: new Date(dayStart), lte: new Date(now) };
  const Y = { gte: new Date(yStart), lt: new Date(ySame) };
  const hidden = await statsHiddenIds().catch(() => [] as string[]);
  const orgWhere = hidden.length ? { organizationId: { notIn: hidden } } : {};
  const orgIdWhere = hidden.length ? { id: { notIn: hidden } } : {};
  const sparkFrom = trafficDayStartMs(dayStart - 13 * 24 * HOUR + 2 * HOUR);

  const count = (name: string, run: () => Promise<number>) => part(name, gaps, 0, run);
  // Platform admins are the staff, not the users (owner, 2026-10-14: the admin showed under "in the app now").
  const staff = (await db.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true } }).catch(() => [] as { id: string }[])).map((u) => u.id);
  const userWhere = staff.length ? { not: null, notIn: staff } : { not: null };
  const people = async (range: { gte: Date; lte?: Date; lt?: Date }) =>
    (await db.pageView.findMany({ where: { at: range, userId: userWhere, ...orgWhere }, distinct: ["userId"], select: { userId: true } })).length;

  const [board, healthReport, website, signupsT, signupsY, activeT, activeY, createdT, createdY, sentT, sentY, acceptedRowsT, acceptedY, roofT, roofY, hvacT, hvacY, plansT, plansY, leadsT, leadsY, textsT, textsY, supportUnread, supportOldest, leadQueue] = await Promise.all([
    part("trials", gaps, null, () => readTrialBoard(now), 15000),
    part("health", gaps, null, () => readIntegrationsHealth()),
    part("website visitors", gaps, null, async () => (await fetchLiveTotals(TRAFFIC_TZ)).production, 6000),
    count("signups", () => db.organization.count({ where: { createdAt: T, ...orgIdWhere } })),
    count("signups", () => db.organization.count({ where: { createdAt: Y, ...orgIdWhere } })),
    part("people in the app", gaps, 0, () => people(T)),
    part("people in the app", gaps, 0, () => people(Y)),
    count("proposals", () => db.proposal.count({ where: { createdAt: T, ...orgWhere } })),
    count("proposals", () => db.proposal.count({ where: { createdAt: Y, ...orgWhere } })),
    count("proposals", () => db.proposal.count({ where: { sentAt: T, ...orgWhere } })),
    count("proposals", () => db.proposal.count({ where: { sentAt: Y, ...orgWhere } })),
    part("proposals", gaps, [] as { total: number }[], () => db.proposal.findMany({ where: { acceptedAt: T, ...orgWhere }, select: { total: true } })),
    count("proposals", () => db.proposal.count({ where: { acceptedAt: Y, ...orgWhere } })),
    count("roof measurements", () => db.roofMeasurement.count({ where: { createdAt: T, ...orgWhere } })),
    count("roof measurements", () => db.roofMeasurement.count({ where: { createdAt: Y, ...orgWhere } })),
    count("HVAC estimates", () => db.hvacEstimate.count({ where: { createdAt: T, ...orgWhere } })),
    count("HVAC estimates", () => db.hvacEstimate.count({ where: { createdAt: Y, ...orgWhere } })),
    count("deck and fence plans", () => db.activityEvent.count({ where: { createdAt: T, kind: { in: [DECK_PLAN_EVENT, FENCE_PLAN_EVENT] }, ...orgWhere } })),
    count("deck and fence plans", () => db.activityEvent.count({ where: { createdAt: Y, kind: { in: [DECK_PLAN_EVENT, FENCE_PLAN_EVENT] }, ...orgWhere } })),
    count("homeowner requests", () => db.platformLead.count({ where: { createdAt: T, isTest: false } })),
    count("homeowner requests", () => db.platformLead.count({ where: { createdAt: Y, isTest: false } })),
    count("texts", () => db.smsMessage.count({ where: { createdAt: T, status: { in: ["SENT", "DELIVERED"] }, ...(hidden.length ? { OR: [{ organizationId: null }, { organizationId: { notIn: hidden } }] } : {}) } })),
    count("texts", () => db.smsMessage.count({ where: { createdAt: Y, status: { in: ["SENT", "DELIVERED"] }, ...(hidden.length ? { OR: [{ organizationId: null }, { organizationId: { notIn: hidden } }] } : {}) } })),
    count("support", () => db.supportTicket.count({ where: { adminReadAt: null } })),
    part("support", gaps, null, async () => (await db.supportTicket.findFirst({ where: { adminReadAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }))?.createdAt.getTime() ?? null),
    count("homeowner requests", () => db.platformLead.count({ where: { status: "MANUAL_QUEUE", isTest: false } })),
  ]);

  // ── Trials and payers, off the trial board (test trials and hidden accounts already out). ──
  const rows = (board?.rows ?? []).filter((r) => !r.test && !hidden.includes(r.orgId));
  const onTrial = rows.filter((r) => r.phase === "trial");
  const paying = rows.filter((r) => r.phase === "paying");
  const endsToday = onTrial.filter((r) => r.trialEnd != null && r.trialEnd >= dayStart && r.trialEnd < dayEnd);
  const endsTomorrow = onTrial.filter((r) => r.trialEnd != null && r.trialEnd >= dayEnd && r.trialEnd < tomorrowEnd);
  const paidToday = paying.filter((r) => r.paidFrom != null && r.paidFrom >= dayStart);
  const paidYesterday = paying.filter((r) => r.paidFrom != null && r.paidFrom >= yStart && r.paidFrom < ySame);
  const trialsT = rows.filter((r) => r.trialStart != null && r.trialStart >= dayStart);
  const trialsY = rows.filter((r) => r.trialStart != null && r.trialStart >= yStart && r.trialStart < ySame);
  const byOrg = new Map(rows.map((r) => [r.orgId, r]));

  const acceptedSum = acceptedRowsT.reduce((a, p) => a + (p.total || 0), 0);
  const estimatesT = roofT + hvacT + plansT;
  const estimatesY = roofY + hvacY + plansY;
  const visitors = website ? { today: website.today, yesterday: website.yesterdaySoFar } : null;

  const tiles: OfficeTile[] = [
    { key: "visitors", label: "Website visitors", today: visitors?.today ?? 0, yesterday: visitors ? visitors.yesterday : null, missing: !visitors },
    { key: "signups", label: "Signups", today: signupsT, yesterday: signupsY },
    { key: "trials", label: "Trials started", today: trialsT.length, yesterday: trialsY.length, sub: `card ${trialsT.filter((r) => r.kind === "card").length} · no card ${trialsT.filter((r) => r.kind !== "card").length}` },
    { key: "paying", label: "New paying", today: paidToday.length, yesterday: paidYesterday.length, sub: paidToday.length ? `${money(paidToday.reduce((a, r) => a + (r.monthlyCents ?? 0), 0) / 100)}/mo added` : undefined },
    { key: "sent", label: "Proposals sent", today: sentT, yesterday: sentY },
    { key: "accepted", label: "Accepted by clients", today: acceptedRowsT.length, yesterday: acceptedY, sub: acceptedRowsT.length ? `${money(acceptedSum)} signed` : undefined },
  ];
  const strip: OfficeTile[] = [
    { key: "active", label: "In the app", today: activeT, yesterday: activeY },
    { key: "created", label: "Proposals made", today: createdT, yesterday: createdY },
    { key: "estimates", label: "Estimates", today: estimatesT, yesterday: estimatesY, sub: [roofT ? `${roofT} roof` : "", hvacT ? `${hvacT} HVAC` : "", plansT ? `${plansT} deck/fence` : ""].filter(Boolean).join(" · ") || undefined },
    { key: "leads", label: "Homeowner requests", today: leadsT, yesterday: leadsY },
    { key: "texts", label: "Texts sent", today: textsT, yesterday: textsY },
    { key: "support", label: "Support unread", today: supportUnread, yesterday: null },
  ];

  // ── Who is in the app now: the last screen of each person seen in ten minutes. ──
  const online = await part("people in the app", gaps, [] as OfficeScreenData["online"], async () => {
    const views = await db.pageView.findMany({ where: { at: { gte: new Date(now - ONLINE_MS) }, userId: userWhere, ...orgWhere }, orderBy: { at: "desc" }, take: 400, select: { userId: true, organizationId: true, route: true, at: true } });
    const last = new Map<string, (typeof views)[number]>();
    for (const v of views) if (v.userId && !last.has(v.userId)) last.set(v.userId, v);
    const picked = [...last.values()].slice(0, 14);
    const [users, orgs] = await Promise.all([
      db.user.findMany({ where: { id: { in: picked.map((v) => v.userId!) } }, select: { id: true, name: true, email: true } }),
      db.organization.findMany({ where: { id: { in: [...new Set(picked.map((v) => v.organizationId))] } }, select: { id: true, name: true } }),
    ]);
    const u = new Map(users.map((x) => [x.id, x]));
    const o = new Map(orgs.map((x) => [x.id, x.name]));
    return picked.map((v) => ({ name: u.get(v.userId!)?.name?.trim() || u.get(v.userId!)?.email?.split("@")[0] || "Someone", company: o.get(v.organizationId) ?? "", screen: screenWords(v.route), at: v.at.getTime() }));
  });

  // ── Today, as it happened. ──
  const feedItems: OfficeFeedItem[] = [];
  await Promise.all([
    part("signups", gaps, null, async () => {
      const orgs = await db.organization.findMany({ where: { createdAt: T, ...orgIdWhere }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, name: true, createdAt: true } });
      for (const o of orgs) {
        const r = byOrg.get(o.id);
        const how = r?.kind === "card" ? " — trial with a card" : r?.phase === "trial" ? " — trial, no card yet" : "";
        feedItems.push({ at: o.createdAt.getTime(), kind: "signup", who: o.name, text: `signed up${how}${r?.fromAd ? " · from an ad" : ""}` });
      }
      return null;
    }),
    part("proposals", gaps, null, async () => {
      const ps = await db.proposal.findMany({
        where: { OR: [{ createdAt: T }, { sentAt: T }, { viewedAt: T }, { acceptedAt: T }], ...orgWhere },
        orderBy: { updatedAt: "desc" },
        take: 120,
        select: { organizationId: true, total: true, trade: true, createdAt: true, sentAt: true, viewedAt: true, acceptedAt: true, organization: { select: { name: true } } },
      });
      // A first proposal is a moment: the company had none before today.
      const madeToday = [...new Set(ps.filter((p) => p.createdAt.getTime() >= dayStart).map((p) => p.organizationId))];
      const before = madeToday.length ? await db.proposal.groupBy({ by: ["organizationId"], where: { organizationId: { in: madeToday }, createdAt: { lt: new Date(dayStart) } }, _count: { _all: true } }) : [];
      const veteran = new Set(before.map((b) => b.organizationId));
      const firstDone = new Set<string>();
      for (const p of ps) {
        const who = p.organization?.name ?? "";
        const what = `${p.trade && TRADE_WORDS[p.trade] ? `${TRADE_WORDS[p.trade]} ` : ""}proposal${p.total > 0 ? ` · ${money(p.total)}` : ""}`;
        const aWhat = `${/^(HVAC|[aeiou])/i.test(what) ? "an" : "a"} ${what}`;
        if (p.createdAt.getTime() >= dayStart) {
          const first = !veteran.has(p.organizationId) && !firstDone.has(p.organizationId);
          if (first) firstDone.add(p.organizationId);
          feedItems.push({ at: p.createdAt.getTime(), kind: first ? "first" : "proposal", who, text: first ? `made their FIRST ${what}` : `made ${aWhat}`, win: first });
        }
        if (p.sentAt && p.sentAt.getTime() >= dayStart) feedItems.push({ at: p.sentAt.getTime(), kind: "sent", who, text: `sent ${aWhat} to a client` });
        if (p.viewedAt && p.viewedAt.getTime() >= dayStart) feedItems.push({ at: p.viewedAt.getTime(), kind: "opened", who, text: `'s client opened ${aWhat}` });
        if (p.acceptedAt && p.acceptedAt.getTime() >= dayStart) feedItems.push({ at: p.acceptedAt.getTime(), kind: "accepted", who, text: `'s client ACCEPTED ${aWhat}`, win: true });
      }
      return null;
    }),
    part("roof measurements", gaps, null, async () => {
      const rs = await db.roofMeasurement.findMany({ where: { createdAt: T, ...orgWhere }, orderBy: { createdAt: "desc" }, take: 30, select: { createdAt: true, city: true, address: true, squares: true, organization: { select: { name: true } } } });
      for (const r of rs) feedItems.push({ at: r.createdAt.getTime(), kind: "estimate", who: r.organization?.name ?? "", text: `measured a roof${townOf(r.address, r.city) ? ` in ${townOf(r.address, r.city)}` : ""}${r.squares ? ` · ${r.squares.toFixed(1)} squares` : ""}` });
      return null;
    }),
    part("HVAC estimates", gaps, null, async () => {
      const hs = await db.hvacEstimate.findMany({ where: { createdAt: T, ...orgWhere }, orderBy: { createdAt: "desc" }, take: 20, select: { createdAt: true, organizationId: true } });
      const orgNames = new Map((await db.organization.findMany({ where: { id: { in: [...new Set(hs.map((h) => h.organizationId))] } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
      for (const h of hs) feedItems.push({ at: h.createdAt.getTime(), kind: "estimate", who: orgNames.get(h.organizationId) ?? "", text: "sized an HVAC system" });
      return null;
    }),
    part("homeowner requests", gaps, null, async () => {
      const ls = await db.platformLead.findMany({ where: { createdAt: T, isTest: false }, orderBy: { createdAt: "desc" }, take: 20, select: { createdAt: true, city: true, detectedTrade: true, status: true } });
      for (const l of ls) feedItems.push({ at: l.createdAt.getTime(), kind: "lead", who: l.city?.trim() || "A homeowner", text: `asked for ${l.detectedTrade ? `a ${l.detectedTrade.toLowerCase()} pro` : "a contractor"}${l.status === "MATCHED" ? " · matched" : l.status === "MANUAL_QUEUE" ? " · waiting for a hand match" : ""}` });
      return null;
    }),
    part("support", gaps, null, async () => {
      const ts = await db.supportTicket.findMany({ where: { createdAt: T }, orderBy: { createdAt: "desc" }, take: 15, select: { createdAt: true, subject: true, organization: { select: { name: true } } } });
      for (const t of ts) feedItems.push({ at: t.createdAt.getTime(), kind: "support", who: t.organization?.name ?? "", text: `wrote to support: "${clip(t.subject, 60)}"` });
      return null;
    }),
  ]);
  // The investor link (2026-10-13): who introduced themselves today, and any offer.
  const [invVisitors, invOffers] = await Promise.all([
    part("investor link", gaps, [] as Awaited<ReturnType<typeof readInvestorVisitors>>, () => readInvestorVisitors()),
    part("investor link", gaps, [] as Awaited<ReturnType<typeof readInvestorOffers>>, () => readInvestorOffers()),
  ]);
  for (const v of invVisitors) {
    const at = Date.parse(v.lastSeen);
    if (at >= dayStart) feedItems.push({ at, kind: "investor", who: v.name, text: `${v.visits > 1 ? "came back to" : "opened"} the investor page · ${v.company} · ${v.kind}` });
  }
  for (const o of invOffers) {
    const at = Date.parse(o.at);
    if (at >= dayStart) feedItems.push({ at, kind: "offer", who: o.company, text: `sent a VC offer — ${o.type.toLowerCase()} · ${o.amount} · ${o.instrument}`, win: true });
  }
  for (const r of rows) {
    if (r.phase === "paying" && r.paidFrom != null && r.paidFrom >= dayStart) feedItems.push({ at: r.paidFrom, kind: "paid", who: r.orgName, text: `started PAYING${r.plan ? ` · ${r.plan}` : ""}${r.monthlyCents ? ` · ${money(r.monthlyCents / 100)}/mo` : ""}`, win: true });
    if (r.cardAddedAt != null && r.cardAddedAt >= dayStart) feedItems.push({ at: r.cardAddedAt, kind: "card", who: r.orgName, text: "added a card to their trial", win: true });
    if (r.cancelsAtEnd && r.canceledAt != null && r.canceledAt >= dayStart) feedItems.push({ at: r.canceledAt, kind: "cancel", who: r.orgName, text: "set their trial to cancel at the end" });
  }

  // ── Systems. ──
  const services: OfficeHealthRow[] = (healthReport?.services ?? []).map((s) => ({ name: s.name, level: s.level, reason: s.reason, optional: !!s.optional }));

  // ── Fourteen days of signups and proposals. ──
  const spark = await part("trend", gaps, { days: [] as number[], signups: [] as number[], proposals: [] as number[] }, async () => {
    const days: number[] = [];
    for (let d = sparkFrom; d <= dayStart; d = trafficDayStartMs(d + 30 * HOUR)) days.push(d);
    const [os, ps] = await Promise.all([
      db.organization.findMany({ where: { createdAt: { gte: new Date(sparkFrom) }, ...orgIdWhere }, select: { createdAt: true } }),
      db.proposal.findMany({ where: { createdAt: { gte: new Date(sparkFrom) }, ...orgWhere }, select: { createdAt: true }, take: 20000 }),
    ]);
    const bucket = (ts: number) => {
      let i = days.length - 1;
      while (i > 0 && ts < days[i]) i--;
      return i;
    };
    const signups = days.map(() => 0);
    const proposals = days.map(() => 0);
    for (const o of os) signups[bucket(o.createdAt.getTime())] += 1;
    for (const p of ps) proposals[bucket(p.createdAt.getTime())] += 1;
    return { days, signups, proposals };
  });

  const attention = buildAttention({
    now,
    dayStart,
    trialsEndingToday: endsToday.map((r) => ({ name: r.orgName, proposals: r.work.proposals, card: r.cardNow })),
    trialsEndingTomorrow: endsTomorrow.length,
    failedPayments: rows.filter((r) => r.phase === "failed").map((r) => r.orgName),
    setToCancelCard: onTrial.filter((r) => r.cancelsAtEnd && r.cardNow).map((r) => r.orgName),
    signupsToday: rows.filter((r) => r.createdAt >= dayStart).map((r) => ({ name: r.orgName, at: r.createdAt, lastSeen: r.work.lastSeen, views: r.work.views })),
    supportUnread,
    supportOldest,
    leadQueue,
    health: services,
    visitors,
    sentToday: sentT,
    sentYesterday: sentY,
    recentOffers: invOffers.filter((o) => now - Date.parse(o.at) < 3 * 24 * HOUR).map((o) => ({ company: o.company, amount: o.amount, at: Date.parse(o.at) })),
  });

  return {
    now,
    tz: TRAFFIC_TZ,
    dayStart,
    tiles,
    strip,
    online,
    activeToday: activeT,
    feed: orderFeed(feedItems, 40),
    attention,
    trials: {
      onTrial: onTrial.length,
      card: onTrial.filter((r) => r.cardNow).length,
      nocard: onTrial.filter((r) => !r.cardNow).length,
      endsToday: endsToday.length,
      endsTomorrow: endsTomorrow.length,
      setToCancel: onTrial.filter((r) => r.cancelsAtEnd).length,
      setToCancelCard: onTrial.filter((r) => r.cancelsAtEnd && r.cardNow).length,
      paying: paying.length,
      payingMonthlyCents: paying.reduce((a, r) => a + (r.monthlyCents ?? 0), 0),
      likelyCents: board?.onTrial.likelyCents ?? 0,
    },
    health: healthReport ? { ranAt: healthReport.ranAt, worst: healthReport.worst, services } : null,
    spark,
    gaps: [...new Set(gaps)],
  };
}

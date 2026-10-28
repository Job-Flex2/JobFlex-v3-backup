// WHAT MEMBERS DO — THE ANALYST OF THE TRAIL (owner, 2026-10-28: "analyze the user activity page … make some
// conclusions that will help us make the platform better based on what they do, or give us some statistics.
// Make it smart.")
//
// Pure: takes what lib/activityInsightsRead fetched — every counted workspace with its plan and members, the screens
// members opened (the trial watch's page views, in the sidebar's words), the trail, the estimates and the proposals
// — and returns statistics and FINDINGS: each a sentence of evidence with the numbers in it and one concrete thing to
// do, by rules with minimum samples, so it says nothing it cannot back. No I/O: qa/tests/logic/activity-insights
// .check.ts proves every rule on made-up workspaces.
//
// The questions it answers, in the owner's order: what do members actually use; what do new workspaces do on their
// first day and where do they stall; what did the ones who PAID do in their first week that the lost trials did not;
// do clients open and sign what is sent; which estimators are looked at but never used; is the team side used at
// all; which paying accounts have gone quiet; which trials are about to end with nothing in them; when do members
// work; how long is a sitting and where does it end.

export interface InsightOrg {
  id: string;
  name: string;
  createdAt: number;
  plan: string;
  status: string;
  trialEndsAt: number | null;
  /** Members of the workspace, and the user ids of its owners. */
  members: number;
  owners: string[];
}
export interface InsightView {
  orgId: string;
  userId: string;
  at: number;
  /** The screen in the sidebar's words ("Proposals", "Roof estimator · inventory") and its first part, the area. */
  screen: string;
  area: string;
}
export interface InsightEvent {
  orgId: string;
  actorId: string | null;
  kind: string;
  at: number;
  /** ESTIMATE rows: which estimator ("roof", "hvac", "fence", "deck", "lawn", "smart", "kitchen", "video"). */
  trade: string | null;
  proposalId: string | null;
  clientId: string | null;
}
export interface InsightProposal {
  orgId: string;
  createdAt: number;
  sentAt: number | null;
  viewedAt: number | null;
  acceptedAt: number | null;
  declinedAt: number | null;
  paidAt: number | null;
  total: number;
  trade: string | null;
}
export interface InsightInput {
  now: number;
  /** The start of the range; null = all time. */
  since: number | null;
  timezone: string;
  orgs: InsightOrg[];
  views: InsightView[];
  events: InsightEvent[];
  proposals: InsightProposal[];
  /** A read that hit its cap: the figures are of the newest rows only. */
  truncated: boolean;
}

export type InsightTone = "bad" | "warn" | "good" | "info";
export interface InsightFinding {
  key: string;
  tone: InsightTone;
  title: string;
  /** The evidence, numbers in it. */
  evidence: string;
  /** One concrete thing to do. */
  action: string;
  /** Workspaces the finding names, when it names any. */
  names?: string[];
}
export interface AreaRow {
  area: string;
  workspaces: number;
  /** Of the workspaces that opened any screen in the range. */
  share: number;
  views: number;
  payingShare: number | null;
  lapsedShare: number | null;
}
export interface CohortRow {
  what: string;
  paying: number;
  payingShare: number;
  lapsed: number;
  lapsedShare: number;
  gap: number;
}
export interface ActivityInsights {
  since: number | null;
  now: number;
  truncated: boolean;
  sample: {
    workspaces: number;
    active: number;
    viewers: number;
    newOnes: number;
    paying: number;
    trial: number;
    lapsed: number;
    members: number;
    views: number;
    events: number;
    sittings: number;
  };
  /** Nothing to read yet: the one line says so, and the findings are empty. */
  quiet: boolean;
  headline: string;
  findings: InsightFinding[];
  areas: AreaRow[];
  firstDay: {
    newOnes: number;
    priced: number;
    proposed: number;
    sent: number;
    idle: number;
    medianHoursToFirstProposal: number | null;
    firstScreens: Array<{ screen: string; n: number }>;
    endsOn: Array<{ screen: string; n: number }>;
  };
  cohorts: { paying: number; lapsed: number; rows: CohortRow[] } | null;
  proposals: {
    created: number;
    sent: number;
    viewed: number;
    accepted: number;
    declined: number;
    paid: number;
    openRate: number | null;
    winRate: number | null;
    medianHoursToView: number | null;
    medianHoursToAccept: number | null;
    byTrade: Array<{ trade: string; sent: number; accepted: number }>;
  };
  estimators: Array<{ trade: string; area: string; estimates: number; workspaces: number; lookers: number }>;
  team: { multiMember: number; share: number | null; nonOwnerActions: number; nonOwnerShare: number | null };
  quietPaying: Array<{ orgId: string; name: string; daysQuiet: number | null }>;
  endingEmpty: Array<{ orgId: string; name: string; daysLeft: number }>;
  hours: { byHour: number[]; byWeekday: number[]; weekendShare: number | null; busy: string };
  sittings: {
    n: number;
    medianMinutes: number | null;
    medianScreens: number | null;
    oneScreenShare: number | null;
    endsOn: Array<{ screen: string; n: number; share: number; viewShare: number; ratio: number }>;
  };
}

/** Workspaces the analyst needs before it speaks about shares. */
export const MIN_WORKSPACES = 5;
/** Each side of a paying-vs-lost comparison needs this many. */
const COHORT_MIN = 3;
/** A quiet paying account: nothing opened or done for this long. */
export const QUIET_DAYS = 14;
/** A trial "about to end": this many days left. */
const ENDING_DAYS = 3;
/** A gap of ten minutes between two screens is a new sitting (the same rule as "Working right now"). */
const SITTING_GAP_MS = 10 * 60_000;
const DAY = 86_400_000;
const HOUR = 3_600_000;

export type OrgState = "paying" | "trial" | "lapsed" | "other";
/** The same reading as the signup ledger's (lib/traffic-live signupState): paying only on a real plan. */
export function orgState(o: { plan: string; status: string }): OrgState {
  const status = (o.status || "").trim().toUpperCase();
  const plan = (o.plan || "").trim().toUpperCase();
  if (status === "TRIALING") return "trial";
  if (status === "ACTIVE") return plan && plan !== "FREE" ? "paying" : "other";
  if (["PAST_DUE", "UNPAID", "CANCELED", "EXPIRED", "TRIAL_ENDED"].includes(status)) return "lapsed";
  return "other";
}

/** Which estimator an ESTIMATE row came from → the sidebar area its screen has. */
export const ESTIMATOR_AREA: Readonly<Record<string, string>> = {
  roof: "Roof estimator",
  hvac: "HVAC estimator",
  fence: "Fence estimator",
  deck: "Deck Studio",
  lawn: "Lawn estimator",
  smart: "Smart Proposal",
  kitchen: "Design Studio",
  video: "Video estimator",
  blueprint: "Blueprint estimator",
};
const ESTIMATOR_AREAS = new Set(Object.values(ESTIMATOR_AREA));

export const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
const share = (n: number, d: number): number | null => (d > 0 ? n / d : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
export function hoursWords(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h < 10 ? h.toFixed(1).replace(/\.0$/, "") : Math.round(h)} h`;
  const d = h / 24;
  return `${d.toFixed(1).replace(/\.0$/, "")} days`;
}
export function hourWord(h: number): string {
  const x = ((h % 24) + 24) % 24;
  if (x === 0) return "12 am";
  if (x === 12) return "12 pm";
  return x < 12 ? `${x} am` : `${x - 12} pm`;
}

/** Hour (0–23) and weekday (0 = Sunday) of an instant in a zone; UTC when the zone is unknown. */
function localParts(at: number, timezone: string): { hour: number; weekday: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false, weekday: "short" }).formatToParts(new Date(at));
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
    return { hour, weekday: weekday < 0 ? 0 : weekday };
  } catch {
    const d = new Date(at);
    return { hour: d.getUTCHours(), weekday: d.getUTCDay() };
  }
}

/** The busy hours in words: every hour with at least 60% of the busiest hour's sittings, contiguous ones joined. */
export function busyHoursWords(byHour: readonly number[]): string {
  const max = Math.max(0, ...byHour);
  if (max === 0) return "";
  const busy = byHour.map((n) => n >= max * 0.6);
  const ranges: Array<[number, number]> = [];
  for (let h = 0; h < 24; h++) {
    if (!busy[h]) continue;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === h - 1) last[1] = h;
    else ranges.push([h, h]);
  }
  const words = ranges.slice(0, 3).map(([a, b]) => (a === b ? hourWord(a) : `${hourWord(a)}–${hourWord(b + 1)}`));
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0] ?? "";
}

export interface Sitting {
  orgId: string;
  userId: string;
  start: number;
  end: number;
  screens: number;
  first: string;
  last: string;
  areas: Set<string>;
}
/** Screens grouped into sittings per member: a gap of ten minutes starts a new one. */
export function sittingsOf(views: readonly InsightView[]): Sitting[] {
  const byUser = new Map<string, InsightView[]>();
  for (const v of views) {
    const list = byUser.get(v.userId);
    if (list) list.push(v);
    else byUser.set(v.userId, [v]);
  }
  const out: Sitting[] = [];
  for (const list of byUser.values()) {
    list.sort((a, b) => a.at - b.at);
    let cur: Sitting | null = null;
    for (const v of list) {
      if (cur && v.at - cur.end <= SITTING_GAP_MS && v.orgId === cur.orgId) {
        cur.end = v.at;
        cur.screens += 1;
        cur.last = v.screen;
        cur.areas.add(v.area);
      } else {
        cur = { orgId: v.orgId, userId: v.userId, start: v.at, end: v.at, screens: 1, first: v.screen, last: v.screen, areas: new Set([v.area]) };
        out.push(cur);
      }
    }
  }
  return out;
}

const topN = <T extends { n: number }>(rows: T[], n: number) => rows.sort((a, b) => b.n - a.n).slice(0, n);
const counts = <K>(items: Iterable<K>): Map<K, number> => {
  const m = new Map<K, number>();
  for (const k of items) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
};

/** What a workspace did inside a window after it was made (its first day, its first week). */
function didWithin(orgId: string, from: number, until: number, idx: Index): { priced: boolean; proposed: boolean; sent: boolean; client: boolean; areas: Set<string> } {
  const inWin = (t: number) => t >= from && t <= until;
  const ev = idx.eventsByOrg.get(orgId) ?? [];
  const pr = idx.proposalsByOrg.get(orgId) ?? [];
  const vw = idx.viewsByOrg.get(orgId) ?? [];
  return {
    priced: ev.some((e) => e.kind === "ESTIMATE" && inWin(e.at)),
    proposed: pr.some((p) => inWin(p.createdAt)) || ev.some((e) => e.kind === "CREATED" && e.proposalId && inWin(e.at)),
    sent: pr.some((p) => p.sentAt !== null && inWin(p.sentAt)),
    client: ev.some((e) => (e.kind === "CLIENT" || (e.kind === "CREATED" && e.clientId)) && inWin(e.at)),
    areas: new Set(vw.filter((v) => inWin(v.at)).map((v) => v.area)),
  };
}

interface Index {
  eventsByOrg: Map<string, InsightEvent[]>;
  proposalsByOrg: Map<string, InsightProposal[]>;
  viewsByOrg: Map<string, InsightView[]>;
}
const groupBy = <T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
};

export function analyseActivity(input: InsightInput): ActivityInsights {
  const { now, since, timezone } = input;
  const orgs = input.orgs;
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  // Rows of workspaces the read did not return (deleted since) are left out everywhere.
  const views = input.views.filter((v) => orgById.has(v.orgId));
  const events = input.events.filter((e) => orgById.has(e.orgId) && e.kind !== "TEST");
  const proposals = input.proposals.filter((p) => orgById.has(p.orgId));
  const idx: Index = { eventsByOrg: groupBy(events, (e) => e.orgId), proposalsByOrg: groupBy(proposals, (p) => p.orgId), viewsByOrg: groupBy(views, (v) => v.orgId) };
  const state = new Map(orgs.map((o) => [o.id, orgState(o)]));
  const byState = (s: OrgState) => orgs.filter((o) => state.get(o.id) === s);

  // ── who was here ──
  const lastAt = new Map<string, number>();
  for (const v of views) lastAt.set(v.orgId, Math.max(lastAt.get(v.orgId) ?? 0, v.at));
  for (const e of events) lastAt.set(e.orgId, Math.max(lastAt.get(e.orgId) ?? 0, e.at));
  const activeIds = new Set(lastAt.keys());
  const viewerIds = new Set(views.map((v) => v.orgId));
  const members = new Set(views.map((v) => v.userId));
  for (const e of events) if (e.actorId) members.add(e.actorId);
  const newOnes = orgs.filter((o) => (since === null || o.createdAt >= since) && o.createdAt <= now);
  const sittings = sittingsOf(views);

  // ── the areas members use ──
  const payingViewers = [...viewerIds].filter((id) => state.get(id) === "paying").length;
  const lapsedViewers = [...viewerIds].filter((id) => state.get(id) === "lapsed").length;
  const areaOrgs = new Map<string, Set<string>>();
  const areaViews = counts(views.map((v) => v.area));
  for (const v of views) {
    const set = areaOrgs.get(v.area);
    if (set) set.add(v.orgId);
    else areaOrgs.set(v.area, new Set([v.orgId]));
  }
  const areas: AreaRow[] = [...areaOrgs.entries()]
    .map(([area, set]) => ({
      area,
      workspaces: set.size,
      share: share(set.size, viewerIds.size) ?? 0,
      views: areaViews.get(area) ?? 0,
      payingShare: payingViewers >= COHORT_MIN ? share([...set].filter((id) => state.get(id) === "paying").length, payingViewers) : null,
      lapsedShare: lapsedViewers >= COHORT_MIN ? share([...set].filter((id) => state.get(id) === "lapsed").length, lapsedViewers) : null,
    }))
    .sort((a, b) => b.workspaces - a.workspaces || b.views - a.views);

  // ── the first day of a new workspace ──
  const firstDays = newOnes.map((o) => ({ o, did: didWithin(o.id, o.createdAt, o.createdAt + DAY, idx) }));
  const firstSittings = newOnes.map((o) => sittings.filter((s) => s.orgId === o.id && s.start <= o.createdAt + DAY).sort((a, b) => a.start - b.start)[0]).filter((s): s is Sitting => !!s);
  const hoursToFirstProposal = newOnes
    .map((o) => {
      const first = (idx.proposalsByOrg.get(o.id) ?? []).reduce<number | null>((m, p) => (m === null || p.createdAt < m ? p.createdAt : m), null);
      return first === null ? null : (first - o.createdAt) / HOUR;
    })
    .filter((h): h is number => h !== null && h >= 0);
  const settled = newOnes.filter((o) => now - o.createdAt >= 3 * DAY);
  const idle = settled.filter((o) => !didWithin(o.id, o.createdAt, now, idx).priced && !didWithin(o.id, o.createdAt, now, idx).proposed);
  const firstDay: ActivityInsights["firstDay"] = {
    newOnes: newOnes.length,
    priced: firstDays.filter((f) => f.did.priced).length,
    proposed: firstDays.filter((f) => f.did.proposed).length,
    sent: firstDays.filter((f) => f.did.sent).length,
    idle: idle.length,
    medianHoursToFirstProposal: median(hoursToFirstProposal),
    firstScreens: topN([...counts(firstSittings.map((s) => s.first)).entries()].map(([screen, n]) => ({ screen, n })), 5),
    endsOn: topN([...counts(firstSittings.map((s) => s.last)).entries()].map(([screen, n]) => ({ screen, n })), 5),
  };

  // ── what the ones who paid did in their first week, against the lost trials ──
  const decided = orgs.filter((o) => (since === null || o.createdAt >= since) && now - o.createdAt >= 7 * DAY);
  const payingCohort = decided.filter((o) => state.get(o.id) === "paying");
  const lapsedCohort = decided.filter((o) => state.get(o.id) === "lapsed");
  let cohorts: ActivityInsights["cohorts"] = null;
  if (payingCohort.length >= COHORT_MIN && lapsedCohort.length >= COHORT_MIN) {
    const week = (o: InsightOrg) => didWithin(o.id, o.createdAt, o.createdAt + 7 * DAY, idx);
    const pw = payingCohort.map(week);
    const lw = lapsedCohort.map(week);
    const row = (what: string, test: (d: ReturnType<typeof didWithin>, o: InsightOrg) => boolean): CohortRow => {
      const paying = pw.filter((d, i) => test(d, payingCohort[i])).length;
      const lapsed = lw.filter((d, i) => test(d, lapsedCohort[i])).length;
      const payingShare = paying / payingCohort.length;
      const lapsedShare = lapsed / lapsedCohort.length;
      return { what, paying, payingShare, lapsed, lapsedShare, gap: payingShare - lapsedShare };
    };
    const rows = [
      row("Priced an estimate", (d) => d.priced),
      row("Created a proposal", (d) => d.proposed),
      row("Sent a proposal", (d) => d.sent),
      row("Added a client", (d) => d.client),
      row("Invited a teammate", (_d, o) => o.members > 1),
      ...areas.slice(0, 8).map((a) => row(`Opened ${a.area}`, (d) => d.areas.has(a.area))),
    ];
    cohorts = { paying: payingCohort.length, lapsed: lapsedCohort.length, rows };
  }

  // ── proposals: sent, opened, signed ──
  const inRange = (t: number | null): t is number => t !== null && (since === null || t >= since) && t <= now;
  const sentOnes = proposals.filter((p) => inRange(p.sentAt));
  // A signed proposal was seen, whether or not the portal recorded the open (signed in person, on paper).
  const viewedOnes = sentOnes.filter((p) => p.viewedAt !== null || p.acceptedAt !== null);
  const acceptedOnes = sentOnes.filter((p) => p.acceptedAt !== null);
  const tradeCounts = new Map<string, { sent: number; accepted: number }>();
  for (const p of sentOnes) {
    const t = p.trade || "other";
    const row = tradeCounts.get(t) ?? { sent: 0, accepted: 0 };
    row.sent += 1;
    if (p.acceptedAt !== null) row.accepted += 1;
    tradeCounts.set(t, row);
  }
  const proposalStats: ActivityInsights["proposals"] = {
    created: proposals.filter((p) => inRange(p.createdAt)).length,
    sent: sentOnes.length,
    viewed: viewedOnes.length,
    accepted: acceptedOnes.length,
    declined: sentOnes.filter((p) => p.declinedAt !== null).length,
    paid: sentOnes.filter((p) => p.paidAt !== null).length,
    openRate: share(viewedOnes.length, sentOnes.length),
    winRate: share(acceptedOnes.length, sentOnes.length),
    medianHoursToView: median(viewedOnes.map((p) => (((p.viewedAt ?? p.acceptedAt) as number) - (p.sentAt as number)) / HOUR).filter((h) => h >= 0)),
    medianHoursToAccept: median(acceptedOnes.map((p) => ((p.acceptedAt as number) - (p.sentAt as number)) / HOUR).filter((h) => h >= 0)),
    byTrade: [...tradeCounts.entries()].map(([trade, c]) => ({ trade, ...c })).sort((a, b) => b.sent - a.sent),
  };

  // ── estimators: used, and looked at without pricing ──
  const estimateEvents = events.filter((e) => e.kind === "ESTIMATE");
  const byTrade = groupBy(estimateEvents, (e) => e.trade || "other");
  const estimators: ActivityInsights["estimators"] = [...new Set([...byTrade.keys(), ...Object.keys(ESTIMATOR_AREA).filter((t) => areaOrgs.has(ESTIMATOR_AREA[t]))])]
    .map((trade) => {
      const rows = byTrade.get(trade) ?? [];
      const area = ESTIMATOR_AREA[trade] ?? trade;
      const used = new Set(rows.map((e) => e.orgId));
      const looked = areaOrgs.get(area) ?? new Set<string>();
      return { trade, area, estimates: rows.length, workspaces: used.size, lookers: [...looked].filter((id) => !used.has(id)).length };
    })
    .sort((a, b) => b.estimates - a.estimates || b.lookers - a.lookers);

  // ── the team side ──
  const multi = orgs.filter((o) => o.members > 1);
  const ownerSet = new Map(orgs.map((o) => [o.id, new Set(o.owners)]));
  const acted = events.filter((e) => e.actorId);
  const nonOwner = acted.filter((e) => !ownerSet.get(e.orgId)?.has(e.actorId as string));
  const team: ActivityInsights["team"] = {
    multiMember: multi.length,
    share: share(multi.length, orgs.length),
    nonOwnerActions: nonOwner.length,
    nonOwnerShare: share(nonOwner.length, acted.length),
  };

  // ── paying accounts gone quiet; trials ending with nothing in them ──
  const quietPaying = byState("paying")
    .filter((o) => now - o.createdAt >= QUIET_DAYS * DAY)
    .map((o) => ({ orgId: o.id, name: o.name, last: lastAt.get(o.id) ?? null }))
    .filter((r) => r.last === null || now - r.last >= QUIET_DAYS * DAY)
    .map((r) => ({ orgId: r.orgId, name: r.name, daysQuiet: r.last === null ? null : Math.floor((now - r.last) / DAY) }))
    .sort((a, b) => (b.daysQuiet ?? Infinity) - (a.daysQuiet ?? Infinity));
  const endingEmpty = byState("trial")
    .filter((o) => o.trialEndsAt !== null && o.trialEndsAt >= now - DAY && o.trialEndsAt <= now + ENDING_DAYS * DAY)
    .filter((o) => {
      const did = didWithin(o.id, 0, now, idx);
      return !did.priced && !did.proposed;
    })
    .map((o) => ({ orgId: o.id, name: o.name, daysLeft: Math.max(0, Math.ceil(((o.trialEndsAt as number) - now) / DAY)) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // ── when members work ──
  const byHour = new Array<number>(24).fill(0);
  const byWeekday = new Array<number>(7).fill(0);
  for (const s of sittings) {
    const { hour, weekday } = localParts(s.start, timezone);
    byHour[hour] += 1;
    byWeekday[weekday] += 1;
  }
  const hours: ActivityInsights["hours"] = {
    byHour,
    byWeekday,
    weekendShare: share(byWeekday[0] + byWeekday[6], sittings.length),
    busy: busyHoursWords(byHour),
  };

  // ── sittings: how long, how many screens, where they end ──
  const endCounts = counts(sittings.map((s) => s.last));
  const screenViews = counts(views.map((v) => v.screen));
  const endsOn = [...endCounts.entries()]
    .map(([screen, n]) => {
      const sh = n / Math.max(1, sittings.length);
      const vs = (screenViews.get(screen) ?? 0) / Math.max(1, views.length);
      return { screen, n, share: sh, viewShare: vs, ratio: vs > 0 ? sh / vs : 0 };
    })
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const sittingStats: ActivityInsights["sittings"] = {
    n: sittings.length,
    medianMinutes: median(sittings.map((s) => (s.end - s.start) / 60_000)),
    medianScreens: median(sittings.map((s) => s.screens)),
    oneScreenShare: share(sittings.filter((s) => s.screens === 1).length, sittings.length),
    endsOn,
  };

  const sample: ActivityInsights["sample"] = {
    workspaces: orgs.length,
    active: activeIds.size,
    viewers: viewerIds.size,
    newOnes: newOnes.length,
    paying: byState("paying").length,
    trial: byState("trial").length,
    lapsed: byState("lapsed").length,
    members: members.size,
    views: views.length,
    events: events.length,
    sittings: sittings.length,
  };

  // ── the findings ──
  const findings: InsightFinding[] = [];
  const quiet = activeIds.size < MIN_WORKSPACES;
  if (!quiet) {
    // What members live in.
    const top = areas.filter((a) => a.area !== "Overview").slice(0, 3);
    if (top.length >= 2) {
      findings.push({
        key: "top-areas",
        tone: "info",
        title: `Members live in ${top.map((a) => a.area).join(", ")}`,
        evidence: `Of the ${plural(viewerIds.size, "workspace")} that opened anything: ${top.map((a) => `${a.area} ${pct(a.workspaces, viewerIds.size)}`).join(", ")}.`,
        action: "These are the screens to keep fast and polish first — every change there is seen by most of the product.",
      });
    }
    // What nobody opens.
    if (viewerIds.size >= 10) {
      const unused = areas.filter((a) => a.area !== "Overview" && a.share < 0.1);
      if (unused.length) {
        findings.push({
          key: "unused-areas",
          tone: "warn",
          title: `${unused.length === 1 ? "One screen" : `${unused.length} screens`} almost nobody opens`,
          evidence: `${unused.slice(0, 6).map((a) => `${a.area} (${a.workspaces})`).join(", ")}${unused.length > 6 ? "…" : ""} — each opened by fewer than one workspace in ten.`,
          action: "Either they are not found or not wanted: show each once to a new workspace in its first week (a card on the overview), or fold it into the screen members already use.",
        });
      }
    }
    // The first day.
    if (newOnes.length >= MIN_WORKSPACES) {
      const pricedShare = firstDay.priced / newOnes.length;
      const stall = firstDay.endsOn.find((e) => e.screen !== "Overview");
      findings.push({
        key: "first-day",
        tone: pricedShare >= 0.5 ? "good" : "warn",
        title: pricedShare >= 0.5 ? "Most new workspaces price something on day one" : "Most new workspaces price nothing on day one",
        evidence: `${firstDay.priced} of ${plural(newOnes.length, "new workspace")} ran an estimate in their first 24 hours, ${firstDay.proposed} wrote a proposal and ${firstDay.sent} sent one${firstDay.medianHoursToFirstProposal !== null ? `; the median first proposal came ${hoursWords(firstDay.medianHoursToFirstProposal)} after sign-up` : ""}.${stall ? ` The first sitting ends on ${stall.screen} more than anywhere else (${stall.n}).` : ""}`,
        action: pricedShare >= 0.5
          ? "Keep the first screen pointed at the estimator — it is working."
          : `Put the estimator for the workspace's trade on the very first screen after sign-up, with the address box focused${stall && stall.screen !== "Overview" ? `, and look at ${stall.screen}: that is where they give up` : ""}.`,
      });
    }
    if (settled.length >= MIN_WORKSPACES && idle.length / settled.length >= 0.3) {
      const opened = counts(idle.flatMap((o) => [...new Set((idx.viewsByOrg.get(o.id) ?? []).map((v) => v.area))]));
      const where = topN([...opened.entries()].filter(([a]) => a !== "Overview").map(([screen, n]) => ({ screen, n })), 2);
      findings.push({
        key: "idle-new",
        tone: "bad",
        title: `${idle.length} of ${plural(settled.length, "new workspace")} never priced or wrote anything`,
        evidence: `Three days or more after sign-up, nothing estimated and no proposal${where.length ? ` — what they did open: ${where.map((w) => `${w.screen} (${w.n})`).join(", ")}` : ""}.`,
        action: "A workspace with nothing in it after three days is a lost trial: send a one-line email on day two with a link that opens their estimator on their own address, and a call for the ones that came from an ad.",
        names: idle.slice(0, 8).map((o) => o.name),
      });
    }
    // The buyers' habit.
    if (cohorts) {
      const best = [...cohorts.rows].sort((a, b) => b.gap - a.gap)[0];
      if (best && best.gap >= 0.25) {
        findings.push({
          key: "buyers-habit",
          tone: "good",
          title: `${best.what.toLowerCase()} in week one is what separates the ones who paid`,
          evidence: `${best.paying} of ${plural(cohorts.paying, "paying account")} did it in their first seven days; ${best.lapsed} of ${plural(cohorts.lapsed, "lost trial")} did.`,
          action: `Make "${best.what.toLowerCase()}" the one thing the trial asks for: the welcome email, the first screen and the day-three nudge all point at it, and the trial emails stop once it is done.`,
        });
      }
    }
    // Proposals: opened and signed.
    if (proposalStats.sent >= 10 && proposalStats.openRate !== null) {
      const low = proposalStats.openRate < 0.5;
      findings.push({
        key: "proposal-outcomes",
        tone: low ? "warn" : "info",
        title: low ? "Half the sent proposals are never opened" : `Clients open ${pct(proposalStats.viewed, proposalStats.sent)} of sent proposals and sign ${pct(proposalStats.accepted, proposalStats.sent)}`,
        evidence: `${proposalStats.sent} sent, ${proposalStats.viewed} opened, ${proposalStats.accepted} signed, ${proposalStats.paid} paid${proposalStats.medianHoursToView !== null ? `; the median open takes ${hoursWords(proposalStats.medianHoursToView)}` : ""}${proposalStats.medianHoursToAccept !== null ? ` and the median signature ${hoursWords(proposalStats.medianHoursToAccept)}` : ""}.`,
        action: low
          ? "The send is not landing: check that the proposal email reaches the inbox (a text with the link beside it), and add a reminder two days after a send nobody opened."
          : "Add a reminder two days after a send that was opened and not signed — that is where the signatures are.",
      });
    }
    // Estimators looked at, not used.
    for (const e of estimators) {
      const looked = e.workspaces + e.lookers;
      if (looked >= 8 && e.lookers / looked >= 0.5 && ESTIMATOR_AREAS.has(e.area)) {
        findings.push({
          key: `lookers-${e.trade}`,
          tone: "warn",
          title: `${e.area}: ${e.lookers} of ${plural(looked, "workspace")} opened it and never priced anything`,
          evidence: `${e.estimates} estimates from ${e.workspaces} workspaces in the range; the other ${e.lookers} opened the screen and left without one.`,
          action: `Walk its first step on a phone and a desk as a new account: whatever asks for a key, an address format or a step they do not understand is where ${e.lookers} workspaces stopped.`,
        });
      }
    }
    // The team side.
    if (orgs.length >= 10 && team.share !== null) {
      findings.push({
        key: "team",
        tone: team.share < 0.2 ? "info" : "good",
        title: team.share < 0.2 ? "The product is used alone" : `${pct(team.multiMember, orgs.length)} of workspaces have a team`,
        evidence: `${team.multiMember} of ${plural(orgs.length, "workspace")} have a second member${team.nonOwnerShare !== null ? `; ${pct(team.nonOwnerActions, acted.length)} of recorded actions are by someone other than the owner` : ""}.`,
        action: team.share < 0.2
          ? "The crew, roles and job-texting features are unseen by most accounts: invite the second member during the trial (\"who runs your jobs?\") and show what the crew sees — or sell the single-operator plan on the single-operator story."
          : "Keep the owner's surfaces showing who did what — that is what a team owner pays for.",
      });
    }
    // Quiet paying accounts.
    if (quietPaying.length) {
      findings.push({
        key: "quiet-paying",
        tone: "bad",
        title: `${plural(quietPaying.length, "paying account")} gone quiet`,
        evidence: `Nothing opened or done for ${QUIET_DAYS} days or more${quietPaying.some((q) => q.daysQuiet !== null) ? `; the most recent of them was seen ${Math.min(...quietPaying.filter((q) => q.daysQuiet !== null).map((q) => q.daysQuiet as number))} days ago` : ""}${quietPaying.some((q) => q.daysQuiet === null) ? `; ${plural(quietPaying.filter((q) => q.daysQuiet === null).length, "was", "were")} not seen in the range at all` : ""}.`,
        action: "A paying account that stopped using the product cancels at the next invoice: one personal email each this week — what were they trying to do, and can we do it for them.",
        names: quietPaying.slice(0, 8).map((q) => `${q.name} · ${q.daysQuiet !== null ? `${q.daysQuiet} d` : "not seen"}`),
      });
    }
    // Trials ending with nothing in them.
    if (endingEmpty.length) {
      findings.push({
        key: "ending-empty",
        tone: "warn",
        title: `${plural(endingEmpty.length, "trial")} ending within ${ENDING_DAYS} days with nothing in ${endingEmpty.length === 1 ? "it" : "them"}`,
        evidence: `No estimate and no proposal in ${endingEmpty.length === 1 ? "it" : "any of them"}; the first ends ${endingEmpty[0].daysLeft === 0 ? "today" : endingEmpty[0].daysLeft === 1 ? "tomorrow" : `in ${endingEmpty[0].daysLeft} days`}.`,
        action: "These will not convert on their own: a call or a text today with an offer to price their first job together.",
        names: endingEmpty.slice(0, 8).map((t) => `${t.name} · ${t.daysLeft === 0 ? "today" : `${t.daysLeft} d left`}`),
      });
    }
    // Hours.
    if (sittings.length >= 30 && hours.busy) {
      findings.push({
        key: "hours",
        tone: "info",
        title: `Members work ${hours.busy}`,
        evidence: `${plural(sittings.length, "sitting")} in the range${hours.weekendShare !== null ? `, ${pct(byWeekday[0] + byWeekday[6], sittings.length)} of them on a weekend` : ""}; a typical sitting is ${sittingStats.medianMinutes !== null ? `${Math.round(sittingStats.medianMinutes)} min` : "short"} and ${sittingStats.medianScreens ?? 1} screens.`,
        action: `Support replies and deploys go out around those hours — a reply inside a sitting is answered; one sent at midnight waits a day. Deploy outside them.`,
      });
    }
    // Where sittings end.
    const deadEnd = endsOn.find((e) => e.n >= 10 && e.ratio >= 2 && e.screen !== "Overview" && !/^Proposals$|^Calendar$|^Jobs$/.test(e.screen));
    if (deadEnd) {
      findings.push({
        key: "dead-end",
        tone: "warn",
        title: `Sittings end on ${deadEnd.screen} ${deadEnd.ratio.toFixed(1)}× more than its share`,
        evidence: `${deadEnd.n} of ${plural(sittings.length, "sitting")} ended there (${pct(deadEnd.n, sittings.length)}), though it is ${pct(Math.round(deadEnd.viewShare * views.length), views.length)} of all screens opened.`,
        action: "Open it as a member and look for the dead end — a save with no next step, an error that shows nothing, a page that needs something they do not have.",
      });
    }
  }
  const order: Record<InsightTone, number> = { bad: 0, warn: 1, good: 2, info: 3 };
  findings.sort((a, b) => order[a.tone] - order[b.tone]);

  // ── the one line ──
  const headline = quiet
    ? `${plural(activeIds.size, "workspace")} active in the range — the analyst speaks from ${MIN_WORKSPACES}.`
    : [
        `${activeIds.size} active of ${plural(orgs.length, "workspace")} (${sample.paying} paying, ${sample.trial} on trial)`,
        areas.filter((a) => a.area !== "Overview").slice(0, 2).length ? `members live in ${areas.filter((a) => a.area !== "Overview").slice(0, 2).map((a) => a.area).join(" and ")}` : "",
        newOnes.length ? `${firstDay.priced} of ${newOnes.length} new ones priced something on day one` : "",
        quietPaying.length ? `${plural(quietPaying.length, "paying account")} gone quiet` : "",
      ].filter(Boolean).join(" · ") + ".";

  return {
    since,
    now,
    truncated: input.truncated,
    sample,
    quiet,
    headline,
    findings,
    areas,
    firstDay,
    cohorts,
    proposals: proposalStats,
    estimators,
    team,
    quietPaying,
    endingEmpty,
    hours,
    sittings: sittingStats,
  };
}

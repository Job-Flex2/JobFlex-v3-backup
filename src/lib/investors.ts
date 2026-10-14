import "server-only";
// THE INVESTOR PAGE'S DATA (owner, 2026-10-06) — what is kept, and the one
// read that builds the report for the admin page, the shared link and the
// PDF alike. Nothing new in the schema: three SyncState rows.
//
//   adSpend          the ad budget, a list of days — typed in by hand until
//                    Meta's API token arrives (then a cron writes the same
//                    rows with source "meta" and the hand entries stay);
//   investorSettings the realistic share (60% unless changed), the projected
//                    daily spend, the horizon, the trial length, and the
//                    shared link's token and switch;
//
// The accounts come from the same rows the signups list reads (since the ad
// launch, hidden accounts out, lib/statsHidden), priced the same way (lib/
// trialProjectionRead); the visitors from the live map's totals.
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { countedOrgs, statsHiddenIds } from "@/lib/statsHidden";
import { signupState } from "@/lib/traffic-live";
import { TRAFFIC_SINCE, TRAFFIC_SINCE_MS, TRAFFIC_TZ } from "@/lib/traffic-visitor";
import { fetchInvestorVisitors } from "@/lib/traffic-server";
import { valueSignups } from "@/lib/trialProjectionRead";
import { investorFigures, cohortFigures, dayOf, PLATFORMS, PLATFORM_LABEL, spendPeriods, addDays, type CohortFigures, type InvestorAssumptions, type InvestorFigures, type PolicySpan, type SpendDay, type SpendPlatform, type SpendPeriod, type TrialCohort } from "@/lib/investorModel";
import { cardlessKey } from "@/lib/trialState";
import { readTrialPolicyHistory, signupTrialState } from "@/lib/trialPolicyServer";

export const AD_SPEND_KEY = "adSpend";
export const INVESTOR_SETTINGS_KEY = "investorSettings";
/** When Meta's figures were last read, and how it went (lib/metaAdSpend). */
export const META_SPEND_STATUS_KEY = "metaAdSpendStatus";
/** Meta's own figures by day and by campaign, the last read (lib/metaAdSpend). */
export const META_INSIGHTS_KEY = "metaInsights";

// The platform list lives in the pure model so the client page can list it.
export { PLATFORMS, PLATFORM_LABEL, type SpendPlatform } from "@/lib/investorModel";

export interface AdSpendEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  platform: SpendPlatform;
  cents: number;
  source: "manual" | "meta";
  note?: string;
  by?: string | null;
  at: string;
}

export interface InvestorSettings extends InvestorAssumptions {
  /** The day the first campaign went live (owner, 2026-10-06: "count only what
   *  happened after that"); null = the live map's start, TRAFFIC_SINCE. */
  sinceDate: string | null;
  linkToken: string | null;
  linkEnabled: boolean;
  /** When the link was last made. */
  linkMadeAt: string | null;
}

export const DEFAULT_SETTINGS: InvestorSettings = { realisticPct: 60, spendPerDayCents: null, horizonDays: 180, trialDays: 7, dailyBudgetCents: null, budgetFrom: null, sinceDate: null, linkToken: null, linkEnabled: false, linkMadeAt: null };
const MAX_ENTRIES = 3000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const parse = <T,>(text: string | null | undefined): T | null => {
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
};
async function readKey(key: string): Promise<string | null> {
  try {
    return (await db.syncState.findUnique({ where: { key }, select: { cursor: true } }))?.cursor ?? null;
  } catch {
    return null;
  }
}
async function writeKey(key: string, value: unknown): Promise<void> {
  const cursor = JSON.stringify(value);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

/* ── ad spend ─────────────────────────────────────────────────────────── */

export function cleanEntries(raw: unknown): AdSpendEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: AdSpendEntry[] = [];
  for (const e of raw) {
    const r = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
    const date = typeof r.date === "string" && DATE.test(r.date) ? r.date : null;
    const cents = typeof r.cents === "number" && Number.isFinite(r.cents) ? Math.round(r.cents) : NaN;
    if (!date || !Number.isFinite(cents) || cents < 0 || typeof r.id !== "string") continue;
    out.push({
      id: r.id.slice(0, 40),
      date,
      platform: (PLATFORMS as readonly string[]).includes(String(r.platform)) ? (r.platform as SpendPlatform) : "other",
      cents,
      source: r.source === "meta" ? "meta" : "manual",
      note: typeof r.note === "string" ? r.note.slice(0, 120) : undefined,
      by: typeof r.by === "string" ? r.by : null,
      at: typeof r.at === "string" ? r.at : new Date(0).toISOString(),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, MAX_ENTRIES);
}

export async function readAdSpend(): Promise<AdSpendEntry[]> {
  return cleanEntries(parse(await readKey(AD_SPEND_KEY)));
}

export interface AddSpendInput {
  from: string;
  to: string;
  perDayCents: number;
  platform: SpendPlatform;
  note?: string;
}

/** One entry per day from `from` to `to` (366 days at most), replacing hand entries of the same platform on those days. */
export async function addAdSpend(input: AddSpendInput, by: string | null): Promise<AdSpendEntry[]> {
  const days: string[] = [];
  for (let d = input.from; d <= input.to && days.length < 366; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) days.push(d);
  const now = new Date().toISOString();
  const fresh: AdSpendEntry[] = days.map((date) => ({ id: `${date}-${input.platform}-${randomBytes(3).toString("hex")}`, date, platform: input.platform, cents: Math.round(input.perDayCents), source: "manual", note: input.note?.trim() || undefined, by, at: now }));
  const have = await readAdSpend();
  const replaced = new Set(days);
  // A hand-typed day replaces whatever that platform had on it — Meta's own figure too, on purpose.
  const kept = have.filter((e) => !(e.platform === input.platform && replaced.has(e.date)));
  const next = cleanEntries([...kept, ...fresh]);
  await writeKey(AD_SPEND_KEY, next);
  return next;
}

/** Meta's own spend per day (lib/metaAdSpend): on those days the Meta figure
 *  replaces anything Meta had, typed or read earlier; other platforms stay. */
export async function writeMetaSpend(days: Array<{ date: string; cents: number }>): Promise<AdSpendEntry[]> {
  const now = new Date().toISOString();
  const clean = days.filter((d) => DATE.test(d.date) && Number.isFinite(d.cents) && d.cents >= 0);
  const replaced = new Set(clean.map((d) => d.date));
  const fresh: AdSpendEntry[] = clean.map((d) => ({ id: `${d.date}-meta-api`, date: d.date, platform: "meta", cents: Math.round(d.cents), source: "meta", by: null, at: now }));
  const kept = (await readAdSpend()).filter((e) => !(e.platform === "meta" && replaced.has(e.date)));
  const next = cleanEntries([...kept, ...fresh]);
  await writeKey(AD_SPEND_KEY, next);
  return next;
}

export interface MetaSpendStatus { lastPulledAt: string | null; lastError: string | null; daysPulled: number }
export interface MetaDay { date: string; spendCents: number; impressions: number; clicks: number; reach: number }
export interface MetaCampaign { id: string; name: string; spendCents: number; impressions: number; clicks: number; reach: number }
export interface MetaInsights { at: string; since: string; until: string; /** The campaign totals' first day (the investors' start day when inside the window). */ campaignsSince: string; days: MetaDay[]; campaigns: MetaCampaign[] }
const n0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
export function cleanInsights(raw: unknown): MetaInsights | null {
  const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!r || typeof r.at !== "string") return null;
  const days = Array.isArray(r.days) ? r.days.map((d) => d as Record<string, unknown>).filter((d) => typeof d.date === "string" && DATE.test(d.date)).map((d) => ({ date: d.date as string, spendCents: n0(d.spendCents), impressions: n0(d.impressions), clicks: n0(d.clicks), reach: n0(d.reach) })) : [];
  const campaigns = Array.isArray(r.campaigns) ? r.campaigns.map((c) => c as Record<string, unknown>).filter((c) => typeof c.id === "string").map((c) => ({ id: String(c.id).slice(0, 40), name: typeof c.name === "string" ? c.name.slice(0, 120) : "", spendCents: n0(c.spendCents), impressions: n0(c.impressions), clicks: n0(c.clicks), reach: n0(c.reach) })) : [];
  const since = typeof r.since === "string" ? r.since : "";
  return { at: r.at, since, until: typeof r.until === "string" ? r.until : "", campaignsSince: typeof r.campaignsSince === "string" && DATE.test(r.campaignsSince) ? r.campaignsSince : since, days, campaigns };
}
export async function readMetaInsights(): Promise<MetaInsights | null> {
  return cleanInsights(parse(await readKey(META_INSIGHTS_KEY)));
}
export async function writeMetaInsights(insights: MetaInsights): Promise<void> {
  await writeKey(META_INSIGHTS_KEY, insights);
}
export async function readMetaStatus(): Promise<MetaSpendStatus> {
  const r = (parse<Record<string, unknown>>(await readKey(META_SPEND_STATUS_KEY)) ?? {}) as Record<string, unknown>;
  return {
    lastPulledAt: typeof r.lastPulledAt === "string" ? r.lastPulledAt : null,
    lastError: typeof r.lastError === "string" ? r.lastError.slice(0, 200) : null,
    daysPulled: typeof r.daysPulled === "number" && Number.isFinite(r.daysPulled) ? Math.round(r.daysPulled) : 0,
  };
}
export async function writeMetaStatus(status: MetaSpendStatus): Promise<void> {
  await writeKey(META_SPEND_STATUS_KEY, status);
}
/** The two deployment variables that connect the ad account. */
export function metaAdsConfigured(): boolean {
  return !!(process.env.META_ADS_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
}

export async function deleteAdSpend(id: string): Promise<AdSpendEntry[]> {
  const next = (await readAdSpend()).filter((e) => e.id !== id);
  if (next.length === 0) await db.syncState.deleteMany({ where: { key: AD_SPEND_KEY } });
  else await writeKey(AD_SPEND_KEY, next);
  return next;
}

/* ── settings and the shared link ─────────────────────────────────────── */

export function cleanSettings(raw: unknown): InvestorSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
  return {
    realisticPct: Math.round(num(r.realisticPct, DEFAULT_SETTINGS.realisticPct, 0, 100)),
    spendPerDayCents: typeof r.spendPerDayCents === "number" && Number.isFinite(r.spendPerDayCents) && r.spendPerDayCents >= 0 ? Math.round(r.spendPerDayCents) : null,
    horizonDays: Math.round(num(r.horizonDays, DEFAULT_SETTINGS.horizonDays, 30, 730)),
    trialDays: Math.round(num(r.trialDays, DEFAULT_SETTINGS.trialDays, 1, 90)),
    dailyBudgetCents: typeof r.dailyBudgetCents === "number" && Number.isFinite(r.dailyBudgetCents) && r.dailyBudgetCents > 0 ? Math.round(r.dailyBudgetCents) : null,
    budgetFrom: typeof r.budgetFrom === "string" && DATE.test(r.budgetFrom) && r.budgetFrom >= "2025-01-01" ? r.budgetFrom : null,
    sinceDate: typeof r.sinceDate === "string" && DATE.test(r.sinceDate) && r.sinceDate >= "2025-01-01" ? r.sinceDate : null,
    linkToken: typeof r.linkToken === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(r.linkToken) ? r.linkToken : null,
    linkEnabled: r.linkEnabled === true,
    linkMadeAt: typeof r.linkMadeAt === "string" ? r.linkMadeAt : null,
  };
}

export async function readInvestorSettings(): Promise<InvestorSettings> {
  return cleanSettings(parse(await readKey(INVESTOR_SETTINGS_KEY)));
}

export async function saveInvestorSettings(patch: Partial<InvestorSettings>): Promise<InvestorSettings> {
  const next = cleanSettings({ ...(await readInvestorSettings()), ...patch });
  await writeKey(INVESTOR_SETTINGS_KEY, next);
  return next;
}

/** A new shared link (the old one stops working), switched on. */
export async function rotateInvestorLink(): Promise<InvestorSettings> {
  return saveInvestorSettings({ linkToken: randomBytes(18).toString("base64url"), linkEnabled: true, linkMadeAt: new Date().toISOString() });
}

/** True when `token` is the live shared link. */
export async function investorLinkOpen(token: string): Promise<boolean> {
  const s = await readInvestorSettings();
  return !!s.linkToken && s.linkEnabled && token === s.linkToken;
}

/* ── the report ───────────────────────────────────────────────────────── */

export interface InvestorReport {
  figures: InvestorFigures;
  settings: InvestorSettings;
  spend: { entries: AdSpendEntry[]; byPlatform: Array<{ platform: SpendPlatform; label: string; cents: number; days: number }> };
  /** The analytics answered (visitors are real), or not. */
  visitorsKnown: boolean;
  /** Paying accounts whose plan has no list price — counted as $0 in the MRR, and said so. */
  payingUnpriced: number;
  /** Accounts paying from before the start day — counted under With a card as paying (2026-10-13), named here. */
  before: { paying: number; mrrCents: number };
  /** The first day a visitor arrived from an ad (utm_source or fbclid), when the analytics answered. */
  firstAdDay: string | null;
  /** Meta's ad account: connected (the deployment has the token and account id), and the last read. */
  meta: { configured: boolean } & MetaSpendStatus;
  /** The spend by period — today, this week, this month… — off the curve's booked days (lib/investorModel). */
  periods: SpendPeriod[];
  /** Meta's own figures, when read: by day for the bars, by campaign for the table (with the signups each brought). */
  insights: MetaInsights | null;
  campaigns: Array<{ id: string; name: string; spendCents: number; impressions: number; clicks: number; cpcCents: number | null; signups: number; costPerSignupCents: number | null }>;
  /** The last 30 days, one row each: what was spent (any source) and who signed up. */
  dailyRows: Array<{ date: string; spendCents: number; source: "booked" | "budget" | "none"; clicks: number | null; signups: number }>;
  /** THE TWO COHORTS (owner, 2026-10-13): the same figures for the trials that started with a card and the ones
   *  that started with none, each with the ad spend that went to it; which one a new signup gets today. */
  cohorts: {
    card: CohortFigures;
    nocard: CohortFigures;
    current: TrialCohort;
    /** When the current policy began, YYYY-MM-DD, when known. */
    currentSince: string | null;
    /** How the spend was split: by the recorded switch from this day on (null = no flip recorded yet). */
    recordedFrom: string | null;
  };
  /** When this was read. */
  at: string;
}

/** Midnight of `date` in `tz`, as a timestamp (the day's offset read from Intl). */
function dayStartMs(date: string, tz: string): number {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date(guess)).find((x) => x.type === "timeZoneName")?.value ?? "GMT";
  const m = /([+-])(\d{2}):?(\d{2})?/.exec(name);
  const offsetMin = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  return guess - offsetMin * 60_000;
}

const todayIn = (tz: string) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const n = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${n("year")}-${n("month")}-${n("day")}`;
};

export async function investorReport({ refreshMeta = false }: { refreshMeta?: boolean } = {}): Promise<InvestorReport> {
  // The admin's own read asks Meta first when the last read is over an hour old
  // (owner, 2026-10-08: "live spending"); the shared link and the PDF read what is kept.
  if (refreshMeta && metaAdsConfigured()) {
    try {
      const { metaPullIfStale } = await import("@/lib/metaAdSpend");
      await metaPullIfStale(60);
    } catch (err) {
      console.warn("[investors] Meta refresh skipped:", err instanceof Error ? err.message : err);
    }
  }
  const [entries, settings, hidden, metaStatus, insights] = await Promise.all([readAdSpend(), readInvestorSettings(), statsHiddenIds(), readMetaStatus(), readMetaInsights()]);
  const today = todayIn(TRAFFIC_TZ);
  // The start day: the first campaign's (owner, 2026-10-06), else the live map's.
  const since = settings.sinceDate ?? TRAFFIC_SINCE;
  const sinceMs = settings.sinceDate ? dayStartMs(since, TRAFFIC_TZ) : TRAFFIC_SINCE_MS;

  // The accounts since the start day, with their subscriptions — the signups list's rows.
  const orgs = await db.organization.findMany({
    where: { createdAt: { gte: new Date(sinceMs) }, ...countedOrgs(hidden) },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: { id: true, createdAt: true, utmCampaign: true, utmContent: true, utmSource: true, subscription: { select: { plan: true, status: true, trialEndsAt: true, stripePriceId: true, externalSubId: true, provider: true, createdAt: true } } },
  });
  // Every paying account; the ones from before the start day are named, not counted.
  const payingAll = await db.subscription.findMany({
    where: { status: "ACTIVE", organization: countedOrgs(hidden) },
    select: { organizationId: true, plan: true, status: true, trialEndsAt: true, stripePriceId: true, externalSubId: true, provider: true, createdAt: true, organization: { select: { createdAt: true } } },
  });

  const payRow = (p: (typeof payingAll)[number]) => ({ orgId: p.organizationId, createdAt: p.organization.createdAt, state: "paying" as const, sub: { plan: p.plan, status: p.status, trialEndsAt: p.trialEndsAt, stripePriceId: p.stripePriceId, externalSubId: p.externalSubId, provider: p.provider }, subCreatedAt: p.createdAt, trialEndsAt: p.trialEndsAt });
  const rows = [
    ...orgs.map((o) => ({ orgId: o.id, createdAt: o.createdAt, state: signupState(o.subscription?.status ?? ""), sub: o.subscription ? { plan: o.subscription.plan, status: o.subscription.status, trialEndsAt: o.subscription.trialEndsAt, stripePriceId: o.subscription.stripePriceId, externalSubId: o.subscription.externalSubId, provider: o.subscription.provider } : null, subCreatedAt: o.subscription?.createdAt ?? o.createdAt, trialEndsAt: o.subscription?.trialEndsAt ?? null })),
    ...payingAll.filter((p) => p.organization.createdAt.getTime() >= sinceMs && !orgs.some((o) => o.id === p.organizationId)).map(payRow),
  ];
  const beforeRows = payingAll.filter((p) => p.organization.createdAt.getTime() < sinceMs).map(payRow);
  let values = new Map<string, { monthlyCents: number | null; chance?: number }>();
  try {
    values = (await valueSignups([...rows, ...beforeRows].map((r) => ({ orgId: r.orgId, createdAt: r.createdAt, state: r.state, sub: r.sub })), Date.now())).values;
  } catch {
    values = new Map();
  }

  // HOW EACH TRIAL STARTED (2026-10-13): a card-less trial leaves its record (lib/trialState); everything else took a card.
  const nocardIds = new Set<string>();
  try {
    const ids = rows.map((r) => r.orgId);
    const recs = ids.length ? await db.syncState.findMany({ where: { key: { in: ids.map(cardlessKey) } }, select: { key: true, cursor: true } }) : [];
    for (const rec of recs) {
      const r = parse<{ subId?: unknown }>(rec.cursor);
      if (r?.subId) nocardIds.add(rec.key.slice("cardlessTrial:".length));
    }
  } catch {
    /* no records read: every trial counts as a card trial */
  }
  const cohortOf = (orgId: string): TrialCohort => (nocardIds.has(orgId) ? "nocard" : "card");

  const payRowOf = (r: (typeof rows)[number], preexisting: boolean) => {
    // Paying from the trial's end when there was one, else from the subscription.
    const ends = r.trialEndsAt && r.trialEndsAt.getTime() < Date.now() ? r.trialEndsAt : r.subCreatedAt;
    return { startedAt: dayOf(ends.toISOString()), monthlyCents: values.get(r.orgId)?.monthlyCents ?? 0, signedUpAt: dayOf(r.createdAt.toISOString()), cohort: cohortOf(r.orgId), preexisting };
  };
  // The accounts paying from before the start day (owner, 2026-10-13: "add them to With a card, paying"): they
  // took a card, so they sit in that cohort — paying, never signups of the period (lib/investorModel).
  const paying = [...rows.filter((r) => r.state === "paying").map((r) => payRowOf(r, false)), ...beforeRows.map((r) => payRowOf(r, true))];
  const trials = rows.filter((r) => r.state === "trial").map((r) => {
    const v = values.get(r.orgId);
    return { createdAt: dayOf(r.createdAt.toISOString()), endsAt: r.trialEndsAt ? dayOf(r.trialEndsAt.toISOString()) : null, monthlyCents: v?.monthlyCents ?? null, chance: v?.chance ?? 0.2, cohort: cohortOf(r.orgId) };
  });
  const lapsedRows = rows.filter((r) => r.state === "lapsed");
  const lapsed = lapsedRows.length;
  // The switch's recorded flips (from 2026-10-13), and what a new signup gets today.
  let policy: PolicySpan[] = [];
  let current: TrialCohort = "card";
  let currentSince: string | null = null;
  try {
    const [flips, state] = await Promise.all([readTrialPolicyHistory(), signupTrialState({ fresh: true })]);
    policy = flips.map((f) => ({ from: dayOf(f.at), mode: f.requiresCard ? "card" : "nocard" }));
    current = state.requiresCard ? "card" : "nocard";
    currentSince = state.at ? dayOf(state.at) : policy.at(-1)?.from ?? null;
    // The switch's own stamp stands in for the last flip when the history began after it.
    if (state.source === "admin" && state.at && !policy.some((p) => p.from === dayOf(state.at as string) && p.mode === current)) policy.push({ from: dayOf(state.at), mode: current });
  } catch {
    /* the deployment's default: a card */
  }
  const cohortInput = {
    lapsed: { card: lapsedRows.filter((r) => cohortOf(r.orgId) === "card").length, nocard: lapsedRows.filter((r) => cohortOf(r.orgId) === "nocard").length },
    signups: rows.filter((r) => r.state === "trial" || r.state === "paying" || r.state === "lapsed").map((r) => ({ date: dayOf(r.createdAt.toISOString()), cohort: cohortOf(r.orgId) })),
    policy,
    current,
  };
  const payingUnpriced = rows.filter((r) => r.state === "paying" && values.get(r.orgId)?.monthlyCents == null).length;

  const before = { paying: beforeRows.length, mrrCents: beforeRows.reduce((a, r) => a + (values.get(r.orgId)?.monthlyCents ?? 0), 0) };

  let visitors: number | null = null;
  let firstAdDay: string | null = null;
  try {
    const v = await fetchInvestorVisitors(since, TRAFFIC_TZ);
    visitors = v.visitors;
    firstAdDay = v.firstAdDay;
  } catch {
    visitors = null;
  }

  const spend: SpendDay[] = entries.map((e) => ({ date: e.date, cents: e.cents }));
  const modelInput = { since, today, spend, paying, trials, lapsed, assumptions: settings, visitors, cohorts: cohortInput };
  const figures = investorFigures(modelInput);
  const cohorts = {
    card: cohortFigures(modelInput, "card", figures),
    nocard: cohortFigures(modelInput, "nocard", figures),
    current,
    currentSince,
    recordedFrom: policy.length ? [...policy].sort((a, b) => a.from.localeCompare(b.from))[0].from : null,
  };
  const byPlatform = PLATFORMS.map((platform) => {
    const mine = entries.filter((e) => e.platform === platform && e.date >= since && e.date <= today);
    return { platform, label: PLATFORM_LABEL[platform], cents: mine.reduce((a, e) => a + e.cents, 0), days: new Set(mine.map((e) => e.date)).size };
  }).filter((p) => p.cents > 0);
  // Spend by period, the daily rows of the last 30 days, and each Meta campaign with the signups it brought
  // (a signup carries the ad's utm_campaign — Meta sends {{campaign.id}} or the name — so both are matched).
  const periods = spendPeriods(figures.curve, today);
  const dayIn = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TRAFFIC_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  // Only the signups the figures count (a trial, a paying account, a lapsed trial) — the same rows as "Signed up".
  const counted = new Set(rows.filter((r) => r.state === "trial" || r.state === "paying" || r.state === "lapsed").map((r) => r.orgId));
  const signupsByDay = new Map<string, number>();
  for (const o of orgs) { if (!counted.has(o.id)) continue; const d = dayIn(o.createdAt); signupsByDay.set(d, (signupsByDay.get(d) ?? 0) + 1); }
  const clicksByDay = new Map((insights?.days ?? []).map((d) => [d.date, d.clicks]));
  const from30 = addDays(today, -29);
  const dailyRows = figures.curve.filter((p) => !p.projected && p.date >= from30 && p.date <= today).map((p) => ({
    date: p.date, spendCents: p.spendDayCents, source: p.spendSource === "projected" ? ("none" as const) : p.spendSource, clicks: clicksByDay.has(p.date) ? (clicksByDay.get(p.date) ?? 0) : null, signups: signupsByDay.get(p.date) ?? 0,
  }));
  const tagOf = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  const campaigns = (insights?.campaigns ?? []).map((c) => {
    const id = tagOf(c.id), name = tagOf(c.name);
    const signups = orgs.filter((o) => { if (!counted.has(o.id)) return false; const t = tagOf(o.utmCampaign); return t !== "" && (t === id || t === name); }).length;
    return { id: c.id, name: c.name || c.id, spendCents: c.spendCents, impressions: c.impressions, clicks: c.clicks, cpcCents: c.clicks > 0 ? Math.round(c.spendCents / c.clicks) : null, signups, costPerSignupCents: signups > 0 && c.spendCents > 0 ? Math.round(c.spendCents / signups) : null };
  }).sort((a, b) => b.spendCents - a.spendCents);
  return { figures, settings, spend: { entries, byPlatform }, visitorsKnown: visitors !== null, payingUnpriced, before, firstAdDay, meta: { configured: metaAdsConfigured(), ...metaStatus }, periods, insights, campaigns, cohorts, dailyRows, at: new Date().toISOString() };
}

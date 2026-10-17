import "server-only";
// THE INVESTOR PAGE'S DATA (owner, 2026-10-06) — what is kept, and the one
// read that builds the report for the admin page, the shared link and the
// PDF alike. Nothing new in the schema: SyncState rows.
//
//   adSpend          the ad spend by day and platform — Meta's own figures
//                    (lib/metaAdSpend writes them, source "meta") and any day
//                    booked by hand for another platform;
//   investorSettings the start day and the shared link's token and switch
//                    (and the old daily budget, kept for the traffic page's
//                    tile — never counted as spent here);
//
// FACTS ONLY (owner, 2026-10-17): the report counts what happened — Meta's
// spend (read again when it is over 15 minutes old, on the shared link too),
// the accounts, what Stripe collected — and leaves out the no-card trials'
// days of spend while still counting the paying customers they brought
// (lib/investorModel). The accounts come from the same rows the signups list
// reads (since the ad launch, hidden accounts out, lib/statsHidden), priced
// the same way (lib/trialProjectionRead); the visitors from the live map's.
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { countedOrgs, statsHiddenIds } from "@/lib/statsHidden";
import { signupState } from "@/lib/traffic-live";
import { TRAFFIC_SINCE, TRAFFIC_SINCE_MS, TRAFFIC_TZ } from "@/lib/traffic-visitor";
import { fetchInvestorVisitors } from "@/lib/traffic-server";
import { valueSignups } from "@/lib/trialProjectionRead";
import { investorFacts, noCardDays, dayOf, PLATFORMS, type InvestorFacts, type PayingIn, type PolicySpan, type SpendPlatform, type TrialCohort, type TrialIn } from "@/lib/investorModel";
import { readSubscriptionPayments } from "@/lib/investorPayments";
import { afterResponse } from "@/lib/server-events";
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

export interface InvestorSettings {
  /** The day the first campaign went live (owner, 2026-10-06: "count only what
   *  happened after that"); null = the live map's start, TRAFFIC_SINCE. */
  sinceDate: string | null;
  /** The daily ad budget, all ads together (2026-10-06). The traffic page shows it as "Ad budget today" when Meta
   *  is not connected (lib/adSpendToday); the investor figures never count it as spent (2026-10-17). */
  dailyBudgetCents: number | null;
  budgetFrom: string | null;
  linkToken: string | null;
  linkEnabled: boolean;
  /** When the link was last made. */
  linkMadeAt: string | null;
}

export const DEFAULT_SETTINGS: InvestorSettings = { dailyBudgetCents: null, budgetFrom: null, sinceDate: null, linkToken: null, linkEnabled: false, linkMadeAt: null };
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
  return {
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
  facts: InvestorFacts;
  settings: InvestorSettings;
  /** Every day booked (Meta's and by hand), for the admin's list. */
  entries: AdSpendEntry[];
  /** Paying accounts whose plan has no list price — counted as $0 a month, and said so. */
  payingUnpriced: number;
  /** The first day a visitor arrived from an ad (utm_source or fbclid), when the analytics answered. */
  firstAdDay: string | null;
  /** Meta's ad account: connected (the deployment has the token and account id), and the last read. */
  meta: { configured: boolean } & MetaSpendStatus;
  /** Clicks per day from Meta's last read, for the bars. */
  clicksByDay: Record<string, number>;
  /** Stripe's payments: read, or why not. */
  stripe: { read: boolean; error: string | null };
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
const dayIn = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TRAFFIC_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** THE CURRENT SPEND (owner, 2026-10-17: "let it read current spend"): Meta is asked again when its last read is
 *  over 15 minutes old — for the admin and for the shared link alike. One read at a time per instance; the admin
 *  waits for it, a reader waits five seconds at most and a slower read finishes after the page has gone out. A read
 *  that failed is tried again two minutes later, not on every view. */
const META_FRESH_MIN = 15;
const META_RETRY_MS = 2 * 60_000;
let metaInFlight: Promise<void> | null = null;
let metaFailedAt = 0;
async function freshMeta(mode: "admin" | "shared" | false): Promise<void> {
  if (!mode || !metaAdsConfigured() || Date.now() - metaFailedAt < META_RETRY_MS) return;
  const pull =
    metaInFlight ??
    (metaInFlight = (async () => {
      const { metaPullIfStale } = await import("@/lib/metaAdSpend");
      const r = await metaPullIfStale(META_FRESH_MIN);
      if (r && !r.ok) metaFailedAt = Date.now();
    })()
      .catch((err) => {
        metaFailedAt = Date.now();
        console.warn("[investors] Meta refresh skipped:", err instanceof Error ? err.message : err);
      })
      .finally(() => {
        metaInFlight = null;
      }));
  if (mode === "admin") return pull;
  let done = false;
  await Promise.race([pull.then(() => { done = true; }), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (!done) afterResponse(() => pull);
}

export async function investorReport({ refreshMeta = false }: { refreshMeta?: "admin" | "shared" | false } = {}): Promise<InvestorReport> {
  await freshMeta(refreshMeta);
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
    select: { id: true, createdAt: true, subscription: { select: { plan: true, status: true, trialEndsAt: true, stripePriceId: true, externalSubId: true, provider: true, createdAt: true } } },
  });
  // Every paying account; the ones from before the start day count as paying, never as signups of the period.
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

  // Paying from the trial's end when there was one, else from the subscription.
  const paidFrom = (r: (typeof rows)[number]) => dayOf((r.trialEndsAt && r.trialEndsAt.getTime() < Date.now() ? r.trialEndsAt : r.subCreatedAt).toISOString());
  const paying: PayingIn[] = [
    ...rows.filter((r) => r.state === "paying").map((r) => ({ startedAt: paidFrom(r), monthlyCents: values.get(r.orgId)?.monthlyCents ?? 0, from: cohortOf(r.orgId) })),
    ...beforeRows.map((r) => ({ startedAt: paidFrom(r), monthlyCents: values.get(r.orgId)?.monthlyCents ?? 0, from: "before" as const })),
  ];
  const trials: TrialIn[] = rows.filter((r) => r.state === "trial").map((r) => ({ createdAt: dayIn(r.createdAt), monthlyCents: values.get(r.orgId)?.monthlyCents ?? null, cohort: cohortOf(r.orgId) }));
  const lapsedRows = rows.filter((r) => r.state === "lapsed");
  const lapsed = { card: lapsedRows.filter((r) => cohortOf(r.orgId) === "card").length, nocard: lapsedRows.filter((r) => cohortOf(r.orgId) === "nocard").length };
  const signups = rows.filter((r) => r.state === "trial" || r.state === "paying" || r.state === "lapsed").map((r) => ({ date: dayIn(r.createdAt), cohort: cohortOf(r.orgId) }));
  const payingUnpriced = rows.filter((r) => r.state === "paying" && values.get(r.orgId)?.monthlyCents == null).length;

  // The switch's recorded flips (from 2026-10-13); its own stamp stands in for the last flip when the history began after it.
  let policy: PolicySpan[] = [];
  try {
    const [flips, state] = await Promise.all([readTrialPolicyHistory(), signupTrialState({ fresh: true })]);
    policy = flips.map((f) => ({ from: dayOf(f.at), mode: f.requiresCard ? "card" : "nocard" }));
    const current: TrialCohort = state.requiresCard ? "card" : "nocard";
    if (state.source === "admin" && state.at && !policy.some((p) => p.from === dayOf(state.at as string) && p.mode === current)) policy.push({ from: dayOf(state.at), mode: current });
  } catch {
    /* the deployment's default: a card */
  }

  // The visitors on the card trials' days, and what Stripe collected from the counted accounts — side by side.
  const customers = new Set(
    (await db.subscription.findMany({ where: { organization: countedOrgs(hidden), externalCustomerId: { not: null } }, select: { externalCustomerId: true } }).catch(() => []))
      .map((c) => c.externalCustomerId)
      .filter((c): c is string => !!c),
  );
  const [visitorRead, paid] = await Promise.all([
    fetchInvestorVisitors(since, TRAFFIC_TZ, noCardDays(since, today, signups, policy)).catch(() => null),
    readSubscriptionPayments(sinceMs, customers, (ms) => dayIn(new Date(ms))),
  ]);

  const facts = investorFacts({
    since,
    today,
    spend: entries.map((e) => ({ date: e.date, cents: e.cents, platform: e.platform, source: e.source })),
    signups,
    policy,
    paying,
    trials,
    lapsed,
    visitors: visitorRead ? visitorRead.visitors : null,
    payments: paid.ok ? paid.payments : null,
  });
  return {
    facts,
    settings,
    entries,
    payingUnpriced,
    firstAdDay: visitorRead?.firstAdDay ?? null,
    meta: { configured: metaAdsConfigured(), ...metaStatus },
    clicksByDay: Object.fromEntries((insights?.days ?? []).map((d) => [d.date, d.clicks])),
    stripe: paid.ok ? { read: true, error: null } : { read: false, error: paid.error },
    at: new Date().toISOString(),
  };
}

import type { ExperimentResult, StaleNote, StageVisitor, StageVisitorsReport, TrafficBreakdown, TrafficDaily, TrafficFilters, TrafficReport, TrafficTotals } from "./traffic-contract";
import { experimentResultFromRow } from "./traffic-contract";
import { buildExperimentsQuery, buildStageVisitorsQuery, buildTrafficQueries, funnelStages, shiftDate } from "./traffic-query";
import { CONVERTED_HOURS, MAP_HISTORY_LIMIT, buildConvertedQuery, buildLiveQuery, buildInvestorVisitorsQuery, buildLiveTotalsQuery, buildMapHistoryQuery, liveEventFromRow, liveHeadline, liveTotalsFromRow, mapHistoryEventsFromRow, minutesIntoDay, shapeLive, shortId, type FreshSignup, type LiveEvent, type LiveReport, type LiveTotalsPair, type MapHistory, type MapSpan } from "./traffic-live";
import { analystSessionFromRow, buildAnalystQuery, type LandingSession } from "./traffic-analyst";
import { buildDropoffQuery, buildDropoffReport, dropoffVisitFromRow, type DropoffReport, type DropoffVisit } from "./signup-dropoff";
import { TRAFFIC_TZ } from "./traffic-visitor";

/** The last half hour of events, one PostHog query, shared by every admin
 *  looking for LIVE_CACHE_MS — the query endpoint's budget is small, and the
 *  panel polls. */
const LIVE_CACHE_MS = 25_000;
/** Live mode polls every 15 s, so its answers may be at most this stale —
 *  otherwise the cache would hand back the same rows twice and the panel
 *  would tick without moving. Still shared: two admins watching cost one
 *  query between them. */
const LIVE_FAST_CACHE_MS = 12_000;
let liveEvents: { at: number; promise: Promise<LiveEvent[]> } | null = null;
export async function fetchLiveEvents(maxAgeMs = LIVE_CACHE_MS): Promise<LiveEvent[]> {
  const now = Date.now();
  const age = Math.max(LIVE_FAST_CACHE_MS, Math.min(LIVE_CACHE_MS, maxAgeMs));
  if (liveEvents && now - liveEvents.at < age) return liveEvents.promise;
  const promise = runTrafficQuery(buildLiveQuery(), "live").then((rows) => rows.map(liveEventFromRow).filter((e): e is LiveEvent => !!e));
  promise.catch(() => { if (liveEvents?.promise === promise) liveEvents = null; });
  liveEvents = { at: now, promise };
  return promise;
}

/** The day's converts — the events of everyone who completed a signup in
 *  the last CONVERTED_HOURS — for the prospects map, which keeps a convert
 *  for a day (2026-10-02). Its own, longer cache: a signup is rare, and the
 *  window query above already shows one the minute it happens. */
const CONVERTED_CACHE_MS = 2 * 60_000;
let convertedEvents: { at: number; promise: Promise<LiveEvent[]> } | null = null;
export async function fetchConvertedEvents(): Promise<LiveEvent[]> {
  const now = Date.now();
  if (convertedEvents && now - convertedEvents.at < CONVERTED_CACHE_MS) return convertedEvents.promise;
  const promise = runTrafficQuery(buildConvertedQuery(), "converted").then((rows) => rows.map(liveEventFromRow).filter((e): e is LiveEvent => !!e));
  promise.catch(() => { if (convertedEvents?.promise === promise) convertedEvents = null; });
  convertedEvents = { at: now, promise };
  return promise;
}

/** THE ANALYST's sessions (2026-10-02): the last week of landing visits,
 *  one row each, read every ten minutes at most — the reading does not
 *  change by the minute, and the query walks a week of events. */
const ANALYST_CACHE_MS = 10 * 60_000;
/** The sessions and when PostHog answered for them (2026-10-04): a cached
 *  week is up to ten minutes old, and "read at" must say so. */
export interface AnalystRead { sessions: LandingSession[]; readAt: string }
let analystSessions: { at: number; promise: Promise<AnalystRead> } | null = null;
export async function fetchAnalystSessions(force = false): Promise<AnalystRead> {
  const now = Date.now();
  if (!force && analystSessions && now - analystSessions.at < ANALYST_CACHE_MS) return analystSessions.promise;
  const promise = runTrafficQuery(buildAnalystQuery(), "analyst").then((rows) => ({
    sessions: rows.map(analystSessionFromRow).filter((s): s is LandingSession => !!s),
    readAt: new Date().toISOString(),
  }));
  promise.catch(() => { if (analystSessions?.promise === promise) analystSessions = null; });
  analystSessions = { at: now, promise };
  return promise;
}

/** WHERE SIGN-UPS STOP (2026-10-14): the week's or the month's sign-up visits, one row each, read into the report
 *  under the live map. Five minutes per span — the form's numbers do not move while someone reads them. */
const DROPOFF_CACHE_MS = 5 * 60_000;
export interface DropoffRead { report: DropoffReport; readAt: string }
const dropoffReads = new Map<number, { at: number; promise: Promise<DropoffRead> }>();
export async function fetchSignupDropoff(days: number, force = false): Promise<DropoffRead> {
  const now = Date.now();
  const hit = dropoffReads.get(days);
  if (!force && hit && now - hit.at < DROPOFF_CACHE_MS) return hit.promise;
  const scope = process.env.NODE_ENV === "production" ? "production" : "with-local";
  const promise = runTrafficQuery(buildDropoffQuery(days, scope), "signup dropoff").then((rows) => ({
    report: buildDropoffReport(rows.map(dropoffVisitFromRow).filter((v): v is DropoffVisit => !!v), days, Date.now()),
    readAt: new Date().toISOString(),
  }));
  promise.catch(() => { if (dropoffReads.get(days)?.promise === promise) dropoffReads.delete(days); });
  dropoffReads.set(days, { at: now, promise });
  return promise;
}

/** The site-wide totals (all-time, today, this time yesterday, seven days).
 *  A far longer cache than the window above on purpose: the query reads every
 *  event in the project, and an all-time count does not move while someone
 *  watches a 15-second ticker. Keyed by timezone, because "today" is. */
const LIVE_TOTALS_CACHE_MS = 5 * 60_000;
const liveTotals = new Map<string, { at: number; promise: Promise<LiveTotalsPair> }>();
export async function fetchLiveTotals(timezone: string, fullHistory = false): Promise<LiveTotalsPair> {
  const key = `${timezone || "UTC"}|${fullHistory ? "full" : "since"}`;
  const now = Date.now();
  const hit = liveTotals.get(key);
  if (hit && now - hit.at < LIVE_TOTALS_CACHE_MS) return hit.promise;
  const promise = runTrafficQuery(buildLiveTotalsQuery(timezone || "UTC", fullHistory), "live totals").then((rows) => liveTotalsFromRow(Array.isArray(rows[0]) ? rows[0] : []));
  promise.catch(() => { if (liveTotals.get(key)?.promise === promise) liveTotals.delete(key); });
  liveTotals.set(key, { at: now, promise });
  return promise;
}

/** THE INVESTORS' VISITORS (2026-10-06): unique visitors from the owner's
 *  chosen start day, and the first day a visitor came from an ad — the hint
 *  beside the "Counting from" field. Cached like the totals, per day asked. */
export interface InvestorVisitors { visitors: number; firstAdDay: string | null }
const investorVisitors = new Map<string, { at: number; promise: Promise<InvestorVisitors> }>();
export async function fetchInvestorVisitors(sinceDate: string, timezone = TRAFFIC_TZ, skipDays: readonly string[] = []): Promise<InvestorVisitors> {
  const key = `${sinceDate}|${timezone}|${skipDays.join(",")}`;
  const now = Date.now();
  const hit = investorVisitors.get(key);
  if (hit && now - hit.at < LIVE_TOTALS_CACHE_MS) return hit.promise;
  const promise = runTrafficQuery(buildInvestorVisitorsQuery(timezone, sinceDate, skipDays), "investor visitors").then((rows) => {
    const row: unknown[] = Array.isArray(rows[0]) ? rows[0] : [];
    const v = Number(row[0]);
    const d = typeof row[1] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row[1]) && row[1] >= "2020-01-01" ? row[1] : null;
    return { visitors: Number.isFinite(v) && v > 0 ? Math.round(v) : 0, firstAdDay: d };
  });
  promise.catch(() => { if (investorVisitors.get(key)?.promise === promise) investorVisitors.delete(key); });
  investorVisitors.set(key, { at: now, promise });
  return promise;
}

/** The totals, or the last ones read when PostHog does not answer for them.
 *  Their "today" and "yesterday to this hour" are the page's day, TRAFFIC_TZ —
 *  the same day the signups beside them are counted in. */
const liveTotalsOrLast = (fullHistory: boolean) =>
  orLastGood(`totals|${fullHistory ? 1 : 0}`, fetchLiveTotals(TRAFFIC_TZ, fullHistory), "the totals");

/** The map over a longer span (2026-10-03, lib/traffic-live buildMapHistoryQuery):
 *  one row per person, cached per span — a month's query reads every event,
 *  so it is asked at most every few minutes whoever is watching. The rows are
 *  cached as events; each answer shapes them with its own signups. */
type HistoryRows = { events: LiveEvent[]; views: Map<string, number>; rows: number };
const mapHistoryCache = new Map<string, { at: number; promise: Promise<HistoryRows> }>();
const mapHistoryAge = (minutes: number) => (minutes <= 240 ? 60_000 : minutes <= 1440 ? 120_000 : 300_000);
export async function getMapHistory(minutes: MapSpan, signups: FreshSignup[], opts: { includeDevelopment?: boolean; fullHistory?: boolean } = {}): Promise<Omit<MapHistory, "adNames">> {
  const fetchedAt = new Date().toISOString();
  const empty = { minutes, visitors: [], truncated: false, fetchedAt };
  try {
    if (!posthogApiConfig()) return { ...empty, status: "disabled", message: "Connect a PostHog personal key with query:read and a numeric project ID." };
  } catch (err) { return { ...empty, status: "error", message: (err as Error).message }; }
  const key = `${minutes}|${opts.includeDevelopment ? 1 : 0}|${opts.fullHistory ? 1 : 0}`;
  const now = Date.now();
  let hit = mapHistoryCache.get(key);
  if (!hit || now - hit.at >= mapHistoryAge(minutes)) {
    const promise = runTrafficQuery(buildMapHistoryQuery(minutes, opts), "map history").then((rows) => {
      const events: LiveEvent[] = [];
      const views = new Map<string, number>();
      for (const row of rows) {
        const h = Array.isArray(row) ? mapHistoryEventsFromRow(row) : null;
        if (!h) continue;
        events.push(...h.events);
        views.set(shortId(h.person), h.views);
      }
      return { events, views, rows: rows.length };
    });
    promise.catch(() => { if (mapHistoryCache.get(key)?.promise === promise) mapHistoryCache.delete(key); });
    hit = { at: now, promise };
    mapHistoryCache.set(key, hit);
  }
  try {
    // PostHog down: the span as it last read, and from when.
    const { value: { events, views, rows }, stale } = await orLastGood(`map|${key}`, hit.promise);
    // PostHog already held the rows to the span; the slack keeps a first
    // touch at its edge (and its ad tag) while the rows sit in the cache.
    const shaped = shapeLive(events, signups, Date.now(), { ...opts, windowMinutes: minutes + 10 });
    // The row's own pageview count; the events stand in for the visit, not for every page.
    const visitors = shaped.visitors.map((v) => ({ ...v, views: views.get(v.id) ?? v.views }));
    return { ...empty, status: "ok", visitors, truncated: rows >= MAP_HISTORY_LIMIT, ...(stale ? { stale, fetchedAt: stale.since } : {}) };
  } catch (err) {
    const msg = err instanceof Error && err.name === "TimeoutError" ? "PostHog took too long. Try a shorter span." : err instanceof Error ? err.message : "The map is unavailable.";
    return { ...empty, status: "error", message: msg };
  }
}

/** The live report: the window's visitors shaped with the day's signups. */
export async function getLiveTraffic(signups: FreshSignup[], opts: { includeDevelopment?: boolean; fast?: boolean; fullHistory?: boolean } = {}): Promise<LiveReport> {
  const fetchedAt = new Date().toISOString();
  try {
    if (!posthogApiConfig()) return { ...shapeLive([], signups, Date.now(), opts), status: "disabled", message: "Connect a PostHog personal key with query:read and a numeric project ID.", fetchedAt };
  } catch (err) { return { ...shapeLive([], signups, Date.now(), opts), status: "error", message: (err as Error).message, fetchedAt }; }
  // One kept report per reading of the window (localhost, the history switch).
  const keptKey = `live|${opts.includeDevelopment ? 1 : 0}|${opts.fullHistory ? 1 : 0}`;
  try {
    // The totals must never take the live view down with them: a failure
    // there leaves the window intact with the totals it last read, or — with
    // none to fall back on — the panel simply prints no totals.
    const [events, totalsRead, dayRead] = await Promise.all([
      fetchLiveEvents(opts.fast ? LIVE_FAST_CACHE_MS : LIVE_CACHE_MS),
      liveTotalsOrLast(!!opts.fullHistory).catch(() => null),
      // Nor the converts: without them the prospects map simply shows the window.
      orLastGood("converted", fetchConvertedEvents()).catch(() => null),
    ]);
    const pair = totalsRead?.value ?? null;
    const dayEvents = dayRead?.value ?? [];
    const totals = pair ? (opts.includeDevelopment ? pair.all : pair.production) : null;
    const shaped = shapeLive(events, signups, Date.now(), opts);
    // The day's converts, shaped the same way over a day-long window and kept
    // only where the signup is on the record; the prospects map merges them.
    const converted = shapeLive(dayEvents, signups, Date.now(), { ...opts, windowMinutes: CONVERTED_HOURS * 60 }).visitors.filter((v) => v.stage === "signed-up");
    const dayAgeMinutes = minutesIntoDay(TRAFFIC_TZ);
    // The busiest platform of the window, for the sentence.
    const top = [...shaped.platforms].sort((a, b) => b.visitors - a.visitors)[0];
    const headline = liveHeadline({
      onSite: shaped.counts.onSite,
      fromAds: shaped.counts.fromAds,
      signingUp: shaped.counts.signingUp,
      windowVisitors: shaped.visitors.length,
      windowMinutes: shaped.windowMinutes,
      todayVisitors: totals ? totals.today : null,
      todaySignups: shaped.today.signups,
      yesterdaySoFar: totals ? totals.yesterdaySoFar : null,
      yesterdayTotal: totals ? totals.yesterday : null,
      dayAgeMinutes,
      topPlatform: top && top.visitors > 0 ? { name: top.name, visitors: top.visitors } : null,
    });
    // The session replays (2026-10-14): PostHog's own player for the visit, one click from its line.
    const cfg = posthogApiConfig();
    const replayBase = cfg ? `${cfg.host}/project/${cfg.id}/replay/` : null;
    const report: LiveReport = keepGood(keptKey, { ...shaped, converted, totals, dayAgeMinutes, headline, status: "ok", fetchedAt, replayBase });
    return totalsRead?.stale ? { ...report, stale: totalsRead.stale } : report;
  } catch (err) {
    const msg = err instanceof Error && err.name === "TimeoutError" ? "PostHog took too long. Try again shortly." : err instanceof Error ? err.message : "Live view unavailable.";
    // PostHog down: the window as it last read (its own fetchedAt), not an empty panel.
    const kept = lastGood.get(keptKey)?.value as LiveReport | undefined;
    if (kept) return { ...kept, stale: { since: kept.fetchedAt, reason: msg } };
    return { ...shapeLive([], signups, Date.now(), opts), status: "error", message: msg, fetchedAt };
  }
}

type Rows = unknown[][];
const cache = new Map<string, { at: number; promise: Promise<TrafficReport> }>();
const numeric = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;
const daily = (r: unknown[]): TrafficDaily => ({ people: numeric(r[0]), inAppVisitors: numeric(r[1]), inAppPeople: numeric(r[2]), adsFb: numeric(r[3]), adsIg: numeric(r[4]), adsAn: numeric(r[5]), adsFbclid: numeric(r[6]), adsAny: numeric(r[7]) });
const totals = (r: unknown[]): TrafficTotals => ({ visitors: numeric(r[0]), newVisitors: numeric(r[1]), returningVisitors: numeric(r[2]), repeatVisitors: numeric(r[3]), sessions: numeric(r[4]), pageviews: numeric(r[5]) });

export function posthogApiConfig() {
  const host = (process.env.POSTHOG_HOST || "https://us.posthog.com").trim().replace(/\/+$/, "");
  // A local stand may answer as PostHog (a fixture server) — never production.
  const local = process.env.NODE_ENV !== "production" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  if (!local && !["https://us.posthog.com", "https://eu.posthog.com"].includes(host)) throw new Error("POSTHOG_HOST must be https://us.posthog.com or https://eu.posthog.com.");
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const id = process.env.POSTHOG_PROJECT_ID?.trim();
  if (!key || !id) return null;
  if (!/^\d+$/.test(id)) throw new Error("POSTHOG_PROJECT_ID must be numeric.");
  return { host, key, id };
}

/** ONE QUERY'S BUDGET (2026-10-03, after production showed "HTTP 503"): a
 *  query waits eight seconds, and one that timed out, could not connect or
 *  came back 502 / 503 / 504 — PostHog's side, not our SQL — is asked once
 *  more after a pause. Every failed attempt goes to the server log with its
 *  name, status, time and the body's first line: the 503 left no trace at
 *  all, so nobody could say which query it was. */
const QUERY_TIMEOUT_MS = 8_000;
const RETRY_PAUSE_MS = 700;
const RETRY_STATUS = new Set([502, 503, 504]);
class PosthogQueryError extends Error {
  constructor(message: string, readonly retry: boolean) { super(message); }
}

async function askPosthog(config: { host: string; key: string; id: string }, sql: string, name: string, attempt: number): Promise<Rows> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${config.host}/api/projects/${config.id}/query/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ name: `JobFlex traffic / ${name}`, query: { kind: "HogQLQuery", query: sql }, refresh: "blocking" }),
      cache: "no-store", signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.warn(`[traffic] PostHog ${name}: ${timedOut ? "no answer" : "no connection"} after ${Date.now() - started} ms (attempt ${attempt})`);
    // The callers word a timeout themselves, by the error's name.
    if (timedOut) throw err;
    throw new PosthogQueryError("PostHog could not be reached. Try again shortly.", true);
  }
  if (!response.ok) {
    // Upstream bodies may contain SQL, identifiers or credentials. Keep them
    // server-side — except the one line that says WHY a query was refused
    // (HTTP 400 is HogQL rejecting our own SQL): that goes to the server log
    // in full and to the admin, trimmed, so a broken query names itself
    // (2026-10-02: the analyst's first query failed as a bare "HTTP 400").
    let why = "";
    let raw = "";
    try { raw = (await response.text()).replace(/\s+/g, " ").trim(); } catch { /* no body */ }
    try { const b = JSON.parse(raw); why = String(b?.detail ?? b?.error ?? b?.message ?? "").replace(/\s+/g, " ").trim(); } catch { /* not JSON: a gateway's page */ }
    if (response.status === 400) console.warn(`[traffic] PostHog refused the ${name} query: ${why || "no detail"}`);
    else console.warn(`[traffic] PostHog ${name}: HTTP ${response.status} after ${Date.now() - started} ms (attempt ${attempt}): ${(why || raw).slice(0, 300) || "no body"}`);
    throw new PosthogQueryError(response.status === 401 || response.status === 403 ? "PostHog denied access. Check the project ID and query:read permission."
      : response.status === 429 ? "PostHog query limit reached. Try again shortly."
      : `PostHog query failed (HTTP ${response.status})${response.status === 400 && why ? `: ${why.slice(0, 220)}` : "."}`, RETRY_STATUS.has(response.status));
  }
  const body = await response.json();
  if (!Array.isArray(body.results)) throw new Error("PostHog has not returned a completed result yet.");
  return body.results;
}

export async function runTrafficQuery(sql: string, name: string): Promise<Rows> {
  const config = posthogApiConfig();
  if (!config) throw new Error("Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID.");
  try { return await askPosthog(config, sql, name, 1); }
  catch (err) {
    const again = err instanceof PosthogQueryError ? err.retry : err instanceof Error && err.name === "TimeoutError";
    if (!again) throw err;
  }
  await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
  return askPosthog(config, sql, name, 2);
}

/** THE LAST GOOD ANSWER (2026-10-03). When PostHog does not answer, the page
 *  shows what it last did answer, and says from when — an error banner is for
 *  the case where there is nothing to show. Kept per query in this server
 *  instance's memory (the browser keeps its own copy of what it has on
 *  screen, for the instance that has none). */
const LAST_GOOD_MAX = 64;
const lastGood = new Map<string, { at: number; value: unknown }>();
function keepGood<T>(key: string, value: T): T {
  lastGood.delete(key);
  if (lastGood.size >= LAST_GOOD_MAX) lastGood.delete(lastGood.keys().next().value!);
  lastGood.set(key, { at: Date.now(), value });
  return value;
}
const failureWords = (err: unknown) => err instanceof Error && err.name === "TimeoutError" ? "PostHog took too long." : err instanceof Error ? err.message : "PostHog did not answer.";
/** `fresh`, remembered — or, when it fails, the last answer under `key` with
 *  a note of its age. Throws only when there is no earlier answer. */
export async function orLastGood<T>(key: string, fresh: Promise<T>, scope?: string): Promise<{ value: T; stale: StaleNote | null }> {
  try { return { value: keepGood(key, await fresh), stale: null }; }
  catch (err) {
    const good = lastGood.get(key);
    if (!good) throw err;
    return { value: good.value as T, stale: { since: new Date(good.at).toISOString(), reason: failureWords(err), ...(scope ? { scope } : {}) } };
  }
}

export function emptyTrafficReport(filters: TrafficFilters): TrafficReport {
  return { filters, fetchedAt: new Date().toISOString(), status: "ok", errors: [], totals: null, previous: null,
    lifetime: null, today: null, firstTrackedAt: null, firstStepAt: null, people: null, points: [], pages: [], sources: [],
    referrers: [], campaigns: [], devices: [], browsers: [], countries: [], terms: [], hosts: [], funnel: [], funnelOutcomes: null, experiments: [], variants: [], modes: [] };
}

async function loadReport(filters: TrafficFilters, cacheKey: string): Promise<TrafficReport> {
  const report = emptyTrafficReport(filters);
  try {
    if (!posthogApiConfig()) return { ...report, status: "disabled", message: "Connect a PostHog personal key with query:read and a numeric project ID." };
  } catch (err) { return { ...report, status: "error", message: (err as Error).message }; }
  const queries = Object.entries(buildTrafficQueries(filters));
  const results: Record<string, Rows> = {};
  // A query PostHog did not answer keeps the rows it last answered with
  // (same filters); only one that never answered is an error.
  const old: StaleNote[] = [];
  const oldNames: string[] = [];
  // Bound concurrency to avoid saturating the upstream project's query slots.
  // Two at a time: the live panel's two queries run beside these on a page
  // load, and at three PostHog queued one of them for nine seconds
  // (measured 2026-10-01). Six queries now (lifetime folded into the
  // overview, the A/B bench on its tab) — three rounds, not five.
  for (let i = 0; i < queries.length; i += QUERY_CONCURRENCY) {
    await Promise.all(queries.slice(i, i + QUERY_CONCURRENCY).map(async ([name, sql]) => {
      try {
        const read = await orLastGood(`report|${cacheKey}|${name}`, runTrafficQuery(sql, name));
        results[name] = read.value;
        if (read.stale) { old.push(read.stale); oldNames.push(name); }
      } catch (err) {
        const msg = err instanceof Error && err.name === "TimeoutError" ? "Query timed out. Narrow the date range." : err instanceof Error ? err.message : "Query unavailable.";
        report.errors.push(`${name}: ${msg}`);
      }
    }));
  }
  if (results.overview) {
    const current = results.overview.find(r => r[0] === "current");
    const previous = results.overview.find(r => r[0] === "previous");
    report.totals = current ? totals(current.slice(1)) : null;
    report.previous = previous ? totals(previous.slice(1)) : null;
    const people = results.overview.find(r => r[0] === "people");
    report.people = people ? { people: numeric(people[1]), inAppVisitors: numeric(people[2]), inAppPeople: numeric(people[3]) } : null;
    // Coverage: the first pageview and the first registration step, as Unix seconds (0 = none).
    const coverage = results.overview.find(r => r[0] === "coverage");
    const iso = (v: unknown) => (numeric(v) > 0 ? new Date(numeric(v) * 1000).toISOString() : null);
    report.firstTrackedAt = coverage ? iso(coverage[1]) : null;
    report.firstStepAt = coverage ? iso(coverage[2]) : null;
  }
  // ONE ALL-TIME FIGURE (2026-10-01). The header's "All-time visitors" and
  // "Today" are the live panel's totals — the same query, the same cached
  // answer — so the two can no longer print 11,706 and 11,702 side by side
  // (two queries, two rules, two cache ages). The localhost-only scope keeps
  // its own count; the pair has no column for it.
  if (filters.environment !== "development") {
    try {
      const read = await liveTotalsOrLast(filters.fullHistory);
      const t = filters.environment === "all" ? read.value.all : read.value.production;
      report.lifetime = t.allTime; report.today = t.today;
      if (read.stale) { old.push(read.stale); oldNames.push("all-time"); }
    } catch { /* the report's own count stands */ }
  }
  if (results.trend) {
    const days = new Map(results.trend.map(r => [String(r[0]), { ...totals(r.slice(1)), ...daily(r.slice(7)) }]));
    for (let date = filters.from; date <= filters.to; date = shiftDate(date, 1)) report.points.push({ date, ...(days.get(date) || { ...totals([]), ...daily([]) }) });
  }
  report.pages = (results.pages || []).map(r => ({ page: String(r[0]), ...totals(r.slice(1)) }));
  for (const r of results.breakdowns || []) {
    const key = String(r[0]);
    if (["sources", "referrers", "campaigns", "devices", "browsers", "countries", "terms", "hosts"].includes(key)) {
      (report[key as "sources"] as TrafficBreakdown[]).push({ name: String(r[1]), visitors: numeric(r[2]), sessions: numeric(r[3]), conversions: numeric(r[4]) });
    }
  }
  const stages = funnelStages(filters);
  report.funnel = results.funnel?.[0] ? stages.map(({ id, label }, i) => ({ id, label, visitors: numeric(results.funnel[0][i]) })) : [];
  if (results.funnel?.[0]) {
    const row = results.funnel[0].slice(stages.length);
    report.funnelOutcomes = { trials: numeric(row[0]), purchases: numeric(row[1]), other: numeric(row[2]), trialAttempts: numeric(row[3]), purchaseAttempts: numeric(row[4]) };
  }
  report.variants = (results.variants || []).map(r => ({ variant: String(r[0]) === "e" ? "e" as const : "d" as const, started: numeric(r[1]), completed: numeric(r[2]) }));
  {
    const byMode = new Map<string, { mode: string; started: number; completed: number; recorded: number }>();
    for (const r of results.modes || []) {
      const mode = String(r[1] || "unknown");
      const m = byMode.get(mode) ?? { mode, started: 0, completed: 0, recorded: 0 };
      if (String(r[0]) === "start") { m.started += numeric(r[2]); m.completed += numeric(r[3]); } else m.recorded += numeric(r[3]);
      byMode.set(mode, m);
    }
    const order = ["3-step", "2-step", "passwordless", "unknown"];
    report.modes = [...byMode.values()].sort((a, b) => (order.indexOf(a.mode) + 1 || 9) - (order.indexOf(b.mode) + 1 || 9));
  }
  report.experiments = (results.experiments || []).map(experimentResultFromRow);
  if (!report.totals) { report.status = "error"; report.message = report.errors[0] || "Traffic is unavailable."; }
  // The oldest answer on the page dates the note; a scope only when some of it is fresh.
  else if (old.length) {
    const oldest = old.reduce((a, b) => (a.since <= b.since ? a : b));
    const whole = queries.every(([name]) => oldNames.includes(name));
    report.stale = { since: oldest.since, reason: oldest.reason, ...(whole ? {} : { scope: oldNames.join(", ") }) };
  }
  return report;
}

/** STALE WHILE REVALIDATE (2026-10-01). A report younger than a minute is
 *  served as is; up to half an hour old it is served AT ONCE and refreshed
 *  behind it, so the page never waits on PostHog for a figure it showed a
 *  minute ago (the header says when it was fetched). Older, or an answer that
 *  failed, waits for a fresh one. */
const REPORT_FRESH_MS = 60_000;
const REPORT_STALE_MS = 30 * 60_000;
const QUERY_CONCURRENCY = 2;
const refreshing = new Set<string>();
export async function getTrafficReport(filters: TrafficFilters): Promise<TrafficReport> {
  const cacheKey = JSON.stringify([process.env.POSTHOG_PROJECT_ID, process.env.POSTHOG_HOST, filters]);
  const hit = cache.get(cacheKey);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < REPORT_FRESH_MS) return hit.promise;
  if (hit && age < REPORT_STALE_MS) {
    const served = await hit.promise;
    if (served.status === "ok" && !served.errors.length) {
      if (!refreshing.has(cacheKey)) {
        refreshing.add(cacheKey);
        void loadReport(filters, cacheKey).then((fresh) => { if (fresh.status === "ok") cache.set(cacheKey, { at: Date.now(), promise: Promise.resolve(fresh) }); }).finally(() => refreshing.delete(cacheKey));
      }
      return served;
    }
  }
  if (cache.size >= 24) cache.delete(cache.keys().next().value!);
  const promise = loadReport(filters, cacheKey);
  cache.set(cacheKey, { at: Date.now(), promise });
  return promise;
}

/** The A/B bench, asked for when its tab opens — not on every page load. */
export async function getTrafficExperiments(filters: TrafficFilters): Promise<ExperimentResult[]> {
  if (!posthogApiConfig()) throw new Error("Experiment results are unavailable because PostHog is not connected.");
  const rows = await runTrafficQuery(buildExperimentsQuery(filters), "experiments");
  return rows.map(experimentResultFromRow);
}

const text = (v: unknown) => v == null ? "" : String(v);
// HogQL returns UTC datetimes as "YYYY-MM-DD HH:MM:SS[.ffffff]" or ISO strings; both become ISO.
const stamp = (v: unknown) => { const raw = text(v).trim(); if (!raw) return ""; const iso = raw.replace(" ", "T") + (/[Zz]$|[+-]\d\d:?\d\d$/.test(raw) ? "" : "Z"); const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toISOString(); };
const stageCache = new Map<string, { at: number; promise: Promise<StageVisitorsReport> }>();

/** Everyone who reached one funnel stage under the current filters, newest first. */
export async function getStageVisitors(filters: TrafficFilters, stageId: string): Promise<StageVisitorsReport> {
  const stage = funnelStages(filters).find(s => s.id === stageId);
  if (!stage) throw new Error("Choose a funnel stage.");
  const cacheKey = JSON.stringify([process.env.POSTHOG_PROJECT_ID, process.env.POSTHOG_HOST, filters, stageId]);
  const hit = stageCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 60_000) return hit.promise;
  if (stageCache.size >= 24) stageCache.delete(stageCache.keys().next().value!);
  const promise = (async () => {
    const config = posthogApiConfig();
    if (!config) throw new Error("Connect PostHog to inspect visitors.");
    const sql = buildStageVisitorsQuery(filters, stageId);
    if (!sql) throw new Error("Choose a funnel stage.");
    const rows = await runTrafficQuery(sql, `stage visitors / ${stageId}`);
    const visitors: StageVisitor[] = rows.map(r => ({
      id: text(r[0]), reachedAt: stamp(r[2]), lastSeen: stamp(r[3]),
      device: text(r[4]), browser: text(r[5]), os: text(r[6]),
      country: text(r[7]), region: text(r[8]), city: text(r[9]),
      source: text(r[10]), referrer: text(r[11]), campaign: text(r[12]).trim() === "/  /" ? "" : text(r[12]),
      sessions: numeric(r[13]), views: numeric(r[14]), furthest: text(r[15]),
      personUrl: r[1] ? `${config.host}/project/${config.id}/person/${encodeURIComponent(text(r[1]))}` : null,
    }));
    return { stage: { id: stage.id, label: stage.label }, filters, total: numeric(rows[0]?.[16]) || visitors.length, visitors, fetchedAt: new Date().toISOString() };
  })();
  promise.catch(() => stageCache.delete(cacheKey));
  stageCache.set(cacheKey, { at: Date.now(), promise });
  return promise;
}

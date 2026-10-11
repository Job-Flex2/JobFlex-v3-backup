import type { TrafficFilters } from "./traffic-contract";
import { TRAFFIC_EVENTS as E } from "./traffic-contract";
// Who counts: one rule for every figure on the page (2026-10-01).
import { BROWSER_TYPE_SQL, HOST_SQL, IN_APP_SQL, PERSON_KEY_SQL, TRAFFIC_SINCE, TRAFFIC_TZ, UA_SQL, sinceSql, visitorRuleSql, type VisitorScope } from "./traffic-visitor";

const DAY = 86_400_000;
export function dateInZone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(date + "T12:00:00Z") + days * DAY).toISOString().slice(0, 10);
}
export function parseTrafficFilters(input: Record<string, unknown> = {}, now = new Date()): TrafficFilters {
  const timezone = typeof input.timezone === "string" ? input.timezone : TRAFFIC_TZ;
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(now); } catch { throw new Error("Choose a valid timezone."); }
  const today = dateInZone(now, timezone);
  const fullHistory = input.fullHistory === true || input.fullHistory === "true";
  // The range works inside the counted window: nothing before TRAFFIC_SINCE
  // unless the full history is asked for (2026-10-01).
  const floor = (d: string) => (fullHistory || d >= TRAFFIC_SINCE ? d : TRAFFIC_SINCE);
  const from = floor(typeof input.from === "string" ? input.from : shiftDate(today, -29));
  const to = floor(typeof input.to === "string" ? input.to : today);
  for (const d of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) throw new Error("Use valid dates in YYYY-MM-DD format.");
  }
  if (from > to || to > today || Date.parse(to) - Date.parse(from) >= 366 * DAY) throw new Error("Choose a date range up to 366 days ending today or earlier.");
  const text = (key: string, max: number) => typeof input[key] === "string" ? (input[key] as string).trim().slice(0, max) : "";
  return {
    from, to, timezone,
    audience: input.audience === "new" || input.audience === "returning" ? input.audience : "all",
    // Production (www.jobflex.app, jobflex.app) unless the admin asks for localhost too (2026-10-01).
    environment: input.environment === "all" || input.environment === "development" ? input.environment : "production",
    page: text("page", 240), source: text("source", 160), device: text("device", 80), host: text("host", 253),
    flow: input.flow === "google" || input.flow === "standard" || input.flow === "otp" ? input.flow : "all",
    windowDays: [1, 7, 14].includes(Number(input.windowDays)) ? Number(input.windowDays) : 7,
    billingMode: input.billingMode === "test" || input.billingMode === "all" ? input.billingMode : "live",
    fullHistory,
  };
}

// Only validated literals enter HogQL; the client never supplies SQL or identifiers.
export const literal = (s: string) => "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

export interface FunnelStageSpec { id: string; label: string; where: string }
/** All flows use shared stages and distinct visitors, so Google need not pass the email-only Account step. */
export function funnelStages(f: TrafficFilters): FunnelStageSpec[] {
  const q = literal;
  return [
    { id: "landing", label: "Landing", where: "event = '$pageview' AND pathname = '/'" },
    { id: "registration", label: "Registration", where: "event = '$pageview' AND pathname = '/auth/register'" },
    ...(f.flow === "standard" ? [{ id: "account", label: "1 / Account", where: `event = ${q(E.step)} AND step = '1'` }] : []),
    // The passwordless sign-up (2026-10-10) has no company screen: name and email, then the code.
    ...(f.flow === "otp"
      ? [
          { id: "account", label: "1 / Account", where: `event = ${q(E.step)} AND step = '1' AND flow = 'otp'` },
          { id: "code", label: "1 / Email code", where: `event = ${q(E.step)} AND step = 'code' AND flow = 'otp'` },
        ]
      : [{ id: "company", label: "2 / Company", where: `event = ${q(E.step)} AND step = '2'${f.flow === "all" ? "" : ` AND flow = ${q(f.flow)}`}` }]),
    { id: "plan", label: "3 / Plan", where: `event = ${q(E.step)} AND step = '3'` },
    { id: "attempt", label: "Trial / purchase attempt", where: `event = ${q(E.attempt)}` },
    { id: "checkout", label: "Checkout opened", where: `event = ${q(E.opened)}` },
    { id: "completed", label: "Verified signup", where: `event = ${q(E.completed)} AND verified = 'true'` },
  ];
}

/** The shared CTE scaffolding every traffic report is built on. */
function trafficParts(f: TrafficFilters) {
  const q = literal;
  const start = `toDateTime(${q(f.from + " 00:00:00")}, ${q(f.timezone)})`;
  const end = `toDateTime(${q(shiftDate(f.to, 1) + " 00:00:00")}, ${q(f.timezone)})`;
  const duration = Math.round((Date.parse(f.to) - Date.parse(f.from)) / DAY) + 1;
  const prev = `toDateTime(${q(shiftDate(f.from, -duration) + " 00:00:00")}, ${q(f.timezone)})`;
  const prop = (name: string) => `ifNull(toString(properties.${name}), '')`;
  const eventPath = `ifNull(nullIf(${prop("$pathname")}, ''), path(${prop("$current_url")}))`;
  // The page's one visitor rule (lib/traffic-visitor): production hosts, localhost
  // only when asked, Vercel previews and unknown hosts never, no bots.
  const scope: VisitorScope = f.environment === "all" ? "with-local" : f.environment === "development" ? "local" : "production";
  const env = visitorRuleSql({ host: "hostname", ua: "ua", browserType: "browser_type", event: "event" }, scope);
  const hostFilter = f.host ? `hostname = ${q(f.host === "__unknown__" ? "" : f.host)}` : "1 = 1";
  const base = `WITH raw AS (
    SELECT timestamp, toString(person_id) AS visitor, toString(distinct_id) AS distinct_id, event,
      ${eventPath} AS pathname,
      ${HOST_SQL} AS hostname, ${UA_SQL} AS ua, ${BROWSER_TYPE_SQL} AS browser_type,
      ${PERSON_KEY_SQL} AS person_key, ${IN_APP_SQL} AS in_app, ${prop("fbclid")} AS fbclid,
      ${prop("$session_id")} AS session_id,
      ifNull(nullIf(${prop("jf_environment")}, ''), if(domain(${prop("$current_url")}) IN ('localhost', '127.0.0.1'), 'development', 'production')) AS environment,
      ${prop("utm_source")} AS utm_source, ${prop("utm_medium")} AS medium,
      ${prop("utm_campaign")} AS campaign, ${prop("utm_term")} AS term,
      ${prop("$referring_domain")} AS referrer,
      ${prop("$device_type")} AS device, ${prop("$browser")} AS browser, ${prop("$os")} AS os,
      ${prop("$geoip_country_name")} AS country, ${prop("$geoip_subdivision_1_name")} AS region, ${prop("$geoip_city_name")} AS city,
      ${prop("step")} AS step, ${prop("flow")} AS flow,
      ${prop("experiment")} AS experiment, ${prop("variant")} AS variant,
      ${prop("verified")} AS verified, ${prop("billing_mode")} AS billing_mode,
      ${prop("intent")} AS intent, ${prop("outcome")} AS outcome
    FROM events
    WHERE timestamp <= now() AND ${sinceSql(f.fullHistory)} AND (event = '$pageview' OR event IN (${Object.values(E).filter((e) => e !== E.landingSection).map(q).join(",")}))
  ), base AS (
    SELECT *, if(event = ${q(E.step)}, concat('registration:', step), pathname) AS page,
      if(utm_source != '', utm_source, if(referrer IN ('', '$direct') OR referrer = hostname, 'Direct / unknown', referrer)) AS source
    FROM raw WHERE pathname != '/admin' AND NOT startsWith(pathname, '/admin/') AND ${env} AND ${hostFilter}
      ${f.billingMode === "all" ? "" : `AND (event != ${q(E.completed)} OR billing_mode = ${q(f.billingMode)})`}
  ), enriched AS (
    SELECT *, minIf(timestamp, event = '$pageview') OVER (PARTITION BY visitor) AS first_seen,
      if(session_id = '', source, argMin(source, timestamp) OVER (PARTITION BY visitor, session_id)) AS traffic_source,
      if(session_id = '', referrer, argMin(referrer, timestamp) OVER (PARTITION BY visitor, session_id)) AS traffic_referrer,
      argMin(concat(utm_source, ' / ', medium, ' / ', campaign), timestamp) OVER (PARTITION BY visitor, session_id) AS traffic_campaign,
      argMin(term, timestamp) OVER (PARTITION BY visitor, session_id) AS traffic_term,
      minOrNullIf(timestamp, event = ${q(E.completed)} AND verified = 'true') OVER
        (PARTITION BY visitor ORDER BY timestamp ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS next_completed
    FROM base
  )`;
  // Most reports need only first-seen and source. Avoid calculating acquisition
  // and forward-conversion windows for every audience/funnel request.
  const scopedBase = base.slice(0, base.indexOf(", enriched AS ("));
  const audienceBase = `${scopedBase}, enriched AS (
    SELECT *, minIf(timestamp, event = '$pageview') OVER (PARTITION BY visitor) AS first_seen,
      if(session_id = '', source, argMin(source, timestamp) OVER (PARTITION BY visitor, session_id)) AS traffic_source
    FROM base
  )`;
  const aud = (boundary: string) => f.audience === "new" ? `first_seen >= ${boundary}` : f.audience === "returning" ? `first_seen < ${boundary}` : "1 = 1";
  const segment = `${f.source ? `traffic_source = ${q(f.source)}` : "1 = 1"} AND ${f.device ? `device = ${q(f.device === "__unknown__" ? "" : f.device)}` : "1 = 1"}`;
  const page = f.page.startsWith("registration:") ? `event = ${q(E.step)} AND page = ${q(f.page)}`
    : `event = '$pageview'${f.page ? ` AND page = ${q(f.page)}` : ""}`;
  const selected = `timestamp >= ${start} AND timestamp < ${end} AND ${segment} AND ${aud(start)}`;
  const previous = `timestamp >= ${prev} AND timestamp < ${start} AND ${segment} AND ${aud(prev)}`;
  // The cohort starts with its first eligible landing. Every later stage must follow
  // the preceding stage and fit inside that visitor's conversion window.
  const stages = funnelStages(f);
  const ctes = [`s0 AS (SELECT *, minOrNullIf(timestamp, ${selected} AND ${stages[0].where}) OVER (PARTITION BY visitor) AS t0 FROM enriched)`];
  for (let i = 1; i < stages.length; i++) ctes.push(`s${i} AS (
    SELECT *, minOrNullIf(timestamp, t${i - 1} IS NOT NULL AND timestamp >= t${i - 1}
      AND timestamp <= t0 + INTERVAL ${f.windowDays} DAY AND ${stages[i].where}) OVER (PARTITION BY visitor) AS t${i} FROM s${i - 1})`);
  return { q, start, end, prev, base, scopedBase, audienceBase, aud, selected, previous, page, stages, ctes };
}

/** The report's queries as the page loads them: five round trips' worth. The
 *  A/B bench's query waits for its tab (buildExperimentsQuery). */
export function buildTrafficQueries(f: TrafficFilters): Record<string, string> {
  const { experiments: _deferred, ...onLoad } = buildAllTrafficQueries(f);
  void _deferred;
  return onLoad;
}
export function buildExperimentsQuery(f: TrafficFilters): string {
  return buildAllTrafficQueries(f).experiments;
}

function buildAllTrafficQueries(f: TrafficFilters): Record<string, string> {
  const { q, start, end, prev, base, audienceBase, aud, selected, previous, page, stages, ctes } = trafficParts(f);
  const totals = (where: string, boundary: string) => `SELECT count() AS visitors,
    countIf(visitor_first_seen >= ${boundary}) AS new_visitors, countIf(visitor_first_seen < ${boundary}) AS returning_visitors,
    countIf(sessions >= 2) AS repeat_visitors, sum(sessions) AS session_total, sum(views) AS pageview_total
    FROM (SELECT visitor, min(first_seen) AS visitor_first_seen, uniqExactIf(session_id, session_id != '') AS sessions, count() AS views
      FROM enriched WHERE ${where} AND ${page} GROUP BY visitor)`;
  // ONE ROUND TRIP FOR THE HEADLINE FIGURES (2026-10-01): the range and the
  // period before it, the estimated people (address + browser) and the in-app
  // share, and when coverage begins — what the separate "lifetime" query used
  // to answer; the all-time count itself comes from the live totals.
  // HogQL has no toUInt64; every column here is already an unsigned count, and
  // a zero is written as an empty countIf so UNION ALL finds one type.
  const u = (x: string) => (x === "0" ? "countIf(1 = 0)" : x);
  const overview = `${audienceBase} SELECT 'current' AS period, * FROM (${totals(selected, start)})
    UNION ALL SELECT 'previous' AS period, * FROM (${totals(previous, prev)})
    UNION ALL SELECT 'people', ${u("uniqExact(person_key)")}, ${u("uniqExactIf(visitor, in_app)")}, ${u("uniqExactIf(person_key, in_app)")}, ${u("0")}, ${u("0")}, ${u("0")}
      FROM enriched WHERE ${selected} AND ${page}
    UNION ALL SELECT 'coverage', ${u("ifNull(toUnixTimestamp(minOrNullIf(timestamp, event = '$pageview')), 0)")}, ${u(`ifNull(toUnixTimestamp(minOrNullIf(timestamp, event = ${q(E.step)})), 0)`)}, ${u("0")}, ${u("0")}, ${u("0")}, ${u("0")}
      FROM base LIMIT 4`;
  // The days, with the estimated people and the in-app share beside the
  // visitors, and the ad tags the reconciliation table needs (2026-10-01).
  const trend = `${audienceBase} SELECT t.day, t.visitors, t.new_visitors, t.returning_visitors, t.repeat_visitors, t.session_total, t.pageview_total,
      d.people, d.in_app_visitors, d.in_app_people, d.ads_fb, d.ads_ig, d.ads_an, d.ads_fbclid, d.ads_any
    FROM (SELECT day, count() AS visitors, countIf(visitor_first_seen >= ${start}) AS new_visitors, countIf(visitor_first_seen < ${start}) AS returning_visitors,
        countIf(sessions >= 2) AS repeat_visitors, sum(sessions) AS session_total, sum(views) AS pageview_total
      FROM (SELECT toString(toDate(toTimeZone(timestamp, ${q(f.timezone)}))) AS day, visitor, min(first_seen) AS visitor_first_seen,
        uniqExactIf(session_id, session_id != '') AS sessions, count() AS views
        FROM enriched WHERE ${selected} AND ${page} GROUP BY day, visitor)
      GROUP BY day) AS t
    LEFT JOIN (SELECT toString(toDate(toTimeZone(timestamp, ${q(f.timezone)}))) AS day,
        uniqExact(person_key) AS people, uniqExactIf(visitor, in_app) AS in_app_visitors, uniqExactIf(person_key, in_app) AS in_app_people,
        uniqExactIf(visitor, utm_source = 'fb') AS ads_fb, uniqExactIf(visitor, utm_source = 'ig') AS ads_ig, uniqExactIf(visitor, utm_source = 'an') AS ads_an,
        uniqExactIf(visitor, fbclid != '') AS ads_fbclid, uniqExactIf(visitor, utm_source != '' OR fbclid != '') AS ads_any
      FROM enriched WHERE ${selected} AND ${page} GROUP BY day) AS d ON t.day = d.day
    ORDER BY t.day LIMIT 366`;
  const pages = `${audienceBase} SELECT page, count(), countIf(visitor_first_seen >= ${start}), countIf(visitor_first_seen < ${start}), countIf(sessions >= 2), sum(sessions), sum(views)
    FROM (SELECT page, visitor, min(first_seen) AS visitor_first_seen, uniqExactIf(session_id, session_id != '') AS sessions, count() AS views
      FROM enriched WHERE ${selected} AND event IN ('$pageview', ${q(E.step)}) GROUP BY page, visitor)
    GROUP BY page ORDER BY count() DESC LIMIT 200`;
  const dimensions = { sources: "traffic_source", referrers: "traffic_referrer", campaigns: "traffic_campaign", devices: "device", browsers: "browser", countries: "country", terms: "traffic_term", hosts: "hostname" };
  const breakdowns = `${base} SELECT tupleElement(dimension, 1) AS kind, ifNull(nullIf(tupleElement(dimension, 2), ''), 'Unknown') AS name,
      uniqExact(visitor) AS visitors, uniqExactIf(concat(visitor, ':', session_id), session_id != '') AS sessions,
      uniqExactIf(visitor, next_completed >= timestamp AND next_completed <= timestamp + INTERVAL ${f.windowDays} DAY) AS conversions
    FROM (SELECT *, arrayJoin([${Object.entries(dimensions).map(([key, column]) => `tuple(${q(key)}, ${column})`).join(",")}]) AS dimension FROM enriched)
    WHERE ${selected} AND ${page} GROUP BY kind, name ORDER BY visitors DESC LIMIT 20 BY kind LIMIT 160`;
  const funnel = `${audienceBase}, ${ctes.join(",\n")}
    SELECT ${stages.map((_, i) => `uniqExactIf(visitor, t${i} IS NOT NULL)`).join(", ")},
      uniqExactIf(visitor, timestamp = t${stages.length - 1} AND event = ${q(E.completed)} AND outcome = 'trial_started'),
      uniqExactIf(visitor, timestamp = t${stages.length - 1} AND event = ${q(E.completed)} AND outcome = 'subscription_purchased'),
      uniqExactIf(visitor, timestamp = t${stages.length - 1} AND event = ${q(E.completed)} AND outcome NOT IN ('trial_started', 'subscription_purchased')),
      uniqExactIf(visitor, timestamp = t${stages.length - 3} AND event = ${q(E.attempt)} AND intent = 'trial'),
      uniqExactIf(visitor, timestamp = t${stages.length - 3} AND event = ${q(E.attempt)} AND intent = 'purchase')
    FROM s${stages.length - 1} LIMIT 1`;
  const experiments = `${audienceBase}, exposures AS (
    SELECT visitor, experiment, argMin(variant, timestamp) AS assigned_variant, min(timestamp) AS exposed_at, uniqExact(variant) AS variants,
      argMin(traffic_source, timestamp) AS exposure_source, argMin(device, timestamp) AS exposure_device, min(first_seen) AS first_seen
    FROM enriched WHERE event = ${q(E.exposure)} AND experiment != '' AND variant != '' GROUP BY visitor, experiment
  ), outcomes AS (
    SELECT x.visitor, x.experiment, x.assigned_variant, x.variants,
      countIf(b.event = ${q(E.attempt)} AND b.timestamp >= x.exposed_at AND b.timestamp <= x.exposed_at + INTERVAL ${f.windowDays} DAY) > 0 AS attempted,
      countIf(b.event = ${q(E.completed)} AND b.verified = 'true' AND b.timestamp >= x.exposed_at AND b.timestamp <= x.exposed_at + INTERVAL ${f.windowDays} DAY) > 0 AS completed
    FROM exposures x LEFT JOIN base b ON x.visitor = b.visitor
    WHERE x.exposed_at >= ${start} AND x.exposed_at < ${end} AND ${aud(start)}
      ${f.source ? `AND x.exposure_source = ${q(f.source)}` : ""} ${f.device ? `AND x.exposure_device = ${q(f.device === "__unknown__" ? "" : f.device)}` : ""}
    GROUP BY x.visitor, x.experiment, x.assigned_variant, x.variants
  ) SELECT experiment, assigned_variant, countIf(variants = 1), countIf(variants = 1 AND attempted), countIf(variants = 1 AND completed), countIf(variants > 1)
    FROM outcomes GROUP BY experiment, assigned_variant ORDER BY experiment, assigned_variant LIMIT 100`;
  // Landing variant d vs e (landing-e pass A): a signup start is a visitor's
  // first registration step in the range; its `variant` property ("e" from
  // landing-e's register, nothing from landing-d's) names the arm. Completion
  // is the verified server event inside the window after that start. Since
  // 2026-09-16 every start is "e" (landing-e is the only landing); the split
  // stays for the history before that date.
  const variants = `${audienceBase}, starts AS (
    SELECT visitor, if(argMin(variant, timestamp) = 'e', 'e', 'd') AS arm, min(timestamp) AS started_at
    FROM enriched WHERE ${selected} AND event = ${q(E.step)} GROUP BY visitor
  )
    SELECT s.arm, uniqExact(s.visitor) AS started,
      uniqExactIf(s.visitor, b.event = ${q(E.completed)} AND b.verified = 'true' AND b.timestamp >= s.started_at AND b.timestamp <= s.started_at + INTERVAL ${f.windowDays} DAY) AS completed
    FROM starts s LEFT JOIN base b ON s.visitor = b.visitor
    GROUP BY s.arm ORDER BY s.arm LIMIT 2`;
  return { overview, trend, pages, breakdowns, funnel, experiments, variants };
}

export const STAGE_VISITOR_LIMIT = 200;
/**
 * Who reached one funnel stage: one row per visitor with the device, place and
 * source they arrived with, plus how far along the funnel they got.
 * Columns: visitor, distinct_id, reached_at, last_seen, device, browser, os, country,
 * region, city, source, referrer, campaign, sessions, views, furthest, total.
 */
export function buildStageVisitorsQuery(f: TrafficFilters, stageId: string): string | null {
  const { audienceBase, stages, ctes } = trafficParts(f);
  const index = stages.findIndex(stage => stage.id === stageId);
  if (index < 0) return null;
  const last = stages.length - 1;
  const inWindow = `timestamp >= t0 AND timestamp <= t0 + INTERVAL ${f.windowDays} DAY`;
  const pick = (column: string, extra = "") => `ifNull(argMinIf(${column}, timestamp, ${column} != '' AND ${inWindow}${extra}), '')`;
  const furthest = `multiIf(${stages.map((stage, i) => last - i).map(i => `any(t${i}) IS NOT NULL, ${literal(stages[i].id)}`).join(", ")}, '')`;
  return `${audienceBase}, ${ctes.join(",\n")}
    SELECT visitor, ifNull(argMin(distinct_id, timestamp), '') AS distinct_id, any(t${index}) AS reached_at, max(timestamp) AS last_seen,
      ${pick("device")}, ${pick("browser")}, ${pick("os")},
      ${pick("country")}, ${pick("region")}, ${pick("city")},
      ${pick("traffic_source")}, ${pick("referrer", " AND referrer NOT IN ('$direct')")},
      ${pick("campaign", " AND event = '$pageview'")},
      uniqExactIf(session_id, session_id != '' AND ${inWindow}) AS sessions,
      countIf(event = '$pageview' AND ${inWindow}) AS views,
      ${furthest} AS furthest,
      count() OVER () AS total
    FROM s${last} WHERE t${index} IS NOT NULL
    GROUP BY visitor ORDER BY reached_at DESC LIMIT ${STAGE_VISITOR_LIMIT}`;
}

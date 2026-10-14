// THE ANALYST (owner, 2026-10-02: "a smart analyser of what people do on the
// landing page — find what is wrong with the ads or the sign-up, how to
// convert faster, and say what is going on after a period of time").
//
// One HogQL query reads the last ANALYST_DAYS of events as ONE ROW PER
// SESSION: where the visit came from (ad, trade hero, device, Facebook's
// in-app browser), what happened on the landing (pages, seconds on it, how
// far they scrolled — posthog-js sends both on $pageleave — which sections
// they reached, which buttons they pressed) and how far the sign-up got
// (the form, step 1 / 2 / 3, a trial or checkout started, errors, the
// verified completion). `analyse` then turns those rows into FINDINGS — each
// a plain sentence of evidence and one concrete thing to try — by rules
// with minimum samples, so it says nothing it cannot back, and a one-line
// headline of what is going on. Pure: no I/O, so scripts/qa/traffic-analyst
// .check.ts proves every rule on made-up sessions.

import { LANDING_SECTIONS, OWN_ORDER_LANDINGS, hasOwnSectionOrder, landingSectionsFor, type LandingSection } from "./landing-sections";
import { TRAFFIC_EVENTS as E } from "./traffic-contract";
import { classifySource } from "./traffic-live";
import { BROWSER_TYPE_SQL, HOST_SQL, IN_APP_SQL, TRAFFIC_SINCE_MS, UA_SQL, sinceSql, visitorRuleSql } from "./traffic-visitor";
import { resolveLandingVariant } from "@/components/v3/landing-e/landing-variants";

export const ANALYST_DAYS = 7;
/** The analyst speaks once this many visits from ads have landed in the window. */
export const ANALYST_MIN_AD_VISITS = 20;
/** A segment (an ad, a trade, a device…) is compared once it has this many visits. */
const SEGMENT_MIN = 8;

/** The window in words (2026-10-04): "last 7 days" once the ad launch is
 *  that far back, else "since Sep 30 (4.6 days)" — the reading never claims
 *  days it did not read. `inWords` fits a sentence: "in the last 7 days". */
export function periodWords(from: number, now: number, days = ANALYST_DAYS, timezone = "America/Los_Angeles"): { label: string; inWords: string } {
  if (from <= now - days * 86_400_000 + 60_000) return { label: `last ${days} days`, inWords: `in the last ${days} days` };
  let since: string;
  try { since = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(new Date(from)); } catch { since = new Date(from).toISOString().slice(0, 10); }
  const d = Math.max(0, (now - from) / 86_400_000);
  const span = d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${d.toFixed(1).replace(/\.0$/, "")} ${d.toFixed(1) === "1.0" ? "day" : "days"}`;
  const label = `since ${since} (${span})`;
  return { label, inWords: label };
}

/** Between free-text values in one column (button words can hold commas). */
const LIST_SEP = " ¦ ";

/** Where the analyst's window starts: `days` back, never before the ad
 *  launch (TRAFFIC_SINCE) — the page's one counting start (2026-10-04). */
export function analystWindowFrom(now: number, days = ANALYST_DAYS): number {
  return Math.max(now - days * 86_400_000, TRAFFIC_SINCE_MS);
}

/** One session, as the query returns it (analystSessionFromRow). */
export interface LandingSession {
  id: string;
  person: string;
  startedAt: number;
  endedAt: number;
  /** The landing's variant key ("roofing", "hvac", "default"…), "" when the landing was not seen. */
  industry: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  referrer: string;
  fbclid: boolean;
  device: string;
  browser: string;
  os: string;
  inApp: boolean;
  views: number;
  landingViews: number;
  /** Seconds on the landing (null = the browser never reported leaving it). */
  dwell: number | null;
  /** Deepest scroll on the landing, 0..1 (null = not reported). */
  scroll: number | null;
  sections: string[];
  cta: number;
  placements: string[];
  registerViews: number;
  /** The furthest sign-up step viewed: 0 none, 1 account, 2 company, 3 plan. */
  step: number;
  flow: string;
  attempts: number;
  cardless: number;
  opened: number;
  errors: string[];
  completed: boolean;
  outcome: string;
  plan: string;
  /** The first screen as the phone drew it (landing_timing, 2026-10-04), ms
   *  from the tap; null when the visit sent none. */
  heroMs: number | null;
  paintMs: number | null;
  readyMs: number | null;
  trackedMs: number | null;
  kb: number | null;
  /** "4g", "3g"… where Chrome names it; "" elsewhere. */
  connection: string;
  /** They left the landing before the headline had appeared. */
  leftUnshown: number;
  /** Step 1 of the sign-up as it became usable (signup_step1, 2026-10-04). */
  formReadyMs: number | null;
  typedEarly: number;
  submittedEarly: number;
  step1Errors: string[];
  step1Passed: number;
  // What the beacons already send and the reading did not take (2026-10-04, stage 2).
  /** landing_timing: the largest paint; when they left before the headline; the link as Chrome measures it. */
  lcpMs: number | null;
  leftMs: number | null;
  /** Mbps, and the round trip in ms ("" / null where the browser does not say). */
  downlink: number | null;
  rttMs: number | null;
  /** signup_step1 "ready": ms from the tap to the first key typed and the early Continue. */
  typedMs: number | null;
  submitMs: number | null;
  /** landing_section: "key:seconds" — when each section was reached, in page order. */
  sectionAfter: string[];
  /** cta_click: the words on the buttons pressed, where they lead, their spot. */
  ctaLabels: string[];
  ctaHrefs: string[];
  ctaSpots: string[];
  /** The HVAC hero's demo: steps reached (by tap or by the clock), taps, tiers picked. */
  hvacSteps: number;
  hvacStepKeys: string[];
  hvacTaps: number;
  hvacTierPicks: number;
  hvacTiers: string[];
  /** Where PostHog's GeoIP puts the visit. */
  country: string;
  region: string;
  city: string;
}

export interface AnalystFinding {
  id: string;
  tone: "bad" | "warn" | "good" | "info";
  title: string;
  /** The numbers behind it, in one line. */
  evidence: string;
  /** One concrete thing to try. */
  action: string;
  /** The fix as steps, when one line is not enough (2026-10-04). */
  steps?: string[];
  /** What it is about — an ad's name, a trade, a browser — when not the whole site. */
  about?: string;
  n: number;
  confidence: "low" | "medium" | "high";
}

export interface AnalystSegment { key: string; name: string; n: number; bounce: number | null; cta: number | null; form: number | null; completed: number; platform?: string }
export interface AnalystSectionReach { key: string; label: string; reach: number | null; shown: "all" | "some" }

export interface AnalystReport {
  days: number;
  /** The window as read, in words: "last 7 days", or "since Sep 30 (4.6 days)"
   *  while the ad launch is less than `days` back (2026-10-04). */
  period: string;
  /** Where the window starts, Unix ms. */
  windowFrom: number;
  sample: { sessions: number; landed: number; fromAds: number; last24h: number; measured: number; enough: boolean; needed: number; basis: "ads" | "all" };
  headline: string;
  findings: AnalystFinding[];
  funnel: Array<{ key: string; label: string; n: number; pct: number | null }>;
  /** How far down the page they get, over the landings laid out in the usual
   *  order (LANDING_SECTIONS). */
  sections: AnalystSectionReach[];
  /** A landing laid out in an order of its own (lib/landing-sections — the
   *  roofing landing, 2026-10-04) is read apart, in that order: "the section
   *  after the hero" is a different section there. Only landings with a
   *  measured visit; absent on a reading saved before the field existed. */
  landings?: Array<{ key: string; name: string; measured: number; sections: AnalystSectionReach[] }>;
  ads: AnalystSegment[];
  trades: AnalystSegment[];
  placements: Array<{ placement: string; n: number }>;
  stats: { bounce: number | null; fast: number | null; dwellMedian: number | null; scrollMedian: number | null; inApp: number | null;
    /** Median ms from the tap to the headline on phones, and to a usable sign-up form (2026-10-04). */
    heroMedianPhone: number | null; formReadyMedian: number | null };
}

// ── The query ──────────────────────────────────────────────────────────────

/** The last `days` of events, one row per session, in the order
 *  analystSessionFromRow reads them. Arrays travel as comma-joined strings
 *  (groupUniqArrayIf). HogQL, not ClickHouse: the alias cannot be `session`
 *  (HogQL's own sessions table), only its whitelisted functions exist
 *  (toFloat64OrNull yes; the Int variants are not relied on), and the sort
 *  key must be a selected column. The visitor rule is the page's one rule
 *  (traffic-visitor). */
export function buildAnalystQuery(days = ANALYST_DAYS): string {
  const prop = (name: string) => `ifNull(toString(properties.${name}), '')`;
  const num = (name: string) => `toFloat64OrNull(toString(properties.${name}))`;
  const path = `ifNull(nullIf(${prop("$pathname")}, ''), path(${prop("$current_url")}))`;
  const events = ["'$pageview'", "'$pageleave'", ...[E.landingView, E.landingSection, E.ctaClick, E.step, E.attempt, E.opened, E.error, E.completed, E.landingTiming, E.signupStep1, E.hvacDemoStep, E.hvacDemoTier].map((e) => `'${e}'`)].join(", ");
  // The landing's own numbers ride on the event that leaves it: $pageleave, or the next $pageview on an in-app navigation.
  const left = `((event = '$pageleave' OR event = '$pageview') AND ${prop("$prev_pageview_pathname")} = '/')`;
  const joined = (value: string, when: string, sep = ",") => `arrayStringConcat(groupUniqArrayIf(${value}, ${when} AND ${value} != ''), '${sep}')`;
  const ready = `event = '${E.signupStep1}' AND ${prop("outcome")} = 'ready'`;
  const d = Math.max(1, Math.min(30, Math.round(days)));
  return `SELECT ${prop("$session_id")} AS sid, any(toString(person_id)),
    toUnixTimestamp(min(timestamp)) * 1000 AS started, toUnixTimestamp(max(timestamp)) * 1000,
    anyIf(${prop("industry")}, event = '${E.landingView}'),
    argMinIf(${prop("$current_url")}, timestamp, event = '$pageview' AND ${path} = '/'),
    anyIf(${prop("utm_source")}, ${prop("utm_source")} != ''), anyIf(${prop("utm_medium")}, ${prop("utm_medium")} != ''),
    anyIf(${prop("utm_campaign")}, ${prop("utm_campaign")} != ''), anyIf(${prop("utm_content")}, ${prop("utm_content")} != ''),
    anyIf(${prop("$referring_domain")}, event = '$pageview'), max(${prop("fbclid")} != ''),
    anyIf(${prop("$device_type")}, ${prop("$device_type")} != ''), anyIf(${prop("$browser")}, ${prop("$browser")} != ''), anyIf(${prop("$os")}, ${prop("$os")} != ''),
    max(${IN_APP_SQL}),
    countIf(event = '$pageview'), countIf(event = '$pageview' AND ${path} = '/'),
    maxIf(${num("$prev_pageview_duration")}, ${left}), maxIf(${num("$prev_pageview_max_scroll_percentage")}, ${left}),
    ${joined(prop("section"), `event = '${E.landingSection}'`)},
    countIf(event = '${E.ctaClick}'), ${joined(prop("placement"), `event = '${E.ctaClick}'`)},
    countIf(event = '$pageview' AND startsWith(${path}, '/auth/register')),
    maxIf(${num("step")}, event = '${E.step}'), anyIf(${prop("flow")}, event = '${E.step}'),
    countIf(event = '${E.attempt}'), countIf(event = '${E.attempt}' AND ${prop("card")} = 'false'), countIf(event = '${E.opened}'),
    ${joined(prop("reason"), `event = '${E.error}'`)},
    countIf(event = '${E.completed}' AND ${prop("verified")} IN ('true', '1', '')),
    anyIf(${prop("outcome")}, event = '${E.completed}'), anyIf(${prop("plan")}, event = '${E.completed}'),
    maxIf(${num("hero_ms")}, event = '${E.landingTiming}' AND ${prop("shown")} = 'true'), maxIf(${num("paint_ms")}, event = '${E.landingTiming}'),
    maxIf(${num("ready_ms")}, event = '${E.landingTiming}'), maxIf(${num("tracked_ms")}, event = '${E.landingTiming}'), maxIf(${num("kb")}, event = '${E.landingTiming}'),
    anyIf(${prop("connection")}, event = '${E.landingTiming}' AND ${prop("connection")} != ''), countIf(event = '${E.landingTiming}' AND ${prop("shown")} = 'false'),
    maxIf(${num("ready_ms")}, event = '${E.signupStep1}' AND ${prop("outcome")} = 'ready'),
    countIf(event = '${E.signupStep1}' AND ${prop("typed_before_ready")} = 'true'), countIf(event = '${E.signupStep1}' AND ${prop("early_submit")} = 'true'),
    ${joined(prop("reason"), `event = '${E.signupStep1}' AND ${prop("outcome")} = 'error'`)}, countIf(event = '${E.signupStep1}' AND ${prop("outcome")} = 'continue'),
    maxIf(${num("lcp_ms")}, event = '${E.landingTiming}'), maxIf(${num("left_ms")}, event = '${E.landingTiming}' AND ${prop("shown")} = 'false'),
    maxIf(${num("downlink")}, event = '${E.landingTiming}'), maxIf(${num("rtt")}, event = '${E.landingTiming}'),
    maxIf(${num("typed_ms")}, ${ready}), maxIf(${num("submit_ms")}, ${ready}),
    ${joined(`concat(${prop("section")}, ':', ${prop("after")})`, `event = '${E.landingSection}' AND ${prop("section")} != ''`)},
    ${joined(prop("label"), `event = '${E.ctaClick}'`, LIST_SEP)}, ${joined(prop("href"), `event = '${E.ctaClick}'`, LIST_SEP)}, ${joined(prop("spot"), `event = '${E.ctaClick}'`, LIST_SEP)},
    countIf(event = '${E.hvacDemoStep}'), ${joined(prop("step"), `event = '${E.hvacDemoStep}'`)}, countIf(event = '${E.hvacDemoStep}' AND ${prop("how")} = 'tap'),
    countIf(event = '${E.hvacDemoTier}'), ${joined(prop("tier"), `event = '${E.hvacDemoTier}'`)},
    anyIf(${prop("$geoip_country_name")}, ${prop("$geoip_country_name")} != ''), anyIf(${prop("$geoip_subdivision_1_name")}, ${prop("$geoip_subdivision_1_name")} != ''), anyIf(${prop("$geoip_city_name")}, ${prop("$geoip_city_name")} != '')
    FROM events
    WHERE timestamp > now() - INTERVAL ${d} DAY AND ${sinceSql(false)} AND timestamp <= now() AND event IN (${events})
      AND ${prop("$session_id")} != '' AND ${path} != '/admin' AND NOT startsWith(${path}, '/admin/')
      AND ${visitorRuleSql({ host: HOST_SQL, ua: UA_SQL, browserType: BROWSER_TYPE_SQL, event: "event" }, "production")}
    GROUP BY sid ORDER BY started DESC LIMIT 6000`;
}

const text = (v: unknown) => (v == null ? "" : String(v));
const count = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const maybe = (v: unknown) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const list = (v: unknown, sep = ",") => text(v).split(sep).map((s) => s.trim()).filter(Boolean);
/** A measured moment in ms: positive, else null (the beacons send -1 for "not known"). */
const ms = (v: unknown) => { const n = maybe(v); return n !== null && n > 0 ? n : null; };
/** Zero is a reading (a round trip Chrome rounds to 0); -1 is not. */
const nonNegative = (v: unknown) => { const n = maybe(v); return n !== null && n >= 0 ? n : null; };
/** "hero:0,compare:12" in the order they were reached. */
const bySeconds = (xs: string[]) => [...xs].sort((a, b) => Number(a.split(":")[1] ?? 0) - Number(b.split(":")[1] ?? 0));

/** The landing's trade from its URL when landing_view did not arrive (beacon fallback). */
function industryOfUrl(url: string): string {
  if (!url.includes("?")) return "";
  try { const q = new URL(url, "https://www.jobflex.app").searchParams; return resolveLandingVariant(q.get("industry") ?? q.get("trade")) ?? ""; } catch { return ""; }
}

export function analystSessionFromRow(row: unknown[]): LandingSession | null {
  if (!Array.isArray(row) || row.length < 33) return null;
  const id = text(row[0]);
  if (!id) return null;
  const industry = text(row[4]) || industryOfUrl(text(row[5])) || (count(row[16]) > 0 ? "default" : "");
  return {
    id, person: text(row[1]), startedAt: count(row[2]), endedAt: count(row[3]), industry,
    utmSource: text(row[6]), utmMedium: text(row[7]), utmCampaign: text(row[8]), utmContent: text(row[9]), referrer: text(row[10]), fbclid: count(row[11]) > 0,
    device: text(row[12]), browser: text(row[13]), os: text(row[14]), inApp: count(row[15]) > 0,
    views: count(row[16]), landingViews: count(row[17]), dwell: maybe(row[18]), scroll: maybe(row[19]),
    sections: list(row[20]), cta: count(row[21]), placements: list(row[22]),
    registerViews: count(row[23]), step: count(row[24]), flow: text(row[25]),
    attempts: count(row[26]), cardless: count(row[27]), opened: count(row[28]), errors: list(row[29]),
    completed: count(row[30]) > 0, outcome: text(row[31]), plan: text(row[32]),
    heroMs: ms(row[33]), paintMs: ms(row[34]), readyMs: ms(row[35]), trackedMs: ms(row[36]), kb: ms(row[37]), connection: text(row[38]), leftUnshown: count(row[39]),
    formReadyMs: ms(row[40]), typedEarly: count(row[41]), submittedEarly: count(row[42]), step1Errors: list(row[43]), step1Passed: count(row[44]),
    lcpMs: ms(row[45]), leftMs: ms(row[46]), downlink: ms(row[47]), rttMs: nonNegative(row[48]), typedMs: ms(row[49]), submitMs: ms(row[50]),
    sectionAfter: bySeconds(list(row[51])), ctaLabels: list(row[52], LIST_SEP), ctaHrefs: list(row[53], LIST_SEP), ctaSpots: list(row[54], LIST_SEP),
    hvacSteps: count(row[55]), hvacStepKeys: list(row[56]), hvacTaps: count(row[57]), hvacTierPicks: count(row[58]), hvacTiers: list(row[59]),
    country: text(row[60]), region: text(row[61]), city: text(row[62]),
  };
}

// ── The reading of one session ─────────────────────────────────────────────

interface Read extends LandingSession {
  landed: boolean; fromAd: boolean; platform: string; platformName: string; adKey: string;
  bounced: boolean; fast: boolean; engaged: boolean; pressed: boolean; form: boolean;
  s1: boolean; s2: boolean; s3: boolean; attempted: boolean; done: boolean; hour: number;
}

function hourIn(ms: number, timezone: string): number {
  try { return Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(new Date(ms))) % 24; } catch { return new Date(ms).getUTCHours(); }
}

function read(s: LandingSession, timezone: string): Read {
  const src = classifySource(s.utmSource, s.utmMedium, s.referrer, "www.jobflex.app", s.fbclid ? "fbclid" : "");
  const landed = s.landingViews > 0 || s.industry !== "";
  const pressed = s.cta > 0;
  const form = s.registerViews > 0 || s.step >= 1;
  const bounced = landed && s.views <= 1 && !pressed && !form;
  return {
    ...s, landed, fromAd: src.fromAd, platform: src.platform, platformName: src.label, adKey: s.utmContent || s.utmCampaign,
    bounced, fast: bounced && s.dwell !== null && s.dwell < 5 && (s.scroll === null || s.scroll < 0.1),
    engaged: landed && ((s.dwell ?? 0) >= 30 || (s.scroll ?? 0) >= 0.5 || s.sections.length >= 3),
    pressed, form, s1: s.step >= 1, s2: s.step >= 2, s3: s.step >= 3, attempted: s.attempts > 0 || s.opened > 0, done: s.completed,
    hour: hourIn(s.startedAt, timezone),
  };
}

// ── Arithmetic in plain words ──────────────────────────────────────────────

const share = (xs: readonly Read[], pick: (r: Read) => boolean): number | null => (xs.length ? xs.filter(pick).length / xs.length : null);
const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const pct = (x: number | null, digits = 0): string => (x === null ? "—" : `${(x * 100).toFixed(digits)}%`);
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const conf = (n: number): AnalystFinding["confidence"] => (n >= 100 ? "high" : n >= 40 ? "medium" : "low");
const secs = (x: number | null) => (x === null ? "—" : x < 60 ? `${Math.round(x)} s` : `${Math.round(x / 60)} min`);
/** Milliseconds as the eye reads them: "7.6 s", "0.9 s". */
const secsMs = (x: number | null) => (x === null ? "—" : `${(x / 1000).toFixed(1)} s`);
const quantile = (xs: number[], q: number): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const size = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`);
const nums = (xs: readonly Read[], pick: (r: Read) => number | null) => xs.map(pick).filter((x): x is number => x !== null);
const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

function segment(key: string, name: string, xs: Read[], platform?: string): AnalystSegment {
  return { key, name, n: xs.length, bounce: share(xs, (r) => r.bounced), cta: share(xs, (r) => r.pressed), form: share(xs, (r) => r.form), completed: xs.filter((r) => r.done).length, platform };
}
function groupBy(xs: Read[], by: (r: Read) => string): Map<string, Read[]> {
  const m = new Map<string, Read[]>();
  for (const r of xs) { const k = by(r); if (!k) continue; const g = m.get(k); if (g) g.push(r); else m.set(k, [r]); }
  return m;
}

/** An ad's name: the owner's name for the ad (utm_content) or the campaign, else the id as Meta sent it. */
export function adNameOf(s: { utmCampaign: string; utmContent: string }, adNames: Record<string, string>): string {
  if (s.utmContent && adNames[s.utmContent]) return adNames[s.utmContent];
  // Only the campaign is named: the ad is told apart by its id, under that name.
  if (s.utmCampaign && adNames[s.utmCampaign]) return s.utmContent ? `${adNames[s.utmCampaign]} · ad ${s.utmContent}` : adNames[s.utmCampaign];
  if (s.utmContent) return `ad ${s.utmContent}`;
  if (s.utmCampaign) return `campaign ${s.utmCampaign}`;
  return "untagged";
}

const STEP_NAMES: Record<number, string> = { 1: "step 1 (account)", 2: "step 2 (company)", 3: "step 3 (plan)" };
const TRADE_NAME = (key: string) => (key === "default" ? "the general landing" : `the ${key === "hvac" ? "HVAC" : key.replace(/-/g, " ")} landing`);

// ── The analysis ───────────────────────────────────────────────────────────

export function analyse(sessions: LandingSession[], opts: { now?: number; timezone?: string; adNames?: Record<string, string>; days?: number; windowFrom?: number } = {}): AnalystReport {
  const now = opts.now ?? Date.now();
  const timezone = opts.timezone || "America/Los_Angeles";
  const adNames = opts.adNames ?? {};
  const days = opts.days ?? ANALYST_DAYS;
  // The window as it was read: never before the ad launch (the query's own rule).
  const windowFrom = opts.windowFrom ?? analystWindowFrom(now, days);
  const period = periodWords(windowFrom, now, days, timezone);
  const all = sessions.map((s) => read(s, timezone));
  const landed = all.filter((r) => r.landed);
  const fromAds = landed.filter((r) => r.fromAd);
  const enough = fromAds.length >= ANALYST_MIN_AD_VISITS;
  // The basis: visits from ads once there are enough of them (that is what the
  // owner pays for), else every landing visit.
  const basis: "ads" | "all" = enough ? "ads" : "all";
  const base = enough ? fromAds : landed;
  const last24h = landed.filter((r) => r.startedAt >= now - 86_400_000).length;
  // The visits that reported a section. A landing laid out in an order of
  // its own (lib/landing-sections) is read apart, in that order: mixed into
  // the usual one, a roofing visit that went hero → demo would read as a
  // visit that never reached "the section after the hero". A visit from
  // before that landing took its order saw the usual one, and is read there.
  const measuredAll = base.filter((r) => r.sections.length > 0);
  const ownOrder = (r: Read) => hasOwnSectionOrder(r.industry, r.startedAt);
  const measured = measuredAll.filter((r) => !ownOrder(r));

  // The funnel in people, over the basis.
  const n = base.length;
  const pressed = base.filter((r) => r.pressed), form = base.filter((r) => r.form), s1 = base.filter((r) => r.s1), s2 = base.filter((r) => r.s2), s3 = base.filter((r) => r.s3), attempted = base.filter((r) => r.attempted), done = base.filter((r) => r.done);
  const funnel = [
    { key: "landed", label: basis === "ads" ? "Landed from an ad" : "Landed", n, pct: n ? 1 : null },
    { key: "pressed", label: "Pressed a button", n: pressed.length, pct: n ? pressed.length / n : null },
    { key: "form", label: "Opened the form", n: form.length, pct: n ? form.length / n : null },
    { key: "s2", label: "Step 2 · company", n: s2.length, pct: n ? s2.length / n : null },
    { key: "s3", label: "Step 3 · plan", n: s3.length, pct: n ? s3.length / n : null },
    { key: "attempted", label: "Started a trial / checkout", n: attempted.length, pct: n ? attempted.length / n : null },
    { key: "done", label: "Signed up", n: done.length, pct: n ? done.length / n : null },
  ];
  const stats = {
    bounce: share(base, (r) => r.bounced),
    fast: share(base, (r) => r.fast),
    dwellMedian: median(base.map((r) => r.dwell).filter((x): x is number => x !== null)),
    scrollMedian: median(base.map((r) => r.scroll).filter((x): x is number => x !== null)),
    inApp: share(base, (r) => r.inApp),
    heroMedianPhone: median(nums(base.filter((r) => !/desktop/i.test(r.device)), (r) => r.heroMs)),
    formReadyMedian: median(nums(all.filter((r) => !/desktop/i.test(r.device)), (r) => r.formReadyMs)),
  };
  // Sections: of the visits that reported any section, how many reached each —
  // in the usual order, and per landing with an order of its own.
  const reachOf = (xs: Read[], list: readonly LandingSection[]): AnalystSectionReach[] => list.map((sec) => ({ key: sec.key, label: sec.label, shown: sec.shown, reach: xs.length ? xs.filter((r) => r.sections.includes(sec.key)).length / xs.length : null }));
  const sections = reachOf(measured, LANDING_SECTIONS);
  const landings = OWN_ORDER_LANDINGS.map((key) => { const xs = measuredAll.filter((r) => r.industry === key && ownOrder(r)); return { key, name: TRADE_NAME(key), measured: xs.length, sections: reachOf(xs, landingSectionsFor(key)) }; }).filter((l) => l.measured > 0);
  const placementCounts = new Map<string, number>();
  for (const r of base) for (const p of r.placements) placementCounts.set(p, (placementCounts.get(p) ?? 0) + 1);
  const placements = [...placementCounts].map(([placement, c]) => ({ placement, n: c })).sort((a, b) => b.n - a.n);
  const ads = [...groupBy(fromAds, (r) => r.adKey)].map(([key, xs]) => segment(key, adNameOf(xs[0], adNames), xs, xs[0].platformName)).sort((a, b) => b.n - a.n);
  const trades = [...groupBy(landed, (r) => r.industry)].map(([key, xs]) => segment(key, TRADE_NAME(key), xs)).sort((a, b) => b.n - a.n);

  const findings: AnalystFinding[] = [];
  const add = (f: Omit<AnalystFinding, "confidence">) => findings.push({ ...f, confidence: conf(f.n) });

  if (!enough) {
    add({ id: "sample", tone: "info", title: `Not enough yet — ${fromAds.length} of the ${ANALYST_MIN_AD_VISITS} ad visits the analyst waits for`,
      evidence: `${landed.length} landing ${landed.length === 1 ? "visit" : "visits"} ${period.inWords}, ${fromAds.length} from ads, ${last24h} in the last 24 h.`,
      action: "Let the ads run; the reading starts on its own once there is something to read.", n: fromAds.length });
  }

  // The leak: the transition that loses the most of what reaches it.
  const steps: Array<{ from: string; to: string; a: number; b: number; key: string }> = [
    { key: "pressed", from: "landed", to: "pressed a button", a: n, b: pressed.length },
    { key: "form", from: "pressed a button", to: "opened the form", a: pressed.length, b: form.length },
    { key: "s2", from: "opened the form", to: "finished step 1 (account)", a: form.length, b: s2.length },
    { key: "s3", from: "step 2 (company)", to: "step 3 (plan)", a: s2.length, b: s3.length },
    { key: "attempted", from: "step 3 (plan)", to: "started a trial", a: s3.length, b: attempted.length },
    { key: "done", from: "started a trial", to: "signed up", a: attempted.length, b: done.length },
  ];
  const leak = steps.filter((t) => t.a >= 5).sort((x, y) => (x.b / x.a) - (y.b / y.a))[0] ?? null;

  if (enough) {
    add({ id: "funnel", tone: "info", title: `The funnel, ${period.label}`,
      evidence: `${n} landed from ads → ${pct(funnel[1].pct)} pressed a button → ${pct(funnel[2].pct)} opened the form → ${s2.length} reached the company step → ${s3.length} the plan → ${attempted.length} started → ${done.length} signed up.`,
      action: leak ? `The biggest leak is ${leak.from} → ${leak.to}: ${leak.a} reached it, ${leak.b} went on (${pct(leak.b / leak.a)}).` : "Too few reach the form to say where the sign-up leaks.", n });
  }

  // No signups at all.
  if (enough && n >= 30 && done.length === 0) {
    add({ id: "no-signups", tone: "bad", title: `No signups from ${n} ad visits`,
      evidence: `${pct(stats.bounce)} left the landing without a second page, ${pressed.length} pressed a button, ${form.length} opened the form, ${attempted.length} started a trial.`,
      action: leak ? `Fix the biggest leak first — ${leak.from} → ${leak.to} loses ${pct(1 - leak.b / leak.a)}.` : "Get people to the form first: a clear price and a button showing the exact free-trial duration in the first screen.", n });
  }

  // The phones that reported their first screen (landing_timing): the hero's
  // moment on each, for the bounce rule and the first-screen finding below.
  const phonesTimed = base.filter((r) => !/desktop/i.test(r.device) && (r.heroMs !== null || r.leftUnshown > 0 || r.readyMs !== null));
  const heroPhones = nums(phonesTimed, (r) => r.heroMs);
  const heroMedian = median(heroPhones);

  // Bouncing.
  const bounce = stats.bounce ?? 0;
  if (enough && n >= 20 && bounce >= 0.45) {
    const fastShare = stats.fast ?? 0;
    const inAppBounce = share(base.filter((r) => r.inApp), (r) => r.bounced), browserBounce = share(base.filter((r) => !r.inApp), (r) => r.bounced);
    const quick = bounce > 0 && fastShare / bounce >= 0.5;
    // A measured slow first screen (below) explains the leaving before the words do.
    const slowScreen = heroPhones.length >= 12 && heroMedian !== null && heroMedian >= 2500;
    add({ id: "bounce", tone: bounce >= 0.6 ? "bad" : "warn", title: `${pct(bounce)} of ad clicks leave the landing without a second page`,
      evidence: `${Math.round(bounce * n)} of ${n}; ${pct(fastShare)} of all visits were gone inside 5 seconds without scrolling${inAppBounce !== null && browserBounce !== null ? `; Facebook's in-app browser bounces ${pct(inAppBounce)} vs ${pct(browserBounce)} in a real browser` : ""}. Median time on the landing ${secs(stats.dwellMedian)}.`,
      action: slowScreen ? `The first screen is slow before it is anything else: on phones the headline shows ${secsMs(heroMedian)} after the tap (the first-screen finding). Fix that first, then judge the words.`
        : quick ? "Most of these never looked: accidental taps or a slow first screen in the in-app browser. Optimise the ad set for landing-page views (not link clicks), keep the first screen light, and check the hero loads under 2 s on 4G."
        : "They looked and left: the ad's promise is not in the first screen. Put the ad's exact claim, the trade, the price and the exact free-trial duration in the hero, above the fold.", n });
  }

  // THE FIRST SCREEN AS THE PHONES DREW IT (landing_timing, 2026-10-04). The
  // lab found the headline arriving 7–8 s after the tap on Google's mobile
  // profile — the hero's copy is kept invisible until the JavaScript is in —
  // and this is the same moment measured on real visits, phones only (a desk
  // draws it in under a second).
  if (heroPhones.length >= 12 && heroMedian !== null && heroMedian >= 2500) {
    const p75 = quantile(heroPhones, 0.75);
    const slow = heroPhones.filter((x) => x >= 4000).length / heroPhones.length;
    const inA = median(nums(phonesTimed.filter((r) => r.inApp), (r) => r.heroMs)), brw = median(nums(phonesTimed.filter((r) => !r.inApp), (r) => r.heroMs));
    const unshown = phonesTimed.filter((r) => r.leftUnshown > 0).length;
    const kbMed = median(nums(phonesTimed, (r) => r.kb)), readyMed = median(nums(phonesTimed, (r) => r.readyMs)), paintMed = median(nums(phonesTimed, (r) => r.paintMs));
    const byConn = [...groupBy(phonesTimed.filter((r) => r.connection), (r) => r.connection)].map(([c, xs]) => ({ c, n: xs.length, med: median(nums(xs, (r) => r.heroMs)) })).filter((x) => x.n >= 5 && x.med !== null).sort((a, b) => (b.med ?? 0) - (a.med ?? 0));
    // Is the headline held back AFTER the first paint (the entrance waiting
    // for the JavaScript — fixed for phones on 2026-10-04), or does it come
    // with a first paint that is itself late (the page's weight)? The advice
    // follows whichever the visits show.
    const lag = median(phonesTimed.filter((r) => r.heroMs !== null && r.paintMs !== null).map((r) => (r.heroMs as number) - (r.paintMs as number)));
    const heldBack = lag !== null && lag >= 1000;
    add({ id: "first-screen", tone: heroMedian >= 4000 ? "bad" : "warn",
      title: `On phones the headline shows ${secsMs(heroMedian)} after the tap`,
      evidence: `Median ${secsMs(heroMedian)} over ${heroPhones.length} phone visits; a quarter wait ${secsMs(p75)} or more, ${pct(slow)} wait over 4 s${inA !== null && brw !== null ? `; ${secsMs(inA)} in Facebook's browser vs ${secsMs(brw)} in a real one` : ""}${byConn.length ? `; by connection ${byConn.map((x) => `${x.c} ${secsMs(x.med)}`).join(", ")}` : ""}${unshown ? `; ${unshown} left before the headline ever appeared` : ""}. The first paint comes at ${secsMs(paintMed)}${heldBack ? ` and the headline ${secsMs(lag)} after it` : ""}, the page's JavaScript takes over at ${secsMs(readyMed)}${kbMed !== null ? ` after ${size(kbMed)} downloaded` : ""}.`,
      action: heldBack ? "The headline is held back after the first paint: the hero's copy is kept invisible until the JavaScript is in, for an entrance animation — that is most of the wait. Show it from the first paint, then make the page lighter."
        : "The headline now comes with the first paint — it is the first paint that is late. The page is heavy for a phone: make what the first screen needs small, and everything else wait.",
      steps: [
        ...(heldBack ? ["Show the hero copy from the first paint: hold `.lp-enter` back only where an entrance is about to play (landing-e.css, hero-entrance.tsx), and render the product shot visible from the server (reveal.tsx `shown`). Never animate it in on phones."] : []),
        "Serve the fonts as subset WOFF2 files instead of the full variable TTFs (a fraction of the size); the mono font is for a few small labels and can go.",
        "Merge the stylesheets into one or two and inline the hero's own CSS in the HTML, so the first paint waits for nothing.",
        "Fetch the sections under the fold on scroll, not at start — today every section's JavaScript arrives before the page can respond.",
        "Defer Meta's pixel script until after the first paint; PageView still goes out.",
        "Aim for the headline under 1.5 s on Google's mobile profile (pagespeed.web.dev). This finding stops on its own once the median drops under 2.5 s.",
      ], n: heroPhones.length });
  }

  // THE SIGN-UP FORM BEFORE IT IS USABLE (signup_step1 "ready", 2026-10-04).
  // The page's prelude now keeps what was typed early and holds an early
  // Continue, so nothing is lost any more — but a form that is usable only
  // seconds after it is drawn is still a form that loses people.
  const forms = all.filter((r) => r.formReadyMs !== null && !/desktop/i.test(r.device));
  const formMedian = median(nums(forms, (r) => r.formReadyMs));
  const early = forms.filter((r) => r.typedEarly > 0 || r.submittedEarly > 0).length;
  if (forms.length >= 10 && formMedian !== null && (formMedian >= 2500 || early / forms.length >= 0.1)) {
    const typed = forms.filter((r) => r.typedEarly > 0).length, pressed1 = forms.filter((r) => r.submittedEarly > 0).length;
    add({ id: "form-ready", tone: formMedian >= 4000 || early / forms.length >= 0.25 ? "bad" : "warn",
      title: early / forms.length >= 0.1 ? `${pct(early / forms.length)} start filling the sign-up form before it is ready` : `The sign-up form is usable only ${secsMs(formMedian)} after it appears on phones`,
      evidence: `${forms.length} form loads on phones: the form's JavaScript takes over ${secsMs(formMedian)} after the tap (a quarter wait ${secsMs(quantile(nums(forms, (r) => r.formReadyMs), 0.75))} or more); ${typed} had already typed and ${pressed1} had already pressed Continue by then — kept and restored now, each one a reload with empty fields before 2026-10-04.`,
      action: "A four-field form should be usable in a second. Make the sign-up page light, and ask for less on step 1.",
      steps: [
        "Send phones no decorative picture: the sign-up page's side image is over a megabyte and hidden on a phone, yet downloaded before the form's own code.",
        "Trim the sign-up page's JavaScript to the form itself.",
        "Ask for the email alone on step 1 — the name on the company step, the password after the trial starts (and one field with 'show', not a confirmation).",
        "Carry the ad's promise onto the form: 'Your first roof report is two steps away' instead of 'Register.'",
      ], n: forms.length });
  }

  // Step 1's refusals, by reason (signup_step1 "error").
  const s1err = new Map<string, number>();
  for (const r of all) for (const e of r.step1Errors) s1err.set(e, (s1err.get(e) ?? 0) + 1);
  const s1total = [...s1err.values()].reduce((a, c) => a + c, 0);
  if (s1total >= 3) {
    const STEP1_ADVICE: Record<string, string> = {
      email_taken: "'Already registered': put a one-tap 'Sign in instead' right there, with a reset link — these are customers coming back through an ad.",
      email_google: "'Signs in with Google' inside a webview, where Google is not offered: send a code by email instead.",
      password_short: "Password rules at step 1 cost sign-ups: one field with 'show', or no password until the trial has started.",
      password_mismatch: "The confirmation field is the only reason this error exists: drop it and keep 'show password'.",
      email_disposable: "Throwaway mailboxes refused — fine; say why in one line and offer the Google route in a real browser.",
      rate_limited: "The email check's rate limit hit: 30 a minute per address is too tight for a shared office IP — raise it.",
      check_failed: "The server check failed: read the server log for checkEmailAvailable.",
      email_invalid: "A bad address reached Continue: validate the field as it is left, not on submit.",
      missing: "Empty fields reached Continue: mark required fields as they are left, and keep the button off until they are filled.",
    };
    const rows = [...s1err].sort((a, b) => b[1] - a[1]);
    add({ id: "step1-errors", tone: "warn", title: `Step 1 refused ${s1total} ${s1total === 1 ? "time" : "times"}`,
      evidence: rows.map(([k, c]) => `${k.replace(/_/g, " ")} × ${c}`).join(", ") + ".",
      action: `The first reason is ${rows[0][0].replace(/_/g, " ")}: ${STEP1_ADVICE[rows[0][0]] ?? "look at the form's own message for it."}`,
      steps: rows.slice(1).map(([k]) => STEP1_ADVICE[k]).filter((x): x is string => !!x), n: s1total });
  }

  // Scrolling but not far.
  const scrolls = base.filter((r) => r.scroll !== null);
  if (enough && scrolls.length >= 20 && (stats.scrollMedian ?? 1) < 0.35 && bounce < 0.6) {
    const pricing = sections.find((s) => s.key === "pricing");
    add({ id: "scroll", tone: "warn", title: `Half of them stop before ${pct(stats.scrollMedian)} of the page`,
      evidence: `Median deepest scroll ${pct(stats.scrollMedian)} over ${scrolls.length} visits${pricing?.reach !== null && pricing?.reach !== undefined ? `; only ${pct(pricing.reach)} reach the pricing` : ""}.`,
      action: "Bring the price and a sign-up button into the first two screens; the pricing section is too far down to be seen.", n: scrolls.length });
  }

  // The section where they leave, and the demo that is not the second screen
  // (2026-10-04: the ad showed the estimator, the page shows something else
  // first) — each read in the order the sections are laid out in: the usual
  // one, then every landing with an order of its own, named.
  const layouts: Array<{ id: string; on: string; of: string; about?: string; n: number; secs: AnalystSectionReach[] }> = [
    { id: "", on: "", of: "", n: measured.length, secs: sections },
    ...landings.map((l) => ({ id: `-${l.key}`, on: `On ${l.name} `, of: ` to ${l.name}`, about: l.name, n: l.measured, secs: l.sections })),
  ];
  for (const lay of layouts) {
    if (lay.n < 20) continue;
    const shown = lay.secs.filter((s) => s.reach !== null && s.reach > 0);
    let cliff: { at: typeof shown[0]; next: typeof shown[0]; drop: number } | null = null;
    for (let i = 0; i + 1 < shown.length; i++) {
      const a = shown[i], b = shown[i + 1];
      if ((a.reach ?? 0) < 0.3) continue;
      const drop = (a.reach ?? 0) - (b.reach ?? 0);
      if (drop >= 0.25 && (!cliff || drop > cliff.drop)) cliff = { at: a, next: b, drop };
    }
    if (cliff) add({ id: `cliff${lay.id}`, tone: "warn", title: lay.on ? `${lay.on}they leave at «${cliff.at.label}»` : `They leave at «${cliff.at.label}»`,
      evidence: `${pct(cliff.at.reach)} of ${lay.n} measured visits${lay.of} reach «${cliff.at.label}», ${pct(cliff.next.reach)} reach the next section («${cliff.next.label}»).`,
      action: `Shorten «${cliff.at.label}» or move what matters below it («${cliff.next.label}») above it — and put a sign-up button right there, at the point where they stop.`, ...(lay.about ? { about: lay.about } : {}), n: lay.n });

    const second = lay.secs[1];
    const demoIndex = lay.secs.findIndex((x) => x.key === "showcase");
    const secondReach = second?.reach ?? null;
    const demoReach = lay.secs[demoIndex]?.reach ?? null;
    if (second && second.key !== "showcase" && demoIndex > 1 && secondReach !== null && demoReach !== null && secondReach >= 0.25 && demoReach < secondReach) {
      add({ id: `order${lay.id}`, tone: "warn", title: `${lay.on}${lay.on ? "the" : "The"} demo is the ${ordinal(demoIndex + 1)} screen; «${second.label}» comes before it`,
        evidence: `${pct(secondReach)} of ${lay.n} measured visits${lay.of} reach «${second.label}», ${pct(demoReach)} reach the demo («${lay.secs[demoIndex].label}») after it.`,
        action: "Put the estimator demo directly under the hero — it is what the ad showed — and move the rest down.",
        steps: [`Reorder landing-e-page.tsx: hero → the estimators showcase → …; «${second.label}» after the proof, near the pricing.`, "Let the hero's product shot play its sequence on phones too (it opens as a still today), with the sign-up button under it."], ...(lay.about ? { about: lay.about } : {}), n: lay.n });
    }
  }

  // When the counting starts (landing_timing tracked_ms): the tracking
  // library loads after the page, so whoever leaves before it is in no
  // number here.
  const tracked = nums(phonesTimed, (r) => r.trackedMs);
  const trackedMed = median(tracked);
  if (enough && tracked.length >= 12 && trackedMed !== null && trackedMed >= 1500) {
    add({ id: "undercount", tone: "info", title: `Counting starts ${secsMs(trackedMed)} into a phone visit`,
      evidence: `The tracking loads ${secsMs(trackedMed)} after the tap (median of ${tracked.length} phone visits); anyone gone before that is in no number here — which is why "gone inside 5 s" reads only ${pct(stats.fast)}.`,
      action: "Compare the week's link clicks in Ads Manager with the landed count here: the gap is the people who left before the counter started. For a true picture, run the tracking from the first paint for a week.", n: tracked.length });
  }

  // Reading, not pressing.
  const engaged = share(base, (r) => r.engaged) ?? 0, ctaRate = funnel[1].pct ?? 0;
  if (enough && n >= 30 && engaged >= 0.4 && ctaRate <= 0.08) {
    const top = placements.slice(0, 2).map((p) => `${p.placement} (${p.n})`).join(", ");
    add({ id: "reading", tone: "warn", title: "They read, but they don't press",
      evidence: `${pct(engaged)} stay 30 s or scroll past half the page; only ${pct(ctaRate)} press any button${top ? ` — the presses: ${top}` : ""}.`,
      action: "The offer is not clear enough to act on: say the price and the exact free-trial duration on the hero button itself, and repeat that button after the estimator section.", n });
  }

  // Pressed, never saw the form.
  if (pressed.length >= 10) {
    const lost = pressed.filter((r) => !r.form).length, lostShare = lost / pressed.length;
    if (lostShare >= 0.25) add({ id: "leak", tone: "warn", title: `${pct(lostShare)} press a button but never see the form`,
      evidence: `${lost} of ${pressed.length} who pressed a sign-up button have no form view${share(pressed.filter((r) => !r.form), (r) => r.inApp) !== null ? ` — ${pct(share(pressed.filter((r) => !r.form), (r) => r.inApp))} of them in the in-app browser` : ""}.`,
      action: "The form page loads too slowly after the tap (worst in Facebook's browser). Preload /auth/register from the landing, or open the first step in a sheet on the landing itself.", n: pressed.length });
  }

  // Where the sign-up leaks.
  if (s1.length >= 10) {
    const trans = [
      { from: 1, to: 2, a: s1.length, b: s2.length, action: "Step 1 asks for name, email and two passwords, and the Google button is hidden inside Facebook's browser. Ask for the email alone first; set the password after the trial starts. (Step-1 errors — 'email already registered' — are not tracked yet.)" },
      { from: 2, to: 3, a: s2.length, b: s3.length, action: "Step 2 wants the business name, the address and the trades, all required. Make the company step optional — ask inside the app on the first proposal — or keep only the business name." },
      { from: 3, to: 4, a: s3.length, b: attempted.length, action: "The plan sheet stops them. Pre-select the plan the ad promised, and say 'Start free trial' on the button; show the price per month next to it." },
    ].filter((t) => t.a >= 8).map((t) => ({ ...t, loss: 1 - t.b / t.a })).sort((x, y) => y.loss - x.loss);
    const worst = trans[0];
    if (worst && worst.loss >= 0.4) add({ id: "step", tone: worst.loss >= 0.6 ? "bad" : "warn",
      title: `${STEP_NAMES[worst.from]} loses ${pct(worst.loss)} of the people who reach it`,
      evidence: `${worst.a} reached ${STEP_NAMES[worst.from]}, ${worst.b} went on to ${worst.to === 4 ? "a trial or checkout" : STEP_NAMES[worst.to]}.`, action: worst.action, n: worst.a });
    const errs = new Map<string, number>();
    for (const r of base) for (const e of r.errors) errs.set(e, (errs.get(e) ?? 0) + 1);
    const errList = [...errs].sort((a, b) => b[1] - a[1]);
    if (errList.length && errList[0][1] >= 3) add({ id: "errors", tone: "warn", title: `The plan step failed ${errList.reduce((a, [, c]) => a + c, 0)} times`,
      evidence: errList.map(([k, c]) => `${k.replace(/_/g, " ")} × ${c}`).join(", ") + ".", action: "Checkout or trial requests were refused: check the Stripe keys and the rate limit on /api/checkout/signup, and show the reason on the page instead of a generic error.", n: s3.length });
  }
  // Started, never finished (the e-mail confirmation).
  if (attempted.length >= 8 && done.length / attempted.length <= 0.5) {
    const cardless = attempted.filter((r) => r.cardless > 0).length;
    add({ id: "confirm", tone: "warn", title: `${attempted.length - done.length} of ${attempted.length} who started a trial never finished`,
      evidence: cardless >= attempted.length / 2 ? `${cardless} started a card-less trial, which needs the confirmation e-mail to be opened; ${done.length} did.` : `${done.length} of ${attempted.length} checkouts completed.`,
      action: cardless >= attempted.length / 2 ? "The confirmation e-mail is the leak: confirm on the page (a 6-digit code) instead of a link, resend after a minute, and check the e-mail is not landing in spam." : "Stripe's checkout loses them: offer the card-less trial first, card later.", n: attempted.length });
  }

  // Facebook's in-app browser vs a real one.
  const inApp = base.filter((r) => r.inApp), browser = base.filter((r) => !r.inApp);
  if (inApp.length >= 12 && browser.length >= 12) {
    const a = share(inApp, (r) => r.form) ?? 0, b = share(browser, (r) => r.form) ?? 0;
    if (b > 0 && a <= b * 0.5) add({ id: "in-app", tone: "warn", title: "Facebook's in-app browser converts half as well",
      evidence: `${pct(a)} of ${inApp.length} in-app visits open the form vs ${pct(b)} of ${browser.length} in a real browser; ${pct(stats.inApp)} of ad visits arrive in-app.`,
      action: "Keep the landing light for the in-app browser (it is slower and hides Google sign-up): email-first sign-up, no autoplay video in the hero, and the 'Open in browser' hint on the form.", n: inApp.length + browser.length });
  }

  // Ad against ad.
  const ranked = ads.filter((a) => a.n >= SEGMENT_MIN);
  if (ranked.length >= 2) {
    const byForm = [...ranked].sort((x, y) => (y.form ?? 0) - (x.form ?? 0));
    const best = byForm[0], worst = byForm[byForm.length - 1];
    if ((best.form ?? 0) >= 2 * (worst.form ?? 0) && (best.form ?? 0) > 0) add({ id: "ads", tone: "info", title: `«${best.name}» gets people to the form; «${worst.name}» does not`,
      evidence: `${best.name}: ${pct(best.form)} open the form, ${pct(best.bounce)} bounce (${best.n} visits). ${worst.name}: ${pct(worst.form)} and ${pct(worst.bounce)} (${worst.n} visits).`,
      action: `Move budget to «${best.name}». For «${worst.name}», change the audience or the first three seconds of the creative — its clicks are not the people the landing is for.`, about: worst.name, n: best.n + worst.n });
    for (const a of ranked) {
      const xs = fromAds.filter((r) => r.adKey === a.key);
      const eng = share(xs, (r) => r.engaged) ?? 0;
      // Readers (they stay, they scroll, they never open the form) and
      // bouncers (gone without a look) are different ads with different fixes.
      if (xs.length >= 12 && eng >= 0.5 && (a.form ?? 0) <= 0.06) add({ id: `readers-${a.key}`, tone: "warn", title: `«${a.name}» brings readers, not sign-ups`,
        evidence: `${pct(eng)} of its ${xs.length} visits read the page, ${pct(a.form)} open the form.`, action: "The ad's audience is curious, not buying: make the ad's offer the landing's first line, and add the price. If the ad targets homeowners, retarget to contractors.", about: a.name, n: xs.length });
      else if (xs.length >= 12 && eng < 0.5 && (a.bounce ?? 0) >= 0.75) {
        // Where its clicks land: the general hero, or a trade's hero that does not continue the ad's line.
        const onDefault = share(xs, (r) => r.industry === "default") ?? 0;
        const adHero = median(nums(xs.filter((r) => !/desktop/i.test(r.device)), (r) => r.heroMs));
        add({ id: `bounce-${a.key}`, tone: "warn", title: `«${a.name}»: ${pct(a.bounce)} leave without pressing anything`,
          evidence: `${Math.round((a.bounce ?? 0) * xs.length)} of ${xs.length} clicks; ${pct(share(xs, (r) => r.fast))} gone inside 5 s; median ${secs(median(xs.map((r) => r.dwell).filter((x): x is number => x !== null)))} on the page${onDefault >= 0.5 ? `; ${pct(onDefault)} land on the general hero` : ""}${adHero !== null ? `; its phones see the headline after ${secsMs(adHero)}` : ""}.`,
          action: onDefault >= 0.5 ? "Its clicks land on the general hero («Turn your trade into a business»), not on the trade's: put ?industry=<trade> on the ad's URL so the first screen is the trade's own, and a ?hook= (to build: the ad's opening line as the headline) so the page continues the ad's sentence."
            : "The hero does not continue the ad's first line: give the landing a ?hook= parameter (to build) that puts the ad's own opening line in the headline and its second line under it, and send this ad there. Until then, pause it or swap the creative.", about: a.name, n: xs.length });
      }
    }
  }

  // Trade landing against trade landing.
  const tr = trades.filter((t) => t.n >= SEGMENT_MIN);
  if (tr.length >= 2) {
    const byForm = [...tr].sort((x, y) => (y.form ?? 0) - (x.form ?? 0));
    const best = byForm[0], worst = byForm[byForm.length - 1];
    if ((best.form ?? 0) >= 2 * (worst.form ?? 0) && (best.form ?? 0) > 0) add({ id: "trades", tone: "info", title: `${best.name[0].toUpperCase()}${best.name.slice(1)} converts, ${worst.name} does not`,
      evidence: `${best.name}: ${pct(best.form)} open the form (${best.n} visits). ${worst.name}: ${pct(worst.form)} (${worst.n} visits).`,
      action: `Read ${worst.name}'s hero against the ad that sends people there — the words, the picture and the price should match the ad; copy what ${best.name} does.`, about: worst.name, n: best.n + worst.n });
  }

  // Phone against desktop.
  const phone = base.filter((r) => /mobile/i.test(r.device)), desk = base.filter((r) => /desktop/i.test(r.device));
  if (phone.length >= 12 && desk.length >= 12) {
    const a = share(phone, (r) => r.form) ?? 0, b = share(desk, (r) => r.form) ?? 0;
    if (b >= 2 * a && b > 0) add({ id: "device", tone: "info", title: "Desktops sign up, phones don't",
      evidence: `${pct(b)} of ${desk.length} desktop visits open the form vs ${pct(a)} of ${phone.length} on phones — and ${pct(phone.length / n)} of ad visits are phones.`,
      action: "The form is a phone form now: one field per screen, big buttons, the keyboard type right (email, phone). Or run the ads to desktop placements until it is.", n: phone.length + desk.length });
  }

  // The hour of the day.
  if (n >= 60) {
    const buckets = [["night", 0, 6], ["morning", 6, 12], ["afternoon", 12, 18], ["evening", 18, 24]] as const;
    const rows = buckets.map(([name, a, b]) => { const xs = base.filter((r) => r.hour >= a && r.hour < b); return { name, n: xs.length, bounce: share(xs, (r) => r.bounced) ?? 0, form: share(xs, (r) => r.form) ?? 0 }; }).filter((r) => r.n >= 12);
    if (rows.length >= 2) {
      const byBounce = [...rows].sort((x, y) => x.bounce - y.bounce);
      const best = byBounce[0], worst = byBounce[byBounce.length - 1];
      if (worst.bounce >= 1.4 * best.bounce && worst.bounce - best.bounce >= 0.15) add({ id: "hours", tone: "info", title: `${worst.name[0].toUpperCase()}${worst.name.slice(1)} clicks bounce more`,
        evidence: `${pct(worst.bounce)} bounce in the ${worst.name} (${worst.n} visits) vs ${pct(best.bounce)} in the ${best.name} (${best.n}).`,
        action: `Day-part the ad set: cut the ${worst.name} hours, or give them a lighter creative; keep the ${best.name}.`, n: worst.n + best.n });
    }
  }

  // Good news is news too.
  if (enough && done.length >= 3 && done.length / n >= 0.03) {
    const bestAd = ads.filter((a) => a.n >= SEGMENT_MIN).sort((x, y) => y.completed - x.completed)[0];
    add({ id: "good", tone: "good", title: `${done.length} signed up — ${pct(done.length / n, 1)} of ad visits`,
      evidence: `${people(done.length)} completed a verified sign-up ${period.inWords}${bestAd && bestAd.completed > 0 ? `; «${bestAd.name}» brought ${bestAd.completed} of them` : ""}.`,
      action: bestAd && bestAd.completed > 0 ? `Scale «${bestAd.name}» before anything else.` : "Keep the ads running; the landing is converting.", n });
  }

  const order: Record<AnalystFinding["tone"], number> = { bad: 0, warn: 1, good: 2, info: 3 };
  findings.sort((a, b) => order[a.tone] - order[b.tone] || b.n - a.n);

  // One line of what is going on.
  let headline: string;
  const lead = period.inWords[0].toUpperCase() + period.inWords.slice(1);
  if (!landed.length) headline = `Nobody has landed ${period.inWords}.`;
  else if (!enough) headline = `${landed.length} landing ${landed.length === 1 ? "visit" : "visits"} ${period.inWords}, ${fromAds.length} from ads — the analyst starts reading at ${ANALYST_MIN_AD_VISITS} ad visits.`;
  else {
    const top = findings.find((f) => f.tone === "bad" || f.tone === "warn");
    headline = `${lead}, ${n} people landed from ads: ${pct(stats.bounce)} left without pressing anything, ${pct(funnel[1].pct)} pressed a button, ${pct(funnel[2].pct)} opened the form, ${done.length} signed up.${top ? ` The thing to fix: ${top.title.replace(/^./, (c) => c.toLowerCase())}.` : done.length ? " Nothing is broken; scale what works." : ""}`;
  }

  return {
    days, period: period.label, windowFrom,
    // `measured` is every visit with a section reading; the sections table is
    // over the usual order's share of them, each own-order landing has its own.
    sample: { sessions: all.length, landed: landed.length, fromAds: fromAds.length, last24h, measured: measuredAll.length, enough, needed: ANALYST_MIN_AD_VISITS, basis },
    // Every ad, trade and placement (2026-10-04): the panel shows the first
    // dozen ads; the exports carry them all.
    headline, findings, funnel, sections, landings, ads, trades, placements, stats,
  };
}

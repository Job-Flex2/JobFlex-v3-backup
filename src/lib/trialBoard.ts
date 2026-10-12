// THE TRIALS BOARD (owner, 2026-10-12): "move the sign up section to its own page under Traffic — show how many are on
// the trial with a card and without, in order who's going to expire first, who started paying and whether it was with
// the card or with no card, a statistic for the seven days of the trial (if yesterday brought eight trials, when their
// seven days are up show who left and how many pay) — super smart, very easy to understand — and on each trial what
// they did".
//
// Pure: one pass over the accounts lib/trialBoardRead reads, into what /admin/traffic/signups shows — the trials in the
// order they end, the calendar of signup days and what became of each day's trials, who started paying and how, who
// left. Every day is the traffic page's day (TRAFFIC_TZ), so "today" here is the map's today.
import { TRAFFIC_TZ, trafficDayStartMs } from "@/lib/traffic-visitor";

export const DAY_MS = 86_400_000;
/** The calendar's reach: the seven days still on trial and the seven before them, whose trials have just been decided. */
export const CALENDAR_DAYS = 14;
/** The statistic's window — a trial is seven days. */
export const RECENT_DAYS = 7;

/** How the trial began: a card taken at signup, no card (the card-less signup), a comp, or no trial at all. */
export type TrialKind = "card" | "nocard" | "comp" | "none";
export type TrialPhase = "trial" | "paying" | "failed" | "left" | "free" | "unknown";
/** How a paying account came to pay. */
export type PaidHow = "card-at-signup" | "card-added" | "card-after-end" | "paid-at-signup" | "paid-early";

export interface TrialWork {
  proposals: number;
  sent: number;
  /** Roofs measured and HVAC systems sized. */
  estimates: number;
  /** Briefs given to Smart Proposal. */
  aiAsks: number;
  clients: number;
  leads: number;
  jobs: number;
  activeDays: number;
  views: number;
  lastSeen: number | null;
}

/** One account as read — times in epoch ms. */
export interface BoardAccount {
  orgId: string;
  orgName: string;
  ownerName: string;
  ownerEmail: string;
  createdAt: number;
  source: string;
  fromAd: boolean;
  campaign: string;
  /** Subscription.status, as stored. */
  status: string;
  /** The plan's name in words ("Professional"), "" when none. */
  plan: string;
  provider: string;
  hasStripeSub: boolean;
  trialEndsAt: number | null;
  canceledAt: number | null;
  /** The subscription row's last change — when a plan paid before its trial was up, the nearest record of when. */
  subUpdatedAt: number | null;
  /** The card-less trial's record (lib/trialState), when the account started one. */
  cardless: { startedAt: number | null; endsAt: number | null; cardAt: number | null; endedAt: number | null; restartedAt: number | null; test: boolean } | null;
  monthlyCents: number | null;
  chance: number | null;
  tierLabel: string | null;
  work: TrialWork;
}

export interface BoardRow extends BoardAccount {
  kind: TrialKind;
  phase: TrialPhase;
  /** A test-mode trial: listed, counted nowhere. */
  test: boolean;
  trialStart: number | null;
  trialEnd: number | null;
  trialDays: number | null;
  /** Day N of the trial while it runs. */
  dayOfTrial: number | null;
  /** A card is on file now — taken at signup, or added since. */
  cardNow: boolean;
  /** When a card-less trial added one. */
  cardAddedAt: number | null;
  paidFrom: number | null;
  paidHow: PaidHow | null;
  /** When the trial was decided — paid, left or failed; null while it runs, and for an account that never had one. */
  decidedAt: number | null;
}

const phaseOf = (status: string): TrialPhase => {
  switch (status) {
    case "TRIALING":
      return "trial";
    case "ACTIVE":
      return "paying";
    case "PAST_DUE":
    case "UNPAID":
      return "failed";
    case "CANCELED":
    case "TRIAL_ENDED":
    case "EXPIRED":
    case "INCOMPLETE_EXPIRED":
    case "INCOMPLETE":
      return "left";
    case "FREE":
      return "free";
    default:
      return "unknown";
  }
};

export function classify(a: BoardAccount, now: number): BoardRow {
  const status = (a.status || "").trim().toUpperCase();
  const c = a.cardless;
  const kind: TrialKind =
    a.provider.toUpperCase() === "MANUAL" ? "comp" : c ? "nocard" : a.hasStripeSub && (a.trialEndsAt !== null || status === "TRIALING") ? "card" : "none";
  let phase = phaseOf(status);
  // The daily sweep ended a card-less trial before the subscription row caught up.
  if (kind === "nocard" && c?.endedAt && !c.restartedAt && phase === "trial") phase = "left";
  const isTrial = kind === "card" || kind === "nocard";
  const trialEnd = isTrial ? a.trialEndsAt ?? c?.endsAt ?? null : null;
  const trialStart = isTrial ? c?.startedAt ?? a.createdAt : null;
  const trialDays = trialStart !== null && trialEnd !== null ? Math.max(1, Math.round((trialEnd - trialStart) / DAY_MS)) : null;
  const dayOfTrial =
    phase === "trial" && trialStart !== null && trialDays !== null ? Math.min(trialDays, Math.max(1, Math.floor((now - trialStart) / DAY_MS) + 1)) : null;
  const cardAddedAt = kind === "nocard" ? c?.cardAt ?? c?.restartedAt ?? null : null;
  const cardNow = kind === "card" || (kind === "nocard" && cardAddedAt !== null);

  let paidFrom: number | null = null;
  let paidHow: PaidHow | null = null;
  if (phase === "paying") {
    if (kind === "nocard" && c?.restartedAt) {
      paidFrom = c.restartedAt;
      paidHow = "card-after-end";
    } else if (isTrial && trialEnd !== null && trialEnd <= now) {
      paidFrom = trialEnd;
      paidHow = kind === "card" ? "card-at-signup" : "card-added";
    } else if (isTrial) {
      paidFrom = a.subUpdatedAt;
      paidHow = "paid-early";
    } else if (kind === "none") {
      paidFrom = a.createdAt;
      paidHow = "paid-at-signup";
    }
  }
  const past = trialEnd !== null && trialEnd <= now ? trialEnd : null;
  const decidedAt = !isTrial
    ? null
    : phase === "paying"
      ? paidFrom
      : phase === "left"
        ? c?.endedAt ?? a.canceledAt ?? past ?? a.subUpdatedAt
        : phase === "failed"
          ? past ?? a.subUpdatedAt
          : null;
  return { ...a, kind, phase, test: !!c?.test, trialStart, trialEnd, trialDays, dayOfTrial, cardNow, cardAddedAt, paidFrom, paidHow, decidedAt };
}

/** Local midnight (TRAFFIC_TZ) of the day after / before the one starting at `start` — DST-safe. */
export const nextDayStart = (start: number) => trafficDayStartMs(start + 36 * 3_600_000);
export const prevDayStart = (start: number) => trafficDayStartMs(start - 12 * 3_600_000);

export interface CohortDay {
  dayStart: number;
  /** Accounts made that day. */
  signedUp: number;
  /** Of them, the ones that started a trial. */
  trials: number;
  card: number;
  nocard: number;
  /** The day most of its trials end (TRAFFIC_TZ midnight), null when none. */
  endsOn: number | null;
  onTrial: number;
  paying: number;
  left: number;
  failed: number;
  /** Every trial of the day is decided. */
  finished: boolean;
  /** Paying ÷ decided, once one is decided. */
  rate: number | null;
  /** The day's trials, in the order they end. */
  orgIds: string[];
}

export interface Outcome {
  total: number;
  paid: number;
  left: number;
  failed: number;
  card: { total: number; paid: number };
  nocard: { total: number; paid: number };
}

export interface TrialBoard {
  now: number;
  rows: BoardRow[];
  onTrial: { total: number; card: number; nocard: number; cardAdded: number; endsToday: number; endsTomorrow: number; monthlyCents: number; likelyCents: number; priced: number };
  /** Trials started in the last RECENT_DAYS signup days (today included), card at signup or not. */
  started: { trials: number; card: number; nocard: number };
  /** Every running trial, the one ending first first. */
  ending: string[];
  /** CALENDAR_DAYS signup days, today first. */
  calendar: CohortDay[];
  /** Trials decided in the last day and the last seven. */
  decided: { day: Outcome; week: Outcome };
  /** Paying accounts, the newest payer first. */
  startedPaying: string[];
  /** Trials that ended without paying in the calendar's reach, newest first. */
  left: string[];
  /** Test-mode trials, left out of every count. */
  tests: number;
  headline: string;
}

const emptyOutcome = (): Outcome => ({ total: 0, paid: 0, left: 0, failed: 0, card: { total: 0, paid: 0 }, nocard: { total: 0, paid: 0 } });
function tally(rows: readonly BoardRow[]): Outcome {
  const o = emptyOutcome();
  for (const r of rows) {
    o.total += 1;
    const paid = r.phase === "paying";
    if (paid) o.paid += 1;
    else if (r.phase === "failed") o.failed += 1;
    else o.left += 1;
    // Card or not, as the trial BEGAN — the owner's question is whether the card at signup pays.
    const side = r.kind === "card" ? o.card : o.nocard;
    side.total += 1;
    if (paid) side.paid += 1;
  }
  return o;
}

export function buildTrialBoard(accounts: readonly BoardAccount[], now: number): TrialBoard {
  const rows = accounts.map((a) => classify(a, now));
  const counted = rows.filter((r) => !r.test);
  const isTrial = (r: BoardRow) => r.kind === "card" || r.kind === "nocard";
  const today = trafficDayStartMs(now);
  const tomorrow = nextDayStart(today);
  const dayAfter = nextDayStart(tomorrow);

  const running = counted.filter((r) => isTrial(r) && r.phase === "trial").sort((a, b) => (a.trialEnd ?? Infinity) - (b.trialEnd ?? Infinity));
  const onTrial = {
    total: running.length,
    card: running.filter((r) => r.cardNow).length,
    nocard: running.filter((r) => !r.cardNow).length,
    cardAdded: running.filter((r) => r.kind === "nocard" && r.cardNow).length,
    endsToday: running.filter((r) => r.trialEnd !== null && r.trialEnd < tomorrow).length,
    endsTomorrow: running.filter((r) => r.trialEnd !== null && r.trialEnd >= tomorrow && r.trialEnd < dayAfter).length,
    monthlyCents: running.reduce((sum, r) => sum + (r.monthlyCents ?? 0), 0),
    likelyCents: Math.round(running.reduce((sum, r) => sum + (r.monthlyCents ?? 0) * (r.chance ?? 0), 0)),
    // How many of them carry a price — none on a database without the plan catalog; the page then names no sum.
    priced: running.filter((r) => r.monthlyCents !== null).length,
  };

  // The calendar: signup days, today first, each with what became of its trials.
  const calendar: CohortDay[] = [];
  let start = today;
  for (let i = 0; i < CALENDAR_DAYS; i++) {
    const end = nextDayStart(start);
    const made = counted.filter((r) => r.createdAt >= start && r.createdAt < end);
    const trials = made.filter(isTrial).sort((a, b) => (a.trialEnd ?? Infinity) - (b.trialEnd ?? Infinity));
    const endDays = new Map<number, number>();
    for (const r of trials) if (r.trialEnd !== null) endDays.set(trafficDayStartMs(r.trialEnd), (endDays.get(trafficDayStartMs(r.trialEnd)) ?? 0) + 1);
    const endsOn = [...endDays].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
    const paying = trials.filter((r) => r.phase === "paying").length;
    const left = trials.filter((r) => r.phase !== "trial" && r.phase !== "paying" && r.phase !== "failed").length;
    const failed = trials.filter((r) => r.phase === "failed").length;
    const onTrialN = trials.filter((r) => r.phase === "trial").length;
    const decided = paying + left + failed;
    calendar.push({
      dayStart: start,
      signedUp: made.length,
      trials: trials.length,
      card: trials.filter((r) => r.kind === "card").length,
      nocard: trials.filter((r) => r.kind === "nocard").length,
      endsOn,
      onTrial: onTrialN,
      paying,
      left,
      failed,
      finished: trials.length > 0 && onTrialN === 0,
      rate: decided > 0 ? paying / decided : null,
      orgIds: trials.map((r) => r.orgId),
    });
    start = prevDayStart(start);
  }

  const week = calendar.slice(0, RECENT_DAYS);
  const started = { trials: week.reduce((n, d) => n + d.trials, 0), card: week.reduce((n, d) => n + d.card, 0), nocard: week.reduce((n, d) => n + d.nocard, 0) };

  const decidedRows = counted.filter((r) => isTrial(r) && r.decidedAt !== null && r.decidedAt <= now);
  const within = (ms: number) => decidedRows.filter((r) => (r.decidedAt as number) > now - ms);
  const decided = { day: tally(within(DAY_MS)), week: tally(within(RECENT_DAYS * DAY_MS)) };

  const startedPaying = counted
    .filter((r) => r.phase === "paying" && r.kind !== "comp")
    .sort((a, b) => (b.paidFrom ?? 0) - (a.paidFrom ?? 0))
    .map((r) => r.orgId);
  const reach = now - CALENDAR_DAYS * DAY_MS;
  const left = counted
    .filter((r) => isTrial(r) && (r.phase === "left" || r.phase === "failed") && (r.decidedAt ?? 0) > reach)
    .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))
    .map((r) => r.orgId);

  const board: Omit<TrialBoard, "headline"> = {
    now,
    rows,
    onTrial,
    started,
    ending: running.map((r) => r.orgId),
    calendar,
    decided,
    startedPaying,
    left,
    tests: rows.filter((r) => r.test).length,
  };
  return { ...board, headline: boardHeadline(board) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** The page in three sentences: who is on trial, what ends soon, what the last seven days decided. */
export function boardHeadline(b: Pick<TrialBoard, "onTrial" | "decided">): string {
  const t = b.onTrial;
  const parts: string[] = [];
  if (t.total === 0) parts.push("No one is on a trial right now.");
  else {
    const card = t.card === 0 ? "none with a card" : t.card === t.total ? (t.total === 1 ? "with a card" : "all with a card") : `${t.card} with a card`;
    const without = t.nocard === 0 || t.card === t.total ? "" : `, ${t.nocard} without one`;
    parts.push(`${plural(t.total, "account")} on a trial now — ${card}${without}.`);
    if (t.endsToday + t.endsTomorrow === 0) parts.push("None ends today or tomorrow.");
    else parts.push(`${t.endsToday} ${t.endsToday === 1 ? "ends" : "end"} today, ${t.endsTomorrow} tomorrow.`);
  }
  const w = b.decided.week;
  if (w.total === 0) parts.push("No trial has ended in the last 7 days yet.");
  else {
    const sides = [w.card.total ? `with a card ${w.card.paid} of ${w.card.total}` : "", w.nocard.total ? `without one ${w.nocard.paid} of ${w.nocard.total}` : ""].filter(Boolean).join(", ");
    parts.push(`Of the ${plural(w.total, "trial")} decided in the last 7 days, ${w.paid} ${w.paid === 1 ? "is" : "are"} paying (${pct(w.paid, w.total)}%)${sides ? ` — ${sides}` : ""}.`);
  }
  return parts.join(" ");
}

// ── words for the page ───────────────────────────────────────────────────────

const DAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: TRAFFIC_TZ, weekday: "short", month: "short", day: "numeric" });
const TIME_FMT = new Intl.DateTimeFormat("en-US", { timeZone: TRAFFIC_TZ, hour: "numeric", minute: "2-digit" });

/** "Today", "Tomorrow", "Yesterday" or "Wed, Oct 15" — the traffic page's days. */
export function dayWords(ms: number, now: number): string {
  const day = trafficDayStartMs(ms);
  const today = trafficDayStartMs(now);
  if (day === today) return "Today";
  if (day === nextDayStart(today)) return "Tomorrow";
  if (day === prevDayStart(today)) return "Yesterday";
  return DAY_FMT.format(new Date(ms));
}
export const timeWords = (ms: number) => TIME_FMT.format(new Date(ms));
/** The same inside a sentence: "today", "tomorrow", "yesterday" — a date stays a date ("Mon, Oct 19"). */
export function dayInline(ms: number, now: number): string {
  const w = dayWords(ms, now);
  return w === "Today" || w === "Tomorrow" || w === "Yesterday" ? w.toLowerCase() : w;
}

/** "in 5 h", "in 2 days", "3 h ago" — how far a moment is from now. */
export function fromNow(ms: number, now: number): string {
  const d = ms - now;
  const abs = Math.abs(d);
  const unit = abs < 3_600_000 ? `${Math.max(1, Math.round(abs / 60_000))} min` : abs < 2 * DAY_MS ? `${Math.round(abs / 3_600_000)} h` : `${Math.round(abs / DAY_MS)} days`;
  return d >= 0 ? `in ${unit}` : `${unit} ago`;
}

export const PAID_HOW_LABEL: Record<PaidHow, string> = {
  "card-at-signup": "Card at signup — charged when the trial ended",
  "card-added": "No card at signup — added one during the trial",
  "card-after-end": "No card at signup — paid after the trial ended",
  "paid-at-signup": "Paid at signup, no trial",
  "paid-early": "Paid before the trial was up",
};

/** Why a trial ended without paying, in words. */
export function leftWords(r: BoardRow): string {
  if (r.phase === "failed") return "The card failed when the trial ended";
  if (r.kind === "nocard" && r.cardless?.endedAt) return "The trial ended with no card";
  if (r.canceledAt !== null && r.trialEnd !== null && r.canceledAt < r.trialEnd) return "Canceled during the trial";
  if (r.status.toUpperCase() === "CANCELED") return "Canceled";
  return "The trial ended without paying";
}

/** What the account did, in one line ("2 proposals (1 sent) · 1 estimate · 3 clients · on 2 days"). */
export function workWords(w: TrialWork): string {
  const bits = [
    w.proposals ? `${plural(w.proposals, "proposal")}${w.sent ? ` (${w.sent} sent)` : ""}` : "",
    w.aiAsks ? plural(w.aiAsks, "Smart Proposal brief") : "",
    w.estimates ? plural(w.estimates, "estimate") : "",
    w.clients ? plural(w.clients, "client") : "",
    w.leads ? plural(w.leads, "lead") : "",
    w.jobs ? plural(w.jobs, "job") : "",
    w.activeDays ? `in the app on ${plural(w.activeDays, "day")}` : "",
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : "Nothing made yet";
}

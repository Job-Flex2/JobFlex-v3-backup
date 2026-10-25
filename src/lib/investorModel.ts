// THE INVESTOR FIGURES (owner, 2026-10-06): "how much we spend on ads, how
// many users we get on free trial … and the main thing: how soon we cover the
// ad spend." Pure: dates and cents in, figures and a day-by-day curve out. The
// server gathers the rows (lib/investors); this decides what they mean, and
// the QA script pins every rule.
//
// MEASURED, NOT ASSUMED (owner, 2026-10-24: "we don't know how many users will
// pay after sign-up, only an assumption — remove the assumptions and use the
// current rate of how many companies stay after their trials"). The share of
// trials that pay is no longer the owner's 60%, nor "if every trial pays", nor
// the behaviour model's guess: it is the RATE MEASURED on the trials that have
// already ended — of those, the share paying today — with its 90% range for
// that many trials. The trials running now are expected to pay at that rate.
// No trial ended yet = no rate, and nothing is predicted from it.
//
// THE CURVE. Each day from the ad launch to the horizon has two running totals:
//   · ad spend — every dollar booked so far, then the last full week's pace;
//   · revenue — each paying account earns its monthly price a thirtieth a day
//     from the day it started paying; each running trial, at the measured
//     rate, from the day its trial ends; signups still to come arrive at the
//     last week's pace and pay, at the measured rate, after their trial.
// The break-even is the first day revenue stands at or above the spend.
// Revenue is at LIST price per month, not Stripe's collections (the page
// shows those beside it): discounts, taxes and churn are not modelled.

/** Where an ad dollar went. Pure, so the admin page (a client component) can list it. */
export const PLATFORMS = ["meta", "google", "tiktok", "other"] as const;
export type SpendPlatform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<SpendPlatform, string> = { meta: "Meta (Facebook · Instagram)", google: "Google", tiktok: "TikTok", other: "Other" };

export interface SpendDay {
  /** YYYY-MM-DD, in the page's zone. */
  date: string;
  cents: number;
}
/** How a trial started (owner, 2026-10-13): with a card up front, or with no card (lib/trialState's record). */
export type TrialCohort = "card" | "nocard";
export const COHORT_LABEL: Record<TrialCohort, string> = { card: "With a card", nocard: "No card" };
export interface PayingAccount {
  /** The day it started paying, YYYY-MM-DD. */
  startedAt: string;
  monthlyCents: number;
  /** The day the account signed up (for the cohort split); defaults to startedAt. */
  signedUpAt?: string;
  cohort?: TrialCohort;
  /** Paying from before the start day (owner, 2026-10-13: "add the users already paying before this period to
   *  With a card, paying"): counted as a paying account — its revenue from the start day on, in the run rate, the
   *  curve and the payback — but not as a signup of the period: the ads did not bring it. */
  preexisting?: boolean;
}
export interface TrialAccount {
  createdAt: string;
  /** The day the trial ends (pays from then), YYYY-MM-DD; null = unknown, read as createdAt + trialDays. */
  endsAt: string | null;
  /** null = no price on record; counted, not valued. */
  monthlyCents: number | null;
  cohort?: TrialCohort;
}
/** One flip of the owner's switch: from this day on, new signups got this. */
export interface PolicySpan {
  from: string;
  mode: TrialCohort;
}
/** What the owner sets — none of it a guess at who pays (2026-10-24). */
export interface ModelSettings {
  /** How far the curve runs past today: how far the chart looks, not a figure. */
  horizonDays: number;
  /** A trial's length, days — used only when no running trial has its end on record. */
  trialDays: number;
  /** The daily ad budget, ALL ads together (owner, 2026-10-06: "we have a per-day
   *  budget set and it's getting used") — counted as spent every day from
   *  `budgetFrom` to today on which nothing was booked by hand; null = none. */
  dailyBudgetCents: number | null;
  /** The day the budget started; null = the start day. */
  budgetFrom: string | null;
}
export interface ModelInput {
  since: string;
  today: string;
  spend: SpendDay[];
  paying: PayingAccount[];
  trials: TrialAccount[];
  /** Trials that ended with no payment (ran out, canceled, a payment that failed) — with the paying, the measured rate. */
  lapsed: number;
  /** The day each lapsed trial signed up: a signup like any other, so the pace the measured rate is applied to
   *  counts the ones that will not stay too. Absent = not known (the pace then counts trials and paying). */
  lapsedSignups?: Array<{ date: string; cohort?: TrialCohort }>;
  settings: ModelSettings;
  /** The spend per day from tomorrow; absent = the last full week's pace. Set by the cohort cut (a cohort no
   *  new signup gets any more spends nothing forward). */
  forwardSpendCents?: number | null;
  /** Unique visitors since the launch, when the analytics answered. */
  visitors: number | null;
  /** The cohort split (owner, 2026-10-13): lapsed trials by how they started, the signups' days by cohort, the
   *  switch's recorded flips, and what a new signup gets today. */
  cohorts?: {
    lapsed: Record<TrialCohort, number>;
    /** Every counted signup — a trial, a paying account, a lapsed trial — by the day it signed up. */
    signups: Array<{ date: string; cohort: TrialCohort }>;
    policy: PolicySpan[];
    current: TrialCohort;
  };
}

export interface CurvePoint {
  date: string;
  /** Running totals from the start day: what went out on ads, what came in at list price (trials at the measured rate). */
  spendCents: number;
  revenueCents: number;
  /** Past today: projected, not booked. */
  projected: boolean;
  /** That day alone. */
  spendDayCents: number;
  spendSource: "booked" | "budget" | "projected" | "none";
  /** The monthly run-rate on that day: what a month brings at that day's accounts. */
  mrrCents: number;
  /** Accounts: paying (expected at the measured rate, fractional, once a trial is over), and signed up so far. */
  paying: number;
  signups: number;
}

export interface InvestorFigures {
  since: string;
  today: string;
  daysLive: number;
  spend: {
    totalCents: number;
    perDayRecentCents: number;
    perDayProjectedCents: number;
    daysWithSpend: number;
    lastDate: string | null;
    /** The daily budget in force, from when, and how many days it filled vs were booked by hand. */
    dailyBudgetCents: number | null;
    budgetFrom: string | null;
    budgetDays: number;
    bookedDays: number;
  };
  visitors: number | null;
  signups: number;
  /** The trials running now: how many, their monthly list price together, the average, and the trial length in use. */
  trials: { count: number; priced: number; mrrCents: number; avgMonthlyCents: number; lengthDays: number };
  paying: {
    count: number; mrrCents: number; arrCents: number; revenueToDateCents: number;
    /** Of them, the ones paying from before the start day, and their monthly list price. */
    preexisting: number; preexistingMrrCents: number;
    /** The ones the period brought (signed up since the start day), and their monthly list price. */
    won: number; wonMrrCents: number;
  };
  lapsed: number;
  /** THE MEASURED RATE (2026-10-24): of the trials that have ended, the share paying today, and its 90% range
   *  (Wilson) for that many trials. pct null = no trial has ended yet. */
  rate: { paid: number; ended: number; pct: number | null; lowPct: number | null; highPct: number | null };
  /** The running trials at the measured rate: how many will pay (and the range), and what they add a month. */
  expected: { payers: number | null; payersLow: number | null; payersHigh: number | null; mrrCents: number | null; mrrWithPayingCents: number };
  unit: {
    costPerVisitorCents: number | null;
    costPerSignupCents: number | null;
    /** Spend ÷ the paying customers the period brought — counted, not expected. */
    costPerPayingCents: number | null;
    visitorToSignupPct: number | null;
    signupsPerDay: number;
    /** Spend ÷ the monthly list price of those customers — months for them to earn the spend back. */
    paybackMonths: number | null;
    /** Revenue to date at list price ÷ spend to date. */
    returnToDatePct: number | null;
  };
  breakEven: { date: string | null; daysFromToday: number | null; withinHorizon: boolean };
  curve: CurvePoint[];
}

const DAY_MS = 86_400_000;
export const dayOf = (iso: string) => iso.slice(0, 10);
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => toDate(toMs(date) + n * DAY_MS);
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY_MS);
const r0 = (n: number) => Math.round(n);

/** The recent pace of something that happened on `dates`: per day over the last `window` days (or since the launch, when younger). */
export function perDay(dates: readonly string[], since: string, today: string, window = 7): number {
  const live = Math.max(1, daysBetween(since, today) + 1);
  const span = Math.min(window, live);
  const from = addDays(today, -(span - 1));
  const n = dates.filter((d) => d >= from && d <= today).length;
  return n / span;
}

/** The 90% range (Wilson score interval) of a share measured as `k` of `n` — what that many trials can tell. */
export function wilson(k: number, n: number, z = 1.645): { low: number; high: number } | null {
  if (!(n > 0)) return null;
  const p = Math.min(1, Math.max(0, k / n));
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** The middle value; null for none. */
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function investorFigures(input: ModelInput): InvestorFigures {
  const { since, today, settings: a } = input;
  const horizon = Math.max(30, Math.min(730, Math.round(a.horizonDays) || 180));
  const daysLive = Math.max(1, daysBetween(since, today) + 1);
  // The trial length: what the running trials show (their end on record), else the setting.
  const shown = median(input.trials.filter((t) => t.endsAt).map((t) => daysBetween(dayOf(t.createdAt), dayOf(t.endsAt as string))).filter((d) => d > 0));
  const trialDays = Math.max(1, Math.min(90, Math.round(shown ?? a.trialDays) || 7));
  // Paces are read over FULL days: today is still running (Meta's figure for it is partial).
  const lastFull = daysLive > 1 ? addDays(today, -1) : today;

  // ── spend: the days booked by hand (or by Meta), then the daily budget on every other day
  const booked = new Map<string, number>();
  for (const s of input.spend) if (s.date >= since && s.date <= today && s.cents > 0) booked.set(s.date, (booked.get(s.date) ?? 0) + s.cents);
  const dailyBudget = a.dailyBudgetCents !== null && Number.isFinite(a.dailyBudgetCents) && a.dailyBudgetCents > 0 ? r0(a.dailyBudgetCents) : null;
  const budgetFrom = dailyBudget !== null ? (a.budgetFrom && a.budgetFrom > since ? a.budgetFrom : since) : null;
  const spendByDay = new Map<string, number>(booked);
  const spendSource = new Map<string, "booked" | "budget">([...booked.keys()].map((d) => [d, "booked" as const]));
  let budgetDays = 0;
  if (dailyBudget !== null && budgetFrom !== null) {
    for (let d = budgetFrom; d <= today; d = addDays(d, 1)) if (!booked.has(d)) { spendByDay.set(d, dailyBudget); spendSource.set(d, "budget"); budgetDays++; }
  }
  const totalSpend = [...spendByDay.values()].reduce((x, y) => x + y, 0);
  const recentFrom = addDays(lastFull, -6) > since ? addDays(lastFull, -6) : since;
  const recentDays = Math.max(1, daysBetween(recentFrom, lastFull) + 1);
  const recentSpend = [...spendByDay].filter(([d]) => d >= recentFrom && d <= lastFull).reduce((x, [, c]) => x + c, 0);
  const perDayRecent = r0(recentSpend / recentDays);
  // Tomorrow on: what the last full week spent a day (the cohort cut stops a cohort no signup gets any more).
  const perDayProjected = input.forwardSpendCents !== undefined && input.forwardSpendCents !== null && Number.isFinite(input.forwardSpendCents) ? Math.max(0, r0(input.forwardSpendCents)) : perDayRecent;
  const spendDates = [...spendByDay.keys()].sort();

  // ── trials and paying
  const trials = input.trials;
  const priced = trials.filter((t) => t.monthlyCents !== null);
  const trialsMrr = priced.reduce((x, t) => x + (t.monthlyCents ?? 0), 0);
  const avgTrialMonthly = priced.length ? r0(trialsMrr / priced.length) : 0;
  const payingMrr = input.paying.reduce((x, p) => x + p.monthlyCents, 0);
  // Revenue earned IN the period: an account paying from before the start day earns from the start day.
  const revenueToDate = input.paying.reduce((x, p) => x + r0((p.monthlyCents * Math.max(0, daysBetween(p.startedAt > since ? p.startedAt : since, today) + 1)) / 30), 0);
  // The period's own signups: the ads did not bring an account that was paying before the start day.
  const won = input.paying.filter((p) => !p.preexisting);
  const wonMrr = won.reduce((x, p) => x + p.monthlyCents, 0);
  const preexisting = input.paying.filter((p) => p.preexisting);
  const signups = trials.length + won.length + input.lapsed;
  const signupDates = [...trials.map((t) => t.createdAt), ...won.map((p) => p.signedUpAt ?? p.startedAt), ...(input.lapsedSignups ?? []).map((x) => x.date)].map(dayOf).sort();
  const signupsPerDay = perDay(signupDates, since, lastFull);

  // ── THE MEASURED RATE: of the trials that have ended, the share paying today. Nothing ended = no rate, and
  // nothing is expected of the running trials (the curve then counts the paying accounts alone).
  const ended = won.length + input.lapsed;
  const share = ended > 0 ? won.length / ended : null;
  const range = wilson(won.length, ended);
  const pct = share ?? 0;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const expectedMrr = share === null ? null : r0(trialsMrr * share);

  // ── the curve
  const trialEnd = (t: TrialAccount) => {
    const end = t.endsAt ? dayOf(t.endsAt) : addDays(dayOf(t.createdAt), trialDays);
    // A trial past its end that is still a trial pays, if it pays, from today.
    return end < today ? today : end;
  };
  const curve: CurvePoint[] = [];
  let spendRun = 0;
  let revenueRun = 0;
  const last = addDays(today, horizon);
  const futureCohorts: number[] = []; // monthly cents from each future day's signups, were every one to pay
  for (let d = since; d <= last; d = addDays(d, 1)) {
    const projected = d > today;
    const spendDay = projected ? perDayProjected : (spendByDay.get(d) ?? 0);
    spendRun += spendDay;
    let mrrDay = 0;
    let payingDay = 0;
    for (const p of input.paying) if (dayOf(p.startedAt) <= d) { mrrDay += p.monthlyCents; payingDay += 1; }
    // A running trial pays, at the measured rate, from its end.
    for (const t of trials) if (trialEnd(t) <= d) {
      payingDay += pct;
      if (t.monthlyCents !== null) mrrDay += t.monthlyCents * pct;
    }
    let signupsSoFar = signupDates.filter((x) => x <= d).length;
    if (projected) {
      // Signups keep arriving at the last week's pace; each day's arrivals pay, at the measured rate, after their trial.
      futureCohorts.push(signupsPerDay * avgTrialMonthly);
      const payingCohorts = futureCohorts.length - trialDays;
      for (let i = 0; i < payingCohorts; i++) mrrDay += futureCohorts[i] * pct;
      if (payingCohorts > 0) payingDay += payingCohorts * signupsPerDay * pct;
      signupsSoFar += futureCohorts.length * signupsPerDay;
    }
    revenueRun += mrrDay / 30;
    curve.push({
      date: d, spendCents: r0(spendRun), revenueCents: r0(revenueRun), projected,
      spendDayCents: r0(spendDay), spendSource: projected ? "projected" : (spendSource.get(d) ?? "none"),
      mrrCents: r0(mrrDay), paying: r1(payingDay), signups: r1(signupsSoFar),
    });
  }
  const cross = totalSpend > 0 ? curve.find((p) => p.revenueCents >= p.spendCents && p.date >= today) ?? null : null;
  const breakEven = cross
    ? { date: cross.date, daysFromToday: daysBetween(today, cross.date), withinHorizon: true }
    : { date: null, daysFromToday: null, withinHorizon: false };

  // A cost needs both a spend and something to divide it by; without either there is no figure.
  const div = (n: number, d: number) => (n > 0 && d > 0 ? r0(n / d) : null);
  const toPct = (x: number) => Math.round(x * 100);
  return {
    since,
    today,
    daysLive,
    spend: { totalCents: totalSpend, perDayRecentCents: perDayRecent, perDayProjectedCents: perDayProjected, daysWithSpend: spendDates.length, lastDate: spendDates.at(-1) ?? null, dailyBudgetCents: dailyBudget, budgetFrom, budgetDays, bookedDays: booked.size },
    visitors: input.visitors,
    signups,
    trials: { count: trials.length, priced: priced.length, mrrCents: trialsMrr, avgMonthlyCents: avgTrialMonthly, lengthDays: trialDays },
    paying: { count: input.paying.length, mrrCents: payingMrr, arrCents: payingMrr * 12, revenueToDateCents: revenueToDate, preexisting: preexisting.length, preexistingMrrCents: preexisting.reduce((x, p) => x + p.monthlyCents, 0), won: won.length, wonMrrCents: wonMrr },
    lapsed: input.lapsed,
    rate: { paid: won.length, ended, pct: share === null ? null : toPct(share), lowPct: range ? toPct(range.low) : null, highPct: range ? toPct(range.high) : null },
    expected: {
      payers: share === null ? null : r1(trials.length * share),
      payersLow: range ? Math.round(trials.length * range.low) : null,
      payersHigh: range ? Math.round(trials.length * range.high) : null,
      mrrCents: expectedMrr,
      mrrWithPayingCents: payingMrr + (expectedMrr ?? 0),
    },
    unit: {
      costPerVisitorCents: input.visitors ? div(totalSpend, input.visitors) : null,
      costPerSignupCents: div(totalSpend, signups),
      costPerPayingCents: div(totalSpend, won.length),
      visitorToSignupPct: input.visitors ? Math.round((signups / input.visitors) * 1000) / 10 : null,
      signupsPerDay: Math.round(signupsPerDay * 100) / 100,
      paybackMonths: wonMrr > 0 && totalSpend > 0 ? Math.round((totalSpend / wonMrr) * 10) / 10 : null,
      returnToDatePct: totalSpend > 0 ? Math.round((revenueToDate / totalSpend) * 100) : null,
    },
    breakEven,
    curve,
  };
}

/* ── THE TWO COHORTS (owner, 2026-10-13: "the statistics with all the signups with a card, and with no card: how
   much budget was spent on each, and where we are now") ──────────────────────────────────────────────────────
   A day's ad spend went to whichever kind of trial a visitor could start that day. Where the owner's switch is
   recorded (lib/trialPolicyServer keeps its flips from 2026-10-13), the day follows the switch; before that, the
   day follows who signed up on it — all no-card signups, the whole day; a mix, in proportion — and a day with
   no signups follows the nearest day that had some (earlier first). Each cohort then gets its own figures on its
   own trials, paying accounts, lapsed trials and attributed spend; only the cohort a new signup gets TODAY keeps
   spending forward, the other's spend stands still, so each has its own break-even. Visitors cannot be split. */

/** The share (0–1) of each day's spend that went to no-card trials. */
export function noCardShareByDay(days: readonly string[], signups: ReadonlyArray<{ date: string; cohort: TrialCohort }>, policy: readonly PolicySpan[]): Map<string, number> {
  const spans = [...policy].filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.from)).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const byDay = new Map<string, { card: number; nocard: number }>();
  for (const x of signups) {
    const c = byDay.get(x.date) ?? { card: 0, nocard: 0 };
    c[x.cohort] += 1;
    byDay.set(x.date, c);
  }
  const ofSignups = (d: string): number | null => {
    const c = byDay.get(d);
    if (!c || c.card + c.nocard === 0) return null;
    return c.nocard / (c.card + c.nocard);
  };
  const sorted = [...days].sort();
  const out = new Map<string, number>();
  for (const d of sorted) {
    const span = spans.filter((p) => p.from <= d).at(-1);
    if (span) {
      out.set(d, span.mode === "nocard" ? 1 : 0);
      continue;
    }
    const own = ofSignups(d);
    if (own !== null) {
      out.set(d, own);
      continue;
    }
    // The nearest day with signups: earlier first, then later; nothing at all = the card (the only kind before the switch).
    const known = [...byDay.keys()].sort();
    const earlier = known.filter((k) => k < d).at(-1);
    const later = known.find((k) => k > d);
    const near = earlier ?? later;
    out.set(d, near ? (ofSignups(near) ?? 0) : 0);
  }
  return out;
}

export interface CohortFigures {
  cohort: TrialCohort;
  figures: InvestorFigures;
  /** The ad spend attributed to this cohort, and over how many days any of it fell. */
  attributedCents: number;
  attributedDays: number;
  firstDay: string | null;
  lastDay: string | null;
  /** New signups get this today: its spend keeps running forward. */
  current: boolean;
  signups: number;
}

/** The figures for one cohort, cut from the whole: its accounts, its share of each day's spend. */
export function cohortFigures(input: ModelInput, cohort: TrialCohort, whole: InvestorFigures = investorFigures(input), opts: { keepVisitors?: boolean } = {}): CohortFigures {
  const c = input.cohorts ?? { lapsed: { card: 0, nocard: 0 }, signups: [], policy: [], current: "card" as TrialCohort };
  const booked = whole.curve.filter((p) => !p.projected && p.date <= whole.today);
  const share = noCardShareByDay(booked.map((p) => p.date), c.signups, c.policy);
  const spend: SpendDay[] = [];
  for (const p of booked) {
    const sh = share.get(p.date) ?? 0;
    const cents = Math.round(p.spendDayCents * (cohort === "nocard" ? sh : 1 - sh));
    if (cents > 0) spend.push({ date: p.date, cents });
  }
  const current = c.current === cohort;
  const mine: ModelInput = {
    ...input,
    spend,
    paying: input.paying.filter((p) => (p.cohort ?? "card") === cohort),
    trials: input.trials.filter((t) => (t.cohort ?? "card") === cohort),
    lapsed: c.lapsed[cohort] ?? 0,
    lapsedSignups: input.lapsedSignups?.filter((x) => (x.cohort ?? "card") === cohort),
    // The whole's spend is already filled by the budget; from tomorrow only today's cohort spends.
    settings: { ...input.settings, dailyBudgetCents: null, budgetFrom: null },
    forwardSpendCents: current ? whole.spend.perDayProjectedCents : 0,
    visitors: opts.keepVisitors ? input.visitors : null,
    cohorts: undefined,
  };
  const figures = investorFigures(mine);
  const dates = spend.map((d) => d.date);
  return {
    cohort,
    figures,
    attributedCents: spend.reduce((x, d) => x + d.cents, 0),
    attributedDays: dates.length,
    firstDay: dates[0] ?? null,
    lastDay: dates.at(-1) ?? null,
    current,
    signups: figures.signups,
  };
}

/** THE SPEND BY PERIOD (owner, 2026-10-08: "live spending per day, per week,
 *  per month; show all the costs"): read off the curve's booked days, so a
 *  Meta figure, a hand-booked day and a budget-filled day all count. The
 *  week starts on Monday; "days" is how many days of the window fall on or
 *  after the start day, so the per-day figure is honest in a young window. */
export interface SpendPeriod {
  key: "today" | "yesterday" | "week" | "last7" | "month" | "last30" | "all";
  label: string;
  cents: number;
  days: number;
  perDayCents: number;
}
export function spendPeriods(curve: CurvePoint[], today: string): SpendPeriod[] {
  const booked = curve.filter((p) => !p.projected && p.date <= today);
  const since = booked[0]?.date ?? today;
  const sum = (from: string, to: string) => {
    const inWindow = booked.filter((p) => p.date >= from && p.date <= to);
    const cents = inWindow.reduce((x, p) => x + p.spendDayCents, 0);
    return { cents, days: inWindow.length, perDayCents: inWindow.length ? r0(cents / inWindow.length) : 0 };
  };
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sunday
  const monday = addDays(today, -((dow + 6) % 7));
  const first = `${today.slice(0, 8)}01`;
  const yesterday = addDays(today, -1);
  const mk = (key: SpendPeriod["key"], label: string, from: string, to: string): SpendPeriod => ({ key, label, ...sum(from < since ? since : from, to) });
  return [
    mk("today", "Today", today, today),
    mk("yesterday", "Yesterday", yesterday, yesterday),
    mk("week", "This week", monday, today),
    mk("last7", "Last 7 days", addDays(today, -6), today),
    mk("month", "This month", first, today),
    mk("last30", "Last 30 days", addDays(today, -29), today),
    mk("all", "Since the start", since, today),
  ];
}

/** "$1,234" — whole dollars; cents only under ten dollars. */
export function dollars(cents: number): string {
  const d = cents / 100;
  return `$${d.toLocaleString("en-US", { maximumFractionDigits: d > 0 && d < 10 ? 2 : 0, minimumFractionDigits: 0 })}`;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const shortDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** What investors read first (2026-10-24): what the ads bought, the rate measured so far, and what it says of
 *  the trials running now. Counted things only; the one prediction is the measured rate applied to them. */
export function standingSentence(f: InvestorFigures): string {
  const spent = f.spend.totalCents > 0 ? `${dollars(f.spend.totalCents)} on ads since ${shortDay(f.since)} brought ${plural(f.signups, "signup", "signups")} with a card.` : `No ad spend is booked since ${shortDay(f.since)}; ${plural(f.signups, "signup", "signups")} with a card.`;
  const r = f.rate;
  if (r.pct === null) return `${spent} No trial has ended yet, so there is no measured rate to predict with — ${plural(f.trials.count, "trial is", "trials are")} running now.`;
  const rate = ` Of the ${plural(r.ended, "trial", "trials")} that have ended, ${r.paid} ${r.paid === 1 ? "is" : "are"} paying today — ${r.pct}%.`;
  const ahead = f.trials.count === 0 || f.expected.payers === null
    ? " No trial is running now."
    : ` At that rate about ${Math.round(f.expected.payers)} of the ${plural(f.trials.count, "trial", "trials")} running now will pay too${f.expected.payersLow !== null && f.expected.payersHigh !== null && f.expected.payersLow !== f.expected.payersHigh ? ` (likely ${f.expected.payersLow}–${f.expected.payersHigh})` : ""}.`;
  return spent + rate + ahead;
}

/** The second sentence: when the ads pay for themselves, at today's pace and the measured rate. */
export function outlookSentence(f: InvestorFigures): string {
  if (f.spend.totalCents === 0) return "With no ad spend booked there is nothing to earn back.";
  const run = dollars(f.expected.mrrWithPayingCents);
  const share = f.rate.pct === null ? "" : `, ${f.rate.pct}% of trials paying`;
  if (f.breakEven.date && f.breakEven.daysFromToday !== null) {
    if (f.breakEven.daysFromToday <= 0) return `The ad spend to date (${dollars(f.spend.totalCents)}) is already covered by revenue at list price; monthly revenue runs at ${run}.`;
    return `At today's pace — ${dollars(f.spend.perDayProjectedCents)} a day on ads, ${f.unit.signupsPerDay} ${f.unit.signupsPerDay === 1 ? "signup" : "signups"} a day${share} — the ads pay for themselves in ${f.breakEven.daysFromToday} days, on ${longDate(f.breakEven.date)}.`;
  }
  const why = f.rate.pct === null ? " Until a trial ends, only the accounts already paying are counted." : f.rate.pct === 0 ? " No trial that ended is paying yet, so the running trials add nothing." : "";
  return `At today's pace the ads do not pay for themselves within ${f.curve.length - f.daysLive} days: ${dollars(f.spend.perDayProjectedCents)} a day goes out against ${run} a month coming in.${why}`;
}

/** Which day since the launch today is (owner, 2026-10-24: "add the days count after JobFlex launched"): the
 *  launch day is day 1; a launch date still ahead reads as day 0. */
export function launchDay(date: string, today: string, set = true): { date: string; day: number; set: boolean } {
  return { date, day: Math.max(0, daysBetween(date, today) + 1), set };
}

export function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

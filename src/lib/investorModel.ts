// THE INVESTOR FIGURES (owner, 2026-10-06): "how much we spend on ads, how
// many users we get on free trial, what is projected if all pay, what is
// realistic — say 60% — and the main thing: how soon we cover the ad spend
// with the trials' potential, the accounts already paying, and the ones
// projected to pay." Pure: dates and cents in, figures and a day-by-day
// curve out. The server gathers the rows (lib/investors); this decides what
// they mean, and the QA script pins every rule.
//
// THE CURVE. Each day from the ad launch to the horizon has three running
// totals:
//   · ad spend — every dollar booked so far, then the projected daily spend;
//   · revenue if every trial pays — each paying account earns its monthly
//     price a thirtieth a day from the day it started paying; each trial
//     earns from the day its trial ends; signups still to come arrive at the
//     recent pace, start their trial, and pay from the day it ends;
//   · realistic revenue — the same, with only the realistic share of trials
//     (the owner's percentage, 60 by default) paying.
// The break-even is the first day realistic revenue stands at or above the
// spend. Revenue is at LIST price per month, not Stripe's collections:
// discounts, taxes and churn are not modelled — the page says so.

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
  /** The behaviour model's chance (lib/trialProjection), for the "by behaviour" reading. */
  chance: number;
  cohort?: TrialCohort;
}
/** One flip of the owner's switch: from this day on, new signups got this. */
export interface PolicySpan {
  from: string;
  mode: TrialCohort;
}
export interface InvestorAssumptions {
  /** The share of trials that will pay, 0–100. The owner's number. */
  realisticPct: number;
  /** Projected ad spend per day from tomorrow; null = the recent average. */
  spendPerDayCents: number | null;
  /** How far the curve runs past today. */
  horizonDays: number;
  /** A trial's length, days. */
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
  /** Trials that ended with no payment — the record the realistic share is checked against. */
  lapsed: number;
  assumptions: InvestorAssumptions;
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
  /** Running totals from the start day. */
  spendCents: number;
  allPayCents: number;
  realisticCents: number;
  /** Past today: projected, not booked. */
  projected: boolean;
  /** That day alone. */
  spendDayCents: number;
  spendSource: "booked" | "budget" | "projected" | "none";
  /** The monthly run-rate on that day: what a month brings at that day's accounts. */
  mrrAllPayCents: number;
  mrrRealisticCents: number;
  /** Accounts: paying (expected, fractional past today), and signed up so far (trial or paying). */
  payingAllPay: number;
  payingRealistic: number;
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
  trials: { count: number; priced: number; maxMrrCents: number; realisticMrrCents: number; byBehaviourMrrCents: number; byBehaviourPct: number | null; avgMonthlyCents: number };
  paying: { count: number; mrrCents: number; arrCents: number; revenueToDateCents: number; /** Of them, the ones paying from before the start day, and their monthly list price. */ preexisting: number; preexistingMrrCents: number };
  lapsed: number;
  /** Trials that already ended: paid vs lapsed, the observed share. */
  observed: { paid: number; lapsed: number; pct: number | null };
  projected: { mrrAllPayCents: number; mrrRealisticCents: number; mrrByBehaviourCents: number };
  unit: {
    costPerVisitorCents: number | null;
    costPerSignupCents: number | null;
    costPerPayingRealisticCents: number | null;
    visitorToSignupPct: number | null;
    signupsPerDay: number;
    /** Spend ÷ realistic monthly revenue — months to recover the spend at today's run rate. */
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
const clampPct = (n: number) => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));
const r0 = (n: number) => Math.round(n);

/** The recent pace of something that happened on `dates`: per day over the last `window` days (or since the launch, when younger). */
export function perDay(dates: readonly string[], since: string, today: string, window = 7): number {
  const live = Math.max(1, daysBetween(since, today) + 1);
  const span = Math.min(window, live);
  const from = addDays(today, -(span - 1));
  const n = dates.filter((d) => d >= from && d <= today).length;
  return n / span;
}

export function investorFigures(input: ModelInput): InvestorFigures {
  const { since, today, assumptions: a } = input;
  const pct = clampPct(a.realisticPct) / 100;
  const horizon = Math.max(30, Math.min(730, Math.round(a.horizonDays) || 180));
  const trialDays = Math.max(1, Math.min(90, Math.round(a.trialDays) || 7));
  const daysLive = Math.max(1, daysBetween(since, today) + 1);

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
  const recentFrom = addDays(today, -6);
  const recentDays = Math.min(7, daysLive);
  const recentSpend = [...spendByDay].filter(([d]) => d >= recentFrom).reduce((x, [, c]) => x + c, 0);
  const perDayRecent = r0(recentSpend / recentDays);
  // Tomorrow on: the owner's projected figure, else the budget, else the recent pace.
  const perDayProjected = a.spendPerDayCents !== null && Number.isFinite(a.spendPerDayCents) ? Math.max(0, r0(a.spendPerDayCents)) : dailyBudget ?? perDayRecent;
  const spendDates = [...spendByDay.keys()].sort();

  // ── trials and paying
  const trials = input.trials;
  const priced = trials.filter((t) => t.monthlyCents !== null);
  const maxMrr = priced.reduce((x, t) => x + (t.monthlyCents ?? 0), 0);
  const byBehaviour = priced.reduce((x, t) => x + r0((t.monthlyCents ?? 0) * t.chance), 0);
  const avgTrialMonthly = priced.length ? r0(maxMrr / priced.length) : 0;
  const payingMrr = input.paying.reduce((x, p) => x + p.monthlyCents, 0);
  // Revenue earned IN the period: an account paying from before the start day earns from the start day.
  const revenueToDate = input.paying.reduce((x, p) => x + r0((p.monthlyCents * Math.max(0, daysBetween(p.startedAt > since ? p.startedAt : since, today) + 1)) / 30), 0);
  // The period's own signups: the ads did not bring an account that was paying before the start day.
  const won = input.paying.filter((p) => !p.preexisting);
  const preexisting = input.paying.filter((p) => p.preexisting);
  const signups = trials.length + won.length + input.lapsed;
  const signupsPerDay = perDay([...trials.map((t) => t.createdAt), ...won.map((p) => p.signedUpAt ?? p.startedAt)].map(dayOf), since, today);
  const observedPaid = won.length;
  const observedDone = observedPaid + input.lapsed;

  // ── the curve
  const trialEnd = (t: TrialAccount) => {
    const end = t.endsAt ? dayOf(t.endsAt) : addDays(dayOf(t.createdAt), trialDays);
    // A trial past its end that is still a trial pays, if it pays, from today.
    return end < today ? today : end;
  };
  const curve: CurvePoint[] = [];
  let spendRun = 0;
  let allRun = 0;
  let realRun = 0;
  const last = addDays(today, horizon);
  const signupDates = [...trials.map((t) => dayOf(t.createdAt)), ...won.map((p) => dayOf(p.signedUpAt ?? p.startedAt))].sort();
  const futureCohorts: number[] = []; // monthly cents paying from each future day, all-pay basis
  for (let d = since; d <= last; d = addDays(d, 1)) {
    const projected = d > today;
    const spendDay = projected ? perDayProjected : (spendByDay.get(d) ?? 0);
    spendRun += spendDay;
    let allDay = 0;
    let realDay = 0;
    let payAll = 0;
    let payReal = 0;
    for (const p of input.paying) if (dayOf(p.startedAt) <= d) { allDay += p.monthlyCents; realDay += p.monthlyCents; payAll += 1; payReal += 1; }
    for (const t of trials) if (trialEnd(t) <= d) {
      payAll += 1;
      payReal += pct;
      if (t.monthlyCents !== null) { allDay += t.monthlyCents; realDay += t.monthlyCents * pct; }
    }
    let signupsSoFar = signupDates.filter((x) => x <= d).length;
    if (projected) {
      // Signups keep arriving at the recent pace; each day's cohort pays from the day its trial ends.
      futureCohorts.push(signupsPerDay * avgTrialMonthly);
      const payingCohorts = futureCohorts.length - trialDays;
      for (let i = 0; i < payingCohorts; i++) { allDay += futureCohorts[i]; realDay += futureCohorts[i] * pct; }
      if (payingCohorts > 0) { payAll += payingCohorts * signupsPerDay; payReal += payingCohorts * signupsPerDay * pct; }
      signupsSoFar += futureCohorts.length * signupsPerDay;
    }
    allRun += allDay / 30;
    realRun += realDay / 30;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    curve.push({
      date: d, spendCents: r0(spendRun), allPayCents: r0(allRun), realisticCents: r0(realRun), projected,
      spendDayCents: r0(spendDay), spendSource: projected ? "projected" : (spendSource.get(d) ?? "none"),
      mrrAllPayCents: r0(allDay), mrrRealisticCents: r0(realDay),
      payingAllPay: r1(payAll), payingRealistic: r1(payReal), signups: r1(signupsSoFar),
    });
  }
  const cross = totalSpend > 0 ? curve.find((p) => p.realisticCents >= p.spendCents && p.date >= today) ?? null : null;
  const breakEven = cross
    ? { date: cross.date, daysFromToday: daysBetween(today, cross.date), withinHorizon: true }
    : { date: null, daysFromToday: null, withinHorizon: false };

  const realisticMrr = r0(maxMrr * pct);
  const mrrRealistic = payingMrr + realisticMrr;
  // A cost needs both a spend and something to divide it by; without either there is no figure.
  const div = (n: number, d: number) => (n > 0 && d > 0 ? r0(n / d) : null);
  return {
    since,
    today,
    daysLive,
    spend: { totalCents: totalSpend, perDayRecentCents: perDayRecent, perDayProjectedCents: perDayProjected, daysWithSpend: spendDates.length, lastDate: spendDates.at(-1) ?? null, dailyBudgetCents: dailyBudget, budgetFrom, budgetDays, bookedDays: booked.size },
    visitors: input.visitors,
    signups,
    trials: { count: trials.length, priced: priced.length, maxMrrCents: maxMrr, realisticMrrCents: realisticMrr, byBehaviourMrrCents: byBehaviour, byBehaviourPct: maxMrr > 0 ? Math.round((byBehaviour / maxMrr) * 100) : null, avgMonthlyCents: avgTrialMonthly },
    paying: { count: input.paying.length, mrrCents: payingMrr, arrCents: payingMrr * 12, revenueToDateCents: revenueToDate, preexisting: preexisting.length, preexistingMrrCents: preexisting.reduce((x, p) => x + p.monthlyCents, 0) },
    lapsed: input.lapsed,
    observed: { paid: observedPaid, lapsed: input.lapsed, pct: observedDone > 0 ? Math.round((observedPaid / observedDone) * 100) : null },
    projected: { mrrAllPayCents: payingMrr + maxMrr, mrrRealisticCents: mrrRealistic, mrrByBehaviourCents: payingMrr + byBehaviour },
    unit: {
      costPerVisitorCents: input.visitors ? div(totalSpend, input.visitors) : null,
      costPerSignupCents: div(totalSpend, signups),
      costPerPayingRealisticCents: totalSpend > 0 && won.length + trials.length * pct > 0 ? r0(totalSpend / (won.length + trials.length * pct)) : null,
      visitorToSignupPct: input.visitors ? Math.round((signups / input.visitors) * 1000) / 10 : null,
      signupsPerDay: Math.round(signupsPerDay * 100) / 100,
      paybackMonths: mrrRealistic > 0 && totalSpend > 0 ? Math.round((totalSpend / mrrRealistic) * 10) / 10 : null,
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
export function cohortFigures(input: ModelInput, cohort: TrialCohort, whole: InvestorFigures = investorFigures(input)): CohortFigures {
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
    // The whole's spend is already filled by the budget; from tomorrow only today's cohort spends.
    assumptions: { ...input.assumptions, dailyBudgetCents: null, budgetFrom: null, spendPerDayCents: current ? whole.spend.perDayProjectedCents : 0 },
    visitors: null,
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

/** One sentence investors read first: when the ads pay for themselves. */
export function paybackSentence(f: InvestorFigures): string {
  if (f.spend.totalCents === 0) return "No ad spend is set yet — set the daily budget, or book the days — so there is nothing to recover.";
  const run = dollars(f.projected.mrrRealisticCents);
  if (f.breakEven.date && f.breakEven.daysFromToday !== null) {
    if (f.breakEven.daysFromToday <= 0) return `The ad spend to date (${dollars(f.spend.totalCents)}) is already covered by revenue at list price; the run rate is ${run} a month.`;
    return `At today's pace — ${dollars(f.spend.perDayProjectedCents)} a day on ads, ${f.unit.signupsPerDay} signups a day, ${Math.round(100 * (f.projected.mrrRealisticCents - f.paying.mrrCents) / Math.max(1, f.trials.maxMrrCents))}% of trials paying — the ads pay for themselves in ${f.breakEven.daysFromToday} days, on ${longDate(f.breakEven.date)}. Monthly revenue then runs at ${run} and up.`;
  }
  return `At today's pace the ads do not pay for themselves within ${f.curve.length - f.daysLive} days: ${dollars(f.spend.perDayProjectedCents)} a day goes out against ${run} a month of realistic revenue. Fewer dollars a day, more signups, or a higher share paying moves the date in.`;
}

export function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

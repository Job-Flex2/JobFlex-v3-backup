// THE INVESTOR FIGURES — FACTS ONLY (owner, 2026-10-17: "remove the assumptions; read the current spend; take out
// the money we spent while the free trials needed no card, show what the ads for the card trials cost — but count
// the paying users who came from the no-card trials; make it smart and understandable").
//
// Pure: the server gathers the rows (lib/investors) — the ad spend by day as Meta reports it, the accounts, the
// payments Stripe took — and this decides what they mean; the QA script pins every rule. Nothing here is guessed:
// no share of trials that "will" pay, no projected spend, no break-even date, no budget counted as spent. Every
// figure is something that happened, or one such thing divided by another.
//
// THE TWO KINDS OF TRIAL. For a few days in October 2026 a new signup could start a trial with no card (an
// experiment since ended). A day's ad spend went to whichever kind a visitor could start that day
// (noCardShareByDay); the no-card share is LEFT OUT of the spend, and the no-card trials are left out of the
// signups — but a no-card trial that went on to pay is a paying customer like any other and counts as one, named
// apart so a reader sees where it came from. The cost of a customer divides the counted spend by the customers that
// spend brought (the card trials that paid), so leaving the experiment's spend out never makes a customer cheaper.

/** Where an ad dollar went. Pure, so the admin page (a client component) can list it. */
export const PLATFORMS = ["meta", "google", "tiktok", "other"] as const;
export type SpendPlatform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<SpendPlatform, string> = { meta: "Meta (Facebook · Instagram)", google: "Google", tiktok: "TikTok", other: "Other" };

/** How a trial started (owner, 2026-10-13): with a card up front, or with no card (lib/trialState's record). */
export type TrialCohort = "card" | "nocard";
/** One flip of the owner's switch: from this day on, new signups got this. */
export interface PolicySpan {
  from: string;
  mode: TrialCohort;
}

/** One day's spend on one platform, as Meta reported it or as it was booked by hand. */
export interface SpendEntryIn {
  /** YYYY-MM-DD, in the page's zone. */
  date: string;
  cents: number;
  platform: SpendPlatform;
  source: "meta" | "manual";
}
/** Where a paying customer came from: a trial that took a card, a no-card trial that went on to pay, or an account
 *  already paying before the start day (owner, 2026-10-13: counted as paying, never as a signup of the period). */
export type PayingFrom = "card" | "nocard" | "before";
export interface PayingIn {
  /** The day it started paying, YYYY-MM-DD. */
  startedAt: string;
  /** Its plan's monthly price (a yearly plan as a twelfth). */
  monthlyCents: number;
  from: PayingFrom;
}
/** A trial still running. */
export interface TrialIn {
  createdAt: string;
  /** null = no price on record. */
  monthlyCents: number | null;
  cohort: TrialCohort;
}
/** One payment Stripe took for a subscription. */
export interface PaymentIn {
  date: string;
  cents: number;
}

export interface FactsInput {
  since: string;
  today: string;
  spend: SpendEntryIn[];
  /** Every counted signup — a trial, a paying account, a lapsed trial — by the day it signed up and how it started. */
  signups: Array<{ date: string; cohort: TrialCohort }>;
  policy: PolicySpan[];
  paying: PayingIn[];
  trials: TrialIn[];
  /** Trials that ended without paying, by how they started. */
  lapsed: Record<TrialCohort, number>;
  /** Unique visitors on the days the card trials ran (the no-card days out), when the analytics answered. */
  visitors: number | null;
  /** Subscription payments since the start day (Stripe); null = Stripe was not read. */
  payments: PaymentIn[] | null;
}

export interface SpendDayRow {
  date: string;
  /** Counted: the card trials' share of the day. */
  cents: number;
  /** The no-card trials' share of the day — left out. */
  leftOutCents: number;
  source: "meta" | "manual" | "mixed" | "none";
  /** Card-trial signups that day. */
  signups: number;
}

export interface SpendPeriod {
  key: "today" | "yesterday" | "week" | "last7" | "month" | "last30" | "all";
  label: string;
  cents: number;
  /** Days of the window on or after the start day. */
  days: number;
  perDayCents: number;
}

/** One day of the chart: running totals from the start day. */
export interface MoneyPoint {
  date: string;
  spentCents: number;
  collectedCents: number | null;
  paying: number;
  signups: number;
}

export interface InvestorFacts {
  since: string;
  today: string;
  daysLive: number;
  spend: {
    /** The counted ad spend: the card trials' share of every day since the start. */
    cents: number;
    perDayLast7Cents: number;
    /** The last day anything was spent on. */
    lastDay: string | null;
    /** Days whose figure is Meta's own, and days booked by hand. */
    metaDays: number;
    handDays: number;
    days: SpendDayRow[];
    periods: SpendPeriod[];
    byPlatform: Array<{ platform: SpendPlatform; label: string; cents: number; days: number }>;
  };
  /** The no-card experiment: its days' spend, left out; its signups, left out; its paying customers, counted. */
  leftOut: { cents: number; days: number; from: string | null; to: string | null; signups: number; paid: number; paidMrrCents: number };
  visitors: number | null;
  /** Card-trial signups since the start: still on trial, paying, or lapsed. */
  signups: number;
  signupsLast7: number;
  /** Card trials still running, and what their plans add up to a month. */
  onTrial: { count: number; priced: number; listMrrCents: number };
  /** Card trials that have ended: paid or lapsed. */
  ended: { paid: number; lapsed: number; pct: number | null };
  paying: { count: number; card: number; nocard: number; before: number; mrrCents: number; arrCents: number; cardMrrCents: number; nocardMrrCents: number; beforeMrrCents: number; avgMonthlyCents: number };
  /** What Stripe took for subscriptions since the start, against the counted spend. */
  collected: { cents: number; payments: number; recoveredPct: number | null } | null;
  unit: {
    perVisitorCents: number | null;
    perSignupCents: number | null;
    /** Counted spend ÷ the customers it brought (card trials that paid). */
    perPayingCents: number | null;
    visitorToSignupPct: number | null;
    /** Months for one such customer's payments to cover what the ads spent to win them. */
    paybackMonths: number | null;
  };
  chart: MoneyPoint[];
}

const DAY_MS = 86_400_000;
export const dayOf = (iso: string) => iso.slice(0, 10);
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => toDate(toMs(date) + n * DAY_MS);
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY_MS);
const r0 = (n: number) => Math.round(n);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every day from `from` to `to`, inclusive. */
export function daysFrom(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 3660; d = addDays(d, 1)) out.push(d);
  return out;
}

/* ── WHICH KIND OF TRIAL A DAY'S SPEND WENT TO (owner, 2026-10-13) ───────────────────────────────────────────
   Where the owner's switch is recorded (lib/trialPolicyServer keeps its flips from 2026-10-13), the day follows the
   switch; before that, the day follows who signed up on it — all no-card signups, the whole day; a mix, in
   proportion — and a day with no signups follows the nearest day that had some (earlier first). */

/** The share (0–1) of each day's spend that went to no-card trials. */
export function noCardShareByDay(days: readonly string[], signups: ReadonlyArray<{ date: string; cohort: TrialCohort }>, policy: readonly PolicySpan[]): Map<string, number> {
  const spans = [...policy].filter((p) => DATE.test(p.from)).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
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
  const known = [...byDay.keys()].sort();
  const out = new Map<string, number>();
  for (const d of [...days].sort()) {
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
    const near = known.filter((k) => k < d).at(-1) ?? known.find((k) => k > d);
    out.set(d, near ? (ofSignups(near) ?? 0) : 0);
  }
  return out;
}

/** The days that went wholly to no-card trials — the visitor count leaves them out, as the spend does. */
export function noCardDays(since: string, today: string, signups: ReadonlyArray<{ date: string; cohort: TrialCohort }>, policy: readonly PolicySpan[]): string[] {
  const share = noCardShareByDay(daysFrom(since, today), signups, policy);
  return [...share].filter(([, v]) => v >= 1).map(([d]) => d);
}

/** THE SPEND BY PERIOD (owner, 2026-10-08: "live spending per day, per week, per month"). The week starts on
 *  Monday; "days" is how many days of the window fall on or after the start day, so the per-day figure is honest
 *  in a young window. */
export function spendPeriods(days: ReadonlyArray<{ date: string; cents: number }>, today: string): SpendPeriod[] {
  const booked = days.filter((p) => p.date <= today);
  const since = booked[0]?.date ?? today;
  const sum = (from: string, to: string) => {
    const inWindow = booked.filter((p) => p.date >= from && p.date <= to);
    const cents = inWindow.reduce((x, p) => x + p.cents, 0);
    return { cents, days: inWindow.length, perDayCents: inWindow.length ? r0(cents / inWindow.length) : 0 };
  };
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sunday
  const monday = addDays(today, -((dow + 6) % 7));
  const first = `${today.slice(0, 8)}01`;
  const yesterday = addDays(today, -1);
  const mk = (key: SpendPeriod["key"], label: string, from: string, to: string): SpendPeriod => ({ key, label, ...sum(from < since ? since : from, to) });
  return [
    mk("today", "Today, so far", today, today),
    mk("yesterday", "Yesterday", yesterday, yesterday),
    mk("week", "This week", monday, today),
    mk("last7", "Last 7 days", addDays(today, -6), today),
    mk("month", "This month", first, today),
    mk("last30", "Last 30 days", addDays(today, -29), today),
    mk("all", "Since the start", since, today),
  ];
}

export function investorFacts(input: FactsInput): InvestorFacts {
  const { since, today } = input;
  const days = daysFrom(since, today);
  const daysLive = Math.max(1, days.length);
  const share = noCardShareByDay(days, input.signups, input.policy);

  // ── the spend, day by day: what was booked (Meta's figure, or by hand), split by the kind of trial it went to
  const entries = input.spend.filter((e) => e.date >= since && e.date <= today && Number.isFinite(e.cents) && e.cents >= 0);
  const cardSignupsByDay = new Map<string, number>();
  for (const s of input.signups) if (s.cohort === "card") cardSignupsByDay.set(s.date, (cardSignupsByDay.get(s.date) ?? 0) + 1);
  const platformCents = new Map<SpendPlatform, { cents: number; days: Set<string> }>();
  const rows: SpendDayRow[] = days.map((date) => {
    const mine = entries.filter((e) => e.date === date);
    const sh = share.get(date) ?? 0;
    let cents = 0;
    let leftOutCents = 0;
    for (const e of mine) {
      const counted = r0(e.cents * (1 - sh));
      cents += counted;
      leftOutCents += e.cents - counted;
      if (counted > 0) {
        const p = platformCents.get(e.platform) ?? { cents: 0, days: new Set<string>() };
        p.cents += counted;
        p.days.add(date);
        platformCents.set(e.platform, p);
      }
    }
    const sources = new Set(mine.map((e) => e.source));
    const source: SpendDayRow["source"] = sources.size === 0 ? "none" : sources.size > 1 ? "mixed" : sources.has("meta") ? "meta" : "manual";
    return { date, cents, leftOutCents, source, signups: cardSignupsByDay.get(date) ?? 0 };
  });
  const spendCents = rows.reduce((x, r) => x + r.cents, 0);
  const last7 = rows.filter((r) => r.date >= addDays(today, -6));
  const leftRows = rows.filter((r) => r.leftOutCents > 0);
  const nocardSignupDates = input.signups.filter((s) => s.cohort === "nocard").map((s) => s.date).sort();
  const span = leftRows.length ? [leftRows[0].date, leftRows.at(-1)!.date] : [nocardSignupDates[0] ?? null, nocardSignupDates.at(-1) ?? null];

  // ── the accounts
  const card = input.paying.filter((p) => p.from === "card");
  const nocard = input.paying.filter((p) => p.from === "nocard");
  const before = input.paying.filter((p) => p.from === "before");
  const sum = (xs: PayingIn[]) => xs.reduce((x, p) => x + p.monthlyCents, 0);
  const mrr = sum(input.paying);
  const cardTrials = input.trials.filter((t) => t.cohort === "card");
  const priced = cardTrials.filter((t) => t.monthlyCents !== null);
  const signups = cardTrials.length + card.length + input.lapsed.card;
  const signupsLast7 = input.signups.filter((s) => s.cohort === "card" && s.date >= addDays(today, -6) && s.date <= today).length;
  const endedDone = card.length + input.lapsed.card;

  // ── the money in: Stripe's payments since the start day
  const payments = input.payments === null ? null : input.payments.filter((p) => p.date >= since && p.date <= today && p.cents > 0);
  const collectedCents = payments ? payments.reduce((x, p) => x + p.cents, 0) : 0;

  // ── the chart: running totals, one point a day
  let spentRun = 0;
  let collectedRun = 0;
  let signupRun = 0;
  const payByDay = new Map<string, number>();
  for (const p of payments ?? []) payByDay.set(p.date, (payByDay.get(p.date) ?? 0) + p.cents);
  const chart: MoneyPoint[] = rows.map((r) => {
    spentRun += r.cents;
    collectedRun += payByDay.get(r.date) ?? 0;
    signupRun += r.signups;
    return {
      date: r.date,
      spentCents: spentRun,
      collectedCents: payments ? collectedRun : null,
      paying: input.paying.filter((p) => p.from === "before" || p.startedAt <= r.date).length,
      signups: signupRun,
    };
  });

  // A unit cost needs both a cost and something to divide it by; without either there is no figure.
  const div = (n: number, d: number) => (n > 0 && d > 0 ? r0(n / d) : null);
  const perPaying = div(spendCents, card.length);
  const cardAvg = card.length ? sum(card) / card.length : 0;
  return {
    since,
    today,
    daysLive,
    spend: {
      cents: spendCents,
      perDayLast7Cents: last7.length ? r0(last7.reduce((x, r) => x + r.cents, 0) / last7.length) : 0,
      lastDay: [...rows].reverse().find((r) => r.cents > 0)?.date ?? null,
      metaDays: rows.filter((r) => r.source === "meta" || r.source === "mixed").length,
      handDays: rows.filter((r) => r.source === "manual").length,
      days: rows,
      periods: spendPeriods(rows, today),
      byPlatform: PLATFORMS.filter((p) => (platformCents.get(p)?.cents ?? 0) > 0).map((p) => ({ platform: p, label: PLATFORM_LABEL[p], cents: platformCents.get(p)!.cents, days: platformCents.get(p)!.days.size })),
    },
    leftOut: { cents: leftRows.reduce((x, r) => x + r.leftOutCents, 0), days: leftRows.length, from: span[0], to: span[1], signups: nocardSignupDates.length, paid: nocard.length, paidMrrCents: sum(nocard) },
    visitors: input.visitors,
    signups,
    signupsLast7,
    onTrial: { count: cardTrials.length, priced: priced.length, listMrrCents: priced.reduce((x, t) => x + (t.monthlyCents ?? 0), 0) },
    ended: { paid: card.length, lapsed: input.lapsed.card, pct: endedDone > 0 ? Math.round((card.length / endedDone) * 100) : null },
    paying: { count: input.paying.length, card: card.length, nocard: nocard.length, before: before.length, mrrCents: mrr, arrCents: mrr * 12, cardMrrCents: sum(card), nocardMrrCents: sum(nocard), beforeMrrCents: sum(before), avgMonthlyCents: input.paying.length ? r0(mrr / input.paying.length) : 0 },
    collected: payments ? { cents: collectedCents, payments: payments.length, recoveredPct: spendCents > 0 ? Math.round((collectedCents / spendCents) * 100) : null } : null,
    unit: {
      perVisitorCents: input.visitors ? div(spendCents, input.visitors) : null,
      perSignupCents: div(spendCents, signups),
      perPayingCents: perPaying,
      visitorToSignupPct: input.visitors ? Math.round((signups / input.visitors) * 1000) / 10 : null,
      paybackMonths: perPaying !== null && cardAvg > 0 ? Math.round((perPaying / cardAvg) * 10) / 10 : null,
    },
    chart,
  };
}

/** "$1,234" — whole dollars; cents only under ten dollars. */
export function dollars(cents: number): string {
  const d = cents / 100;
  return `$${d.toLocaleString("en-US", { maximumFractionDigits: d > 0 && d < 10 ? 2 : 0, minimumFractionDigits: 0 })}`;
}

export function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** What the page says first, in plain sentences, every number a fact. */
export function factsLines(f: InvestorFacts): string[] {
  if (f.spend.cents === 0) return [`No ad spend is on record since ${longDate(f.since)} yet.`];
  const lines: string[] = [];
  const brought = f.visitors !== null ? `${count(f.visitors, "visitor", "visitors")} and ${count(f.signups, "trial signup", "trial signups")}` : count(f.signups, "trial signup", "trial signups");
  lines.push(`Since ${longDate(f.since)} the ads have cost ${dollars(f.spend.cents)} and brought ${brought}.`);
  if (f.paying.count > 0) {
    const pay = `${count(f.paying.count, "customer pays", "customers pay")} ${dollars(f.paying.mrrCents)} a month — ${dollars(f.paying.arrCents)} a year`;
    lines.push(f.collected ? `${pay}; ${dollars(f.collected.cents)} has been paid so far${f.collected.recoveredPct !== null ? `, ${f.collected.recoveredPct}% of the ad spend` : ""}.` : `${pay}.`);
  } else lines.push("No customer pays yet.");
  if (f.unit.perPayingCents !== null && f.unit.paybackMonths !== null) {
    lines.push(`A customer from the ads cost ${dollars(f.unit.perPayingCents)} to win and pays ${dollars(Math.round(f.paying.cardMrrCents / Math.max(1, f.paying.card)))} a month: the ads behind each one are paid back in ${f.unit.paybackMonths} ${f.unit.paybackMonths === 1 ? "month" : "months"}.`);
  }
  return lines;
}

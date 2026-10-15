// SPENT ON ADS TODAY (owner, 2026-10-15: "next to visitors today and signed up
// today, how much is already spent today on the ads"). Pure and client-safe:
// the rule the traffic page's tile reads, so it can be checked without a database.
//
// Where the figure comes from, in order:
//   meta    — Meta's own number for today, when Meta was read today (lib/metaAdSpend
//             keeps one entry per day; other platforms booked by hand are added);
//   manual  — Meta not read today (or not connected) but spend booked for today on
//             /admin/investors;
//   budget  — nothing booked and Meta not connected: the daily budget, said as a
//             budget, never as money already gone;
//   none    — nothing to go on.
// `cents: null` means no figure for today yet — never a fake $0.

export type AdSpendSource = "meta" | "manual" | "budget" | "none";

export interface AdSpendToday {
  cents: number | null;
  source: AdSpendSource;
  /** When Meta was last read (ISO), for the "as of" time. */
  asOf: string | null;
  /** Meta's last error, when the last read failed. */
  error: string | null;
}

export interface SpendTodayInput {
  entries: ReadonlyArray<{ date: string; cents: number; source: "manual" | "meta" }>;
  /** YYYY-MM-DD in the traffic page's zone. */
  today: string;
  metaConnected: boolean;
  lastPulledAt: string | null;
  /** The day (same zone) Meta was last read, or null. */
  lastPulledDay: string | null;
  lastError: string | null;
  dailyBudgetCents: number | null;
  budgetFrom: string | null;
}

export function spendTodayFrom(i: SpendTodayInput): AdSpendToday {
  const todays = i.entries.filter((e) => e.date === i.today);
  const sum = (xs: typeof todays) => xs.reduce((n, e) => n + Math.max(0, Math.round(e.cents)), 0);
  const manual = todays.filter((e) => e.source === "manual");
  if (i.metaConnected && i.lastPulledDay === i.today) {
    // Meta lists no row for a day with no spend: read today, that is its word — zero.
    return { cents: sum(todays), source: "meta", asOf: i.lastPulledAt, error: null };
  }
  if (manual.length) return { cents: sum(manual), source: "manual", asOf: i.lastPulledAt, error: i.metaConnected ? i.lastError : null };
  if (i.metaConnected) return { cents: null, source: "meta", asOf: i.lastPulledAt, error: i.lastError };
  if (i.dailyBudgetCents && i.dailyBudgetCents > 0 && (!i.budgetFrom || i.budgetFrom <= i.today)) {
    return { cents: i.dailyBudgetCents, source: "budget", asOf: null, error: null };
  }
  return { cents: null, source: "none", asOf: null, error: null };
}

/** Ad spend per signup that came from an ad; null when either side is zero or unknown. */
export function perAdSignupCents(cents: number | null, adSignups: number): number | null {
  return cents && cents > 0 && adSignups > 0 ? Math.round(cents / adSignups) : null;
}

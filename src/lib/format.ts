export function money(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
}

/**
 * Dates a server renders and a browser hydrates must come out the same on
 * both, so a caller that renders on both passes the clock and zone it means:
 * `timeZone` (a server on UTC and a desk in Pacific otherwise disagree on an
 * evening's day) and, for `relative`, `now` read once on the server. Left out,
 * each reads the running machine's own — fine for a page drawn in one place.
 */
export type DateOpts = { timeZone?: string };
export type RelativeOpts = DateOpts & { now?: number };

export function shortDate(d: Date | string | null | undefined, opts: DateOpts = {}) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: opts.timeZone }).format(new Date(d));
}

export function longDate(d: Date | string | null | undefined, opts: DateOpts = {}) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: opts.timeZone,
  }).format(new Date(d));
}

export function relative(d: Date | string, opts: RelativeOpts = {}) {
  const diff = ((opts.now ?? Date.now()) - new Date(d).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return shortDate(d, opts);
}

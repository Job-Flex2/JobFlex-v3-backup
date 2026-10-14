// THE OFFICE SCREEN (owner, 2026-10-13: "make office screen for admin — what is going on today with users, with stats,
// what's new and more, super smart … API health, statuses … we will put it on TV").
//
// /admin/office is a wall board: today against yesterday at this same clock time, who is in the app now, what happened
// today as it happened, what needs a person, the trials and the money, and the systems. This file is the PURE half —
// the shapes, the feed's order, and the rules that turn the day's facts into "needs you" lines — so
// scripts/qa/office-screen.check.ts holds them without a database. lib/officeScreenRead gathers the facts.

export type OfficeTone = "bad" | "warn" | "info" | "good";

/** One number on the board: today so far, and yesterday by this time (null when there is no fair comparison). */
export interface OfficeTile {
  key: string;
  label: string;
  today: number;
  yesterday: number | null;
  /** A second line: "card 2 · no card 1", "$4,180 accepted". */
  sub?: string;
  /** Today is money (whole dollars). */
  money?: boolean;
  /** The source could not be read (PostHog off): a dash, never a false zero. */
  missing?: boolean;
}

export type OfficeFeedKind = "signup" | "paid" | "card" | "cancel" | "proposal" | "first" | "sent" | "opened" | "accepted" | "estimate" | "lead" | "support";

export interface OfficeFeedItem {
  at: number;
  kind: OfficeFeedKind;
  /** The company (or the homeowner's town for a request). */
  who: string;
  text: string;
  /** A win worth a second look on the wall. */
  win?: boolean;
}

export interface OfficeOnline {
  name: string;
  company: string;
  screen: string;
  at: number;
}

export interface OfficeAttention {
  tone: OfficeTone;
  text: string;
  /** Names, when the line is about a few accounts. */
  who?: string[];
}

export interface OfficeHealthRow {
  name: string;
  level: "ok" | "degraded" | "down" | "off";
  reason: string;
  optional: boolean;
}

export interface OfficeScreenData {
  now: number;
  tz: string;
  dayStart: number;
  tiles: OfficeTile[];
  /** The quieter numbers under the big ones. */
  strip: OfficeTile[];
  online: OfficeOnline[];
  /** People in the app today (logged in, any page). */
  activeToday: number;
  feed: OfficeFeedItem[];
  attention: OfficeAttention[];
  trials: {
    onTrial: number;
    card: number;
    nocard: number;
    endsToday: number;
    endsTomorrow: number;
    setToCancel: number;
    paying: number;
    /** Monthly from paying accounts, at their plan prices. */
    payingMonthlyCents: number;
    /** What the running trials are likely worth a month (the trial board's projection). */
    likelyCents: number;
  };
  health: { ranAt: string; worst: OfficeHealthRow["level"]; services: OfficeHealthRow[] } | null;
  /** Fourteen days, oldest first, today last. */
  spark: { days: number[]; signups: number[]; proposals: number[] };
  /** What could not be read this time (PostHog off, a table missing) — said small on the wall, never a crash. */
  gaps: string[];
}

/** Newest first, at most `limit`; two lines about the same thing at the same minute keep the more telling one. */
export function orderFeed(items: readonly OfficeFeedItem[], limit = 30): OfficeFeedItem[] {
  const rank: Record<OfficeFeedKind, number> = { first: 9, paid: 8, accepted: 7, signup: 6, card: 5, sent: 4, lead: 4, estimate: 3, opened: 3, proposal: 2, support: 2, cancel: 2 };
  const seen = new Map<string, OfficeFeedItem>();
  for (const it of items) {
    const key = `${it.who}|${Math.floor(it.at / 60_000)}|${it.kind === "first" || it.kind === "proposal" ? "made" : it.kind}`;
    const had = seen.get(key);
    if (!had || rank[it.kind] > rank[had.kind]) seen.set(key, it);
  }
  return [...seen.values()].sort((a, b) => b.at - a.at).slice(0, limit);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const hoursWords = (ms: number) => {
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  return h === 1 ? "an hour" : `${h} hours`;
};

/** The facts the "needs you" lines are made from. */
export interface AttentionFacts {
  now: number;
  dayStart: number;
  trialsEndingToday: { name: string; proposals: number; card: boolean }[];
  trialsEndingTomorrow: number;
  failedPayments: string[];
  setToCancelCard: string[];
  /** Today's signups: when, and whether they came back after signing up. */
  signupsToday: { name: string; at: number; lastSeen: number | null; views: number }[];
  supportUnread: number;
  supportOldest: number | null;
  leadQueue: number;
  health: OfficeHealthRow[];
  visitors: { today: number; yesterday: number } | null;
  sentToday: number;
  sentYesterday: number;
}

/**
 * The lines a person should act on, worst first. Each says what, who, and the reason in one breath; nothing is said
 * that the board's numbers do not show (a quiet morning is not an alarm — a day well behind yesterday by now is).
 */
export function buildAttention(f: AttentionFacts): OfficeAttention[] {
  const out: OfficeAttention[] = [];
  const downs = f.health.filter((s) => !s.optional && s.level === "down");
  for (const s of downs) out.push({ tone: "bad", text: `${s.name} is down — ${s.reason}` });
  if (f.failedPayments.length) out.push({ tone: "bad", text: `${plural(f.failedPayments.length, "payment")} failed — the card was declined`, who: f.failedPayments });
  const idleEnding = f.trialsEndingToday.filter((t) => t.proposals === 0);
  if (f.trialsEndingToday.length) {
    out.push({
      tone: idleEnding.length ? "warn" : "info",
      text: `${plural(f.trialsEndingToday.length, "trial")} end${f.trialsEndingToday.length === 1 ? "s" : ""} today${idleEnding.length ? ` — ${idleEnding.length === f.trialsEndingToday.length ? (idleEnding.length === 1 ? "no proposal made yet" : "none has made a proposal") : `${idleEnding.length} without a proposal`}` : ""}`,
      who: f.trialsEndingToday.map((t) => `${t.name}${t.card ? " · card" : " · no card"}`),
    });
  }
  if (f.setToCancelCard.length) out.push({ tone: "warn", text: `${plural(f.setToCancelCard.length, "trial")} with a card set to cancel at the end`, who: f.setToCancelCard });
  if (f.supportUnread > 0) {
    out.push({ tone: f.supportOldest != null && f.now - f.supportOldest > 4 * 3_600_000 ? "warn" : "info", text: `${plural(f.supportUnread, "support message")} unread${f.supportOldest != null ? ` — oldest ${hoursWords(f.now - f.supportOldest)} ago` : ""}` });
  }
  if (f.leadQueue > 0) out.push({ tone: "warn", text: `${plural(f.leadQueue, "homeowner request")} waiting to be matched by hand` });
  // A signup that never came back: two hours on, nothing after the first ten minutes.
  const gone = f.signupsToday.filter((s) => f.now - s.at >= 2 * 3_600_000 && (s.lastSeen == null || s.lastSeen - s.at < 10 * 60_000));
  if (gone.length) out.push({ tone: "info", text: `${plural(gone.length, "signup")} from today ${gone.length === 1 ? "hasn't" : "haven't"} come back — a hello helps`, who: gone.map((s) => s.name) });
  const degraded = f.health.filter((s) => !s.optional && s.level === "degraded");
  for (const s of degraded) out.push({ tone: "warn", text: `${s.name}: ${s.reason}` });
  if (f.trialsEndingTomorrow > 0) out.push({ tone: "info", text: `${plural(f.trialsEndingTomorrow, "trial")} end${f.trialsEndingTomorrow === 1 ? "s" : ""} tomorrow` });
  // Behind yesterday by now — only on a day with enough to compare.
  if (f.visitors && f.visitors.yesterday >= 20 && f.visitors.today < f.visitors.yesterday * 0.6) {
    out.push({ tone: "warn", text: `Website visitors are ${Math.round((1 - f.visitors.today / f.visitors.yesterday) * 100)}% behind yesterday at this time` });
  }
  if (f.sentToday === 0 && f.sentYesterday >= 3 && f.now - f.dayStart > 12 * 3_600_000) out.push({ tone: "info", text: `No proposals sent yet today — ${f.sentYesterday} by now yesterday` });
  const order: Record<OfficeTone, number> = { bad: 0, warn: 1, info: 2, good: 3 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

/** "+3 vs yesterday", "same as yesterday", "−40%": the comparison under a number. Null without one. */
export function deltaWords(today: number, yesterday: number | null, money = false): { text: string; dir: "up" | "down" | "flat" } | null {
  if (yesterday == null) return null;
  const d = today - yesterday;
  if (d === 0) return { text: "same as yesterday", dir: "flat" };
  const amount = money ? `$${Math.abs(Math.round(d)).toLocaleString("en-US")}` : Math.abs(d).toLocaleString("en-US");
  return { text: `${d > 0 ? "+" : "−"}${amount} vs yesterday`, dir: d > 0 ? "up" : "down" };
}

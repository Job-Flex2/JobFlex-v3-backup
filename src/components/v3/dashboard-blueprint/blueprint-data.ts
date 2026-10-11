// Blueprint dashboard — the shape of everything the sheet paints.
//
// This file used to hold the donor's demo arrays (a fixed week of jobs, a fixed
// activity feed, thirteen invented leads and three hand-written revenue
// series). The page is no longer a fixture: `src/app/dashboard/page.tsx` reads
// the real org aggregates and hands them in through `initDashboardContent`, so
// what survives here are the TYPES that contract is written in, the stage list,
// and the two pure helpers the page needs to describe a chart axis the donor's
// renderer can draw.

import type { WhoLike } from "@/lib/team/who";
import type { FirstEstimateTarget } from "@/lib/firstEstimate";

/** One scheduled block in the This Week card. `m` is minutes-from-midnight,
 *  which is what the day list sorts on. */
export type WeekEvent = { m: number; t: string; title: string };

/** One cell of the seven-day strip. `has` drives the dot under the number. */
export type WeekDay = { iso: string; num: number; lbl: string; today: boolean; has: boolean };

/** One row of Upcoming Jobs. `st` is the donor's two-state chip. */
export type JobRow = {
  id: string;
  date: string;
  title: string;
  sub: string;
  st: "ok" | "wait";
  today: boolean;
};

/** One line of Recent Activity. `i` is a sprite symbol id (`i-file`, …).
 *  `who` is the member who did it — null for the system's own doing,
 *  `{id:null,name:"Client"}` for a client's portal click. `mine` is set on the
 *  server from the signed-in user's id: the reader's own rows carry no author
 *  mark, and neither do the system's (owner, 2026-09-26). */
export type ActivityRow = { i: string; t: string; m: string; who: WhoLike | null; mine: boolean };

/** One card on the Lead Flow board. `stage` is a lowercase `LEAD_STAGES` key —
 *  the uppercase form is the database's `Lead.status`. */
export type BoardLead = {
  id: string;
  stage: string;
  name: string;
  job: string;
  city: string;
  owner: string | null;
  age: string;
};

export type ChartDataset = {
  labels: string[];
  values: number[];
  yMax: number;
  ticks: string[];
};

export type ChartRange = "7d" | "30d" | "90d";

/** What the Lead Center banner is nagging about. `null` when the org is
 *  already matchable, or the viewer is not an owner/admin. A matchable org has
 *  all three: a set-up company, a geocoded address, and at least one trade. */
export type LeadProfileGap = {
  needsCompany: boolean;
  needsAddress: boolean;
  needsTrades: boolean;
  /** The company name is still the passwordless sign-up's stand-in (lib/orgName). */
  needsName?: boolean;
};

/** Only the name is missing: the banner speaks of clients, not leads. */
export function leadProfileNameOnly(gap: LeadProfileGap): boolean {
  return Boolean(gap.needsName) && !gap.needsAddress && !gap.needsTrades;
}

/** "Complete your profile" opens the company page — on the name field when that is missing. */
export function leadProfileHref(gap: LeadProfileGap): string {
  return gap.needsName ? "/dashboard/company#company-name" : "/dashboard/company";
}

/**
 * "your company details, your business address and the trades you take" — the
 * banner names what is actually missing, and has to read as English for one,
 * two or three pieces. Both editions build the sentence here so the phone and
 * the desktop sheet can never word the same gap differently.
 */
export function leadProfileMissing(gap: LeadProfileGap): string {
  const parts: string[] = [];
  if (gap.needsName) parts.push("your company name");
  else if (gap.needsCompany) parts.push("your company details");
  if (gap.needsAddress) parts.push("your business address");
  if (gap.needsTrades) parts.push("the trades you take");
  if (parts.length < 2) return parts[0] ?? "";
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

/** The whole page, read server-side. Every region on the sheet is filled from
 *  this — there is no local seed left to fall back to. */
export type DashboardData = {
  /** "Good Evening · Jul 22" — built on the server's clock. */
  greeting: string;
  /** The signed-in identity. The desktop sidebar reads its own copy from the
   *  layout; the handheld build replaces the whole shell, so its drawer footer
   *  has no other source and used to print the donor's "Ivan / Owner". */
  viewer: { name: string; role: string };
  leadProfile: LeadProfileGap | null;
  /** The first-run card (landing-e pass A, 2026-09-11): a variant-e shop with
   *  no estimate yet gets one card with one button, by trade; null otherwise
   *  and after the first estimate. */
  firstRun: FirstEstimateTarget | null;
  kpis: { revenue: string; pipeline: string; openProposals: string; newLeads: string };
  /** The same four figures unformatted. The handheld build counts them up and
   *  compacts them ("$132K"), which it cannot do from a formatted string
   *  without parsing money back out of it. */
  kpiRaw: { revenue: number; pipeline: number; openProposals: number; newLeads: number };
  chart: Record<ChartRange, ChartDataset>;
  activities: ActivityRow[];
  week: {
    /** "Jul 19 – 25" */
    range: string;
    scheduled: number;
    days: WeekDay[];
    /** Keyed by the same `iso` the days carry. */
    events: Record<string, WeekEvent[]>;
    todayIso: string;
  };
  jobs: JobRow[];
  leads: BoardLead[];
};

/** The five columns of the dashboard's Lead Flow board. The leads page owns the
 *  full seven (WON / LOST land there); this board is the live pipeline only. */
export const LEAD_STAGES = ["new", "routed", "claimed", "contacted", "quoted"] as const;

/** `Lead.status` values the board columns above accept, in column order. */
export const BOARD_STATUSES = ["NEW", "ROUTED", "CLAIMED", "CONTACTED", "QUOTED"] as const;

/** ActivityEvent.kind → sprite symbol. The kinds are the ones the server
 *  actions actually write (see `db.activityEvent.create` across src/actions).
 *  Anything unrecognised falls back to the generic document mark. */
const ACTIVITY_ICONS: Record<string, string> = {
  SENT: "i-send",
  VIEWED: "i-file",
  ACCEPTED: "i-check",
  COMPLETED: "i-check",
  DECLINED: "i-ban",
  CREATED: "i-plus",
  UPDATED: "i-pen",
  EDITED: "i-pen",
  DELETED: "i-trash",
  NOTE: "i-msg",
  EMAIL: "i-msg",
  CALL: "i-phone",
  SCHEDULED: "i-cal",
  JOB: "i-jobs",
  BEFORE: "i-imgadd",
  PASSWORD_RESET: "i-user",
};

export function activityIcon(kind: string): string {
  return ACTIVITY_ICONS[kind] ?? "i-file";
}

/** "SENT" → "Sent", so the meta line reads "Sent · 25m ago" like the donor. */
export function activityLabel(kind: string): string {
  return kind.charAt(0) + kind.slice(1).toLowerCase().replace(/_/g, " ");
}

/**
 * The donor's y-axis is five labels at a fixed pixel ladder — top, three
 * quarters, half, one quarter, zero — so the axis is described entirely by one
 * "nice" quarter step. Pick the smallest 1 / 1.5 / 2 / 2.5 / 5 × 10ⁿ step whose
 * four multiples clear the series maximum.
 */
function niceQuarter(max: number): number {
  if (!(max > 0)) return 1000; // an org with no revenue still gets a $0–$4K frame
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const s of [1, 1.5, 2, 2.5, 5]) {
    if (mag * s >= raw) return mag * s;
  }
  return mag * 10;
}

/** The donor's tick strings: "$8K", "$7.5K", "$800", and a bare "$0" at the
 *  bottom (never "$0K"). */
function tickLabel(v: number): string {
  if (v <= 0) return "$0";
  if (v >= 1000) {
    const k = Math.round((v / 1000) * 10) / 10;
    return "$" + (Number.isInteger(k) ? String(k) : k.toFixed(1)) + "K";
  }
  return "$" + Math.round(v);
}

/** Wrap a real series in the axis the donor's chart renderer expects. */
export function makeDataset(labels: string[], values: number[]): ChartDataset {
  const q = niceQuarter(values.length ? Math.max(...values) : 0);
  return {
    labels,
    values,
    yMax: q * 4,
    ticks: [4, 3, 2, 1, 0].map((n) => tickLabel(q * n)),
  };
}

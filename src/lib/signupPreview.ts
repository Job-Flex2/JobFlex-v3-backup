/* THE APP BEHIND THE SIGN-UP (owner, 2026-10-22, lib/signupView): what the overview shows in the preview — sample
   work for the trade the visitor came in on, so a roofer sees roofs and a fence shop sees fences. Every name and
   number here is made up and the overview says "sample" on it; the preview never reads a real account. Pure. */
import type { TradeType } from "@/lib/tradeTypes";

export type PreviewIcon = "check" | "send" | "lead" | "cal";
export interface PreviewActivity { icon: PreviewIcon; text: string; meta: string }
export interface PreviewJob { inDays: number; title: string; time: string; who: string; status: "Confirmed" | "Scheduled" }
export interface PreviewPack {
  revenue: number;
  pipeline: number;
  open: number;
  leads: number;
  /** Seven days of revenue, the last one today. */
  trend: number[];
  activity: PreviewActivity[];
  jobs: PreviewJob[];
  /** The lead that arrives a few seconds in. */
  toast: { title: string; meta: string };
}

type PackId = "roof" | "exterior" | "hvac" | "fence" | "deck" | "remodel" | "outdoor" | "service" | "paint";

const PACKS: Record<PackId, PreviewPack> = {
  roof: {
    revenue: 52840, pipeline: 148300, open: 9, leads: 6,
    trend: [4200, 6100, 2900, 8400, 5600, 9800, 7300],
    activity: [
      { icon: "check", text: "The Parkers accepted “Roof replacement — 26 squares”", meta: "Accepted · 12 min ago" },
      { icon: "send", text: "Sent “Gutters and guards — 180 ft” to Jordan Lee", meta: "Sent · 1h ago" },
      { icon: "lead", text: "New lead: storm damage inspection, 2.4 mi away", meta: "Lead · 2h ago" },
      { icon: "cal", text: "Crew booked for the Parker roof", meta: "Scheduled · 3h ago" },
    ],
    jobs: [
      { inDays: 1, title: "Roof replacement", time: "7:30 AM", who: "The Parkers", status: "Confirmed" },
      { inDays: 2, title: "Gutters and guards", time: "1:00 PM", who: "Jordan Lee", status: "Scheduled" },
      { inDays: 4, title: "Leak repair", time: "9:00 AM", who: "M. Alvarez", status: "Scheduled" },
    ],
    toast: { title: "New lead · Roof replacement", meta: "Hail damage · 3.1 mi away" },
  },
  exterior: {
    revenue: 47600, pipeline: 139800, open: 8, leads: 5,
    trend: [3800, 5200, 4100, 7600, 3900, 8800, 6900],
    activity: [
      { icon: "check", text: "Jordan Lee accepted “Siding — 2,100 sq ft”", meta: "Accepted · 18 min ago" },
      { icon: "send", text: "Sent “Window replacement — 14 windows” to the Parkers", meta: "Sent · 1h ago" },
      { icon: "lead", text: "New lead: drafty windows, 2.2 mi away", meta: "Lead · 2h ago" },
      { icon: "cal", text: "Crew booked for the Lee siding", meta: "Scheduled · 4h ago" },
    ],
    jobs: [
      { inDays: 1, title: "Siding replacement", time: "8:00 AM", who: "Jordan Lee", status: "Confirmed" },
      { inDays: 3, title: "Window replacement", time: "9:30 AM", who: "The Parkers", status: "Scheduled" },
      { inDays: 4, title: "Trim repair", time: "1:00 PM", who: "M. Alvarez", status: "Scheduled" },
    ],
    toast: { title: "New lead · Siding", meta: "Storm damage · 2.8 mi away" },
  },
  hvac: {
    revenue: 61200, pipeline: 172900, open: 11, leads: 8,
    trend: [5100, 7400, 4600, 9200, 6800, 11300, 8700],
    activity: [
      { icon: "check", text: "Sam Okafor accepted “Heat pump — 3 ton, 18 SEER2”", meta: "Accepted · 9 min ago" },
      { icon: "send", text: "Sent “Furnace — good, better, best” to the Morales family", meta: "Sent · 1h ago" },
      { icon: "lead", text: "New lead: AC not cooling, 1.8 mi away", meta: "Lead · 2h ago" },
      { icon: "cal", text: "Install crew booked for the Okafor heat pump", meta: "Scheduled · 3h ago" },
    ],
    jobs: [
      { inDays: 1, title: "Heat pump install", time: "8:00 AM", who: "Sam Okafor", status: "Confirmed" },
      { inDays: 2, title: "Furnace replacement", time: "10:30 AM", who: "The Morales family", status: "Scheduled" },
      { inDays: 3, title: "Maintenance visits", time: "1:00 PM", who: "Riverside HOA", status: "Scheduled" },
    ],
    toast: { title: "New lead · AC repair", meta: "No cooling · 2.2 mi away" },
  },
  fence: {
    revenue: 38450, pipeline: 96700, open: 8, leads: 5,
    trend: [2900, 4700, 3300, 6200, 4100, 7400, 5800],
    activity: [
      { icon: "check", text: "D. Chen accepted “Cedar privacy fence — 184 ft”", meta: "Accepted · 14 min ago" },
      { icon: "send", text: "Sent “Vinyl privacy — 220 ft, 2 gates” to K. Patel", meta: "Sent · 1h ago" },
      { icon: "lead", text: "New lead: backyard fence, 2.9 mi away", meta: "Lead · 2h ago" },
      { icon: "cal", text: "Post-hole crew booked for the Chen fence", meta: "Scheduled · 4h ago" },
    ],
    jobs: [
      { inDays: 1, title: "Cedar privacy fence", time: "7:00 AM", who: "D. Chen", status: "Confirmed" },
      { inDays: 2, title: "Vinyl privacy fence", time: "8:30 AM", who: "K. Patel", status: "Scheduled" },
      { inDays: 4, title: "Gate repair", time: "2:00 PM", who: "Jordan Lee", status: "Scheduled" },
    ],
    toast: { title: "New lead · Privacy fence", meta: "Backyard · 2.6 mi away" },
  },
  deck: {
    revenue: 44900, pipeline: 131600, open: 7, leads: 4,
    trend: [3400, 5800, 2700, 7900, 4800, 9100, 6600],
    activity: [
      { icon: "check", text: "The Parkers accepted “Composite deck — 16 × 20, covered”", meta: "Accepted · 11 min ago" },
      { icon: "send", text: "Sent “Pergola and stairs” to M. Alvarez", meta: "Sent · 1h ago" },
      { icon: "lead", text: "New lead: deck rebuild, 3.4 mi away", meta: "Lead · 2h ago" },
      { icon: "cal", text: "Framing crew booked for the Parker deck", meta: "Scheduled · 3h ago" },
    ],
    jobs: [
      { inDays: 1, title: "Composite deck", time: "7:30 AM", who: "The Parkers", status: "Confirmed" },
      { inDays: 3, title: "Pergola and stairs", time: "9:00 AM", who: "M. Alvarez", status: "Scheduled" },
      { inDays: 4, title: "Deck repair", time: "1:30 PM", who: "Sam Okafor", status: "Scheduled" },
    ],
    toast: { title: "New lead · Deck rebuild", meta: "Covered deck · 3.0 mi away" },
  },
  remodel: {
    revenue: 57300, pipeline: 184200, open: 10, leads: 6,
    trend: [4600, 6900, 3800, 9400, 5200, 10600, 8100],
    activity: [
      { icon: "check", text: "The Parkers accepted “Kitchen remodel”", meta: "Accepted · 16 min ago" },
      { icon: "send", text: "Sent change order “Heated tile floor” to Jordan Lee", meta: "Sent · 1h ago" },
      { icon: "lead", text: "New lead: basement finish, 2.1 mi away", meta: "Lead · 2h ago" },
      { icon: "cal", text: "Tile crew booked for the Parker kitchen", meta: "Scheduled · 4h ago" },
    ],
    jobs: [
      { inDays: 1, title: "Kitchen remodel", time: "8:00 AM", who: "The Parkers", status: "Confirmed" },
      { inDays: 2, title: "Hall bathroom", time: "9:00 AM", who: "Jordan Lee", status: "Scheduled" },
      { inDays: 4, title: "Flooring — main level", time: "8:30 AM", who: "M. Alvarez", status: "Scheduled" },
    ],
    toast: { title: "New lead · Bathroom remodel", meta: "Full gut · 2.7 mi away" },
  },
  outdoor: {
    revenue: 41800, pipeline: 112500, open: 9, leads: 7,
    trend: [3100, 5400, 3600, 6900, 4400, 8200, 6400],
    activity: [
      { icon: "check", text: "K. Patel accepted “Paver patio — 420 sq ft”", meta: "Accepted · 10 min ago" },
      { icon: "send", text: "Sent “Driveway — broom finish” to Sam Okafor", meta: "Sent · 1h ago" },
      { icon: "lead", text: "New lead: backyard landscaping, 1.6 mi away", meta: "Lead · 2h ago" },
      { icon: "cal", text: "Crew booked for the Patel patio", meta: "Scheduled · 3h ago" },
    ],
    jobs: [
      { inDays: 1, title: "Paver patio", time: "7:00 AM", who: "K. Patel", status: "Confirmed" },
      { inDays: 2, title: "Driveway pour", time: "6:30 AM", who: "Sam Okafor", status: "Scheduled" },
      { inDays: 3, title: "Seasonal cleanup", time: "10:00 AM", who: "Riverside HOA", status: "Scheduled" },
    ],
    toast: { title: "New lead · Patio", meta: "Pavers · 2.4 mi away" },
  },
  service: {
    revenue: 36900, pipeline: 88400, open: 12, leads: 9,
    trend: [3600, 4900, 4200, 5800, 5100, 6700, 6200],
    activity: [
      { icon: "check", text: "M. Alvarez accepted “Water heater — 50 gal”", meta: "Accepted · 7 min ago" },
      { icon: "send", text: "Sent “Panel upgrade — 200 A” to the Morales family", meta: "Sent · 1h ago" },
      { icon: "lead", text: "New lead: no hot water, 1.2 mi away", meta: "Lead · 1h ago" },
      { icon: "cal", text: "Tech booked for the Alvarez install", meta: "Scheduled · 2h ago" },
    ],
    jobs: [
      { inDays: 1, title: "Water heater install", time: "8:00 AM", who: "M. Alvarez", status: "Confirmed" },
      { inDays: 1, title: "Service call", time: "1:30 PM", who: "Jordan Lee", status: "Scheduled" },
      { inDays: 2, title: "Panel upgrade", time: "9:00 AM", who: "The Morales family", status: "Scheduled" },
    ],
    toast: { title: "New lead · Service call", meta: "Leak under the sink · 1.9 mi away" },
  },
  paint: {
    revenue: 33700, pipeline: 79200, open: 8, leads: 6,
    trend: [2500, 4100, 3200, 5600, 3900, 6800, 5300],
    activity: [
      { icon: "check", text: "Riverside HOA accepted “Exterior repaint — 12 units”", meta: "Accepted · 15 min ago" },
      { icon: "send", text: "Sent “Interior — 4 rooms and trim” to D. Chen", meta: "Sent · 1h ago" },
      { icon: "lead", text: "New lead: cabinet painting, 2.0 mi away", meta: "Lead · 2h ago" },
      { icon: "cal", text: "Crew booked for the Chen interior", meta: "Scheduled · 4h ago" },
    ],
    jobs: [
      { inDays: 1, title: "Exterior repaint", time: "7:30 AM", who: "Riverside HOA", status: "Confirmed" },
      { inDays: 2, title: "Interior — 4 rooms", time: "8:00 AM", who: "D. Chen", status: "Scheduled" },
      { inDays: 4, title: "Cabinet refinish", time: "9:00 AM", who: "K. Patel", status: "Scheduled" },
    ],
    toast: { title: "New lead · Exterior paint", meta: "Two-story · 3.3 mi away" },
  },
};

const TRADE_PACK: Partial<Record<TradeType, PackId>> = {
  Roofing: "roof",
  Siding: "exterior",
  Windows: "exterior",
  HVAC: "hvac",
  Insulation: "hvac",
  Fencing: "fence",
  Decking: "deck",
  Carpentry: "deck",
  Landscaping: "outdoor",
  Concrete: "outdoor",
  Plumbing: "service",
  Electrical: "service",
  Painting: "paint",
};

/** The overview's sample work for a trade; a remodeler's when the visitor came in on none (or on a remodel trade). */
export function previewPackFor(trade: TradeType | null | undefined): PreviewPack {
  return PACKS[(trade && TRADE_PACK[trade]) || "remodel"];
}

export const previewMoney = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export interface PreviewCalendar {
  /** "OCT 22" */
  today: string;
  /** The week around today, Sunday first. */
  week: Array<{ dow: string; day: number; today: boolean; jobs: number }>;
  /** "OCT 23"-style labels for the jobs' days. */
  jobDays: string[];
  /** The trend's seven day labels, the last one today ("THU"). */
  trendDays: string[];
}

const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DOW3 = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** The calendar words the preview needs, for the visitor's day in `timeZone` (the server has no other clue). */
export function previewCalendar(now: Date, pack: PreviewPack, timeZone = "America/Chicago"): PreviewCalendar {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const base = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  const at = (offset: number) => new Date(base.getTime() + offset * 86_400_000);
  const label = (d: Date) => d.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).toUpperCase();
  const dow = base.getUTCDay();
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = at(i - dow);
    const offset = i - dow;
    return { dow: DOW[d.getUTCDay()], day: d.getUTCDate(), today: offset === 0, jobs: pack.jobs.filter((j) => j.inDays === offset).length };
  });
  return {
    today: label(base),
    week,
    jobDays: pack.jobs.map((j) => label(at(j.inDays))),
    trendDays: Array.from({ length: 7 }, (_, i) => DOW3[at(i - 6).getUTCDay()]),
  };
}

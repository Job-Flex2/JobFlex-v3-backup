// THE OVERVIEW BEHIND THE PHONE SIGN-UP (2026-10-23, ./phone-backdrop). The phone dashboard
// (mobile-v2) is drawn with this sample shop instead of an org's rows: the sample work for the trade the visitor came
// in on (lib/signupPreview, the same packs the sign-up's own app picture uses), around Seattle. Every name and number
// is made up; nothing here reads an account. Pure — built in the browser with the backdrop, which only a phone loads.
import type { ActivityRow, BoardLead, ChartDataset, DashboardData, JobRow, WeekDay, WeekEvent } from "@/components/v3/dashboard-blueprint/blueprint-data";
import { makeDataset } from "@/components/v3/dashboard-blueprint/blueprint-data";
import { previewMoney, previewPackFor, type PreviewIcon } from "@/lib/signupPreview";
import type { TradeType } from "@/lib/tradeTypes";

const ZONE = "America/Los_Angeles";
const DAY = 86_400_000;

const ICON: Record<PreviewIcon, string> = { check: "i-check", send: "i-send", lead: "i-target", cal: "i-cal" };
const KIND: Record<PreviewIcon, string> = { check: "Accepted", send: "Sent", lead: "Lead", cal: "Scheduled" };

/** The pipeline board: Seattle-area leads, one or two per stage. */
const LEADS: Array<Omit<BoardLead, "id" | "job">> = [
  { stage: "new", name: "Priya Raman", city: "Bellevue, WA", owner: null, age: "12m ago" },
  { stage: "new", name: "Tom Becker", city: "Kirkland, WA", owner: null, age: "1h ago" },
  { stage: "routed", name: "Ana Morales", city: "Redmond, WA", owner: "You", age: "3h ago" },
  { stage: "claimed", name: "Grace Kim", city: "Renton, WA", owner: "You", age: "5h ago" },
  { stage: "contacted", name: "Luis Ortega", city: "Issaquah, WA", owner: "You", age: "1d ago" },
  { stage: "quoted", name: "Dana Whitfield", city: "Bothell, WA", owner: "You", age: "2d ago" },
  { stage: "quoted", name: "Mark Ellison", city: "Shoreline, WA", owner: "You", age: "3d ago" },
];

/** Midnight of `now`'s calendar day in Seattle, as a UTC date whose UTC fields are that day. */
function seattleDay(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}

const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleString("en-US", { timeZone: "UTC", ...o });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const timeOfDay = (label: string) => {
  const m = /^(\d+):(\d+)\s*(AM|PM)$/i.exec(label.trim());
  if (!m) return 9 * 60;
  return ((Number(m[1]) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(m[2]);
};

/** A smooth sample series ending on the pack's own last week. */
function series(trend: number[], points: number, scale: number): number[] {
  return Array.from({ length: points }, (_, i) => Math.round(trend[(i + 3) % trend.length] * scale * (0.82 + ((i * 37) % 23) / 60)));
}

export function signupDashboardFixture(trade: TradeType | null, now: Date = new Date()): DashboardData {
  const pack = previewPackFor(trade);
  const today = seattleDay(now);
  const at = (offset: number) => new Date(today.getTime() + offset * DAY);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", hourCycle: "h23" }).format(now));
  const greeting = `Good ${hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening"} · ${fmt(today, { month: "short" })} ${today.getUTCDate()}`;

  const weekStart = at(-today.getUTCDay());
  const events: Record<string, WeekEvent[]> = {};
  pack.jobs.forEach((j) => {
    const key = iso(at(j.inDays));
    (events[key] ??= []).push({ m: timeOfDay(j.time), t: j.time, title: `${j.title} · ${j.who}` });
  });
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getTime() + i * DAY);
    return { iso: iso(d), num: d.getUTCDate(), lbl: fmt(d, { weekday: "short" }).slice(0, 2).toUpperCase(), today: i === today.getUTCDay(), has: Boolean(events[iso(d)]) };
  });
  const last = new Date(weekStart.getTime() + 6 * DAY);
  const range = `${fmt(weekStart, { month: "short" })} ${weekStart.getUTCDate()} – ${last.getUTCMonth() === weekStart.getUTCMonth() ? "" : fmt(last, { month: "short" }) + " "}${last.getUTCDate()}`;
  const scheduled = days.reduce((n, d) => n + (events[d.iso]?.length ?? 0), 0);

  const jobs: JobRow[] = pack.jobs.map((j, i) => ({
    id: `sample-job-${i}`,
    date: fmt(at(j.inDays), { month: "short", day: "2-digit" }).toUpperCase(),
    title: j.title,
    sub: `${j.time} · ${j.who}`,
    st: j.status === "Confirmed" ? "ok" : "wait",
    today: j.inDays === 0,
  }));

  const activities: ActivityRow[] = pack.activity.map((a) => ({ i: ICON[a.icon], t: a.text, m: a.meta || KIND[a.icon], who: null, mine: true }));

  const jobNames = pack.jobs.map((j) => j.title);
  const leads: BoardLead[] = LEADS.map((l, i) => ({ ...l, id: `sample-lead-${i}`, job: jobNames[i % jobNames.length] }));

  const tick = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  const chart: Record<"7d" | "30d" | "90d", ChartDataset> = {
    "7d": makeDataset(Array.from({ length: 7 }, (_, i) => fmt(at(i - 6), { weekday: "short" }).toUpperCase()), pack.trend),
    "30d": makeDataset(Array.from({ length: 10 }, (_, i) => tick(at((i - 9) * 3))), series(pack.trend, 10, 3)),
    "90d": makeDataset(Array.from({ length: 13 }, (_, i) => tick(at((i - 12) * 7))), series(pack.trend, 13, 7)),
  };

  return {
    greeting,
    viewer: { name: "Your name", role: "Owner" },
    leadProfile: null,
    firstRun: null,
    kpis: { revenue: previewMoney(pack.revenue), pipeline: previewMoney(pack.pipeline), openProposals: String(pack.open), newLeads: String(pack.leads) },
    kpiRaw: { revenue: pack.revenue, pipeline: pack.pipeline, openProposals: pack.open, newLeads: pack.leads },
    chart,
    activities,
    week: { range, scheduled, days, events, todayIso: iso(today) },
    jobs,
    leads,
  };
}

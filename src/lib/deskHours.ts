// RESERVED HOURS FOR THE AI DESK (owner, 2026-10-16: "if the company has sales and they have their own calendar, they
// can reserve the schedule so the AI desk books from the reserved days — and keep an option in the AI desk to reserve
// dates and times by hand … reserve hours, not the full day").
//
// A company chooses where the desk books from:
//   open-hours — the weekly open hours of the booking settings (what it always did)
//   reserved   — only the hours someone reserved: a salesperson on their own calendar, or the office in the AI desk.
//
// A reservation is one day ("Tue, Oct 20 · 1–4 PM") or every week ("every Tuesday · 1–4 PM"), on the shop's clock,
// down to the minute, for one person (the visit is theirs: assigned to them, on their calendar) or for the company
// (any crew — the booking settings' crew count applies). Kept beside the company in SyncState `deskHours:<org>`; no
// schema change.
//
// Pure, browser-safe: the AI desk screen, both calendars, the server and the QA read it.
import { zonedInstant, zonedParts, type BookingService, type BookingSettings, type Busy, type DaySlots, type Slot } from "./booking";

export type DeskWindow = {
  id: string;
  /** Whose time: a member's user id — or null for the company (any crew). */
  userId: string | null;
  /** One day on the shop's calendar ("2026-10-20") … */
  date: string | null;
  /** … or every week: 0 = Sunday … 6 = Saturday. Exactly one of the two is set. */
  dow: number | null;
  /** "13:00" → "16:30", the shop's clock. `to` is after `from`. */
  from: string;
  to: string;
  note: string;
  /** Who reserved it, and when. */
  by: string | null;
  at: string;
};

export type DeskHoursMode = "open-hours" | "reserved";
export type DeskHours = { mode: DeskHoursMode; windows: DeskWindow[] };

export const EMPTY_DESK_HOURS: DeskHours = { mode: "open-hours", windows: [] };
export const deskHoursKey = (organizationId: string) => `deskHours:${organizationId}`;
export const MAX_WINDOWS = 300;
/** The shortest reservation worth making. */
export const MIN_WINDOW_MINUTES = 30;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export const minutesOf = (hhmm: string): number => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
};

/** A reservation from storage or a form, checked; null when it is not one. */
export function cleanWindow(raw: unknown): DeskWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const id = str(o.id, 40);
  const from = str(o.from, 5);
  const to = str(o.to, 5);
  const date = typeof o.date === "string" && YMD.test(o.date) ? o.date : null;
  const dow = typeof o.dow === "number" && Number.isInteger(o.dow) && o.dow >= 0 && o.dow <= 6 ? o.dow : null;
  if (!id || (date === null) === (dow === null)) return null;
  if (minutesOf(from) < 0 || minutesOf(to) < 0 || minutesOf(to) - minutesOf(from) < MIN_WINDOW_MINUTES) return null;
  return {
    id,
    userId: str(o.userId, 40) || null,
    date,
    dow,
    from,
    to,
    note: str(o.note, 120),
    by: str(o.by, 40) || null,
    at: str(o.at, 40),
  };
}

export function cleanDeskHours(raw: unknown): DeskHours {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const windows = Array.isArray(o.windows) ? o.windows.map(cleanWindow).filter((w): w is DeskWindow => !!w).slice(0, MAX_WINDOWS) : [];
  return { mode: o.mode === "reserved" ? "reserved" : "open-hours", windows };
}

export function parseDeskHours(cursor: string | null | undefined): DeskHours {
  if (!cursor) return { ...EMPTY_DESK_HOURS, windows: [] };
  try {
    return cleanDeskHours(JSON.parse(cursor));
  } catch {
    return { ...EMPTY_DESK_HOURS, windows: [] };
  }
}

/** Today on the shop's calendar, "2026-10-16". */
export function shopToday(now: Date, timeZone: string): string {
  const p = zonedParts(now, timeZone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/**
 * Why a reservation can't be made, in words — or null. `today` is the shop's date: a one-day reservation can't be in
 * the past.
 */
export function windowProblem(w: { date: string | null; dow: number | null; from: string; to: string }, today: string): string | null {
  if ((w.date === null) === (w.dow === null)) return "Pick a day, or a day of the week.";
  if (w.date !== null && !YMD.test(w.date)) return "Pick a day.";
  if (w.date !== null && w.date < today) return "That day has passed.";
  const a = minutesOf(w.from);
  const b = minutesOf(w.to);
  if (a < 0 || b < 0) return "Pick a start and an end time.";
  if (b <= a) return "The end has to be after the start.";
  if (b - a < MIN_WINDOW_MINUTES) return `Reserve at least ${MIN_WINDOW_MINUTES} minutes.`;
  return null;
}

/** Two reservations of the same person that overlap on a day they share — the second would add nothing. */
export function overlapsExisting(w: Pick<DeskWindow, "userId" | "date" | "dow" | "from" | "to">, existing: readonly DeskWindow[]): DeskWindow | null {
  const a = minutesOf(w.from);
  const b = minutesOf(w.to);
  const dowOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
  for (const x of existing) {
    if ((x.userId ?? null) !== (w.userId ?? null)) continue;
    const sameDay =
      (w.date && x.date && w.date === x.date) ||
      (w.dow !== null && x.dow !== null && w.dow === x.dow) ||
      (w.date && x.dow !== null && dowOf(w.date) === x.dow) ||
      (x.date && w.dow !== null && dowOf(x.date) === w.dow);
    if (sameDay && minutesOf(x.from) < b && minutesOf(x.to) > a) return x;
  }
  return null;
}

const clock = (hhmm: string) => {
  const m = minutesOf(hhmm);
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h >= 12 ? "PM" : "AM"}`;
};
/** "9 AM–12 PM", "1:30–4 PM". */
export function spanWords(from: string, to: string): string {
  const a = clock(from);
  const b = clock(to);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
}
/** "Every Tuesday · 1–4 PM" / "Tue, Oct 20 · 9 AM–12 PM". */
export function windowWords(w: Pick<DeskWindow, "date" | "dow" | "from" | "to">): string {
  const when =
    w.dow !== null
      ? `Every ${DAY_NAMES[w.dow]}`
      : new Date(`${w.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `${when} · ${spanWords(w.from, w.to)}`;
}

/** The reservations still ahead (a one-day one today or later; every weekly one), weekly first, then by date. */
export function upcomingWindows(windows: readonly DeskWindow[], today: string): DeskWindow[] {
  return windows
    .filter((w) => w.dow !== null || (w.date ?? "") >= today)
    .sort((a, b) => {
      if ((a.dow === null) !== (b.dow === null)) return a.dow !== null ? -1 : 1;
      const ka = a.dow !== null ? `${a.dow}` : a.date!;
      const kb = b.dow !== null ? `${b.dow}` : b.date!;
      return ka === kb ? minutesOf(a.from) - minutesOf(b.from) : ka < kb ? -1 : 1;
    });
}

export type WindowSpan = { windowId: string; userId: string | null; startsAt: Date; endsAt: Date; weekly: boolean };

/** Every reservation as real instants, for `days` days from `from`'s day on the shop's clock. */
export function expandWindows(windows: readonly DeskWindow[], from: Date, days: number, timeZone: string): WindowSpan[] {
  const out: WindowSpan[] = [];
  const start = zonedParts(from, timeZone);
  for (let i = 0; i < days; i++) {
    const noon = zonedInstant(start.y, start.m, start.d + i, 12, 0, timeZone);
    const p = zonedParts(noon, timeZone);
    const ymd = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
    for (const w of windows) {
      if (w.date !== null ? w.date !== ymd : w.dow !== p.dow) continue;
      const a = minutesOf(w.from);
      const b = minutesOf(w.to);
      out.push({
        windowId: w.id,
        userId: w.userId,
        startsAt: zonedInstant(p.y, p.m, p.d, Math.floor(a / 60), a % 60, timeZone),
        endsAt: zonedInstant(p.y, p.m, p.d, Math.floor(b / 60), b % 60, timeZone),
        weekly: w.dow !== null,
      });
    }
  }
  return out.sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
}

export type DeskSlot = Slot & { userId: string | null; windowId: string };
export type DeskDaySlots = Omit<DaySlots, "slots"> & { slots: DeskSlot[] };

/**
 * The times the desk can offer inside the reserved hours: on the slot grid from each reservation's start, long enough
 * for the service, after the notice time, inside the horizon. A person's reservation is open while that person has
 * nothing else then (`busyOf(userId)`: their visits, their blocked time, the company's blocks); a company reservation
 * while fewer than `crews` visits overlap (`orgBusy`). Two people free at the same time are one time to the caller —
 * the first reservation takes it.
 */
export function reservedSlots(input: {
  settings: BookingSettings;
  service: BookingService;
  windows: readonly DeskWindow[];
  orgBusy: Busy[];
  busyOf: (userId: string) => Busy[];
  timeZone: string;
  now?: Date;
  days?: number;
}): DeskDaySlots[] {
  const { settings, service, timeZone } = input;
  const now = input.now ?? new Date();
  const days = input.days ?? settings.horizonDays;
  const earliest = new Date(now.getTime() + (service.urgent ? Math.min(settings.leadHours, 2) : settings.leadHours) * 3600000);
  const spans = expandWindows(input.windows, now, days, timeZone);
  const taken = new Set<number>();
  const byDay = new Map<string, DeskDaySlots>();
  const len = service.minutes * 60000;
  const step = settings.slotMinutes * 60000;
  for (const sp of spans) {
    const busy = sp.userId ? input.busyOf(sp.userId) : input.orgBusy;
    const cap = sp.userId ? 1 : settings.crews;
    for (let t = sp.startsAt.getTime(); t + len <= sp.endsAt.getTime(); t += step) {
      const s = new Date(t);
      const e = new Date(t + len);
      if (s < earliest || taken.has(t)) continue;
      if (busy.filter((b) => b.startsAt < e && b.endsAt > s).length >= cap) continue;
      taken.add(t);
      const p = zonedParts(s, timeZone);
      const day = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
      const bucket = byDay.get(day) ?? { day, weekday: DAY_NAMES[p.dow], slots: [] };
      bucket.slots.push({ startsAt: s, endsAt: e, userId: sp.userId, windowId: sp.windowId });
      byDay.set(day, bucket);
    }
  }
  return [...byDay.values()]
    .map((d) => ({ ...d, slots: d.slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()) }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** "2026-10-20": the shop's calendar day of an instant. */
export function zonedYmd(d: Date, timeZone: string): string {
  return shopToday(d, timeZone);
}
/** "13:30": the shop's clock time of an instant. */
export function zonedHhmm(d: Date, timeZone: string): string {
  const p = zonedParts(d, timeZone);
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
}

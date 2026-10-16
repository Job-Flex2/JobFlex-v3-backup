"use server";
// RESERVED HOURS FOR THE AI DESK (lib/deskHours, 2026-10-16) — reserve, remove, and choose where the desk books from.
//
// Who may do what: an owner, admin or manager reserves hours for anyone or for the whole company and picks the mode;
// a salesperson or an estimator reserves and removes only their own hours (from their calendar); field crew don't
// take booked visits from the desk, so they can't. Read-modify-write on one SyncState row, guarded by its old value.
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { isEstimatorRole, isSalesRole, isWorkerRole, requireOrg } from "@/lib/orgContext";
import {
  cleanWindow,
  deskHoursKey,
  overlapsExisting,
  parseDeskHours,
  shopToday,
  upcomingWindows,
  windowProblem,
  windowWords,
  MAX_WINDOWS,
  type DeskHours,
  type DeskHoursMode,
  type DeskWindow,
} from "@/lib/deskHours";

export type DeskHoursView = {
  mode: DeskHoursMode;
  /** The reservations still ahead, each with its words and whose it is. Limited roles see theirs and the company's. */
  windows: Array<DeskWindow & { words: string; who: string; mine: boolean }>;
  /** Who hours can be reserved for — everyone for a manager, only themselves otherwise. */
  people: Array<{ userId: string; name: string }>;
  me: string;
  canManage: boolean;
  canReserve: boolean;
  today: string;
  timeZone: string;
};

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function ctx() {
  const c = await requireOrg();
  const manager = !isWorkerRole(c.role) && !isSalesRole(c.role) && !isEstimatorRole(c.role);
  const canReserve = manager || isSalesRole(c.role) || isEstimatorRole(c.role);
  return { organizationId: c.organizationId, userId: c.user.id, manager, canReserve };
}

async function readRow(organizationId: string): Promise<{ cursor: string | null; hours: DeskHours }> {
  const row = await db.syncState.findUnique({ where: { key: deskHoursKey(organizationId) }, select: { cursor: true } });
  return { cursor: row?.cursor ?? null, hours: parseDeskHours(row?.cursor) };
}

/** Write `next` only if the row still holds `prev` — two people reserving at once both land, neither overwrites. */
async function writeRow(organizationId: string, prev: string | null, next: DeskHours): Promise<boolean> {
  const key = deskHoursKey(organizationId);
  const cursor = JSON.stringify(next);
  if (prev === null) {
    try {
      await db.syncState.create({ data: { key, cursor } });
      return true;
    } catch {
      return false;
    }
  }
  const r = await db.syncState.updateMany({ where: { key, cursor: prev }, data: { cursor } });
  return r.count === 1;
}

async function change(organizationId: string, edit: (h: DeskHours) => DeskHours | string): Promise<DeskHours | string> {
  for (let i = 0; i < 4; i++) {
    const { cursor, hours } = await readRow(organizationId);
    const next = edit(hours);
    if (typeof next === "string") return next;
    if (await writeRow(organizationId, cursor, next)) return next;
  }
  return "Someone else changed the reserved hours just now. Try again.";
}

function refresh() {
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/settings");
}

async function members(organizationId: string): Promise<Map<string, string>> {
  const rows = await db.membership.findMany({ where: { organizationId }, select: { userId: true, role: true, user: { select: { name: true, email: true } } } });
  return new Map(rows.filter((r) => !isWorkerRole(r.role)).map((r) => [r.userId, r.user.name || r.user.email || "Team member"]));
}

export async function loadDeskHours(): Promise<DeskHoursView> {
  const c = await ctx();
  const [{ hours }, org, names] = await Promise.all([
    readRow(c.organizationId),
    db.organization.findUnique({ where: { id: c.organizationId }, select: { timezone: true } }),
    members(c.organizationId),
  ]);
  const timeZone = org?.timezone || "America/New_York";
  const today = shopToday(new Date(), timeZone);
  const visible = upcomingWindows(hours.windows, today).filter((w) => c.manager || !w.userId || w.userId === c.userId);
  return {
    mode: hours.mode,
    windows: visible.map((w) => ({ ...w, words: windowWords(w), who: w.userId ? names.get(w.userId) ?? "Former team member" : "Anyone at the company", mine: w.userId === c.userId })),
    people: c.manager ? [...names].map(([userId, name]) => ({ userId, name })) : [{ userId: c.userId, name: names.get(c.userId) ?? "Me" }],
    me: c.userId,
    canManage: c.manager,
    canReserve: c.canReserve,
    today,
    timeZone,
  };
}

/** Reserve hours. `userId`: whose — "" for the whole company (managers only); a limited role always reserves their own. */
export async function reserveDeskHours(raw: { userId?: string | null; date?: string | null; dow?: number | null; from: string; to: string; note?: string }): Promise<Result<{ window: DeskWindow; words: string }>> {
  try {
    const c = await ctx();
    if (!c.canReserve) return { ok: false, error: "Your role doesn't take visits from the AI desk." };
    const userId = c.manager ? (raw.userId ? String(raw.userId) : null) : c.userId;
    if (userId && c.manager) {
      const names = await members(c.organizationId);
      if (!names.has(userId)) return { ok: false, error: "That person isn't on the team." };
    }
    const org = await db.organization.findUnique({ where: { id: c.organizationId }, select: { timezone: true } });
    const today = shopToday(new Date(), org?.timezone || "America/New_York");
    const draft = { date: raw.date || null, dow: typeof raw.dow === "number" ? raw.dow : null, from: String(raw.from ?? ""), to: String(raw.to ?? "") };
    const problem = windowProblem(draft, today);
    if (problem) return { ok: false, error: problem };
    const window = cleanWindow({ id: randomUUID().slice(0, 12), userId, ...draft, note: raw.note ?? "", by: c.userId, at: new Date().toISOString() });
    if (!window) return { ok: false, error: "Those hours couldn't be read. Try again." };
    const r = await change(c.organizationId, (h) => {
      const clash = overlapsExisting(window, upcomingWindows(h.windows, today));
      if (clash) return `That overlaps hours already reserved: ${windowWords(clash)}.`;
      // Past one-day reservations make room; a full list says so.
      const kept = upcomingWindows(h.windows, today);
      if (kept.length >= MAX_WINDOWS) return "That's as many reserved hours as the desk keeps — remove some first.";
      return { ...h, windows: [...kept, window] };
    });
    if (typeof r === "string") return { ok: false, error: r };
    refresh();
    return { ok: true, window, words: windowWords(window) };
  } catch {
    return { ok: false, error: "Couldn't save. Try again." };
  }
}

export async function removeDeskHours(id: string): Promise<Result> {
  try {
    const c = await ctx();
    const r = await change(c.organizationId, (h) => {
      const w = h.windows.find((x) => x.id === id);
      if (!w) return h;
      if (!c.manager && w.userId !== c.userId) return "You can remove only your own hours.";
      return { ...h, windows: h.windows.filter((x) => x.id !== id) };
    });
    if (typeof r === "string") return { ok: false, error: r };
    refresh();
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't remove. Try again." };
  }
}

/** Where the desk books from — a manager's call. */
export async function setDeskHoursMode(mode: DeskHoursMode): Promise<Result> {
  try {
    const c = await ctx();
    if (!c.manager) return { ok: false, error: "Only an owner or manager can change this." };
    const next: DeskHoursMode = mode === "reserved" ? "reserved" : "open-hours";
    const r = await change(c.organizationId, (h) => ({ ...h, mode: next }));
    if (typeof r === "string") return { ok: false, error: r };
    refresh();
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't save. Try again." };
  }
}

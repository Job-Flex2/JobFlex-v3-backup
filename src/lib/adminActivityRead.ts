import "server-only";
// USER ACTIVITY — FINDING SOMEONE, AND WHO IS WORKING NOW (2026-10-19 — owner: "add search in user activity, that way
// I can search any client by his company name or email, and look what he's doing … and also keep on the ones that
// are working right now"). Two reads for /admin/activity:
//  · findMembers — any member of any workspace by their name, their email or their company's name, active in the
//    range or not;
//  · readWorkingNow — everyone with a screen open in the app in the last ten minutes: who, which company, the screen
//    they're on, how long they've been at it, and the last thing they did. The staff (platform admins) and the test
//    accounts hidden from the stats are left out, the way the office screen leaves them out.
// What a member has been looking at comes from the page views the trial watch records (PageView: the route, ids
// collapsed), in the sidebar's words.
import { db } from "@/lib/db";
import { statsHiddenIds } from "@/lib/statsHidden";
import { screenWords } from "@/lib/trialBoardRead";

export const ONLINE_MS = 10 * 60_000;
/** How far back "on for 25 min · 14 screens" looks. */
const SESSION_MS = 60 * 60_000;

export type MemberHit = { id: string; name: string | null; email: string | null };

/** Members whose name, email or company name holds `q` (case aside), up to `limit`. */
export async function findMembers(q: string, limit = 30): Promise<MemberHit[]> {
  const t = q.trim().slice(0, 80);
  if (t.length < 2) return [];
  const select = { id: true, name: true, email: true } as const;
  const ci = { contains: t, mode: "insensitive" as const };
  try {
    return await db.user.findMany({
      where: { OR: [{ name: ci }, { email: ci }, { memberships: { some: { organization: { name: ci } } } }] },
      select,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  } catch {
    // SQLite (the stand) has no case-insensitive mode — and its LIKE ignores ASCII case anyway.
    const c = { contains: t };
    return db.user
      .findMany({ where: { OR: [{ name: c }, { email: c }, { memberships: { some: { organization: { name: c } } } }] }, select, orderBy: { createdAt: "desc" }, take: limit })
      .catch(() => []);
  }
}

export type WorkingNowRow = {
  userId: string;
  name: string;
  email: string | null;
  company: string;
  /** The screen they last opened, in the sidebar's words, and when. */
  screen: string;
  at: string;
  /** The first screen of this sitting (no gap of ten minutes since), and how many screens they've opened in it. */
  since: string;
  screens: number;
  /** The last thing they did in the last hour, from the trail. */
  lastAction: { summary: string; kind: string; at: string } | null;
};

/** Everyone with a screen open in the app in the last ten minutes, the most recent first. */
export async function readWorkingNow(now = Date.now()): Promise<WorkingNowRow[]> {
  const [hidden, staff] = await Promise.all([
    statsHiddenIds().catch(() => [] as string[]),
    db.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true } }).catch(() => [] as { id: string }[]),
  ]);
  const staffIds = staff.map((u) => u.id);
  type View = { userId: string | null; organizationId: string; route: string; at: Date };
  const views: View[] = await db.pageView
    .findMany({
      where: { at: { gte: new Date(now - SESSION_MS) }, userId: staffIds.length ? { not: null, notIn: staffIds } : { not: null }, ...(hidden.length ? { organizationId: { notIn: hidden } } : {}) },
      orderBy: { at: "desc" },
      take: 3000,
      select: { userId: true, organizationId: true, route: true, at: true },
    })
    .catch(() => []);
  // Per person, newest first: the last view, then back through the sitting until a ten-minute gap.
  const byUser = new Map<string, View[]>();
  for (const v of views) {
    if (!v.userId) continue;
    const list = byUser.get(v.userId);
    if (list) list.push(v);
    else byUser.set(v.userId, [v]);
  }
  const live = [...byUser.entries()].filter(([, list]) => now - list[0].at.getTime() <= ONLINE_MS).slice(0, 40);
  if (!live.length) return [];
  const ids = live.map(([id]) => id);
  const [users, orgs, events] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }),
    db.organization.findMany({ where: { id: { in: [...new Set(live.map(([, l]) => l[0].organizationId))] } }, select: { id: true, name: true } }),
    db.activityEvent
      .findMany({ where: { actorId: { in: ids }, kind: { not: "TEST" }, createdAt: { gte: new Date(now - SESSION_MS) } }, orderBy: { createdAt: "desc" }, take: 200, select: { actorId: true, kind: true, summary: true, createdAt: true } })
      .catch(() => []),
  ]);
  const user = new Map(users.map((u) => [u.id, u]));
  const org = new Map(orgs.map((o) => [o.id, o.name]));
  const last = new Map<string, (typeof events)[number]>();
  for (const e of events) if (e.actorId && !last.has(e.actorId)) last.set(e.actorId, e);
  return live.map(([id, list]) => {
    let start = list[0];
    for (let i = 1; i < list.length; i++) {
      if (start.at.getTime() - list[i].at.getTime() > ONLINE_MS) break;
      start = list[i];
    }
    const count = list.indexOf(start) + 1;
    const u = user.get(id);
    const e = last.get(id);
    return {
      userId: id,
      name: u?.name?.trim() || u?.email?.split("@")[0] || "Someone",
      email: u?.email ?? null,
      company: org.get(list[0].organizationId) ?? "",
      screen: screenWords(list[0].route),
      at: list[0].at.toISOString(),
      since: start.at.toISOString(),
      screens: count,
      lastAction: e ? { summary: e.summary, kind: e.kind, at: e.createdAt.toISOString() } : null,
    };
  });
}

export type ScreenRun = { userId: string; organizationId: string; route: string; screen: string; at: string; first: string; views: number };

/** A member's page views as runs: the same screen opened again and again in a row is one line ("· 6 views"). `views`
 *  newest first. */
export function screenRuns(views: Array<{ userId: string | null; organizationId: string; route: string; at: Date }>): ScreenRun[] {
  const out: ScreenRun[] = [];
  const open = new Map<string, ScreenRun>();
  for (const v of views) {
    if (!v.userId) continue;
    const cur = open.get(v.userId);
    if (cur && cur.route === v.route) {
      cur.views++;
      cur.first = v.at.toISOString();
      continue;
    }
    const run: ScreenRun = { userId: v.userId, organizationId: v.organizationId, route: v.route, screen: screenWords(v.route), at: v.at.toISOString(), first: v.at.toISOString(), views: 1 };
    open.set(v.userId, run);
    out.push(run);
  }
  return out;
}

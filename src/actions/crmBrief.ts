"use server";

// THE CRM BRIEF — the actions. `getCrmBrief` is how the phone edition reads
// (it is mounted props-less by the responsive shell); the desktop page calls
// lib/crm/briefServer directly. `setCrmCheck` ticks or unticks one of today's
// checks for the signed-in person — stored in SyncState, one row per person per
// viewer-day, so a tick on the phone shows on the desk and is gone tomorrow.

import { db } from "@/lib/db";
import { NoOrgError, UnauthorizedError, requireOrg, roleMayOpen } from "@/lib/orgContext";
import { viewerTimeZone } from "@/lib/viewerTz";
import { dayKeyTz, type CrmBrief } from "@/lib/crm/brief";
import { CHECKS_KEY, readChecksDone, readCrmBrief } from "@/lib/crm/briefServer";

export type CrmBriefResult = { ok: true; data: CrmBrief } | { ok: false; error: string };

export async function getCrmBrief(): Promise<CrmBriefResult> {
  let ctx: Awaited<ReturnType<typeof requireOrg>>;
  try {
    ctx = await requireOrg();
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: "Sign in to see the CRM." };
    if (err instanceof NoOrgError) return { ok: false, error: "Sign in to an organization to see the CRM." };
    throw err;
  }
  if (!roleMayOpen(ctx.role, "/dashboard/crm")) return { ok: false, error: "Your role doesn't include the CRM." };
  const data = await readCrmBrief({ organizationId: ctx.organizationId, userId: ctx.user.id, role: ctx.role });
  return { ok: true, data };
}

const KEY_RE = /^[a-z]+\.[a-z0-9-]+$/;
const MAX_KEYS = 200;

export type SetCheckResult = { ok: true; done: string[]; dayKey: string } | { ok: false; error: string };

/** Tick (or untick) one check for today. `dayKey` is the day the sheet was
 *  drawn for; a tick that arrives after midnight lands on the day the person
 *  was looking at, not on the new one. */
export async function setCrmCheck(input: { key: string; done: boolean; dayKey?: string | null }): Promise<SetCheckResult> {
  let ctx: Awaited<ReturnType<typeof requireOrg>>;
  try {
    ctx = await requireOrg();
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof NoOrgError) return { ok: false, error: "Sign in to tick a check." };
    throw err;
  }
  if (!roleMayOpen(ctx.role, "/dashboard/crm")) return { ok: false, error: "Your role doesn't include the CRM." };
  const key = typeof input.key === "string" ? input.key.trim() : "";
  if (!KEY_RE.test(key) || key.length > 80) return { ok: false, error: "That check isn't one of today's." };

  const org = await db.organization.findUnique({ where: { id: ctx.organizationId }, select: { timezone: true } });
  const tz = await viewerTimeZone(org?.timezone);
  const dayKey = input.dayKey && /^\d{4}-\d{2}-\d{2}$/.test(input.dayKey) ? input.dayKey : dayKeyTz(new Date(), tz);

  const current = await readChecksDone(ctx.organizationId, ctx.user.id, dayKey);
  const next = input.done ? [...new Set([...current, key])].slice(-MAX_KEYS) : current.filter((k) => k !== key);
  const rowKey = CHECKS_KEY(ctx.organizationId, ctx.user.id, dayKey);
  const cursor = JSON.stringify(next);
  await db.syncState.upsert({ where: { key: rowKey }, create: { key: rowKey, cursor }, update: { cursor } });
  return { ok: true, done: next, dayKey };
}

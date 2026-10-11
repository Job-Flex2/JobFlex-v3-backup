import "server-only";
// THE DAILY LEAD SET-UP REMINDER (owner, 2026-10-07) — server only, run by
// api/cron/lead-setup-reminders every morning. Every shop from its first
// fourteen days that still lacks an address or specialties (lib/leadSetup)
// gets one mail to its owner per day — at most 14 — and nothing once both are
// set. The record is one SyncState row per shop, `leadSetupReminder:<orgId>`
// = { count, lastAt }, so a shop is never mailed twice in a day whatever the
// cron's cadence. A failed send is counted and never stops the sweep.
import { db } from "@/lib/db";
import { leadSetupNeedOf } from "@/lib/leadSetup";
import { buildLeadSetupReminder } from "@/lib/email/build/leadSetup";
import { renderEmail } from "@/lib/email/renderEmail";
import { orgNameUnsetKey } from "@/lib/orgName";

const PREFIX = "leadSetupReminder:";
const DAYS = 14;
const MAX_SENDS = 14;
const MIN_GAP_MS = 22 * 60 * 60 * 1000;

export async function runLeadSetupReminderSweep(now = new Date()): Promise<{ scanned: number; needing: number; sent: number; skipped: number; failed: number }> {
  const since = new Date(now.getTime() - DAYS * 86_400_000);
  const orgs = await db.organization.findMany({
    where: { createdAt: { gte: since } },
    select: {
      id: true, name: true, address: true, lat: true, lng: true, tradeTypesJson: true,
      memberships: { where: { role: "OWNER" }, take: 1, select: { user: { select: { email: true, name: true } } } },
    },
    take: 2000,
  });
  const out = { scanned: orgs.length, needing: 0, sent: 0, skipped: 0, failed: 0 };
  const { appBaseUrl } = await import("@/lib/appUrl");
  const { sendEmail } = await import("@/lib/sdk/resend");
  const base = await appBaseUrl();
  // The passwordless sign-up's shops still named after their owner (lib/orgName).
  const unnamed = new Set(
    (await db.syncState.findMany({ where: { key: { in: orgs.map((o) => orgNameUnsetKey(o.id)) } }, select: { key: true } }).catch(() => [])).map((r) => r.key),
  );
  for (const org of orgs) {
    const need = leadSetupNeedOf(org, unnamed.has(orgNameUnsetKey(org.id)));
    if (!need.needs) continue;
    out.needing++;
    const to = org.memberships[0]?.user;
    if (!to?.email) { out.skipped++; continue; }
    const key = PREFIX + org.id;
    try {
      const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
      const rec = row?.cursor ? (JSON.parse(row.cursor) as { count?: number; lastAt?: string }) : {};
      const count = typeof rec.count === "number" ? rec.count : 0;
      const lastAt = typeof rec.lastAt === "string" ? Date.parse(rec.lastAt) : NaN;
      if (count >= MAX_SENDS || (Number.isFinite(lastAt) && now.getTime() - lastAt < MIN_GAP_MS)) { out.skipped++; continue; }
      const doc = buildLeadSetupReminder({ name: to.name, business: org.name, needsAddress: need.needsAddress, needsTrades: need.needsTrades, needsName: need.needsName, href: `${base}/dashboard/company${need.needsName ? "#company-name" : ""}`, nth: count + 1 });
      const { subject, html } = renderEmail(doc);
      await sendEmail({ to: to.email, subject, html });
      const cursor = JSON.stringify({ count: count + 1, lastAt: now.toISOString() });
      await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
      out.sent++;
    } catch (err) {
      out.failed++;
      console.warn("[lead-setup] reminder not sent:", org.id, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

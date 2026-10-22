// Admin · Sent mail (2026-10-21) — every letter sendEmail() handled
// (lib/emailLog): sent, failed after the retries, or skipped. Filtered on the
// server by the URL (?period=today|7d|30d, ?status=, ?kind=, ?q= part of an
// address), newest first, read-only. The four numbers above the table are the
// period's, with the kind and the address search applied and the status not —
// they are what the status filter chooses between.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { emailDailyLimit, utcDayStart } from "@/lib/emailLog";
import { EMAIL_KINDS, EMAIL_STATUSES, MAIL_PERIODS, type EmailKind, type EmailStatus, type MailLogPeriod } from "@/lib/emailLogShared";
import { AdminMailLogContent, type MailLogRow } from "@/components/v3/admin-mail-log/mail-log-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Sent mail",
  description: "Every email the platform sent, failed to send or skipped.",
};

/** Rows read for one view; the pager turns them over in the browser. */
const ROW_LIMIT = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function sinceFor(period: MailLogPeriod, now: Date): Date {
  if (period === "today") return utcDayStart(now);
  return new Date(now.getTime() - (period === "7d" ? 7 : 30) * DAY_MS);
}

export default async function AdminMailLogPage({ searchParams }: { searchParams: Promise<{ period?: string; status?: string; kind?: string; q?: string }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 120);
  const period: MailLogPeriod = (MAIL_PERIODS as readonly string[]).includes(sp.period ?? "") ? (sp.period as MailLogPeriod) : q ? "30d" : "7d";
  const status = (EMAIL_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as EmailStatus) : null;
  const kind = (EMAIL_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as EmailKind) : null;

  const now = new Date();
  const scope = {
    createdAt: { gte: sinceFor(period, now) },
    ...(kind ? { kind } : {}),
    ...(q ? { to: { contains: q } } : {}),
  };

  const read = await Promise.all([
    db.emailLog.findMany({
      where: { ...scope, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: ROW_LIMIT,
    }),
    db.emailLog.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
  ])
    // The table is not in this database yet (prisma/sql/prod-2026-10-21-email-log.sql).
    .catch(() => null);

  const counts = { sent: 0, failed: 0, skipped: 0 };
  for (const g of read?.[1] ?? []) if (g.status in counts) counts[g.status as EmailStatus] = g._count._all;

  // Names for the rows' organizations, in one read.
  const orgIds = [...new Set((read?.[0] ?? []).map((r) => r.organizationId).filter((id): id is string => Boolean(id)))];
  const orgs = orgIds.length ? await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }).catch(() => []) : [];
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));

  const rows: MailLogRow[] | null = read
    ? read[0].map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        to: r.to,
        subject: r.subject,
        kind: (EMAIL_KINDS as readonly string[]).includes(r.kind) ? (r.kind as EmailKind) : "other",
        transport: r.transport,
        status: (EMAIL_STATUSES as readonly string[]).includes(r.status) ? (r.status as EmailStatus) : "failed",
        providerId: r.providerId,
        error: r.error,
        durationMs: r.durationMs,
        orgName: r.organizationId ? (orgName.get(r.organizationId) ?? "Deleted company") : null,
      }))
    : null;

  return (
    <AdminMailLogContent
      rows={rows}
      capped={(read?.[0].length ?? 0) >= ROW_LIMIT}
      counts={counts}
      filters={{ period, status, kind, q }}
      dailyLimit={emailDailyLimit()}
    />
  );
}

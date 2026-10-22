// THE MAIL LOG (2026-10-21) — server only (database).
//
// Every letter lib/sdk/resend sendEmail() handles files one EmailLog row:
// "sent" with the transport's id (an SMTP Message-ID, a Resend id), "failed"
// with the last attempt's error once the retries are spent, or "skipped" with
// the marker sendEmail returned (QA test mode, the preview guard, the dev
// outbox, no transport). Before this the only trace was "email:last-sent", so
// "the code never came" could not be told from "the letter left".
//
// The row is written after the response (next/server `after`), the way
// lib/trialMeter writes its spend; outside a request it is written at once.
// Nothing here throws into a send: a failed write is a console.warn. The
// organization is the request's (requireOrg notes it, lib/trialMeter
// requestOrgId) unless the caller names one.
//
// THE DAILY LIMIT. Gmail SMTP stops sending for the day at ~500 letters on an
// ordinary account (2000 on Workspace) — the sign-in codes fail first.
// EMAIL_DAILY_LIMIT (default 500) is the ceiling; each "sent" row counts the
// UTC day's sent rows, and at 80% and 95% the team gets one text per
// threshold per day (lib/adminAlerts, alert "email"), claimed in SyncState
// `email:limit-alert:<day>:<pct>` so a burst cannot text twice.
import { db } from "@/lib/db";
import { isEmailKind, type EmailKind, type EmailStatus, type EmailTransport } from "@/lib/emailLogShared";

export { EMAIL_KINDS, EMAIL_STATUSES, isEmailKind, isEmailStatus, type EmailKind, type EmailStatus, type EmailTransport } from "@/lib/emailLogShared";

/** Rows older than this are dropped by /api/cron/daily-cleanup. */
export const EMAIL_LOG_KEEP_DAYS = 90;
const ERROR_MAX = 500;
const SUBJECT_MAX = 300;
const TO_MAX = 1000;

export const EMAIL_LIMIT_DEFAULT = 500;
const LIMIT_THRESHOLDS = [80, 95] as const;

export function emailDailyLimit(): number {
  const n = Number(process.env.EMAIL_DAILY_LIMIT);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : EMAIL_LIMIT_DEFAULT;
}

/** Midnight UTC of `now`'s day — the day the limit counts. */
export const utcDayStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export const emailRecipients = (to: string | string[]) =>
  (Array.isArray(to) ? to : [to]).map((a) => a.trim().toLowerCase()).filter(Boolean).join(", ").slice(0, TO_MAX);

/** The error as one line: the message, and the SMTP/HTTP code when there is one. */
function errorText(err: unknown): string {
  const e = (err ?? {}) as { message?: unknown; code?: unknown; responseCode?: unknown; name?: unknown };
  const msg = typeof e.message === "string" && e.message ? e.message : String(err);
  const code = typeof e.responseCode === "number" ? e.responseCode : typeof e.code === "string" || typeof e.code === "number" ? e.code : null;
  const line = code !== null && !msg.includes(String(code)) ? `${code} ${msg}` : msg;
  return line.replace(/\s+/g, " ").trim().slice(0, ERROR_MAX);
}

export type EmailLogEntry = {
  to: string | string[];
  subject: string;
  kind?: EmailKind;
  transport: EmailTransport;
  status: EmailStatus;
  providerId?: string | null;
  error?: unknown;
  durationMs: number;
  organizationId?: string | null;
};

/** File one letter. Never throws, never holds the send up. */
export async function recordEmail(entry: EmailLogEntry): Promise<void> {
  try {
    let organizationId = entry.organizationId ?? null;
    if (!organizationId) {
      const { requestOrgId } = await import("@/lib/trialMeter");
      organizationId = await requestOrgId().catch(() => null);
    }
    const data = {
      to: emailRecipients(entry.to),
      subject: (entry.subject ?? "").slice(0, SUBJECT_MAX),
      kind: isEmailKind(entry.kind) ? entry.kind : "other",
      transport: entry.transport,
      status: entry.status,
      providerId: entry.providerId ? String(entry.providerId).slice(0, 300) : null,
      error: entry.error === undefined || entry.error === null ? null : errorText(entry.error),
      durationMs: Math.max(0, Math.round(entry.durationMs)),
      organizationId,
    };
    const write = () => writeEntry(data);
    try {
      const { after } = await import("next/server");
      after(write);
    } catch {
      await write(); // no `after` here (a script, a cron outside a request) — write now
    }
  } catch (err) {
    console.warn("[email-log] not recorded:", err instanceof Error ? err.message : err);
  }
}

async function writeEntry(data: Parameters<typeof db.emailLog.create>[0]["data"]): Promise<void> {
  try {
    await db.emailLog.create({ data });
  } catch (err) {
    console.warn("[email-log] not written:", err instanceof Error ? err.message : err);
    return;
  }
  if (data.status === "sent") await checkEmailLimit();
}

// ── the daily limit ─────────────────────────────────────────────────────────

export async function emailsSentToday(now = new Date()): Promise<number> {
  return db.emailLog.count({ where: { status: "sent", createdAt: { gte: utcDayStart(now) } } });
}

/** Thresholds this instance already claimed, so a busy day is not a claim per send. */
const claimed = new Set<string>();
const limitKey = (day: string, pct: number) => `email:limit-alert:${day}:${pct}`;

/** After a sent letter: past 80% or 95% of the day's limit, text the team once
 *  per threshold per UTC day. A burst that crosses both at once is one text. */
export async function checkEmailLimit(now = new Date()): Promise<void> {
  try {
    const day = now.toISOString().slice(0, 10);
    const limit = emailDailyLimit();
    const open = LIMIT_THRESHOLDS.filter((pct) => !claimed.has(limitKey(day, pct)));
    if (!open.length) return;
    const sent = await emailsSentToday(now);
    const fresh: number[] = [];
    for (const pct of open) {
      if (sent * 100 < pct * limit) continue;
      const key = limitKey(day, pct);
      claimed.add(key);
      try {
        await db.syncState.create({ data: { key, cursor: JSON.stringify({ sent, limit, at: now.toISOString() }) } });
        fresh.push(pct);
      } catch {
        /* claimed by another instance — already told */
      }
    }
    if (!fresh.length) return;
    const pct = Math.max(...fresh);
    console.warn(`[email-log] ${sent} of ${limit} letters sent today (UTC) — past ${pct}% of the daily limit`);
    const { fireAdminAlert, admin } = await import("@/lib/adminAlerts");
    await fireAdminAlert(
      "email",
      `JobFlex: ${sent} of ${limit} emails sent today (UTC) — ${pct}% of the daily sending limit. Past it, sign-in codes stop going out. ${await admin("/admin/mail/log")}`,
    );
  } catch (err) {
    console.warn("[email-log] limit check failed:", err instanceof Error ? err.message : err);
  }
}

// ── the readouts (/admin/health, lib/integrationsHealth) ────────────────────

export type EmailDaySummary = {
  sent: number;
  failed: number;
  skipped: number;
  limit: number;
  lastFailure: { at: string; to: string; subject: string; error: string | null } | null;
};

/** Today's (UTC) counts and the newest failure of any day. Null when the
 *  table is not in this database yet (prisma/sql/prod-2026-10-21-email-log.sql). */
export async function emailDaySummary(now = new Date()): Promise<EmailDaySummary | null> {
  try {
    const since = utcDayStart(now);
    const [groups, last] = await Promise.all([
      db.emailLog.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      db.emailLog.findFirst({ where: { status: "failed" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, to: true, subject: true, error: true } }),
    ]);
    const n = (s: EmailStatus) => groups.find((g) => g.status === s)?._count._all ?? 0;
    return {
      sent: n("sent"),
      failed: n("failed"),
      skipped: n("skipped"),
      limit: emailDailyLimit(),
      lastFailure: last ? { at: last.createdAt.toISOString(), to: last.to, subject: last.subject, error: last.error } : null,
    };
  } catch {
    return null;
  }
}

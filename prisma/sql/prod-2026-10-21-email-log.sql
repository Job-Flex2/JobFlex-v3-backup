-- PRODUCTION SCHEMA, 2026-10-21 — one row per letter sendEmail() handled
-- (EmailLog): sent, failed after the retries, or skipped. Read by
-- /admin/mail/log, the /admin/health mail card and the daily-limit alert.
-- Postgres (Neon). Safe in either order with the deploy: without the table
-- every send still goes out (the log write fails with a console.warn), and
-- /admin/mail/log says "not set up".
--
-- ADDITIONS ONLY: one new table and its indexes. No foreign key — a deleted
-- company's rows age out with the rest (daily-cleanup drops rows older than
-- 90 days). No existing table, column, index or constraint is altered,
-- renamed or dropped, and no row is touched. Re-runnable: every statement is
-- IF NOT EXISTS, so a second run changes nothing.
--
-- Generated from `prisma migrate diff` (schema before → after, provider
-- postgresql) and guarded by hand. Prisma names: quoted camelCase.

BEGIN;

CREATE TABLE IF NOT EXISTS "EmailLog" (
  "id"             TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "to"             TEXT NOT NULL,                    -- lowercased, several joined by ", "
  "subject"        TEXT NOT NULL,
  "kind"           TEXT NOT NULL DEFAULT 'other',    -- lib/emailLog EMAIL_KINDS
  "transport"      TEXT NOT NULL,                    -- smtp | resend | skipped
  "status"         TEXT NOT NULL,                    -- sent | failed | skipped
  "providerId"     TEXT,
  "error"          TEXT,
  "durationMs"     INTEGER NOT NULL DEFAULT 0,
  "organizationId" TEXT,
  CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EmailLog_createdAt_idx" ON "EmailLog" ("createdAt");
CREATE INDEX IF NOT EXISTS "EmailLog_to_idx" ON "EmailLog" ("to");
CREATE INDEX IF NOT EXISTS "EmailLog_kind_idx" ON "EmailLog" ("kind");
CREATE INDEX IF NOT EXISTS "EmailLog_status_idx" ON "EmailLog" ("status");

COMMIT;

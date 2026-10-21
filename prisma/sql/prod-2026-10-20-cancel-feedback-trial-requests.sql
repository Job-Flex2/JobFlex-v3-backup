-- PRODUCTION SCHEMA, 2026-10-20 — why a plan was cancelled (CancellationFeedback)
-- and the trial-extension asks from "Before you go" (TrialExtensionRequest).
-- Postgres (Neon). Apply BEFORE the code that writes these tables is deployed:
-- without CancellationFeedback the cancel still goes through (the reason is
-- logged as lost), but /admin/cancellations and /admin/trial-requests say
-- "not set up" and a trial-extension request is refused.
--
-- ADDITIONS ONLY: two new tables, their indexes and foreign keys. No existing
-- table, column, index or constraint is altered, renamed or dropped, and no row
-- is touched. Organization and User gained back-relation fields in
-- schema.prisma, which are Prisma-side only and produce no SQL. Re-runnable:
-- every statement is IF NOT EXISTS or guarded, so a second run changes nothing.
--
-- Generated from `prisma migrate diff` (schema before → after, provider
-- postgresql) and guarded by hand. Prisma names: quoted camelCase.

BEGIN;

CREATE TABLE IF NOT EXISTS "CancellationFeedback" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT,
  "plan"           TEXT NOT NULL,
  "reasons"        TEXT NOT NULL DEFAULT '[]',   -- JSON array of lib/cancelFeedback keys
  "otherText"      TEXT,
  "periodEnd"      TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CancellationFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TrialExtensionRequest" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT,
  "requestedDays"  INTEGER NOT NULL,
  "note"           TEXT,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | DENIED
  "plan"           TEXT,
  "trialStartedAt" TIMESTAMP(3),
  "trialEndsAt"    TIMESTAMP(3),
  "grantedDays"    INTEGER,
  "extendedUntil"  TIMESTAMP(3),
  "localOnly"      BOOLEAN NOT NULL DEFAULT false,
  "decisionNote"   TEXT,
  "decidedBy"      TEXT,
  "decidedAt"      TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrialExtensionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CancellationFeedback_organizationId_createdAt_idx" ON "CancellationFeedback" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "CancellationFeedback_createdAt_idx" ON "CancellationFeedback" ("createdAt");
CREATE INDEX IF NOT EXISTS "TrialExtensionRequest_organizationId_status_idx" ON "TrialExtensionRequest" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "TrialExtensionRequest_status_createdAt_idx" ON "TrialExtensionRequest" ("status", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CancellationFeedback_organizationId_fkey') THEN
    ALTER TABLE "CancellationFeedback" ADD CONSTRAINT "CancellationFeedback_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CancellationFeedback_userId_fkey') THEN
    ALTER TABLE "CancellationFeedback" ADD CONSTRAINT "CancellationFeedback_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrialExtensionRequest_organizationId_fkey') THEN
    ALTER TABLE "TrialExtensionRequest" ADD CONSTRAINT "TrialExtensionRequest_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrialExtensionRequest_userId_fkey') THEN
    ALTER TABLE "TrialExtensionRequest" ADD CONSTRAINT "TrialExtensionRequest_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrialExtensionRequest_decidedBy_fkey') THEN
    ALTER TABLE "TrialExtensionRequest" ADD CONSTRAINT "TrialExtensionRequest_decidedBy_fkey"
      FOREIGN KEY ("decidedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;

-- Check after:
--   SELECT count(*) FROM "CancellationFeedback";    -- 0
--   SELECT count(*) FROM "TrialExtensionRequest";   -- 0
--   SELECT conname FROM pg_constraint
--    WHERE conname LIKE 'CancellationFeedback%' OR conname LIKE 'TrialExtensionRequest%' ORDER BY 1;   -- 2 pkeys + 5 fkeys

-- PRODUCTION SCHEMA, 2026-10-21 — why plan charges fail (PaymentFailure).
-- Postgres (Neon). Apply BEFORE the code that writes this table is deployed:
-- without it the Stripe webhook still does everything it did (past due, the
-- dunning email, the team's text, the owner's text) and logs the lost record,
-- and /admin/revenue/failed-payments says "not set up".
--
-- ADDITIONS ONLY: one new table, its indexes and its foreign key. No existing
-- table, column, index or constraint is altered, renamed or dropped, and no row
-- is touched. Organization gained a back-relation field in schema.prisma, which
-- is Prisma-side only and produces no SQL. Re-runnable: every statement is
-- IF NOT EXISTS or guarded, so a second run changes nothing.
--
-- Generated from `prisma migrate diff` (schema before → after, provider
-- postgresql) and guarded by hand. Prisma names: quoted camelCase.
-- The rows of the last 90 days come from scripts/backfill-payment-failures.ts
-- (dry run by default; --write), run after this.

BEGIN;

CREATE TABLE IF NOT EXISTS "PaymentFailure" (
  "id"                   TEXT NOT NULL,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId"       TEXT,
  "subscriptionId"       TEXT,                                 -- our Subscription.id
  "stripeInvoiceId"      TEXT NOT NULL,
  "stripeSubscriptionId" TEXT,
  "attempt"              INTEGER NOT NULL,                     -- the invoice's attempt_count for this try
  "amountCents"          INTEGER NOT NULL,
  "currency"             TEXT NOT NULL DEFAULT 'usd',
  "billingReason"        TEXT,                                 -- subscription_cycle | subscription_create | subscription_update | …
  "declineCode"          TEXT,
  "errorCode"            TEXT,
  "errorMessage"         TEXT,                                 -- ≤ 300 characters
  "cardBrand"            TEXT,
  "cardFunding"          TEXT NOT NULL DEFAULT 'unknown',      -- credit | debit | prepaid | unknown
  "cardLast4"            TEXT,
  "isTrialEnd"           BOOLEAN NOT NULL DEFAULT false,
  "ignored"              BOOLEAN NOT NULL DEFAULT false,
  "recoveredAt"          TIMESTAMP(3),
  CONSTRAINT "PaymentFailure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentFailure_stripeInvoiceId_attempt_key" ON "PaymentFailure" ("stripeInvoiceId", "attempt");
CREATE INDEX IF NOT EXISTS "PaymentFailure_createdAt_idx" ON "PaymentFailure" ("createdAt");
CREATE INDEX IF NOT EXISTS "PaymentFailure_organizationId_createdAt_idx" ON "PaymentFailure" ("organizationId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentFailure_organizationId_fkey') THEN
    ALTER TABLE "PaymentFailure" ADD CONSTRAINT "PaymentFailure_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;

-- Check after:
--   SELECT count(*) FROM "PaymentFailure";   -- 0 until the backfill or the first failed charge
--   SELECT indexname FROM pg_indexes WHERE tablename = 'PaymentFailure' ORDER BY 1;   -- pkey + 3
--   SELECT conname FROM pg_constraint WHERE conname LIKE 'PaymentFailure%' ORDER BY 1;  -- pkey + 1 fkey

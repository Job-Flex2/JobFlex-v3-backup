-- PRODUCTION SCHEMA, 2026-10-22 — what the paid APIs cost us, per
-- organization, per UTC day, per service and operation (ApiSpendDaily).
-- Written by lib/apiSpend after each request that made billed calls (every
-- organization, QA organizations excepted); read by /admin/usage and the
-- /admin/users account sheet. Postgres (Neon). Safe in either order with the
-- deploy: without the table every paid call still goes out (the spend write
-- fails with a console.warn), and /admin/usage says "not set up".
--
-- ADDITIONS ONLY: one new table and its indexes. No foreign key — a deleted
-- company's rows age out with the rest (daily-cleanup drops rows older than
-- 13 months). No existing table, column, index or constraint is altered,
-- renamed or dropped, and no row is touched. Re-runnable: every statement is
-- IF NOT EXISTS, so a second run changes nothing.
--
-- Generated from `prisma migrate diff` (schema before → after, provider
-- postgresql) and guarded by hand. Prisma names: quoted camelCase.

BEGIN;

CREATE TABLE IF NOT EXISTS "ApiSpendDaily" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "day"            TIMESTAMP(3) NOT NULL,              -- UTC midnight
  "service"        TEXT NOT NULL,                      -- lib/paidApiCosts PaidService
  "op"             TEXT NOT NULL,
  "calls"          INTEGER NOT NULL DEFAULT 0,
  "cents"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "ApiSpendDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApiSpendDaily_organizationId_day_service_op_key" ON "ApiSpendDaily" ("organizationId", "day", "service", "op");
CREATE INDEX IF NOT EXISTS "ApiSpendDaily_day_idx" ON "ApiSpendDaily" ("day");

COMMIT;

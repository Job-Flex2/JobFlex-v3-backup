-- PRODUCTION SCHEMA, 2026-10-26 — the in-app guide to a person's first
-- estimate (OnboardingProgress). One row per person × organization × tour:
-- which estimator path, the step reached, active / paused / completed /
-- skipped. Written by actions/onboarding, read by lib/onboarding/progress in
-- the dashboard layout. Postgres (Neon). Safe in either order with the deploy:
-- without the table the read fails quietly and no tour is shown.
--
-- ADDITIONS ONLY: one new table and its indexes. No foreign key — a deleted
-- account's rows are inert. No existing table, column, index or constraint is
-- altered, renamed or dropped, and no row is touched. Re-runnable: every
-- statement is IF NOT EXISTS, so a second run changes nothing.
--
-- Prisma names: quoted camelCase.

BEGIN;

CREATE TABLE IF NOT EXISTS "OnboardingProgress" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "tour"           TEXT NOT NULL,                      -- first_estimate | next_steps
  "path"           TEXT NOT NULL,                      -- roof | fence | hvac | smart | deck | manual | next
  "step"           INTEGER NOT NULL DEFAULT 0,
  "status"         TEXT NOT NULL DEFAULT 'active',     -- active | paused | completed | skipped
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"    TIMESTAMP(3),
  "skippedAt"      TIMESTAMP(3),
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnboardingProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OnboardingProgress_userId_organizationId_tour_key" ON "OnboardingProgress" ("userId", "organizationId", "tour");
CREATE INDEX IF NOT EXISTS "OnboardingProgress_organizationId_idx" ON "OnboardingProgress" ("organizationId");

COMMIT;

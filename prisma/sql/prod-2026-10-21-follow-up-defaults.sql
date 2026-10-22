-- PRODUCTION SCHEMA, 2026-10-21 — starter follow-up rules (lib/followUps/defaults).
-- Postgres (Neon). Apply BEFORE the code that reads FollowUpRule.isDefault is
-- deployed: without the columns /dashboard/follow-ups, the CRM rules list and
-- the signup's ensureDefaultFollowUpRules fail on the unknown column.
--
-- ADDITIONS ONLY: two columns on FollowUpRule and one unique index. No row is
-- touched (existing rules read isDefault = false, defaultKey = NULL, and NULLs
-- never collide in a unique index). Re-runnable: every statement is
-- IF NOT EXISTS, so a second run changes nothing.
--
-- Then, after the deploy, the backfill for existing companies (dry run first):
--   npx tsx --tsconfig tsconfig.json scripts/backfill-follow-up-defaults.ts --prod
--   npx tsx --tsconfig tsconfig.json scripts/backfill-follow-up-defaults.ts --prod --write

BEGIN;

ALTER TABLE "FollowUpRule" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FollowUpRule" ADD COLUMN IF NOT EXISTS "defaultKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "FollowUpRule_organizationId_defaultKey_key"
  ON "FollowUpRule"("organizationId", "defaultKey");

COMMIT;

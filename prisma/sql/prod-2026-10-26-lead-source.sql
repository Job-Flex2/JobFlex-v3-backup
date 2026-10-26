-- PRODUCTION SCHEMA, 2026-10-26 — where a homeowner request came from
-- (LeadSource): the public cost guides (/cost/<work>/<city>) send
-- "seo:<work>:<city>" with the request they start on /homeowner. Read by
-- anyone counting what the guides bring in.
-- Postgres (Neon). Safe in either order with the deploy: without the table
-- every request still goes through (the source write fails with a
-- console.warn and the lead stands).
--
-- ADDITIONS ONLY: one new table and its indexes. No foreign key. No existing
-- table, column, index or constraint is altered, renamed or dropped, and no
-- row is touched. Re-runnable: every statement is IF NOT EXISTS.
--
-- Written to match `prisma migrate diff` for the model (provider
-- postgresql). Prisma names: quoted camelCase.

BEGIN;

CREATE TABLE IF NOT EXISTS "LeadSource" (
  "id"             TEXT NOT NULL,
  "platformLeadId" TEXT NOT NULL,
  "source"         TEXT NOT NULL,                    -- seo:<work>:<city>
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LeadSource_platformLeadId_key" ON "LeadSource" ("platformLeadId");
CREATE INDEX IF NOT EXISTS "LeadSource_source_idx" ON "LeadSource" ("source");

COMMIT;

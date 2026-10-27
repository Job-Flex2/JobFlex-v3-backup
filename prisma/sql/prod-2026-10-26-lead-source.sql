-- PRODUCTION SCHEMA, 2026-10-26 — where a homeowner request came from and
-- the TCPA consent it was sent with (LeadSource). The public cost guides
-- (/cost/<work>/<city>) send "seo:<work>:<city>" with the request they start
-- on /homeowner; every request carries the consent the homeowner ticked —
-- the exact words, when, from which IP and on which page (lib/leadConsent).
-- Postgres (Neon). Apply BEFORE the deploy: without the table every request
-- still goes through (the write fails with a console.error and the lead
-- stands), but its consent record would be lost.
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
  "source"         TEXT,                             -- seo:<work>:<city>, else null
  "consentText"    TEXT,                             -- the words beside the ticked box
  "consentAt"      TIMESTAMP(3),
  "consentIp"      TEXT,
  "consentPage"    TEXT,                             -- path + query the request was sent from
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LeadSource_platformLeadId_key" ON "LeadSource" ("platformLeadId");
CREATE INDEX IF NOT EXISTS "LeadSource_source_idx" ON "LeadSource" ("source");

COMMIT;

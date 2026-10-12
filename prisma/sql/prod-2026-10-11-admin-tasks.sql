-- PRODUCTION SCHEMA, 2026-10-11 — the admin task tracker (/admin/tasks). Postgres (Neon).
-- Apply BEFORE the code that reads these tables is deployed.
--
-- ADDITIONS ONLY: four new tables, their indexes and foreign keys. No existing
-- table, column, index or constraint is altered, renamed or dropped, and no row
-- is touched. The User model gained back-relation fields in schema.prisma, which
-- are Prisma-side only and produce no SQL. Re-runnable: every statement is
-- IF NOT EXISTS or guarded, so a second run changes nothing.
--
-- Generated from `prisma migrate diff` (schema before → after, provider
-- postgresql) and guarded by hand. Prisma names: quoted camelCase.

BEGIN;

CREATE TABLE IF NOT EXISTS "AdminTask" (
  "id"              TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "description"     TEXT NOT NULL DEFAULT '',
  "priority"        TEXT NOT NULL DEFAULT 'NORMAL',  -- URGENT | HIGH | NORMAL | LOW
  "status"          TEXT NOT NULL DEFAULT 'TODO',    -- TODO | IN_PROGRESS | BLOCKED | DONE | CANCELED
  "category"        TEXT NOT NULL DEFAULT 'OTHER',   -- BUG | FEATURE | SUPPORT | BILLING | MARKETING | OTHER
  "assigneeId"      TEXT,
  "authorId"        TEXT,
  "dueDate"         TEXT,                            -- "2026-10-14"
  "linkUrl"         TEXT,
  "supportTicketId" TEXT,
  "closedAt"        TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminTaskSubtask" (
  "id"         TEXT NOT NULL,
  "taskId"     TEXT NOT NULL,
  "title"      TEXT NOT NULL,
  "done"       BOOLEAN NOT NULL DEFAULT false,
  "assigneeId" TEXT,
  "position"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminTaskSubtask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminTaskComment" (
  "id"        TEXT NOT NULL,
  "taskId"    TEXT NOT NULL,
  "authorId"  TEXT,
  "body"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminTaskComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminTaskEvent" (
  "id"        TEXT NOT NULL,
  "taskId"    TEXT NOT NULL,
  "actorId"   TEXT,
  "kind"      TEXT NOT NULL,
  "from"      TEXT,
  "to"        TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminTaskEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminTask_supportTicketId_key" ON "AdminTask" ("supportTicketId");
CREATE INDEX IF NOT EXISTS "AdminTask_updatedAt_idx" ON "AdminTask" ("updatedAt");
CREATE INDEX IF NOT EXISTS "AdminTask_status_idx" ON "AdminTask" ("status");
CREATE INDEX IF NOT EXISTS "AdminTask_assigneeId_status_idx" ON "AdminTask" ("assigneeId", "status");
CREATE INDEX IF NOT EXISTS "AdminTaskSubtask_taskId_position_idx" ON "AdminTaskSubtask" ("taskId", "position");
CREATE INDEX IF NOT EXISTS "AdminTaskComment_taskId_createdAt_idx" ON "AdminTaskComment" ("taskId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminTaskEvent_taskId_createdAt_idx" ON "AdminTaskEvent" ("taskId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdminTask_assigneeId_fkey') THEN
    ALTER TABLE "AdminTask" ADD CONSTRAINT "AdminTask_assigneeId_fkey"
      FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdminTask_authorId_fkey') THEN
    ALTER TABLE "AdminTask" ADD CONSTRAINT "AdminTask_authorId_fkey"
      FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdminTaskSubtask_taskId_fkey') THEN
    ALTER TABLE "AdminTaskSubtask" ADD CONSTRAINT "AdminTaskSubtask_taskId_fkey"
      FOREIGN KEY ("taskId") REFERENCES "AdminTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdminTaskSubtask_assigneeId_fkey') THEN
    ALTER TABLE "AdminTaskSubtask" ADD CONSTRAINT "AdminTaskSubtask_assigneeId_fkey"
      FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdminTaskComment_taskId_fkey') THEN
    ALTER TABLE "AdminTaskComment" ADD CONSTRAINT "AdminTaskComment_taskId_fkey"
      FOREIGN KEY ("taskId") REFERENCES "AdminTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdminTaskComment_authorId_fkey') THEN
    ALTER TABLE "AdminTaskComment" ADD CONSTRAINT "AdminTaskComment_authorId_fkey"
      FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdminTaskEvent_taskId_fkey') THEN
    ALTER TABLE "AdminTaskEvent" ADD CONSTRAINT "AdminTaskEvent_taskId_fkey"
      FOREIGN KEY ("taskId") REFERENCES "AdminTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdminTaskEvent_actorId_fkey') THEN
    ALTER TABLE "AdminTaskEvent" ADD CONSTRAINT "AdminTaskEvent_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;

-- Check after:
--   SELECT count(*) FROM "AdminTask";   -- 0
--   SELECT conname FROM pg_constraint WHERE conname LIKE 'AdminTask%' ORDER BY 1;   -- 4 pkeys + 8 fkeys

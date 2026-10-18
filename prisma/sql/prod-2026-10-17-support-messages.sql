-- PRODUCTION SCHEMA + DATA, 2026-10-17 — one conversation per support ticket
-- (SupportMessage). Postgres (Neon). Apply BEFORE the code that reads it is
-- deployed: from then on every support page reads SupportTicket."lastMessageAt"
-- and the SupportMessage table.
--
-- WHAT IT DOES, in one transaction:
--   1. SupportTicket gains "lastMessageAt" (NOT NULL, default now) and an index.
--   2. The SupportMessage table, its two indexes and two foreign keys.
--   3. Copies every answer kept so far in SyncState "supportReplies:<ticketId>"
--      (a JSON list, oldest first: {id, at, by, to, body, ai?, kind?}) into
--      SupportMessage — from 'ai' when ai is true, else 'team'; channel 'app'.
--      Rows whose ticket is gone are skipped. The SyncState rows are LEFT IN
--      PLACE (nothing reads them any more; drop them later by hand if wanted).
--   4. "lastMessageAt" = the ticket's latest message, or its createdAt.
--
-- Nothing is renamed or dropped. The User model gained a back-relation field
-- in schema.prisma, which is Prisma-side only and produces no SQL.
--
-- RE-RUNNABLE: every statement is IF NOT EXISTS, guarded, or ON CONFLICT DO
-- NOTHING (the copy keeps each answer's own id). Run it a SECOND time right
-- after the new code is live: an answer the old code wrote between the first
-- run and the deploy is then copied too, and nothing already copied changes.
--
-- Generated from `prisma migrate diff` (schema before → after, provider
-- postgresql) and guarded by hand. Prisma names: quoted camelCase.

BEGIN;

-- 1 ── the ticket's place in the queue
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "SupportTicket_lastMessageAt_idx" ON "SupportTicket" ("lastMessageAt");

-- 2 ── the conversation
CREATE TABLE IF NOT EXISTS "SupportMessage" (
  "id"             TEXT NOT NULL,
  "ticketId"       TEXT NOT NULL,
  "from"           TEXT NOT NULL,                  -- customer | team | ai
  "authorUserId"   TEXT,
  "authorName"     TEXT,
  "body"           TEXT NOT NULL,
  "channel"        TEXT NOT NULL DEFAULT 'app',    -- app | email
  "kind"           TEXT,                           -- answer | ack | fixed (the AI's sends)
  "sentTo"         TEXT,
  "emailMessageId" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage" ("ticketId", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportMessage_emailMessageId_idx" ON "SupportMessage" ("emailMessageId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportMessage_ticketId_fkey') THEN
    ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportMessage_authorUserId_fkey') THEN
    ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_authorUserId_fkey"
      FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 3 ── the answers kept so far, moved over (a list that is not valid JSON is skipped)
INSERT INTO "SupportMessage" ("id", "ticketId", "from", "authorName", "body", "channel", "kind", "sentTo", "createdAt")
SELECT
  r->>'id',
  t."id",
  CASE WHEN COALESCE(r->>'ai', 'false') = 'true' THEN 'ai' ELSE 'team' END,
  NULLIF(r->>'by', ''),
  r->>'body',
  'app',
  CASE WHEN r->>'kind' IN ('answer', 'ack', 'fixed') THEN r->>'kind' ELSE NULL END,
  NULLIF(r->>'to', ''),
  (r->>'at')::timestamptz AT TIME ZONE 'UTC'
FROM "SyncState" s
JOIN "SupportTicket" t ON t."id" = substring(s."key" FROM length('supportReplies:') + 1)
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN s."cursor" ~ '^\s*\[' THEN s."cursor"::jsonb ELSE '[]'::jsonb END
) AS r
WHERE s."key" LIKE 'supportReplies:%'
  AND COALESCE(r->>'id', '') <> ''
  AND COALESCE(r->>'body', '') <> ''
  AND COALESCE(r->>'at', '') <> ''
ON CONFLICT ("id") DO NOTHING;

-- 4 ── each ticket's latest message
UPDATE "SupportTicket" t
SET "lastMessageAt" = GREATEST(t."createdAt", COALESCE(m.latest, t."createdAt"))
FROM (
  SELECT tt."id" AS ticket_id, MAX(sm."createdAt") AS latest
  FROM "SupportTicket" tt
  LEFT JOIN "SupportMessage" sm ON sm."ticketId" = tt."id"
  GROUP BY tt."id"
) m
WHERE m.ticket_id = t."id";

COMMIT;

-- Check after:
--   SELECT count(*) FROM "SupportMessage";                              -- = answers in the SyncState lists
--   SELECT count(*) FROM "SyncState" WHERE "key" LIKE 'supportReplies:%';   -- unchanged
--   SELECT count(*) FROM "SupportTicket" WHERE "lastMessageAt" < "createdAt";   -- 0
--   SELECT conname FROM pg_constraint WHERE conname LIKE 'SupportMessage%' ORDER BY 1;   -- pkey + 2 fkeys

-- ============================================================================
-- Safety bot (Jev) policy — CommunityModerationRule plus CommunityFlag.action /
-- CommunityFlag.reason in schema.prisma. Additive and idempotent: safe to re-run.
--
-- ⚠️ Apply BEFORE deploying the server code that reads it: every member post
--    reads the store's rules, and the moderators' queue selects the new columns.
--
-- APPLY (privileged role). On a deployment whose DATABASE_URL has ?schema=X,
-- set the search_path first (Mama Mica's community lives in schema "pepweb"):
--     SET search_path TO pepweb;   -- only for a ?schema=pepweb deployment
--     \i prisma/community-moderation-rules.sql
-- Equivalent to `prisma db push` for these changes.
-- ============================================================================

ALTER TABLE "community_flags"
  ADD COLUMN IF NOT EXISTS "action" TEXT NOT NULL DEFAULT 'hide',
  ADD COLUMN IF NOT EXISTS "reason" TEXT;

CREATE TABLE IF NOT EXISTS "community_moderation_rules" (
  "id"        TEXT         NOT NULL,
  "tenantId"  TEXT         NOT NULL,
  "type"      TEXT         NOT NULL,
  "kind"      TEXT         NOT NULL,
  "text"      TEXT         NOT NULL,
  "source"    TEXT         NOT NULL DEFAULT 'owner',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_moderation_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "community_moderation_rules_tenantId_type_createdAt_idx"
  ON "community_moderation_rules" ("tenantId", "type", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_moderation_rules_tenantId_fkey') THEN
    ALTER TABLE "community_moderation_rules" ADD CONSTRAINT "community_moderation_rules_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- Same owner as the other community tables, so the app role can use it.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pepweb_app') THEN
    ALTER TABLE "community_moderation_rules" OWNER TO pepweb_app;
  END IF;
END $$;

-- ============================================================================
-- community_channel_mutes — per-member channel mute (CommunityChannelMute in
-- schema.prisma). Additive and idempotent: safe to re-run.
--
-- ⚠️ Apply BEFORE deploying the server code that reads it: the inbox queries
--    this table for every member, so a deploy without it breaks Chats.
--
-- APPLY (privileged role). On a deployment whose DATABASE_URL has ?schema=X,
-- set the search_path first (Mama Mica's community lives in schema "pepweb"):
--     SET search_path TO pepweb;   -- only for a ?schema=pepweb deployment
--     \i prisma/community-channel-mutes.sql
-- Equivalent to `prisma db push` for this one model.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "community_channel_mutes" (
  "id"             TEXT         NOT NULL,
  "tenantId"       TEXT         NOT NULL,
  "channelId"      TEXT         NOT NULL,
  "participantKey" TEXT         NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_channel_mutes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "community_channel_mutes_tenantId_participantKey_channelId_key"
  ON "community_channel_mutes" ("tenantId", "participantKey", "channelId");
CREATE INDEX IF NOT EXISTS "community_channel_mutes_channelId_idx"
  ON "community_channel_mutes" ("channelId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_channel_mutes_tenantId_fkey') THEN
    ALTER TABLE "community_channel_mutes" ADD CONSTRAINT "community_channel_mutes_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_channel_mutes_channelId_fkey') THEN
    ALTER TABLE "community_channel_mutes" ADD CONSTRAINT "community_channel_mutes_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "community_channels" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- Same owner as the other community tables, so the app role can use it.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pepweb_app') THEN
    ALTER TABLE "community_channel_mutes" OWNER TO pepweb_app;
  END IF;
END $$;

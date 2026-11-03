-- ============================================================================
-- live_presence — "Live now" visitor heartbeats (LivePresence in
-- schema.prisma, lib/presence/live.ts). Additive and idempotent: safe to re-run.
--
-- ⚠️ Apply BEFORE deploying the code that writes it. Until then every
--    heartbeat answers 500 (the beacon ignores it) and the app's Live screen
--    errors — nothing else breaks.
--
-- APPLY (privileged role):  \i prisma/live-presence.sql
-- Equivalent to `prisma db push` for this one model, plus the Data API lockdown
-- (prisma/lockdown-public-api.sql) for the new table.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "live_presence" (
  "id"          TEXT             NOT NULL,
  "tenantId"    TEXT             NOT NULL,
  "visitorId"   TEXT             NOT NULL,
  "surface"     TEXT             NOT NULL,
  "stage"       TEXT             NOT NULL DEFAULT 'browsing',
  "productRef"  TEXT,
  "cartItems"   INTEGER          NOT NULL DEFAULT 0,
  "cartValue"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency"    TEXT,
  "customerId"  TEXT,
  "city"        TEXT,
  "region"      TEXT,
  "country"     TEXT,
  "firstSeenAt" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "live_presence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "live_presence_tenantId_visitorId_key"
  ON "live_presence" ("tenantId", "visitorId");
CREATE INDEX IF NOT EXISTS "live_presence_tenantId_lastSeenAt_idx"
  ON "live_presence" ("tenantId", "lastSeenAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'live_presence_tenantId_fkey') THEN
    ALTER TABLE "live_presence" ADD CONSTRAINT "live_presence_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pepweb_app') THEN
    ALTER TABLE "live_presence" OWNER TO pepweb_app;
  END IF;
END $$;

-- No Data API (PostgREST) access: the app reaches it through Prisma only.
REVOKE ALL ON "live_presence" FROM anon, authenticated;

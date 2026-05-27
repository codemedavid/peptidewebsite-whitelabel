-- ============================================================================
-- LEAST-PRIVILEGE DB ROLES for the peptide white-label SaaS.
--
-- Run this ONCE, as a privileged role (Supabase `postgres`, or any superuser),
-- BEFORE prisma/rls.sql:
--
--     psql "$DIRECT_URL" -f prisma/roles.sql      # $DIRECT_URL = postgres role
--
-- It creates `app_user` — the role the application runtime connects as. It is
-- deliberately NOT a superuser and NOT BYPASSRLS, so the FORCEd policies in
-- rls.sql actually constrain it. Migrations and seeds keep using the privileged
-- `postgres` role (DIRECT_URL), which on Supabase carries BYPASSRLS.
--
-- ⚠️ Replace the password below before running, then point the app's
--    DATABASE_URL at this role (see docs/RLS.md).
-- ============================================================================

-- ── app_user: the runtime role (subject to RLS) ────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- ── anon: read-only storefront role (Supabase ships this; create for parity) ─
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- ── Schema usage ────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO app_user, anon;

-- ── app_user: full DML on existing tables; RLS decides which ROWS it sees ───
-- (Global catalog tables — plans, features, plan_features, platform_users —
--  have no RLS and are intentionally fully readable/writable by the app.)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Future tables created by `prisma migrate` (run as postgres) inherit the grant.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ── anon: SELECT only on the public storefront surface (NOT every table) ────
-- Row visibility is still narrowed by the anon RLS policies in rls.sql.
-- Note: NEVER grant anon access to platform_users, tenant_users, contacts,
-- orders, carts, tenant_integrations, coupons, or events.
GRANT SELECT ON
  tenants, domains, products, pages, blog_posts,
  branding, tenant_settings, media_assets
TO anon;

-- No ALTER DEFAULT PRIVILEGES for anon on purpose: every new public-facing
-- table must be granted explicitly here, so a forgotten grant fails closed
-- rather than silently exposing a future table to anonymous reads.

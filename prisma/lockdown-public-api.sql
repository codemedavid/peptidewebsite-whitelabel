-- ============================================================================
-- LOCK DOWN the Supabase Data API (PostgREST) on the public schema.
--
-- Supabase grants its `anon` and `authenticated` roles ALL privileges on every
-- table the `postgres` role creates, and exposes them over REST. With RLS off,
-- anyone holding the project's anon key could read or modify every row
-- (customers, sessions, orders). Confirmed live on 2026-10-07: anon could
-- SELECT/INSERT/UPDATE/DELETE all 50 public tables.
--
-- The app never uses the Data API: Prisma connects as `postgres` (table owner,
-- BYPASSRLS) and supabase-js is used for Auth only (auth schema, untouched).
-- So this script removes access the app does not need.
--
-- Compatible with prisma/roles.sql + prisma/rls.sql: those deliberately
-- re-grant a narrow anon SELECT surface, narrowed again by RLS policies.
--
-- APPLY (as postgres, idempotent — re-run after every `prisma db push`, since
-- new tables are created with RLS off):
--     psql "$DIRECT_URL" -f prisma/lockdown-public-api.sql
--
-- UNDO (not recommended):
--     GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
-- ============================================================================

-- 1. No Data API access to existing objects.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- 2. ...and none for objects `postgres` creates later (prisma db push).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 3. Defense in depth: RLS on, no policies → non-owner roles see 0 rows even
--    if a grant comes back. Not FORCEd here; `postgres` is the owner and has
--    BYPASSRLS, so Prisma is unaffected either way.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END
$$;

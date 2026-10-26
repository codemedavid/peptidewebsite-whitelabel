-- One-time rename: this module was first built as "Bunuan", a name that now
-- belongs to a different group-buy feature (the kit-fill phase). Renames every
-- bunuan_* table, constraint and index to paid_access_* IN PLACE (rows kept),
-- then drops the old trigger functions; paid-access.sql recreates them under
-- the new names, so run it straight after:
--
--   prisma db execute --file src/modules/paid-access/sql/rename-from-bunuan.sql --schema prisma/schema.prisma
--   npm run db:paid-access
--
-- Safe to re-run: once bunuan_flows is gone it does nothing. One DO block, so a
-- failure part-way leaves the database exactly as it was.

DO $$
DECLARE
  r record;
  old_prefix constant text := 'bunuan_';
  new_prefix constant text := 'paid_access_';
BEGIN
  IF to_regclass('public.bunuan_flows') IS NULL THEN
    RAISE NOTICE 'paid access: nothing to rename';
    RETURN;
  END IF;

  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'bunuan\_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I RENAME TO %I',
      r.relname, new_prefix || substr(r.relname, length(old_prefix) + 1));
  END LOOP;

  -- Renaming a primary-key constraint renames its index too.
  FOR r IN
    SELECT con.conname, con.conrelid::regclass AS tbl
    FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
    WHERE n.nspname = 'public' AND con.conname LIKE 'bunuan\_%'
  LOOP
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
      r.tbl, r.conname, new_prefix || substr(r.conname, length(old_prefix) + 1));
  END LOOP;

  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname LIKE 'bunuan\_%'
  LOOP
    EXECUTE format('ALTER INDEX public.%I RENAME TO %I',
      r.relname, new_prefix || substr(r.relname, length(old_prefix) + 1));
  END LOOP;

  FOR r IN
    SELECT t.tgname, t.tgrelid::regclass AS tbl FROM pg_trigger t
    WHERE NOT t.tgisinternal AND t.tgname LIKE 'bunuan\_%'
  LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.tbl);
  END LOOP;

  -- No CASCADE: if anything else still depends on an old function, fail loud.
  FOR r IN
    SELECT p.oid::regprocedure AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'bunuan\_%'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.fn);
  END LOOP;
END $$;

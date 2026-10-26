-- ============================================================================
-- One-time cleanup: remove the pre-Paid Access paid-join storage (decision Q2).
--
-- Paid Access replaced the old paid group-buy join (group_buy_memberships,
-- group_buy_membership_events, group_buys."paidJoin"/"joinFeeCents"). Those
-- are gone from prisma/schema.prisma, so `prisma db push` would want to drop
-- them — and refuses (data-loss guard) because "paidJoin" has values. Run this
-- BEFORE the next `db push` / deploy:
--
--     npx prisma db execute --file src/modules/paid-access/sql/drop-legacy-paid-join.sql --schema prisma/schema.prisma
--
-- It REFUSES to drop anything if a single old join request exists: those
-- would need migrating into Paid Access first. Idempotent (safe to re-run).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.group_buy_memberships') IS NOT NULL
     AND EXISTS (SELECT 1 FROM group_buy_memberships) THEN
    RAISE EXCEPTION 'group_buy_memberships still has rows — migrate them into Paid Access before dropping';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'group_buys' AND column_name = 'paidJoin'
  ) AND EXISTS (SELECT 1 FROM group_buys WHERE "paidJoin" = true) THEN
    RAISE EXCEPTION 'a round still has paidJoin = true — set up its Paid Access flow and switch paidJoin off first';
  END IF;
END
$$;

DROP TABLE IF EXISTS group_buy_membership_events;
DROP TABLE IF EXISTS group_buy_memberships;
DROP FUNCTION IF EXISTS gb_membership_guard() CASCADE;
DROP FUNCTION IF EXISTS gb_membership_event_guard() CASCADE;
ALTER TABLE group_buys DROP COLUMN IF EXISTS "paidJoin";
ALTER TABLE group_buys DROP COLUMN IF EXISTS "joinFeeCents";

COMMIT;

-- ============================================================================
-- Paid group-buy access — the rules Postgres enforces on GroupBuyMembership and
-- its audit trail, so no code path (a new action, a script, a hand-run UPDATE)
-- can skip a state, re-price a request, or rewrite history.
--
-- The readable rulebook is lib/storefront/gb-membership.ts; this file is the
-- backstop and MUST stay in step with it:
--
--   pending_payment → paid_pending_approval → approved → revoked
--                                           ↘ rejected → refunded
--
--   * a request is born pending_payment, with a positive amount (centavos)
--   * only the five edges above; rejected/revoked need a reason, refunded a
--     refund reference
--   * store, round, customer and amount are immutable (customer may only go
--     to NULL — the SetNull of an account deletion)
--   * the round must belong to the request's store
--   * one live request (pending/paid/approved/revoked) per customer per round
--   * the audit log is append-only and stays inside its store
--
-- Identifiers are quoted: the columns are camelCase (no @map).
--
-- Apply AFTER `prisma db push` created the tables:
--     npm run db:gb-memberships        (idempotent — safe to re-run)
-- then re-run prisma/lockdown-public-api.sql (db push re-grants new tables).
-- Gate: npm run test:gb-membership-db
-- ============================================================================

CREATE OR REPLACE FUNCTION gb_membership_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  round_tenant TEXT;
BEGIN
  IF NEW.status NOT IN ('pending_payment', 'paid_pending_approval', 'approved', 'rejected', 'refunded', 'revoked') THEN
    RAISE EXCEPTION 'group-buy request: unknown status %', NEW.status;
  END IF;
  IF NEW."amountCents" IS NULL OR NEW."amountCents" <= 0 THEN
    RAISE EXCEPTION 'group-buy request: amount must be a positive number of centavos';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending_payment' THEN
      RAISE EXCEPTION 'group-buy request: a request must start as pending_payment (got %)', NEW.status;
    END IF;
    SELECT "tenantId" INTO round_tenant FROM group_buys WHERE id = NEW."groupBuyId";
    IF round_tenant IS DISTINCT FROM NEW."tenantId" THEN
      RAISE EXCEPTION 'group-buy request: the round must belong to the same store';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR NEW."groupBuyId" IS DISTINCT FROM OLD."groupBuyId"
     OR NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
     OR (NEW."customerId" IS DISTINCT FROM OLD."customerId" AND NEW."customerId" IS NOT NULL) THEN
    RAISE EXCEPTION 'group-buy request: store, round, customer and amount cannot be changed';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status, NEW.status) NOT IN (
      ('pending_payment', 'paid_pending_approval'),
      ('paid_pending_approval', 'approved'),
      ('paid_pending_approval', 'rejected'),
      ('rejected', 'refunded'),
      ('approved', 'revoked')
    ) THEN
      RAISE EXCEPTION 'group-buy request: cannot move from % to %', OLD.status, NEW.status;
    END IF;
    IF NEW.status IN ('rejected', 'revoked') AND btrim(coalesce(NEW."reviewReason", '')) = '' THEN
      RAISE EXCEPTION 'group-buy request: % needs a reason', NEW.status;
    END IF;
    IF NEW.status = 'refunded' AND btrim(coalesce(NEW."refundReference", '')) = '' THEN
      RAISE EXCEPTION 'group-buy request: refunded needs a refund reference';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS group_buy_memberships_guard ON group_buy_memberships;
CREATE TRIGGER group_buy_memberships_guard
  BEFORE INSERT OR UPDATE ON group_buy_memberships
  FOR EACH ROW EXECUTE FUNCTION gb_membership_guard();

-- No double payments. Partial: rejected/refunded rows leave the slot free so the
-- customer may try again; NULL customerIds (deleted accounts) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS group_buy_memberships_one_live
  ON group_buy_memberships ("groupBuyId", "customerId")
  WHERE status IN ('pending_payment', 'paid_pending_approval', 'approved', 'revoked');

-- ── Audit log ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION gb_membership_event_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  membership_tenant TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'group-buy audit log is append-only';
  END IF;
  SELECT "tenantId" INTO membership_tenant FROM group_buy_memberships WHERE id = NEW."membershipId";
  IF membership_tenant IS DISTINCT FROM NEW."tenantId" THEN
    RAISE EXCEPTION 'group-buy audit event must belong to the same store as its request';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS group_buy_membership_events_guard ON group_buy_membership_events;
CREATE TRIGGER group_buy_membership_events_guard
  BEFORE INSERT OR UPDATE ON group_buy_membership_events
  FOR EACH ROW EXECUTE FUNCTION gb_membership_event_guard();

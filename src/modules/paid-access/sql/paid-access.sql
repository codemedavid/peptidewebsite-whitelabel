-- ============================================================================
-- Paid Access — the rules Postgres enforces, so no code path (a new action, a
-- script, a hand-run UPDATE) can skip a step, oversell a slot, re-price a
-- payment or rewrite history. The readable rulebook is
-- src/modules/paid-access/core/machine.ts (+ refund.ts); this file MUST mirror it.
--
--   * a membership is born at its snapshot's first step, or waitlisted
--   * status moves follow the member's OWN settings snapshot (never the flow's
--     current settings), and the snapshot itself can never change
--   * rejected / revoked need a reason; refunds only move forward, only on a
--     rejected membership, and "refunded" needs a reference
--   * the slot counter (paid_access_flows."slotsTaken") is maintained HERE, by an
--     atomic conditional UPDATE: concurrent joins queue on the flow row and
--     the loser sees PAID_ACCESS_FULL instead of overselling
--   * one live membership per customer per round (no double-joining)
--   * a payment charges exactly the snapshot price; at most one confirmed and
--     one under-review payment per membership (no double-charging); a
--     provider's charge id is recorded once (unique key in the schema)
--   * the audit log is append-only and stays inside its store
--
-- Identifiers are quoted: the columns are camelCase (no @map).
-- Apply AFTER `prisma db push` created the tables:
--     npm run db:paid-access          (idempotent — safe to re-run)
-- then re-run prisma/lockdown-public-api.sql (db push re-grants new tables).
-- Gate: npm run test:paid-access-db
-- ============================================================================

-- ── Step helpers (mirror core/machine.ts) ───────────────────────────────────

CREATE OR REPLACE FUNCTION paid_access_step_status(step text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE step
    WHEN 'form' THEN 'form_pending'
    WHEN 'payment' THEN 'payment_pending'
    WHEN 'approval' THEN 'approval_pending'
  END
$$;

CREATE OR REPLACE FUNCTION paid_access_step_index(steps jsonb, step text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT (t.ord - 1)::int
  FROM jsonb_array_elements_text(coalesce(steps, '[]'::jsonb)) WITH ORDINALITY AS t(s, ord)
  WHERE t.s = step
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION paid_access_first_status(steps jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(paid_access_step_status(steps ->> 0), 'active')
$$;

CREATE OR REPLACE FUNCTION paid_access_status_after(steps jsonb, step text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(paid_access_step_status(steps ->> (paid_access_step_index(steps, step) + 1)), 'active')
$$;

CREATE OR REPLACE FUNCTION paid_access_edge_allowed(f text, t text, steps jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  has_form boolean := steps @> '["form"]'::jsonb;
  has_pay boolean := steps @> '["payment"]'::jsonb;
  has_appr boolean := steps @> '["approval"]'::jsonb;
  paid_first boolean;
BEGIN
  IF (f = 'form_pending' AND NOT has_form)
     OR (f IN ('payment_pending', 'payment_review') AND NOT has_pay)
     OR (f = 'approval_pending' AND NOT has_appr) THEN
    RETURN false;
  END IF;
  paid_first := has_pay AND has_appr AND paid_access_step_index(steps, 'payment') < paid_access_step_index(steps, 'approval');
  RETURN
       (f = 'waitlisted' AND t = paid_access_first_status(steps))                          -- promote
    OR (f = 'form_pending' AND t = paid_access_status_after(steps, 'form'))                -- submit_form
    OR (f = 'payment_pending' AND t = 'payment_review')                               -- submit_proof
    OR (f = 'payment_review' AND t = paid_access_status_after(steps, 'payment'))           -- confirm_proof
    OR (f = 'payment_pending' AND t = paid_access_status_after(steps, 'payment'))          -- payment_succeeded
    OR (f = 'payment_review' AND t = 'payment_pending')                               -- reject_proof
    OR (f = 'approval_pending' AND t = paid_access_status_after(steps, 'approval'))        -- approve
    OR (t = 'rejected' AND f IN ('waitlisted', 'form_pending', 'payment_pending', 'payment_review', 'approval_pending'))
    OR (f = 'payment_pending' AND t = 'expired')                                      -- expire
    OR (t = 'cancelled' AND f IN ('waitlisted', 'form_pending', 'payment_pending'))   -- cancel
    OR (t = 'cancelled' AND f = 'approval_pending' AND NOT paid_first)
    OR (f = 'active' AND t = 'revoked');                                              -- revoke
END;
$$;

-- ── Flows: one per round; the slot counter is the database's alone ──────────

CREATE OR REPLACE FUNCTION paid_access_flow_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  round_tenant text;
BEGIN
  IF NEW."maxSlots" IS NOT NULL AND NEW."maxSlots" < 1 THEN
    RAISE EXCEPTION 'paid-access flow: a slot limit must be at least 1';
  END IF;
  IF NEW."slotsTaken" < 0 THEN
    RAISE EXCEPTION 'paid-access flow: the slot counter cannot go below zero';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT "tenantId" INTO round_tenant FROM group_buys WHERE id = NEW."groupBuyId";
    IF round_tenant IS DISTINCT FROM NEW."tenantId" THEN
      RAISE EXCEPTION 'paid-access flow: the round must belong to the same store';
    END IF;
    IF NEW."slotsTaken" <> 0 THEN
      RAISE EXCEPTION 'paid-access flow: the slot counter starts at 0';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR NEW."groupBuyId" IS DISTINCT FROM OLD."groupBuyId" THEN
    RAISE EXCEPTION 'paid-access flow: store and round cannot be changed';
  END IF;
  IF NEW."slotsTaken" IS DISTINCT FROM OLD."slotsTaken"
     AND coalesce(current_setting('paid_access.counter', true), '') <> 'on' THEN
    RAISE EXCEPTION 'paid-access flow: the slot counter is maintained by the database';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS paid_access_flows_guard ON paid_access_flows;
CREATE TRIGGER paid_access_flows_guard
  BEFORE INSERT OR UPDATE ON paid_access_flows
  FOR EACH ROW EXECUTE FUNCTION paid_access_flow_guard();

-- ── Memberships ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION paid_access_holds_slot(status text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT status IN ('form_pending', 'payment_pending', 'payment_review', 'approval_pending', 'active')
$$;

CREATE OR REPLACE FUNCTION paid_access_membership_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  steps jsonb := NEW."settingsSnapshot" -> 'steps';
  flow_tenant text;
  flow_round text;
  was_slot boolean := false;
  is_slot boolean := paid_access_holds_slot(NEW.status);
BEGIN
  IF NEW.status NOT IN ('waitlisted', 'form_pending', 'payment_pending', 'payment_review', 'approval_pending',
                        'active', 'rejected', 'expired', 'cancelled', 'revoked') THEN
    RAISE EXCEPTION 'paid-access membership: unknown status %', NEW.status;
  END IF;
  IF NEW."refundStatus" NOT IN ('none', 'not_applicable', 'pending', 'processing', 'refunded') THEN
    RAISE EXCEPTION 'paid-access membership: unknown refund status %', NEW."refundStatus";
  END IF;
  IF jsonb_typeof(steps) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'paid-access membership: the settings snapshot has no steps';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'waitlisted' AND NEW.status <> paid_access_first_status(steps) THEN
      RAISE EXCEPTION 'paid-access membership: a membership must start at its first step (got %)', NEW.status;
    END IF;
    SELECT "tenantId", "groupBuyId" INTO flow_tenant, flow_round FROM paid_access_flows WHERE id = NEW."flowId";
    IF flow_tenant IS DISTINCT FROM NEW."tenantId" OR flow_round IS DISTINCT FROM NEW."groupBuyId" THEN
      RAISE EXCEPTION 'paid-access membership: must belong to the flow''s store and round';
    END IF;
    IF NEW."refundStatus" <> 'none' THEN
      RAISE EXCEPTION 'paid-access membership: a new membership owes no refund';
    END IF;
  ELSE
    IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
       OR NEW."flowId" IS DISTINCT FROM OLD."flowId"
       OR NEW."groupBuyId" IS DISTINCT FROM OLD."groupBuyId"
       OR NEW."settingsSnapshot" IS DISTINCT FROM OLD."settingsSnapshot"
       OR NEW."settingsVersion" IS DISTINCT FROM OLD."settingsVersion"
       OR (NEW."customerId" IS DISTINCT FROM OLD."customerId" AND NEW."customerId" IS NOT NULL) THEN
      RAISE EXCEPTION 'paid-access membership: store, flow, round, customer and settings snapshot cannot be changed';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT paid_access_edge_allowed(OLD.status, NEW.status, steps) THEN
        RAISE EXCEPTION 'paid-access membership: cannot move from % to %', OLD.status, NEW.status;
      END IF;
      IF NEW.status IN ('rejected', 'revoked') AND btrim(coalesce(NEW."reviewReason", '')) = '' THEN
        RAISE EXCEPTION 'paid-access membership: % needs a reason', NEW.status;
      END IF;
    END IF;

    IF NEW."refundStatus" IS DISTINCT FROM OLD."refundStatus" THEN
      IF (OLD."refundStatus", NEW."refundStatus") NOT IN (
        ('none', 'not_applicable'), ('none', 'pending'), ('none', 'processing'),
        ('processing', 'refunded'), ('processing', 'pending'), ('pending', 'refunded')
      ) THEN
        RAISE EXCEPTION 'paid-access membership: a refund cannot move from % to %', OLD."refundStatus", NEW."refundStatus";
      END IF;
      IF NEW.status <> 'rejected' THEN
        RAISE EXCEPTION 'paid-access membership: only a rejected membership can owe a refund';
      END IF;
      IF NEW."refundStatus" = 'refunded' AND btrim(coalesce(NEW."refundReference", '')) = '' THEN
        RAISE EXCEPTION 'paid-access membership: refunded needs a refund reference';
      END IF;
    END IF;
    was_slot := paid_access_holds_slot(OLD.status);
  END IF;

  -- The slot counter. The conditional UPDATE row-locks the flow, so racing
  -- joins queue here and re-check the limit after the winner commits.
  IF is_slot AND NOT was_slot THEN
    PERFORM set_config('paid_access.counter', 'on', true);
    UPDATE paid_access_flows SET "slotsTaken" = "slotsTaken" + 1
     WHERE id = NEW."flowId" AND ("maxSlots" IS NULL OR "slotsTaken" < "maxSlots");
    IF NOT FOUND THEN
      PERFORM set_config('paid_access.counter', 'off', true);
      RAISE EXCEPTION 'PAID_ACCESS_FULL: this group buy has no slots left';
    END IF;
    PERFORM set_config('paid_access.counter', 'off', true);
  ELSIF was_slot AND NOT is_slot THEN
    PERFORM set_config('paid_access.counter', 'on', true);
    UPDATE paid_access_flows SET "slotsTaken" = "slotsTaken" - 1 WHERE id = NEW."flowId";
    PERFORM set_config('paid_access.counter', 'off', true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS paid_access_memberships_guard ON paid_access_memberships;
CREATE TRIGGER paid_access_memberships_guard
  BEFORE INSERT OR UPDATE ON paid_access_memberships
  FOR EACH ROW EXECUTE FUNCTION paid_access_membership_guard();

-- No double-joining. A rejection still owed a refund blocks re-joining; NULL
-- customers (deleted accounts) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS paid_access_memberships_one_live
  ON paid_access_memberships ("flowId", "customerId")
  WHERE status IN ('waitlisted', 'form_pending', 'payment_pending', 'payment_review', 'approval_pending', 'active', 'revoked')
     OR (status = 'rejected' AND "refundStatus" IN ('pending', 'processing'));

-- ── Payments ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION paid_access_payment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  m_tenant text;
  m_snapshot jsonb;
BEGIN
  IF NEW.status NOT IN ('initiated', 'submitted', 'confirmed', 'rejected', 'failed', 'refund_due', 'refunded') THEN
    RAISE EXCEPTION 'paid-access payment: unknown status %', NEW.status;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT "tenantId", "settingsSnapshot" INTO m_tenant, m_snapshot FROM paid_access_memberships WHERE id = NEW."membershipId";
    IF m_tenant IS DISTINCT FROM NEW."tenantId" THEN
      RAISE EXCEPTION 'paid-access payment: must belong to the same store as its membership';
    END IF;
    IF NOT coalesce(m_snapshot -> 'steps', '[]'::jsonb) @> '["payment"]'::jsonb THEN
      RAISE EXCEPTION 'paid-access payment: this flow has no payment step';
    END IF;
    IF NEW."amountCents" IS DISTINCT FROM (m_snapshot -> 'payment' ->> 'amountCents')::int OR NEW."amountCents" <= 0 THEN
      RAISE EXCEPTION 'paid-access payment: the amount must equal the member''s snapshot price';
    END IF;
    IF NEW.kind IS DISTINCT FROM coalesce(m_snapshot -> 'payment' ->> 'amountMode', 'full') THEN
      RAISE EXCEPTION 'paid-access payment: full/deposit must match the member''s snapshot';
    END IF;
    IF NEW.status NOT IN ('initiated', 'submitted') THEN
      RAISE EXCEPTION 'paid-access payment: a payment must start as initiated or submitted (got %)', NEW.status;
    END IF;
    IF NEW."creditedOrderId" IS NOT NULL THEN
      RAISE EXCEPTION 'paid-access payment: a new payment is not credited to any order';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR NEW."membershipId" IS DISTINCT FROM OLD."membershipId"
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR (OLD."providerRef" IS NOT NULL AND NEW."providerRef" IS DISTINCT FROM OLD."providerRef") THEN
    RAISE EXCEPTION 'paid-access payment: store, membership, provider, charge id and amount cannot be changed';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status, NEW.status) NOT IN (
      ('initiated', 'confirmed'), ('initiated', 'failed'), ('initiated', 'refund_due'),
      ('submitted', 'confirmed'), ('submitted', 'rejected'),
      ('confirmed', 'refunded'), ('refund_due', 'refunded')
    ) THEN
      RAISE EXCEPTION 'paid-access payment: cannot move from % to %', OLD.status, NEW.status;
    END IF;
    IF NEW.status = 'rejected' AND btrim(coalesce(NEW."rejectReason", '')) = '' THEN
      RAISE EXCEPTION 'paid-access payment: a rejected proof needs a reason';
    END IF;
  END IF;

  IF NEW."creditedOrderId" IS DISTINCT FROM OLD."creditedOrderId" THEN
    IF OLD."creditedOrderId" IS NOT NULL THEN
      RAISE EXCEPTION 'paid-access payment: a deposit is credited to one order only';
    END IF;
    IF NEW.kind <> 'deposit' OR NEW.status <> 'confirmed' THEN
      RAISE EXCEPTION 'paid-access payment: only a confirmed deposit can be credited to an order';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS paid_access_payments_guard ON paid_access_payments;
CREATE TRIGGER paid_access_payments_guard
  BEFORE INSERT OR UPDATE ON paid_access_payments
  FOR EACH ROW EXECUTE FUNCTION paid_access_payment_guard();

-- No double-charging: one confirmed payment, and one proof under review, per membership.
CREATE UNIQUE INDEX IF NOT EXISTS paid_access_payments_one_confirmed
  ON paid_access_payments ("membershipId") WHERE status = 'confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS paid_access_payments_one_submitted
  ON paid_access_payments ("membershipId") WHERE status = 'submitted';

-- ── Audit log ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION paid_access_event_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  m_tenant text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'paid-access audit log is append-only';
  END IF;
  IF NEW."membershipId" IS NOT NULL THEN
    SELECT "tenantId" INTO m_tenant FROM paid_access_memberships WHERE id = NEW."membershipId";
    IF m_tenant IS DISTINCT FROM NEW."tenantId" THEN
      RAISE EXCEPTION 'paid-access audit event must belong to the same store as its membership';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS paid_access_events_guard ON paid_access_events;
CREATE TRIGGER paid_access_events_guard
  BEFORE INSERT OR UPDATE ON paid_access_events
  FOR EACH ROW EXECUTE FUNCTION paid_access_event_guard();

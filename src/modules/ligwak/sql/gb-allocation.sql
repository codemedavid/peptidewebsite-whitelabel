-- ============================================================================
-- Bunuan + Ligwak — the rules Postgres enforces, so no code path (a new
-- action, a script, a hand-run UPDATE) can break an allocation or rewrite
-- the audit trail. The readable rules are src/modules/ligwak/core and
-- src/lib/storefront/gb-stage.ts; this file MUST agree with them.
--
--   * an allocation line always adds up: successQty + cancelledQty = quantity,
--     none negative, and the decision is ligwak | keep | NULL
--   * a round's stage is one of open | bunuan | closed | payment, and its
--     payment mode one of pay_first | pay_later
--   * an order's refund status is for_review | refund_pending | refunded and
--     only moves forward; "refunded" needs a reference
--   * the audit trail (gb_audit_events) is append-only
--
-- Identifiers are quoted: the columns are camelCase (no @map).
-- Apply AFTER `prisma db push` created the tables:
--     npm run db:gb-allocation        (idempotent — safe to re-run)
-- then re-run prisma/lockdown-public-api.sql (db push re-grants new tables).
-- Gate: npm run test:bunuan-db
-- ============================================================================

-- ── Allocation lines add up ─────────────────────────────────────────────────
ALTER TABLE gb_allocation_entries DROP CONSTRAINT IF EXISTS gb_allocation_entries_qty_check;
ALTER TABLE gb_allocation_entries ADD CONSTRAINT gb_allocation_entries_qty_check CHECK (
  "quantity" >= 0
  AND "successQty" >= 0
  AND "cancelledQty" >= 0
  AND "suggestQty" >= 0
  AND "suggestQty" <= "quantity"
  AND "successQty" + "cancelledQty" = "quantity"
);

ALTER TABLE gb_allocation_entries DROP CONSTRAINT IF EXISTS gb_allocation_entries_decision_check;
ALTER TABLE gb_allocation_entries ADD CONSTRAINT gb_allocation_entries_decision_check CHECK (
  "decision" IS NULL OR "decision" IN ('ligwak', 'keep')
);

ALTER TABLE gb_allocations DROP CONSTRAINT IF EXISTS gb_allocations_mode_check;
ALTER TABLE gb_allocations ADD CONSTRAINT gb_allocations_mode_check CHECK (
  "paymentMode" IN ('pay_first', 'pay_later') AND "version" >= 1
);

-- ── Round stage + mode ──────────────────────────────────────────────────────
ALTER TABLE group_buys DROP CONSTRAINT IF EXISTS group_buys_stage_check;
ALTER TABLE group_buys ADD CONSTRAINT group_buys_stage_check CHECK (
  "stage" IN ('open', 'bunuan', 'closed', 'payment')
  AND ("paymentMode" IS NULL OR "paymentMode" IN ('pay_first', 'pay_later'))
);

-- ── Order refunds ───────────────────────────────────────────────────────────
ALTER TABLE storefront_orders DROP CONSTRAINT IF EXISTS storefront_orders_refund_check;
ALTER TABLE storefront_orders ADD CONSTRAINT storefront_orders_refund_check CHECK (
  ("refundStatus" IS NULL OR "refundStatus" IN ('for_review', 'refund_pending', 'refunded'))
  AND ("refundStatus" IS DISTINCT FROM 'refunded' OR coalesce(btrim("refundReference"), '') <> '')
  AND ("refundDueCents" IS NULL OR "refundDueCents" >= 0)
  AND ("amountDueCents" IS NULL OR "amountDueCents" >= 0)
  AND ("adjustedTotalCents" IS NULL OR "adjustedTotalCents" >= 0)
);

-- Forward only: for_review → refund_pending → refunded. Clearing it back to
-- NULL is allowed only together with refundDueCents (a Recalculate that leaves
-- nothing to refund); a refunded order can never be un-refunded.
CREATE OR REPLACE FUNCTION gb_refund_rank(s text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s WHEN 'for_review' THEN 1 WHEN 'refund_pending' THEN 2 WHEN 'refunded' THEN 3 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION gb_refund_forward() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."refundStatus" IS NOT DISTINCT FROM NEW."refundStatus" THEN
    RETURN NEW;
  END IF;
  IF OLD."refundStatus" = 'refunded' THEN
    RAISE EXCEPTION 'GB_REFUND_FINAL: a refunded order stays refunded';
  END IF;
  IF NEW."refundStatus" IS NULL THEN
    IF NEW."refundDueCents" IS NOT NULL AND NEW."refundDueCents" > 0 THEN
      RAISE EXCEPTION 'GB_REFUND_BACKWARDS: a refund that is still due cannot be cleared';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."refundStatus" IS NOT NULL AND gb_refund_rank(NEW."refundStatus") < gb_refund_rank(OLD."refundStatus") THEN
    RAISE EXCEPTION 'GB_REFUND_BACKWARDS: % cannot go back to %', OLD."refundStatus", NEW."refundStatus";
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS storefront_orders_refund_forward ON storefront_orders;
CREATE TRIGGER storefront_orders_refund_forward
  BEFORE UPDATE OF "refundStatus" ON storefront_orders
  FOR EACH ROW EXECUTE FUNCTION gb_refund_forward();

-- ── Audit trail is append-only ──────────────────────────────────────────────
-- UPDATE is always refused. DELETE is refused too, unless it arrives through a
-- foreign-key cascade (deleting the whole store), which runs our trigger one
-- level down (pg_trigger_depth() > 1).
CREATE OR REPLACE FUNCTION gb_audit_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'GB_AUDIT_APPEND_ONLY: the group-buy audit trail cannot be changed';
END
$$;

DROP TRIGGER IF EXISTS gb_audit_events_append_only ON gb_audit_events;
CREATE TRIGGER gb_audit_events_append_only
  BEFORE UPDATE OR DELETE ON gb_audit_events
  FOR EACH ROW EXECUTE FUNCTION gb_audit_append_only();

// The bulk "Change Status" decision, for many orders at once — pure.
//
// planStatusChange() (./order-status) answers the question for ONE order. This
// answers it for a selection, in a single in-memory pass, and returns everything
// the caller needs to finish the job WITHOUT going back to the database:
//
//   writes      — the rows to persist, one per genuinely changed order
//   stockMoves  — the inventory movements, to hand to applyOrderStockMovesBatched
//   changed     — the resulting orders + their previous status, for the caller's
//                 in-memory row construction and its order_status_changed events
//
// That last one is the point. The old bulk action re-read each order with a
// findFirst AFTER updating it, which cost one extra round trip per order inside
// an already over-budget transaction (see stock-move-db for the P2028 story).
// Nothing about the updated row is unknown here — we computed it — so the caller
// can build it directly. Covered by scripts/test-bulk-status-batching.ts.

import type { OrderItem, OrderStatus, OrderStatusEvent } from "@/storefront/types";
import { planStatusChange } from "./order-status";
import type { StockMoveEntry } from "./inventory";

/** The order fields the bulk decision reads. Structural so the caller can pass
 *  a DB row, a demo order, or a fixture without a conversion step. */
export type BulkOrderRow = {
  id: string;
  status: OrderStatus;
  statusHistory?: OrderStatusEvent[];
  imported?: boolean;
  items: OrderItem[];
};

/** One order's persisted patch. */
export type BulkStatusWrite = {
  id: string;
  status: OrderStatus;
  statusHistory: OrderStatusEvent[];
};

/** One order's outcome, carrying the status it came FROM so the caller can emit
 *  order_status_changed without re-reading the row it just wrote. */
export type BulkStatusChanged = BulkStatusWrite & { prevStatus: OrderStatus };

export type BulkStatusPlan = {
  writes: BulkStatusWrite[];
  stockMoves: StockMoveEntry[];
  changed: BulkStatusChanged[];
};

/**
 * Decide what moving `rows` to `next` costs, in one pass.
 *
 * Delegates the per-order rules to planStatusChange so the bulk path, the
 * single-order path and the demo path can never drift: an order already at the
 * target status is skipped entirely, an imported order's status moves but its
 * stock stays frozen, and a journey event is appended only on a real change.
 *
 * `nowIso` is injected rather than read from the clock, keeping this pure and
 * deterministic under test.
 */
export function planBulkStatusChange(
  rows: readonly BulkOrderRow[],
  next: OrderStatus,
  nowIso: string,
): BulkStatusPlan {
  const writes: BulkStatusWrite[] = [];
  const stockMoves: StockMoveEntry[] = [];
  const changed: BulkStatusChanged[] = [];

  for (const row of rows) {
    const plan = planStatusChange(
      { status: row.status, statusHistory: row.statusHistory, imported: row.imported },
      next,
      nowIso,
    );
    if (!plan.changed) continue;

    writes.push({ id: row.id, status: plan.status, statusHistory: plan.statusHistory });
    changed.push({
      id: row.id,
      prevStatus: row.status,
      status: plan.status,
      statusHistory: plan.statusHistory,
    });
    if (plan.move) stockMoves.push({ items: row.items, move: plan.move });
  }

  return { writes, stockMoves, changed };
}

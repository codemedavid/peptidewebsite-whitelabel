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

/**
 * Is this Prisma's interactive-transaction timeout (P2028)?
 *
 * Over a PgBouncer-pooled connection it always means "the transaction took too
 * long", never "the connection dropped" — but its message reads like the
 * latter: "Transaction not found. Transaction ID is invalid, refers to an old
 * closed transaction Prisma doesn't have information about anymore…".
 */
export function isTransactionTimeout(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "P2028") return true;
  const message = e instanceof Error ? e.message : "";
  return /Transaction (?:API error|not found)/i.test(message);
}

/**
 * What to tell the owner when a bulk run stopped partway.
 *
 * Because the writes are chunked, a failure can arrive AFTER earlier chunks
 * already committed. Saying only "try again" would hide that: the owner would
 * re-select everything, see a smaller number change the second time, and have
 * no idea which orders had already moved. So the count leads.
 */
export function bulkStatusFailureMessage(saved: number, e: unknown): string {
  if (!isTransactionTimeout(e)) {
    return e instanceof Error && e.message ? e.message : "Couldn't update the orders.";
  }
  if (saved > 0) {
    return `Saved ${saved} order${saved === 1 ? "" : "s"} before running out of time. The rest were left unchanged — select them and try again.`;
  }
  return "That took too long to save. Please select fewer orders and try again.";
}

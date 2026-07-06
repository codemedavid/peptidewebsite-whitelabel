// Pure order-status transition core — shared by the single-order update and the
// bulk "change status" action in the store admin (src/actions/orders.ts). Kept
// free of any DB / Next / cookie dependency so the RULES ("append a journey event
// only on a real change", "deduct on confirm / restock on cancel, never twice")
// are decided in one place and unit-tested directly (scripts/test-bulk-order-status.ts).
//
// The functions here DECIDE what should happen; the caller APPLIES it against its
// own store — the demo file-backed order list, or the tenant's DB rows.

import type { Order, OrderStatus, OrderStatusEvent } from "../../storefront/types";

/** The seven order statuses, in fulfillment order. "ready" (packed / ready to
 *  ship or collect) sits between processing and shipped and is a neutral status:
 *  like processing/shipped/delivered it moves no stock (see inventoryMove — only
 *  confirmed deducts and cancelled restocks). */
export const ORDER_STATUSES: readonly OrderStatus[] = [
  "new",
  "confirmed",
  "processing",
  "ready",
  "shipped",
  "delivered",
  "cancelled",
];

/** Narrow an untrusted value to a valid OrderStatus (server-action guard input). */
export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === "string" && (ORDER_STATUSES as readonly string[]).includes(v);
}

/**
 * Coerce an untrusted id array into a clean list: non-empty strings only,
 * de-duplicated (so one order is never processed twice in a bulk action) and
 * capped. Non-array input collapses to an empty list.
 */
export function cleanIdList(ids: unknown, cap = 1000): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  for (const x of ids) {
    if (typeof x === "string" && x.length > 0) seen.add(x);
    if (seen.size >= cap) break;
  }
  return [...seen];
}

// ── Inventory sync on status change ──────────────────────────────────────────
//
// Entering `confirmed` deducts the order's items from stock; entering `cancelled`
// puts them back — but ONLY if they are currently deducted. Whether they are
// deducted is derived by replaying the status journey, so a confirmed → cancelled
// → confirmed bounce deducts, restocks, then deducts again — never twice in a row.
// Legacy orders confirmed before this feature shipped have no `confirmed` event in
// their journey (or no journey at all), so replaying yields "not deducted" and
// cancelling them never invents stock.

export type InventoryMove = "deduct" | "restock" | null;

/** Replay the journey to learn whether the order's items are deducted now. */
export function stockCurrentlyDeducted(history: OrderStatusEvent[]): boolean {
  let deducted = false;
  for (const e of history) {
    if (e.status === "confirmed") deducted = true;
    else if (e.status === "cancelled") deducted = false;
  }
  return deducted;
}

/** Which stock movement (if any) this status change triggers. */
export function inventoryMove(
  currentStatus: string,
  history: OrderStatusEvent[],
  newStatus: OrderStatus | undefined,
): InventoryMove {
  if (!newStatus || newStatus === currentStatus) return null;
  const deducted = stockCurrentlyDeducted(history);
  if (newStatus === "confirmed" && !deducted) return "deduct";
  if (newStatus === "cancelled" && deducted) return "restock";
  return null;
}

export type StatusChangePlan = {
  /** Whether the target status actually differs from the order's current one. */
  changed: boolean;
  /** The resulting status (unchanged order keeps its current status). */
  status: OrderStatus;
  /** The journey with a new event appended ONLY on a real change. */
  statusHistory: OrderStatusEvent[];
  /** The inventory movement this transition triggers, for the caller to apply. */
  move: InventoryMove;
};

/**
 * The whole per-order decision for moving one order to `newStatus` at `nowIso`.
 * Used by BOTH the single-order update and the bulk action so their rules can
 * never drift. The caller applies `move` to its own product store and persists
 * `status` / `statusHistory`. `nowIso` is injected (never read from the clock
 * here) so the decision stays pure and deterministic under test.
 */
export function planStatusChange(
  current: Pick<Order, "status"> & { statusHistory?: OrderStatusEvent[] },
  newStatus: OrderStatus,
  nowIso: string,
): StatusChangePlan {
  const history = current.statusHistory ?? [];
  const changed = newStatus !== current.status;
  const move = inventoryMove(current.status, history, changed ? newStatus : undefined);
  return {
    changed,
    status: changed ? newStatus : current.status,
    statusHistory: changed ? [...history, { status: newStatus, at: nowIso }] : history,
    move,
  };
}

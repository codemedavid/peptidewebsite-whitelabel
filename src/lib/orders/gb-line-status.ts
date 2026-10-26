// The line status a group-buy customer sees on each order line (Ligwak):
//
//   store without Ligwak  → none (the line reads as it always did)
//   before the lock       → Pending
//   after the lock        → Success · "2 Success · 3 Cancelled" · Cancelled
//
// "After the lock" = the order was re-totalled (adjustedTotal set). The lock
// writes every counted order, changed or not, so a fully kept order reads
// Success on every line. Pure; client-safe. Tested by npm run test:gb-stage-sync.

import { lineStatusFor, lineStatusLabel, type LineStatus } from "@/modules/ligwak/core";
import type { Order, OrderItem } from "@/storefront/types";

export type GbLineStatus = { lineStatus: LineStatus; successQty: number; cancelledQty: number; label: string };

export function gbLineStatuses(
  order: Pick<Order, "adjustedTotal"> & { items: readonly Pick<OrderItem, "qty" | "cancelledQty">[] },
  ligwak: { enabled: boolean },
): (GbLineStatus | null)[] {
  const allocated = order.adjustedTotal != null;
  return order.items.map((item) => {
    const quantity = Math.max(0, Math.floor(item.qty));
    if (allocated) {
      const cancelledQty = Math.min(quantity, Math.max(0, Math.floor(item.cancelledQty ?? 0)));
      const r = { quantity, successQty: quantity - cancelledQty, cancelledQty, lineStatus: lineStatusFor(quantity, cancelledQty) };
      return { lineStatus: r.lineStatus, successQty: r.successQty, cancelledQty, label: lineStatusLabel(r) };
    }
    if (!ligwak.enabled) return null;
    return { lineStatus: "pending", successQty: 0, cancelledQty: 0, label: "Pending" };
  });
}

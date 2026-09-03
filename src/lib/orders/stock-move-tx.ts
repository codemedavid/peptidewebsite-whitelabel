// The transaction-side adapter that lets an order's line items move real stock.
//
// Lifted out of actions/orders.ts alongside db-mapping for the same reason: a
// "use server" module can only export async actions, so the Telegram webhook's
// confirm path could not otherwise reach the SAME stock code the store admin
// runs — and two implementations of "confirm deducts inventory" is exactly the
// drift this feature must not introduce.

import { Prisma } from "@prisma/client";
import type { TenantTx } from "@/lib/db/tenant-client";
import {
  applyOrderStockMovesBatched,
  type StockMoveDb,
} from "@/lib/storefront/stock-move-db";
import type { InventoryMove } from "@/lib/storefront/order-status";
import type { OrderItem } from "@/storefront/types";

/**
 * Adapt a tenant-scoped transaction to the storage-agnostic StockMoveDb the
 * batched engine expects.
 *
 * updateMany rather than update: the tenant extension scopes updateMany by
 * tenantId, while a bare-id update is not tenant-scoped (see lib/db/tenant-client).
 */
export function stockMoveDb(db: TenantTx): StockMoveDb {
  return {
    findProducts: ({ ids, names }) =>
      db.product.findMany({
        where: {
          OR: [
            ...(ids.length ? [{ id: { in: ids } }] : []),
            ...(names.length ? [{ name: { in: names } }] : []),
          ],
        },
        select: { id: true, name: true, stock: true, metadata: true },
      }),
    updateProduct: async (id, data) => {
      await db.product.updateMany({
        where: { id },
        data: {
          ...(data.stock !== undefined ? { stock: data.stock } : {}),
          ...(data.metadata !== undefined
            ? { metadata: data.metadata as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
    },
  };
}

/**
 * Apply an order's line items to the tenant's DB inventory (− on deduct, + on
 * restock), clamping at zero. The DB analogue of adjustProductStock: lines match
 * by productId when present, by exact name for legacy orders. Shared by the
 * single-order update, the bulk status action and the Telegram confirm so all
 * three move stock identically. Runs inside a withTenant() transaction (the
 * passed `db` is already scoped).
 *
 * One order's worth of the batched engine: 1 read + at most 1 write per product,
 * never per line item. That budget is the whole point — see stock-move-db.
 */
export async function applyOrderStockMove(
  db: TenantTx,
  items: OrderItem[],
  move: Exclude<InventoryMove, null>,
): Promise<void> {
  await applyOrderStockMovesBatched(stockMoveDb(db), [{ items, move }]);
}

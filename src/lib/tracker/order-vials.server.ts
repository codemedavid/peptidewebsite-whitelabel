import "server-only";

import { withTenant } from "@/lib/db/tenant-client";
import type { TrackerOrderVial } from "@/lib/mobile/contract";
import { dbOrderToStorefront, type DbOrderRow } from "@/lib/orders/db-mapping";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import { dbProductToStorefront, type DbProductRow } from "@/lib/storefront/product-mapping";
import { ORDER_VIAL_ORDERS, ORDER_VIAL_STATUSES, buildOrderVials, type ProductImages } from "./order-vials";

export type TrackerOrderVialsResponse = { vials: TrackerOrderVial[] };

/**
 * The signed-in buyer's shipped / delivered order lines, newest order first —
 * only orders on THIS account (customerAccountId), never trashed ones.
 * Two reads in one tenant transaction: the orders, then their products' photos.
 */
export async function loadOrderVials(tenantId: string, customerId: string): Promise<TrackerOrderVialsResponse> {
  const { orders, products } = await withTenant(tenantId, async (db) => {
    const rows = await db.storefrontOrder.findMany({
      where: { ...ACTIVE_ORDERS_WHERE, customerAccountId: customerId, status: { in: [...ORDER_VIAL_STATUSES] } },
      orderBy: { placedAt: "desc" },
      take: ORDER_VIAL_ORDERS,
    });
    // The same mapper My Orders uses (lib/mobile/shop-orders.ts): clean lines,
    // server-stamped Ligwak cancellations, a parsed status history.
    const orders = rows.map((r) => {
      const o = dbOrderToStorefront(r as DbOrderRow);
      return { id: o.id, orderNumber: o.orderNumber ?? r.orderNumber, status: o.status, statusHistory: o.statusHistory ?? [], items: o.items };
    });
    const ids = [...new Set(orders.flatMap((o) => o.items.flatMap((i) => (i.productId ? [i.productId] : []))))];
    const products = ids.length ? await db.product.findMany({ where: { id: { in: ids } } }) : [];
    return { orders, products };
  });

  const images = new Map<string, ProductImages>(
    products.map((row) => {
      const p = dbProductToStorefront(row as unknown as DbProductRow, "");
      return [p.id, { image: p.image, variations: p.variations?.map((v) => ({ name: v.name, image: v.image })) }];
    }),
  );
  return { vials: buildOrderVials(orders, images) };
}

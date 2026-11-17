// GET /tracker/order-vials — the PURE mapping (docs/mobile-admin/TRACKER.md §4
// "Vials"): the buyer's shipped/delivered order lines, one row each, so the app
// can turn a line into a tracker vial with the strength prefilled.

import type { TrackerOrderVial } from "@/lib/mobile/contract";
import { imageUrl } from "@/lib/media/image-url";
import type { OrderItem } from "@/storefront/types";
import { parseStrength } from "./strength";

/** Most rows one response carries (newest orders first). */
export const MAX_ORDER_VIALS = 100;
/** Orders read to fill them — a line-heavy order can't starve the list. */
export const ORDER_VIAL_ORDERS = 100;
/** Statuses whose lines the buyer may already hold. */
export const ORDER_VIAL_STATUSES = ["delivered", "shipped"] as const;

const THUMB_PX = 160;

export type OrderVialSource = {
  id: string;
  orderNumber: string;
  status: string;
  statusHistory: { status: string; at: string }[];
  items: OrderItem[];
};

/** The images an order line can show: the product's, or its variation's own. */
export type ProductImages = { image?: string | null; variations?: { name: string; image?: string | null }[] };

function deliveredAt(o: OrderVialSource): string | null {
  const hits = o.statusHistory.filter((e) => e.status === "delivered");
  return hits.length ? hits[hits.length - 1].at : null;
}

function lineImage(item: OrderItem, product: ProductImages | undefined): string | null {
  if (!product) return null;
  const own = item.variation ? product.variations?.find((v) => v.name === item.variation)?.image : undefined;
  const src = own || product.image || "";
  return src ? imageUrl(src, { width: THUMB_PX, height: THUMB_PX }) : null;
}

/** Orders newest first in, rows out in the same order, capped. */
export function buildOrderVials(
  orders: readonly OrderVialSource[],
  products: ReadonlyMap<string, ProductImages>,
): TrackerOrderVial[] {
  const rows: TrackerOrderVial[] = [];
  for (const o of orders) {
    const delivered = deliveredAt(o);
    for (const [index, item] of o.items.entries()) {
      // Ligwak'd vials never arrived (lib/orders/gb-line-status).
      const quantity = Math.max(0, Math.floor(item.qty) - Math.max(0, Math.floor(item.cancelledQty ?? 0)));
      if (quantity === 0) continue;
      const variation = item.variation?.trim() || null;
      rows.push({
        key: `${o.id}:${index}`,
        orderNumber: o.orderNumber,
        deliveredAt: delivered,
        productId: item.productId ?? "",
        name: item.name,
        variation,
        strength: parseStrength(variation, item.name),
        quantity,
        imageUrl: lineImage(item, item.productId ? products.get(item.productId) : undefined),
      });
      if (rows.length >= MAX_ORDER_VIALS) return rows;
    }
  }
  return rows;
}

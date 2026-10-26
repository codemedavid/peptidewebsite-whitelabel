import "server-only";

import { unstable_cache } from "next/cache";
import { withTenant } from "@/lib/db/tenant-client";
import { dbOrderToStorefront, type DbOrderRow } from "@/lib/orders/db-mapping";
import { ordersWhere, type TrashScope } from "@/lib/orders/trash";
import { ordersTag } from "@/lib/orders/order-cache";
import type { Order } from "@/storefront/types";

/** Outer bound only: every order writer busts `ordersTag`, so a list is
 *  normally re-read the moment an order changes. Direct-DB scripts can't. */
const ORDER_LIST_REVALIDATE_SECONDS = 600;

/**
 * The tenant's whole order book, newest first — ONE cache entry shared by every
 * screen that needs all of it: the website's Orders / Dashboard / Analytics and
 * the app's Insights / Customers. Each of those used to re-read every row
 * (~1.8 kB each, hundreds per store) on every open — and Customers on every
 * search — which made order lists a top source of Supabase egress.
 *
 * Cached as mapped Orders (plain JSON, so no Date→string surprise on a hit).
 */
export const loadOrderList = (tenantId: string, view: TrashScope): Promise<Order[]> =>
  unstable_cache(
    async () => {
      const rows = await withTenant(tenantId, (db) =>
        db.storefrontOrder.findMany({
          where: ordersWhere(view),
          // The trash reads newest-DELETED first, which is the order the owner
          // undoing a mis-click is looking for.
          orderBy: view === "trash" ? { deletedAt: "desc" } : { createdAt: "desc" },
        }),
      );
      return rows.map((r) => dbOrderToStorefront(r as DbOrderRow));
    },
    ["admin-order-list", tenantId, view],
    { tags: [`tenant:${tenantId}`, ordersTag(tenantId)], revalidate: ORDER_LIST_REVALIDATE_SECONDS },
  )();

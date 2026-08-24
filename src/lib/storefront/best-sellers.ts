// Best-seller tallies for the "simple" catalog sort.
//
// The tally is a full scan of the tenant's active orders reduced to a
// per-product count — hpglow alone has ~490 of them, and the whole result only
// decides the order of one dropdown. Rescanning that on every page view cost
// ~720ms per render, so the reduced counts are cached rather than the orders.
//
// Cached, never the raw rows: the scan reads only `status` and `items`, and
// what leaves this module is a Record<productId, units>. No order ever reaches
// a caller, so nothing customer-identifying can ride along into a page payload.

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { withTenant } from "@/lib/db/tenant-client";
import { ACTIVE_ORDERS_WHERE, activeOrders } from "@/lib/orders/trash";
import { isDemoMode, getDemoStoreOrders } from "@/lib/demo/fixtures";
import {
  buildBestSellerCounts,
  type BestSellerCounts,
  type BestSellerOrderInput,
} from "./catalog-sort";

/** Long enough to erase the per-render cost, short enough that a new order
 *  shows up in the sort while the owner is still watching for it. */
const REVALIDATE_SECONDS = 300;

const loadCounts = (tenantId: string) =>
  unstable_cache(
    async (): Promise<BestSellerCounts> => {
      // A trashed order sold nothing, so the same predicate the rest of the
      // order surfaces use gates the scan.
      const rows = await withTenant(tenantId, (db) =>
        db.storefrontOrder.findMany({
          where: ACTIVE_ORDERS_WHERE,
          select: { status: true, items: true },
        }),
      );
      const orders: BestSellerOrderInput[] = rows.map((r) => ({
        status: r.status,
        items: Array.isArray(r.items) ? (r.items as BestSellerOrderInput["items"]) : [],
      }));
      return buildBestSellerCounts(orders);
    },
    ["storefront-best-sellers", tenantId],
    {
      // Rides the tenant tag every order/branding mutation already busts, plus
      // its own so an order write can invalidate just this.
      tags: [`tenant:${tenantId}`, `tenant:${tenantId}:orders`],
      revalidate: REVALIDATE_SECONDS,
    },
  )();

/**
 * Units sold per product id. Returns `{}` rather than throwing: this only ranks
 * a sort dropdown, and a DB hiccup must never take the storefront down with it.
 * Outer `cache()` dedupes within a render the way the other tenant loaders do.
 */
export const getBestSellerCounts = cache(
  async (tenantId: string, slug?: string): Promise<BestSellerCounts> => {
    try {
      if (isDemoMode()) {
        return buildBestSellerCounts(activeOrders(getDemoStoreOrders(slug ?? tenantId)));
      }
      return await loadCounts(tenantId);
    } catch {
      return {};
    }
  },
);

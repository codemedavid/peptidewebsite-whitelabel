// Live group-buy round demand for the storefront: the slot bar's order count
// and the per-product vial totals behind the kit progress (gb-moq-kits).
//
// Every storefront render needs these while a round is live, and the vial
// totals mean reading each round order's `items` JSON — so, like the
// best-seller tally, the REDUCED numbers are cached rather than re-read per
// page view. Every order writer busts `ordersTag`, so a new order fills the bar
// straight away. Only counts leave this module; no order row reaches a caller.

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { withTenant } from "@/lib/db/tenant-client";
import { ACTIVE_ORDERS_WHERE, activeOrders } from "@/lib/orders/trash";
import { ordersTag } from "@/lib/orders/order-cache";
import { isDemoMode, getDemoStoreOrders } from "@/lib/demo/fixtures";
import { orderCountsAsDemand, DEMAND_EXCLUDED_STATUS_LIST } from "./group-buy";
import { tallyKitVials } from "./gb-moq-kits";

export type RoundDemand = {
  /** Demand orders in the round (everything except cancelled / refunded). */
  filled: number;
  /** Vials ordered per product id. */
  kitVials: Record<string, number>;
};

const EMPTY: RoundDemand = { filled: 0, kitVials: {} };

/** Outer bound only: every order writer busts `ordersTag`. */
const REVALIDATE_SECONDS = 3600;

function reduce(orders: readonly { items: unknown }[]): RoundDemand {
  return { filled: orders.length, kitVials: tallyKitVials(orders) };
}

const loadDemand = (tenantId: string, groupBuyId: string) =>
  unstable_cache(
    async (): Promise<RoundDemand> => {
      const rows = await withTenant(tenantId, (db) =>
        db.storefrontOrder.findMany({
          select: { items: true },
          where: {
            // A trashed order is not demand — it must not fill the bar.
            ...ACTIVE_ORDERS_WHERE,
            tenantId,
            groupBuyId,
            // Same demand definition the demo path uses (orderCountsAsDemand)
            // — one shared list so the two never drift.
            status: { notIn: [...DEMAND_EXCLUDED_STATUS_LIST] },
          },
        }),
      );
      return reduce(rows);
    },
    ["storefront-gb-round-demand", tenantId, groupBuyId],
    {
      tags: [`tenant:${tenantId}`, ordersTag(tenantId)],
      revalidate: REVALIDATE_SECONDS,
    },
  )();

/**
 * The live round's demand. Returns zeros rather than throwing: the progress
 * bars just show 0 — never block the storefront on them.
 */
export const getRoundDemand = cache(
  async (tenantId: string, groupBuyId: string, slug?: string): Promise<RoundDemand> => {
    try {
      if (isDemoMode()) {
        return reduce(
          activeOrders(getDemoStoreOrders(slug ?? tenantId)).filter(
            (o) => o.groupBuyId === groupBuyId && orderCountsAsDemand(o.status),
          ),
        );
      }
      return await loadDemand(tenantId, groupBuyId);
    } catch {
      return EMPTY;
    }
  },
);

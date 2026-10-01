import "server-only";

import { withTenant } from "@/lib/db/tenant-client";
import { dbOrderToStorefront, type DbOrderRow } from "@/lib/orders/db-mapping";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import { formatMoney } from "@/lib/storefront/currency";
import { normalizeStoreStatus } from "@/lib/storefront/store-status";
import type { DashboardResponse } from "./contract";
import type { MobileContext } from "./auth";
import { mobileCan } from "./branding";
import { toOrderSummary } from "./order-view";
import { queueCounts } from "./orders";
import { listProducts } from "./products";

/**
 * The Home screen: "what needs me now", from real tenant-scoped rows only.
 * Money appears only when this account + plan may see analytics (the same
 * gate as the web's Sales Analytics); otherwise `today` is null, never zero.
 *
 * "Today" is the store's calendar day in Asia/Manila — the timezone the web
 * admin's order screens already render in (storefront/admin/order-detail.ts).
 */

const STORE_UTC_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Manila, no DST
const RECENT = 5;
const LOW_STOCK_ROWS = 5;

export function startOfStoreDay(now: Date): Date {
  const local = new Date(now.getTime() + STORE_UTC_OFFSET_MS);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnightLocal - STORE_UTC_OFFSET_MS);
}

async function orderStats(ctx: MobileContext, withToday: boolean) {
  return withTenant(ctx.tenantId, async (db) => {
    const [counts, recent, today] = await Promise.all([
      queueCounts(db),
      db.storefrontOrder.findMany({ where: ACTIVE_ORDERS_WHERE, orderBy: { createdAt: "desc" }, take: RECENT }),
      withToday
        ? db.storefrontOrder.findMany({
            where: {
              ...ACTIVE_ORDERS_WHERE,
              status: { not: "cancelled" },
              createdAt: { gte: startOfStoreDay(new Date()) },
            },
          })
        : Promise.resolve(null),
    ]);
    return { newOrders: counts.new, toFulfil: counts.toFulfil, recent, today };
  });
}

export async function buildDashboard(ctx: MobileContext): Promise<DashboardResponse> {
  const config = (ctx.tenant.branding?.config ?? {}) as Record<string, unknown>;
  const can = mobileCan(ctx);
  const summarize = (r: unknown) => toOrderSummary(dbOrderToStorefront(r as DbOrderRow), config.currency);

  const [orders, products] = await Promise.all([
    can.orders ? orderStats(ctx, can.analytics) : Promise.resolve(null),
    can.products || can.inventory ? listProducts(ctx) : Promise.resolve([]),
  ]);
  const todays = orders?.today?.map(summarize) ?? null;
  const low = products.filter((p) => p.stockTone === "out" || p.stockTone === "low");

  return {
    store: { open: normalizeStoreStatus(config.storeStatus).open },
    queue: { newOrders: orders?.newOrders ?? 0, toFulfil: orders?.toFulfil ?? 0 },
    today: todays
      ? { orders: todays.length, revenueLabel: formatMoney(todays.reduce((s, o) => s + o.total, 0), config.currency) }
      : null,
    recent: (orders?.recent ?? []).map(summarize),
    lowStockCount: low.length,
    lowStock: [...low]
      .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))
      .slice(0, LOW_STOCK_ROWS)
      .map((p) => ({ id: p.id, name: p.name, units: p.stock ?? 0, tone: p.stockTone as "out" | "low" })),
  };
}

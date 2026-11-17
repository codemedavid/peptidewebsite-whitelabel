import "server-only";

import { unstable_cache } from "next/cache";
import { withTenant } from "@/lib/db/tenant-client";
import { dbOrderToStorefront, type DbOrderRow } from "@/lib/orders/db-mapping";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import { formatMoney } from "@/lib/storefront/currency";
import { isForeignCurrencyOrder } from "@/lib/storefront/markets";
import { isMadeToOrder } from "@/lib/storefront/made-to-order";
import { normalizeStoreStatus } from "@/lib/storefront/store-status";
import { dbProductToStorefront, type DbProductRow } from "@/lib/storefront/product-mapping";
import { loadCatalogRows } from "@/lib/storefront/storefront-brand";
import {
  buildAttentionAlerts,
  buildCategoryShares,
  buildStockPanel,
  LOW_STOCK_AT,
  productUnits,
  type AttentionAlert,
  type DashboardCaps,
} from "@/lib/storefront/admin-dashboard";
import { isModuleAllowed } from "@/storefront/admin/staff-permissions";
import { SEED_CATEGORIES } from "@/storefront/data";
import type { Category, Order, Product } from "@/storefront/types";
import { ordersTag } from "@/lib/orders/order-cache";
import type {
  DashboardAlert,
  DashboardAlertTarget,
  DashboardCatalog,
  DashboardCategoryShare,
  DashboardResponse,
  DashboardStockRow,
  OrderSummary,
} from "./contract";
import type { MobileContext } from "./auth";
import { mobileCan } from "./branding";
import { toOrderSummary } from "./order-view";
import { queueCounts } from "./orders";

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
/** Outer bound only: every stock writer busts `tenant:<id>`. */
const LOW_STOCK_REVALIDATE_SECONDS = 3600;
/** Outer bound only — every order writer busts `ordersTag`. */
const ORDER_STATS_REVALIDATE_SECONDS = 600;

/** The website dashboard's "unfulfilled" statuses (lib/storefront/admin-dashboard). */
const UNFULFILLED_STATUSES = ["new", "confirmed", "processing", "ready"];
/** Order codes named under the "waiting to be packed" alert. */
const ALERT_SAMPLE = 2;

type CatalogSummary = Pick<DashboardResponse, "lowStockCount" | "lowStock"> & {
  catalog: DashboardCatalog;
  stockLevels: DashboardStockRow[];
  topCategories: DashboardCategoryShare[];
  /** Low-stock + empty-category alerts, before the per-account grant filter. */
  alerts: AttentionAlert[];
};

const EMPTY_CATALOG: CatalogSummary = {
  lowStockCount: 0,
  lowStock: [],
  catalog: { products: 0, featured: 0, units: 0, outOfStock: 0 },
  stockLevels: [],
  topCategories: [],
  alerts: [],
};

/** The owner's saved categories, or the website's seed list when none are saved (store.tsx). */
export function categoriesOf(config: Record<string, unknown>): Category[] {
  const saved = config.categories;
  if (!Array.isArray(saved)) return SEED_CATEGORIES;
  return saved.filter(
    (c): c is Category => !!c && typeof c === "object" && typeof (c as Category).id === "string" && typeof (c as Category).label === "string",
  );
}

/**
 * Every catalog figure on Home, from the website dashboard's own pure builders
 * (lib/storefront/admin-dashboard) so the two can never disagree:
 *   - low stock (≤ LOW_STOCK_AT units, made-to-order never counts);
 *   - the operations tiles: Products / Units in stock / Out of stock;
 *   - "Stock levels" (worst first) — made-to-order products hold no stock, so
 *     they are left out rather than read as "Out of stock";
 *   - "Top categories" and the "N categories have no products" alert.
 */
export function summarizeCatalog(products: Product[], categories: Category[]): CatalogSummary {
  const stocked = products.filter((p) => !isMadeToOrder(p));
  const units = (p: Product) => productUnits(p);
  const low = stocked.filter((p) => units(p) <= LOW_STOCK_AT);
  const allCaps: DashboardCaps = { analytics: false, orders: false, inventory: true, products: true, categories: true };
  return {
    lowStockCount: low.length,
    lowStock: [...low]
      .sort((a, b) => units(a) - units(b) || a.name.localeCompare(b.name))
      .slice(0, LOW_STOCK_ROWS)
      .map((p) => ({ id: p.id, name: p.name, units: units(p), tone: units(p) === 0 ? "out" : "low" })),
    catalog: {
      products: products.length,
      featured: products.filter((p) => p.featured).length,
      units: products.reduce((sum, p) => sum + units(p), 0),
      outOfStock: stocked.filter((p) => units(p) === 0).length,
    },
    stockLevels: buildStockPanel(stocked),
    topCategories: buildCategoryShares(categories, products),
    alerts: buildAttentionAlerts({ caps: allCaps, products, orders: [], categories }),
  };
}

/**
 * Catalog summary, cached per tenant. Computing it needs every product row
 * (variation stock lives in metadata), and re-pulling the whole catalog on each
 * 20s poll was a steady source of Supabase egress. Only the reduced summary is
 * cached — plain data, so no Date→string surprises on a cache hit. Category
 * saves bust `tenant:<id>` too; the category list is also in the key.
 */
const loadCatalogSummary = (ctx: MobileContext, categories: Category[], currency: unknown) =>
  unstable_cache(
    async (): Promise<CatalogSummary> => {
      const symbol = typeof currency === "string" && currency.trim() ? currency : "₱";
      const products = (await loadCatalogRows(ctx.tenantId)).map((r) => dbProductToStorefront(r as DbProductRow, symbol));
      return summarizeCatalog(products, categories);
    },
    ["mobile-dashboard-catalog", ctx.tenantId, categories.map((c) => `${c.id}:${c.label}`).join("|")],
    { tags: [`tenant:${ctx.tenantId}`, `tenant:${ctx.tenantId}:products`], revalidate: LOW_STOCK_REVALIDATE_SECONDS },
  )();

export function startOfStoreDay(now: Date): Date {
  const local = new Date(now.getTime() + STORE_UTC_OFFSET_MS);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnightLocal - STORE_UTC_OFFSET_MS);
}

type OrderStats = {
  newOrders: number;
  toFulfil: number;
  recent: OrderSummary[];
  /** Today's store-currency orders (cancelled excluded). */
  today: OrderSummary[] | null;
  /** Today's International (foreign-currency) orders — counted, never summed. */
  todayInternational: number;
  /** "N orders are waiting to be packed" (the website's unfulfilled set). */
  unfulfilled: { count: number; sample: string[] };
};

/** Split today's orders: store currency (summed) vs International (counted). */
export function splitByCurrency(orders: Order[], currency: unknown): { local: Order[]; international: number } {
  const symbol = typeof currency === "string" ? currency : undefined;
  const local = orders.filter((o) => !isForeignCurrencyOrder(o, symbol));
  return { local, international: orders.length - local.length };
}

/**
 * The order half of Home, cached per tenant and store day. The app re-reads
 * Home on a 20s poll from every open phone, so this was re-run ~180 times an
 * hour per device; now it only re-reads after an order write busts
 * `ordersTag`. Summaries (plain JSON) are cached, never raw rows.
 */
const orderStats = (ctx: MobileContext, withToday: boolean, currency: unknown) => {
  const dayStart = startOfStoreDay(new Date());
  return unstable_cache(
    async (): Promise<OrderStats> =>
      withTenant(ctx.tenantId, async (db) => {
        const unfulfilledWhere = { ...ACTIVE_ORDERS_WHERE, status: { in: UNFULFILLED_STATUSES } };
        const [counts, recent, today, unfulfilledCount, unfulfilledSample] = await Promise.all([
          queueCounts(db),
          db.storefrontOrder.findMany({ where: ACTIVE_ORDERS_WHERE, orderBy: { createdAt: "desc" }, take: RECENT }),
          withToday
            ? db.storefrontOrder.findMany({
                where: {
                  ...ACTIVE_ORDERS_WHERE,
                  status: { not: "cancelled" },
                  createdAt: { gte: dayStart },
                },
              })
            : Promise.resolve(null),
          db.storefrontOrder.count({ where: unfulfilledWhere }),
          db.storefrontOrder.findMany({
            where: unfulfilledWhere,
            orderBy: { createdAt: "desc" },
            take: ALERT_SAMPLE,
            select: { id: true, orderNumber: true },
          }),
        ]);
        const summarize = (o: Order) => toOrderSummary(o, currency);
        const todays = today ? splitByCurrency(today.map((r) => dbOrderToStorefront(r as DbOrderRow)), currency) : null;
        return {
          newOrders: counts.new,
          toFulfil: counts.toFulfil,
          recent: recent.map((r) => summarize(dbOrderToStorefront(r as DbOrderRow))),
          today: todays ? todays.local.map(summarize) : null,
          todayInternational: todays?.international ?? 0,
          unfulfilled: { count: unfulfilledCount, sample: unfulfilledSample.map((o) => o.orderNumber || o.id) },
        };
      }),
    ["mobile-dashboard-orders", ctx.tenantId, dayStart.toISOString(), String(withToday), String(currency ?? "")],
    { tags: [`tenant:${ctx.tenantId}`, ordersTag(ctx.tenantId)], revalidate: ORDER_STATS_REVALIDATE_SECONDS },
  )();
};

const ALERT_TARGET: Record<string, DashboardAlertTarget> = {
  inv: "inventory",
  orders: "orders",
  categories: "categories",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "Needs attention", in the website's order (low stock, orders to pack, empty
 * categories) — each entry gated on the grant for the screen it opens, so an
 * alert is never a shortcut past a permission.
 */
export function attentionFor(
  catalogAlerts: AttentionAlert[],
  unfulfilled: OrderStats["unfulfilled"] | null,
  grants: { inventory: boolean; orders: boolean; categories: boolean },
): DashboardAlert[] {
  const toAlert = (a: AttentionAlert): DashboardAlert | null => {
    const target = ALERT_TARGET[a.view];
    return target ? { id: a.id, title: a.title, sub: a.sub, tone: a.tone, target } : null;
  };
  const low = grants.inventory ? catalogAlerts.filter((a) => a.view === "inv") : [];
  const empty = grants.categories ? catalogAlerts.filter((a) => a.view === "categories") : [];
  const packing: AttentionAlert[] =
    grants.orders && unfulfilled && unfulfilled.count > 0
      ? [
          {
            id: "unfulfilled",
            title: `${plural(unfulfilled.count, "order is", "orders are")} waiting to be packed`,
            sub: unfulfilled.sample.join(", "),
            tone: "bad",
            view: "orders",
          },
        ]
      : [];
  return [...low, ...packing, ...empty].map(toAlert).filter((a): a is DashboardAlert => a !== null);
}

export async function buildDashboard(ctx: MobileContext): Promise<DashboardResponse> {
  const config = (ctx.tenant.branding?.config ?? {}) as Record<string, unknown>;
  const can = mobileCan(ctx);
  const catalogGrant = can.products || can.inventory;
  const categoriesGrant = isModuleAllowed(ctx.actor, "categories");

  const [orders, summary] = await Promise.all([
    can.orders ? orderStats(ctx, can.analytics, config.currency) : Promise.resolve(null),
    catalogGrant || categoriesGrant
      ? loadCatalogSummary(ctx, categoriesOf(config), config.currency)
      : Promise.resolve<CatalogSummary>(EMPTY_CATALOG),
  ]);
  const todays = orders?.today ?? null;
  const visible = catalogGrant ? summary : EMPTY_CATALOG;

  return {
    store: { open: normalizeStoreStatus(config.storeStatus).open },
    queue: { newOrders: orders?.newOrders ?? 0, toFulfil: orders?.toFulfil ?? 0 },
    today: todays
      ? {
          orders: todays.length,
          revenueLabel: formatMoney(todays.reduce((s, o) => s + o.total, 0), config.currency),
          international: orders?.todayInternational ?? 0,
        }
      : null,
    recent: orders?.recent ?? [],
    lowStockCount: visible.lowStockCount,
    lowStock: visible.lowStock,
    catalog: catalogGrant ? summary.catalog : null,
    stockLevels: visible.stockLevels,
    topCategories: catalogGrant || categoriesGrant ? summary.topCategories : [],
    attention: attentionFor(summary.alerts, orders?.unfulfilled ?? null, {
      inventory: can.inventory,
      orders: can.orders,
      categories: categoriesGrant,
    }),
  };
}

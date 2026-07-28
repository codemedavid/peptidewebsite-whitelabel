/**
 * Store-admin dashboard core — every number the redesigned dashboard renders is
 * decided here, so the UI stays a dumb projection of these pure builders.
 *
 * The headline rule this module exists to enforce: **a tenant without the Sales
 * Analytics feature never sees revenue**. `dashboardCapabilities()` is the one
 * gate (tenant entitlement AND staff grant, both must hold) and every builder
 * takes those caps — so the analytics-off dashboard falls back to the
 * "operations" layout (stock levels + recent orders) at the DATA level, not by
 * hiding a rendered chart with CSS.
 *
 * Money policy matches AdminAnalytics/AdminOrders: an order's total is
 * items − discount + shipping fee + admin fee, and cancelled orders never count
 * as revenue.
 *
 * Pure: no DB, no React, no Next runtime. Covered by
 * scripts/test-admin-dashboard.ts.
 */

import type { Brand, Category, Order, Product } from "@/storefront/types";
import { isAdminViewVisible } from "@/storefront/visibility";
import { isViewAllowed, type StaffActor } from "@/storefront/admin/staff-permissions";

// ── Constants ────────────────────────────────────────────────────────────────

/** At or below this many units a product counts as "low stock". */
export const LOW_STOCK_AT = 5;

/** Days in the dashboard revenue sparkline. */
export const REVENUE_WINDOW_DAYS = 14;

/** Rows in the stock panel / recent-orders table before "view all". */
const STOCK_ROW_LIMIT = 6;
const RECENT_ORDER_LIMIT = 5;
const CATEGORY_ROW_LIMIT = 6;

/** Statuses that still need someone to act on the order. */
const UNFULFILLED_STATUSES: readonly Order["status"][] = [
  "new",
  "confirmed",
  "processing",
  "ready",
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Capabilities ─────────────────────────────────────────────────────────────

export type DashboardCaps = {
  /** May see revenue: the Sales Analytics entitlement AND the staff grant. */
  analytics: boolean;
  orders: boolean;
  inventory: boolean;
  products: boolean;
  categories: boolean;
};

/**
 * What this actor may see on this tenant's dashboard. Each capability is the
 * conjunction of the tenant-level toggle (`isAdminViewVisible`, which carries
 * the super-admin switch and the platform entitlement) and the actor's own
 * grant (`isViewAllowed`) — so neither an entitled tenant with a limited staff
 * member, nor a fully-granted staff member on an unentitled tenant, can see a
 * panel they aren't owed.
 */
export function dashboardCapabilities(brand: Brand, actor: StaffActor): DashboardCaps {
  const can = (view: string): boolean =>
    isAdminViewVisible(brand, view) && isViewAllowed(actor, view);

  return {
    analytics: can("analytics"),
    orders: can("orders"),
    inventory: can("inv"),
    products: can("products"),
    categories: can("categories"),
  };
}

export type DashboardLayout = "analytics" | "operations";

/**
 * Which dashboard body to render. Without the analytics capability the revenue
 * chart is replaced by the stock-levels panel and the recent-orders table —
 * the operations layout.
 */
export function dashboardLayoutFor(caps: DashboardCaps): DashboardLayout {
  return caps.analytics ? "analytics" : "operations";
}

// ── Shared money / stock helpers ─────────────────────────────────────────────

/**
 * An order's total: items − discount + shipping fee + admin fee, floored at 0.
 * Same rule as AdminOrders / AdminOrderDetail / AdminAnalytics — no order-level
 * total is stored.
 */
export function orderTotal(o: Order): number {
  return Math.max(
    0,
    (o.items || []).reduce((sum, i) => sum + (i.price || 0) * (i.qty || 1), 0) -
      (o.discount?.amount || 0) +
      (o.shipping?.fee || 0) +
      (o.adminFee?.amount || 0),
  );
}

/**
 * Units on hand for a product, variation-aware. Variations that track their own
 * `stock` are separate pools and sum on their own; the base column is added once
 * when anything still draws on it (no variations, or at least one untracked
 * variation) — mirroring the fallback rule in lib/storefront/inventory.ts.
 */
export function productUnits(p: Product): number {
  const variations = p.variations ?? [];
  const tracked = variations.filter((v) => typeof v.stock === "number");
  const sharesBase = variations.length === 0 || tracked.length < variations.length;
  const trackedUnits = tracked.reduce((sum, v) => sum + Math.max(0, v.stock ?? 0), 0);
  return trackedUnits + (sharesBase ? Math.max(0, p.stock ?? 0) : 0);
}

function isUnfulfilled(o: Order): boolean {
  return UNFULFILLED_STATUSES.includes(o.status);
}

function lowStockProducts(products: Product[]): Product[] {
  return products.filter((p) => productUnits(p) <= LOW_STOCK_AT);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function orderDate(o: Order): Date {
  return new Date(o.date);
}

function formatPeso(n: number): string {
  return "₱" + Math.round(n || 0).toLocaleString();
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ── Metric tiles ─────────────────────────────────────────────────────────────

export type MetricTone = "neutral" | "good" | "warn" | "bad";

export type MetricTile = {
  id: string;
  label: string;
  value: string;
  sub: string;
  delta?: { label: string; tone: MetricTone };
};

/**
 * The four KPI tiles. Order-derived tiles require the orders capability, and
 * revenue additionally requires analytics — an unentitled tenant gets catalog
 * and stock counts instead, with no money string anywhere in the row.
 */
export function buildMetricTiles(input: {
  caps: DashboardCaps;
  products: Product[];
  orders: Order[];
  now?: Date;
}): MetricTile[] {
  const { caps, products, orders } = input;
  const now = input.now ?? new Date();
  const today = startOfDay(now).getTime();

  const low = lowStockProducts(products);
  const outOfStock = products.filter((p) => productUnits(p) === 0);
  const units = products.reduce((sum, p) => sum + productUnits(p), 0);
  const unfulfilled = orders.filter(isUnfulfilled);

  const tiles: MetricTile[] = [];

  if (caps.orders && caps.analytics) {
    const todays = orders.filter(
      (o) => o.status !== "cancelled" && startOfDay(orderDate(o)).getTime() === today,
    );
    const revenue = todays.reduce((sum, o) => sum + orderTotal(o), 0);
    const avg = todays.length > 0 ? revenue / todays.length : 0;

    tiles.push({
      id: "orders-today",
      label: "Orders today",
      value: String(todays.length),
      sub: `${plural(unfulfilled.length, "order", "orders")} awaiting fulfillment`,
    });
    tiles.push({
      id: "revenue-today",
      label: "Revenue today",
      value: formatPeso(revenue),
      sub: `Avg. order ${formatPeso(avg)}`,
    });
  } else {
    tiles.push({
      id: "products",
      label: "Products",
      value: String(products.length),
      sub: `${plural(products.filter((p) => p.featured).length, "item", "items")} featured`,
    });
    tiles.push({
      id: "units",
      label: "Units in stock",
      value: String(units),
      sub: `across ${plural(products.length, "product", "products")}`,
    });
  }

  tiles.push({
    id: "low-stock",
    label: "Low stock",
    value: String(low.length),
    sub: `at or below ${LOW_STOCK_AT} units`,
    ...(low.length > 0 ? { delta: { label: "needs action", tone: "warn" as MetricTone } } : {}),
  });

  if (caps.orders) {
    tiles.push({
      id: "unfulfilled",
      label: "Unfulfilled",
      value: String(unfulfilled.length),
      sub: unfulfilled.length > 0 ? "waiting on you" : "all caught up",
      ...(unfulfilled.length > 0
        ? { delta: { label: "to pack", tone: "bad" as MetricTone } }
        : {}),
    });
  } else {
    tiles.push({
      id: "out-of-stock",
      label: "Out of stock",
      value: String(outOfStock.length),
      sub: outOfStock.length > 0 ? "not sellable right now" : "everything is sellable",
    });
  }

  return tiles;
}

// ── Revenue series ───────────────────────────────────────────────────────────

export type RevenuePoint = { day: string; value: number };

export type RevenueSeries = {
  /** One point per day, oldest first. */
  points: RevenuePoint[];
  total: number;
  previousTotal: number;
  /** Change vs. the previous window; null when there is nothing to compare to. */
  deltaPct: number | null;
};

/**
 * The revenue sparkline. Returns `null` without the analytics capability — the
 * caller then renders the operations panels instead. Cancelled orders are
 * excluded, matching AdminAnalytics.
 */
export function buildRevenueSeries(input: {
  caps: DashboardCaps;
  orders: Order[];
  days?: number;
  now?: Date;
}): RevenueSeries | null {
  const { caps, orders } = input;
  if (!caps.analytics) return null;

  const days = input.days ?? REVENUE_WINDOW_DAYS;
  const now = input.now ?? new Date();
  const todayStart = startOfDay(now).getTime();
  const windowStart = todayStart - (days - 1) * MS_PER_DAY;
  const previousStart = windowStart - days * MS_PER_DAY;

  const buckets = new Array<number>(days).fill(0);
  let previousTotal = 0;

  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const at = startOfDay(orderDate(o)).getTime();
    if (Number.isNaN(at)) continue;
    if (at >= windowStart && at <= todayStart) {
      buckets[Math.round((at - windowStart) / MS_PER_DAY)] += orderTotal(o);
    } else if (at >= previousStart && at < windowStart) {
      previousTotal += orderTotal(o);
    }
  }

  const points = buckets.map((value, i) => ({
    day: new Date(windowStart + i * MS_PER_DAY).toISOString().slice(0, 10),
    value,
  }));
  const total = buckets.reduce((sum, v) => sum + v, 0);

  return {
    points,
    total,
    previousTotal,
    deltaPct: previousTotal > 0 ? ((total - previousTotal) / previousTotal) * 100 : null,
  };
}

// ── Stock panel ──────────────────────────────────────────────────────────────

export type StockTone = "out" | "low" | "ok";

export type StockRow = {
  id: string;
  name: string;
  units: number;
  /** Bar width 0..100, relative to the best-stocked product. */
  pct: number;
  tone: StockTone;
};

const TONE_RANK: Record<StockTone, number> = { out: 0, low: 1, ok: 2 };

function stockTone(units: number): StockTone {
  if (units === 0) return "out";
  return units <= LOW_STOCK_AT ? "low" : "ok";
}

/**
 * On-hand levels, worst first — the panel that replaces the revenue chart for a
 * tenant without analytics. Bars are relative to the best-stocked product, so
 * an all-zero catalog renders flat rather than dividing by zero.
 */
export function buildStockPanel(products: Product[], limit = STOCK_ROW_LIMIT): StockRow[] {
  const rows = products.map((p) => {
    const units = productUnits(p);
    return { id: p.id, name: p.name, units, pct: 0, tone: stockTone(units) };
  });

  const max = rows.reduce((m, r) => Math.max(m, r.units), 0);

  return rows
    .map((r) => ({ ...r, pct: max > 0 ? Math.round((r.units / max) * 100) : 0 }))
    .sort(
      (a, b) =>
        TONE_RANK[a.tone] - TONE_RANK[b.tone] ||
        a.units - b.units ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

// ── Recent orders ────────────────────────────────────────────────────────────

export type RecentOrderRow = {
  id: string;
  /** Tenant-facing order code, never the internal row id. */
  code: string;
  customer: string;
  items: number;
  total: number;
  date: string;
  status: Order["status"];
};

/** Recent orders, newest first. Empty without the orders capability. */
export function buildRecentOrders(input: {
  caps: DashboardCaps;
  orders: Order[];
  limit?: number;
}): RecentOrderRow[] {
  const { caps, orders } = input;
  if (!caps.orders) return [];

  return [...orders]
    .sort((a, b) => orderDate(b).getTime() - orderDate(a).getTime())
    .slice(0, input.limit ?? RECENT_ORDER_LIMIT)
    .map((o) => ({
      id: o.id,
      code: o.orderNumber || `#${o.id.slice(0, 8)}`,
      customer: o.customer?.name || "—",
      items: (o.items || []).reduce((sum, i) => sum + (i.qty || 1), 0),
      total: orderTotal(o),
      date: o.date,
      status: o.status,
    }));
}

// ── Needs attention ──────────────────────────────────────────────────────────

export type AttentionAlert = {
  id: string;
  title: string;
  sub: string;
  tone: MetricTone;
  /** The view this alert opens — only ever one the actor is allowed to reach. */
  view: string;
};

/**
 * The "needs attention" list. Each entry is gated on the capability for the view
 * it links to, so an alert can never be a shortcut past a permission the actor
 * doesn't hold.
 */
export function buildAttentionAlerts(input: {
  caps: DashboardCaps;
  products: Product[];
  orders: Order[];
  categories?: Category[];
}): AttentionAlert[] {
  const { caps, products, orders, categories } = input;
  const alerts: AttentionAlert[] = [];

  if (caps.inventory) {
    const low = lowStockProducts(products);
    if (low.length > 0) {
      alerts.push({
        id: "low-stock",
        title: `${plural(low.length, "product is", "products are")} low on stock`,
        sub: low
          .slice(0, 2)
          .map((p) => p.name)
          .join(", "),
        tone: "warn",
        view: "inv",
      });
    }
  }

  if (caps.orders) {
    const unfulfilled = orders.filter(isUnfulfilled);
    if (unfulfilled.length > 0) {
      alerts.push({
        id: "unfulfilled",
        title: `${plural(unfulfilled.length, "order is", "orders are")} waiting to be packed`,
        sub: unfulfilled
          .slice(0, 2)
          .map((o) => o.orderNumber || o.id)
          .join(", "),
        tone: "bad",
        view: "orders",
      });
    }
  }

  if (caps.categories && categories) {
    const empty = categories.filter(
      (c) => c.id !== "all" && !products.some((p) => p.category === c.id),
    );
    if (empty.length > 0) {
      alerts.push({
        id: "empty-categories",
        title: `${plural(empty.length, "category has", "categories have")} no products`,
        sub: empty
          .slice(0, 2)
          .map((c) => c.label)
          .join(", "),
        tone: "neutral",
        view: "categories",
      });
    }
  }

  return alerts;
}

// ── Category shares ──────────────────────────────────────────────────────────

export type CategoryShare = {
  id: string;
  label: string;
  count: number;
  /** Bar width 0..100, relative to the busiest category. */
  pct: number;
};

/** Product distribution per category, busiest first. */
export function buildCategoryShares(
  categories: Category[],
  products: Product[],
  limit = CATEGORY_ROW_LIMIT,
): CategoryShare[] {
  const rows = categories
    .filter((c) => c.id !== "all")
    .map((c) => ({
      id: c.id,
      label: c.label,
      count: products.filter((p) => p.category === c.id).length,
      pct: 0,
    }));

  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);

  return rows
    .map((r) => ({ ...r, pct: max > 0 ? Math.round((r.count / max) * 100) : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

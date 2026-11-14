// Sales Analytics aggregation for the website admin. The date rules (windows,
// comparisons, buckets) come from lib/analytics/sales-period.ts — the same
// engine as the app's Insights tab — so both read the same numbers.
//
// Revenue policy: cancelled orders are excluded from every sales metric; an
// order's total = items − discount + shipping + admin fee + payment fee, or
// the operator's re-total when one is set (same rule as AdminOrders).

import type { Order } from "../../types";
import {
  buildPeriodSeries,
  clampToNow,
  pctChange,
  type PeriodSeries,
  type ResolvedPeriod,
  type SaleEvent,
} from "@/lib/analytics/sales-period";

export function totalOf(o: Order): number {
  if (o.adjustedTotal != null) return o.adjustedTotal;
  return Math.max(
    0,
    (o.items || []).reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0) -
      (o.discount?.amount || 0) +
      (o.shipping?.fee || 0) +
      (o.adminFee?.amount || 0) +
      (o.paymentFee?.amount || 0),
  );
}

export type Ranked<T> = { name: string; value: T };
type CountRevenue = { count: number; revenue: number };
type GroupBuyRow = { name: string; orders: number; qty: number; revenue: number };

export type Kpi = { value: number; prev: number | null; delta: number | null };

export type SalesReport = {
  series: PeriodSeries;
  revenue: Kpi;
  orders: Kpi;
  aov: Kpi;
  items: Kpi;
  paidRevenue: number;
  cancelledCount: number;
  distinctProducts: number;
  windowTotal: number;
  statusCounts: Record<string, number>;
  topProducts: Ranked<{ qty: number; revenue: number }>[];
  methods: Ranked<CountRevenue>[];
  places: Ranked<CountRevenue>[];
  groupBuys: GroupBuyRow[];
  groupBuyRevenue: number;
};

function rankBy<T>(rows: Map<string, T>, score: (v: T) => number, limit: number): Ranked<T>[] {
  return [...rows.entries()]
    .sort((a, b) => score(b[1]) - score(a[1]))
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));
}

function bumpCount(map: Map<string, CountRevenue>, key: string, revenue: number): void {
  const prev = map.get(key) ?? { count: 0, revenue: 0 };
  map.set(key, { count: prev.count + 1, revenue: prev.revenue + revenue });
}

const qtyOf = (o: Order) => (o.items || []).reduce((q, i) => q + (i.qty || 1), 0);

function placeOf(o: Order): string {
  return (
    (o.shipping?.province || "").trim() ||
    (o.shipping?.city || "").trim() ||
    (o.shipping?.region || "").trim() ||
    "Unspecified"
  );
}

/** The time an order counts at: its placed date, with a future (skewed) date read as now. */
export function orderTime(o: Order, now: number): number | null {
  const t = new Date(o.date).getTime();
  return Number.isNaN(t) ? null : clampToNow(t, now);
}

export function earliestOrderTime(orders: ReadonlyArray<Order>): number | null {
  let min: number | null = null;
  for (const o of orders) {
    const t = new Date(o.date).getTime();
    if (!Number.isNaN(t) && (min === null || t < min)) min = t;
  }
  return min;
}

function kpi(value: number, prev: number, comparing: boolean): Kpi {
  return comparing ? { value, prev, delta: pctChange(value, prev) } : { value, prev: null, delta: null };
}

export function buildSalesReport(orders: ReadonlyArray<Order>, period: ResolvedPeriod, now: number): SalesReport {
  const events: SaleEvent[] = [];
  const inWindow: Order[] = [];
  let prevRevenue = 0;
  let prevOrders = 0;
  let prevItems = 0;

  for (const o of orders) {
    const t = orderTime(o, now);
    if (t === null) continue;
    const sale = o.status !== "cancelled";
    if (sale) events.push({ t, revenue: totalOf(o) });
    if (t >= period.start && t < period.end) inWindow.push(o);
    else if (sale && period.prev && t >= period.prev.start && t < period.prev.end) {
      prevRevenue += totalOf(o);
      prevOrders += 1;
      prevItems += qtyOf(o);
    }
  }

  const sales = inWindow.filter((o) => o.status !== "cancelled");
  let revenue = 0;
  let paidRevenue = 0;
  let items = 0;
  const productAgg = new Map<string, { qty: number; revenue: number }>();
  const methodAgg = new Map<string, CountRevenue>();
  const placeAgg = new Map<string, CountRevenue>();
  // Orders carry groupBuyId/groupBuyName when placed inside a live round (stamped at checkout).
  const groupBuyAgg = new Map<string, GroupBuyRow>();

  for (const o of sales) {
    const t = totalOf(o);
    revenue += t;
    if (o.paymentStatus === "paid") paidRevenue += t;
    const orderQty = qtyOf(o);
    items += orderQty;
    for (const it of o.items || []) {
      const qty = it.qty || 1;
      const name = (it.name || "").trim() || "Unnamed product";
      const p = productAgg.get(name) ?? { qty: 0, revenue: 0 };
      productAgg.set(name, { qty: p.qty + qty, revenue: p.revenue + (it.price || 0) * qty });
    }
    if (o.groupBuyId || o.groupBuyName) {
      const key = o.groupBuyId || `name:${o.groupBuyName}`;
      const g = groupBuyAgg.get(key) ?? { name: (o.groupBuyName || "").trim() || "Group buy", orders: 0, qty: 0, revenue: 0 };
      groupBuyAgg.set(key, { ...g, orders: g.orders + 1, qty: g.qty + orderQty, revenue: g.revenue + t });
    }
    bumpCount(methodAgg, (o.paymentMethod || "").trim() || "Unspecified", t);
    bumpCount(placeAgg, placeOf(o), t);
  }

  const statusCounts: Record<string, number> = {};
  for (const o of inWindow) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;

  const comparing = period.prev !== null;
  const aov = sales.length ? revenue / sales.length : 0;
  const prevAov = prevOrders ? prevRevenue / prevOrders : 0;
  const groupBuys = [...groupBuyAgg.values()].sort((x, y) => y.revenue - x.revenue);

  return {
    series: buildPeriodSeries(period, events),
    revenue: kpi(revenue, prevRevenue, comparing),
    orders: kpi(sales.length, prevOrders, comparing),
    aov: kpi(aov, prevAov, comparing),
    items: kpi(items, prevItems, comparing),
    paidRevenue,
    cancelledCount: inWindow.length - sales.length,
    distinctProducts: productAgg.size,
    windowTotal: inWindow.length,
    statusCounts,
    topProducts: rankBy(productAgg, (v) => v.revenue, 8),
    methods: rankBy(methodAgg, (v) => v.revenue, 8),
    places: rankBy(placeAgg, (v) => v.revenue, 6),
    groupBuys: groupBuys.slice(0, 8),
    groupBuyRevenue: groupBuys.reduce((s, g) => s + g.revenue, 0),
  };
}

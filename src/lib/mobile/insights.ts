// Sales analytics for the Pepweb Admin "Insights" tab and the Home sales hero.
//
// Mirrors the web's Sales Analytics (storefront/admin/AdminAnalytics.tsx) so the
// phone never disagrees with the website:
//   - money = computeOrderTotals (the checkout formula), cancelled excluded
//   - the order date is the placed date; a future (clock-skewed) date counts as now
//   - each window is compared with the previous period (or the same dates last year)
// Windows, buckets and comparisons come from lib/analytics/sales-period.ts — the
// same engine the website uses (store calendar, Asia/Manila).
//
// Pure (npm run test:mobile-insights).

import type { Order, OrderStatus } from "../../storefront/types";
import { computeOrderTotals, hasPaymentProof, itemCount } from "../../storefront/admin/order-detail";
import { formatMoney } from "../storefront/currency";
import { isForeignCurrencyOrder } from "../storefront/markets";
import {
  buildPeriodSeries,
  clampToNow,
  dayStart,
  pctChange,
  parseCompare,
  parseGranularity,
  parsePreset,
  resolvePeriod,
  type SaleEvent,
} from "../analytics/sales-period";
import type { InsightsPoint, InsightsQuery, InsightsRange, InsightsResponse, Kpi, RankedRow } from "./contract";
import { customerId, customerKeyOf } from "./customers";

const TOP_ROWS = 5;
/** Group buys listed in the "Group Buys" card (the website shows 8). */
const GROUP_BUY_ROWS = 8;

/** Ranges a request may name. Anything else (or nothing) → 7 days, the app's default. */
export function parseRange(value: unknown): InsightsRange {
  return parsePreset(value, "7d") as InsightsRange;
}

/** Read ?range=&from=&to=&granularity=&compare= — every field validated, unknown values dropped. */
export function parseInsightsQuery(params: URLSearchParams): InsightsQuery {
  const g = parseGranularity(params.get("granularity"));
  const compare = params.get("compare");
  return {
    range: parseRange(params.get("range")),
    from: params.get("from")?.slice(0, 10) || undefined,
    to: params.get("to")?.slice(0, 10) || undefined,
    granularity: g ?? undefined,
    compare: compare ? parseCompare(compare) : undefined,
  };
}

/** Midnight (store time) of the day containing `d`, as a UTC instant. */
export function storeDayStart(d: Date): Date {
  return new Date(dayStart(d.getTime()));
}

export type InsightsWindow = { start: Date; end: Date; prevStart: Date; prevEnd: Date };

/** The KPI window and its comparison (previous period) for a preset. */
export function windowFor(range: InsightsRange, now: Date): InsightsWindow {
  const p = resolvePeriod({ preset: range }, now);
  return {
    start: new Date(p.start),
    end: new Date(p.end),
    prevStart: new Date(p.prev?.start ?? p.start),
    prevEnd: new Date(p.prev?.end ?? p.start),
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** % change vs the comparison window, one decimal; null without a baseline. */
export const pctDelta = (curr: number, prev: number): number | null => pctChange(curr, prev);

type Agg = { key: string; name: string; value: number; count: number };

function bump(map: Map<string, Agg>, key: string, name: string, value: number, count: number): void {
  const prev = map.get(key);
  map.set(key, {
    key,
    name: prev?.name ?? name,
    value: (prev?.value ?? 0) + value,
    count: (prev?.count ?? 0) + count,
  });
}

function ranked(map: Map<string, Agg>, money: (n: number) => string, detail: (a: Agg) => string): Array<RankedRow & { key: string }> {
  const rows = [...map.values()];
  const whole = rows.reduce((s, r) => s + r.value, 0);
  return rows
    .sort((a, b) => b.value - a.value || b.count - a.count)
    .slice(0, TOP_ROWS)
    .map((r) => ({
      key: r.key,
      name: r.name,
      value: r.value,
      valueLabel: money(r.value),
      detail: detail(r),
      share: whole > 0 ? r.value / whole : 0,
    }));
}

/** The website's Group Buys card: revenue per round, share of group-buy revenue. */
function groupBuyRows(
  map: Map<string, Agg>,
  orders: Map<string, number>,
  money: (n: number) => string,
): NonNullable<InsightsResponse["groupBuys"]> {
  const all = [...map.values()].sort((a, b) => b.value - a.value || b.count - a.count);
  const whole = all.reduce((s, r) => s + r.value, 0);
  return {
    totalLabel: money(whole),
    rows: all.slice(0, GROUP_BUY_ROWS).map((r) => ({
      name: r.name,
      value: r.value,
      valueLabel: money(r.value),
      // `count` is units for this map; orders are counted beside it.
      detail: `${plural(orders.get(r.key) ?? 0, "order", "orders")} · ${plural(r.count, "unit", "units")}`,
      share: whole > 0 ? r.value / whole : 0,
    })),
  };
}

const withoutKey = ({ key: _key, ...row }: RankedRow & { key: string }): RankedRow => row;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ── main ─────────────────────────────────────────────────────────────────────

/**
 * @param orders   active (non-trashed) orders covering at least [prevStart, now]
 * @param history  every active order the store has — only used to tell a
 *                 returning customer from a first-timer
 */
/**
 * International (foreign-currency) orders, per currency, cancelled excluded —
 * the website's Sales Analytics note (AdminAnalytics `foreign`). All time, like
 * the website: they are reported beside the figures, never inside them.
 */
export function internationalSummary(orders: Order[], currency: unknown): NonNullable<InsightsResponse["international"]> {
  const symbol = typeof currency === "string" ? currency : undefined;
  const byCode = new Map<string, { orders: number; total: number }>();
  for (const o of orders) {
    if (o.status === "cancelled" || !isForeignCurrencyOrder(o, symbol)) continue;
    const code = (o.currency ?? "").trim().toUpperCase();
    const row = byCode.get(code) ?? { orders: 0, total: 0 };
    byCode.set(code, { orders: row.orders + 1, total: row.total + computeOrderTotals(o).total });
  }
  return [...byCode.entries()].map(([code, r]) => ({ code, orders: r.orders, totalLabel: formatMoney(r.total, code) }));
}

export function buildInsights(
  allOrders: Order[],
  allHistory: Order[],
  opts: { range: InsightsRange; now: Date; currency: unknown; query?: Omit<InsightsQuery, "range"> },
): InsightsResponse {
  const { now, currency } = opts;
  // Dual-currency stores: every figure is in the STORE's currency, so orders
  // charged in another one are kept out (₱ + $ is not a number) and summarised
  // on their own line — the website's AdminAnalytics rule.
  const symbol = typeof currency === "string" ? currency : undefined;
  const orders = allOrders.filter((o) => !isForeignCurrencyOrder(o, symbol));
  const history = allHistory === allOrders ? orders : allHistory.filter((o) => !isForeignCurrencyOrder(o, symbol));
  const nowMs = now.getTime();
  const earliest = history.reduce<number | null>((min, o) => {
    const t = new Date(o.date).getTime();
    return Number.isNaN(t) || (min !== null && min <= t) ? min : t;
  }, null);
  const period = resolvePeriod({ preset: opts.range, ...opts.query }, nowMs, earliest);
  const range = period.preset as InsightsRange;
  const { start, end } = period;
  const prevStart = period.prev?.start ?? 0;
  const prevEnd = period.prev?.end ?? 0;
  const money = (n: number) => formatMoney(n, currency);
  const wholeMoney = (n: number) => formatMoney(Math.round(n), currency, { decimals: false });

  const events: SaleEvent[] = [];
  const statusCounts = new Map<OrderStatus, number>();
  const products = new Map<string, Agg>();
  const customers = new Map<string, Agg>();
  const payments = new Map<string, Agg>();
  const places = new Map<string, Agg>();
  // Orders carry groupBuyId/groupBuyName when placed inside a live round.
  const groupBuys = new Map<string, Agg>();
  const groupBuyOrders = new Map<string, number>();

  let revenue = 0;
  let collected = 0;
  let sales = 0;
  let items = 0;
  let cancelled = 0;
  let prevRevenue = 0;
  let prevSales = 0;
  let prevItems = 0;
  const prevCustomers = new Set<string>();

  for (const o of orders) {
    const raw = new Date(o.date).getTime();
    if (Number.isNaN(raw)) continue;
    const t = clampToNow(raw, nowMs);
    const isCancelled = o.status === "cancelled";
    const total = computeOrderTotals(o).total;
    const who = customerKeyOf(o);
    // Every sale feeds the chart: its buckets also cover the comparison twin and the bucket before.
    if (!isCancelled) events.push({ t, revenue: total });

    if (t >= prevStart && t < prevEnd && !isCancelled) {
      prevRevenue += total;
      prevSales += 1;
      prevItems += itemCount(o);
      if (who) prevCustomers.add(who);
    }
    if (t < start || t >= end) continue;

    statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1);
    if (isCancelled) {
      cancelled += 1;
      continue;
    }

    revenue += total;
    sales += 1;
    items += itemCount(o);
    if (o.paymentStatus === "paid" || hasPaymentProof(o.paymentProof)) collected += total;

    for (const it of o.items ?? []) {
      const qty = it.qty || 1;
      const name = (it.name || "").trim() || "Unnamed product";
      bump(products, name.toLowerCase(), name, (it.price || 0) * qty, qty);
    }
    if (who) bump(customers, who, (o.customer?.name ?? "").trim() || "Customer", total, 1);
    const method = (o.paymentMethod || "").trim() || "Not specified";
    bump(payments, method.toLowerCase(), method, total, 1);
    const place =
      (o.shipping?.province || "").trim() ||
      (o.shipping?.city || "").trim() ||
      (o.shipping?.region || "").trim() ||
      "Not specified";
    bump(places, place.toLowerCase(), place, total, 1);
    if (o.groupBuyId || o.groupBuyName) {
      const gbName = (o.groupBuyName || "").trim() || "Group buy";
      const gbKey = o.groupBuyId || `name:${o.groupBuyName}`;
      bump(groupBuys, gbKey, gbName, total, itemCount(o));
      groupBuyOrders.set(gbKey, (groupBuyOrders.get(gbKey) ?? 0) + 1);
    }
  }

  // First-ever (non-cancelled) order per customer decides new vs returning.
  const firstSeen = new Map<string, number>();
  for (const o of history) {
    if (o.status === "cancelled") continue;
    const who = customerKeyOf(o);
    const t = new Date(o.date).getTime();
    if (!who || Number.isNaN(t)) continue;
    firstSeen.set(who, Math.min(firstSeen.get(who) ?? Infinity, t));
  }
  let returning = 0;
  for (const who of customers.keys()) if ((firstSeen.get(who) ?? Infinity) < start) returning += 1;

  const aov = sales ? revenue / sales : 0;
  const prevAov = prevSales ? prevRevenue / prevSales : 0;
  const comparing = period.prev !== null;
  const kpi = (value: number, label: string, prev: number, prevLabel: string): Kpi => ({
    value,
    label,
    delta: comparing ? pctDelta(value, prev) : null,
    prevLabel: comparing ? prevLabel : null,
  });

  const built = buildPeriodSeries(period, events);
  const series: InsightsPoint[] = built.points.map((p) => ({
    label: p.label,
    longLabel: p.longLabel,
    revenue: p.revenue,
    revenueLabel: wholeMoney(p.revenue),
    orders: p.orders,
    aovLabel: wholeMoney(p.orders ? p.revenue / p.orders : 0),
    prevRevenue: p.prevRevenue,
    prevRevenueLabel: p.prevRevenue === null ? null : wholeMoney(p.prevRevenue),
    prevLongLabel: p.prevLongLabel,
    change: p.change,
    compareChange: p.compareChange,
  }));
  const best = built.best === null ? null : series[built.best];

  return {
    range,
    rangeLabel: period.title,
    compareLabel: period.compareLabel,
    kpis: {
      revenue: kpi(revenue, wholeMoney(revenue), prevRevenue, wholeMoney(prevRevenue)),
      orders: kpi(sales, String(sales), prevSales, String(prevSales)),
      aov: kpi(aov, money(aov), prevAov, money(prevAov)),
      customers: kpi(customers.size, String(customers.size), prevCustomers.size, String(prevCustomers.size)),
      itemsSold: kpi(items, String(items), prevItems, String(prevItems)),
    },
    collection: {
      collectedLabel: wholeMoney(collected),
      pendingLabel: wholeMoney(revenue - collected),
      collectedShare: revenue > 0 ? collected / revenue : 0,
    },
    series,
    peak: best ? { label: best.longLabel, revenueLabel: best.revenueLabel } : null,
    customerMix: { new: customers.size - returning, returning },
    topProducts: ranked(products, wholeMoney, (a) => `${a.count} sold`).map(withoutKey),
    topCustomers: ranked(customers, wholeMoney, (a) => plural(a.count, "order", "orders")).map((r) => ({
      ...r,
      key: customerId(r.key),
    })),
    payments: ranked(payments, wholeMoney, (a) => plural(a.count, "order", "orders")).map(withoutKey),
    places: ranked(places, wholeMoney, (a) => plural(a.count, "order", "orders")).map(withoutKey),
    statusMix: [...statusCounts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    cancelled,
    international: internationalSummary(allOrders, currency),
    groupBuys: groupBuyRows(groupBuys, groupBuyOrders, wholeMoney),
    period: {
      from: period.from,
      to: period.to,
      label: period.label,
      granularity: period.granularity,
      granularities: period.granularities,
      compare: period.compare,
      compareRangeLabel: period.prev?.label ?? null,
      toDate: period.toDate,
      capped: built.capped,
    },
  };
}

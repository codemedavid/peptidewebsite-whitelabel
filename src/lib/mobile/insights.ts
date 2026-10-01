// Sales analytics for the Pepweb Admin "Insights" tab and the Home sales hero.
//
// Mirrors the web's Sales Analytics (storefront/admin/AdminAnalytics.tsx) so the
// phone never disagrees with the website:
//   - money = computeOrderTotals (the checkout formula), cancelled excluded
//   - the order date is the placed date; a future (clock-skewed) date counts as now
//   - each window is compared with the equal window right before it
// Windows follow the store's calendar day in Asia/Manila, like the Home screen.
//
// Pure (npm run test:mobile-insights).

import type { Order, OrderStatus } from "../../storefront/types";
import { computeOrderTotals, hasPaymentProof, itemCount } from "../../storefront/admin/order-detail";
import { formatMoney } from "../storefront/currency";
import type { InsightsPoint, InsightsRange, InsightsResponse, Kpi, RankedRow } from "./contract";
import { customerId, customerKeyOf } from "./customers";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const STORE_UTC_OFFSET_MS = 8 * HOUR; // Asia/Manila, no DST
const TOP_ROWS = 5;
const WEEKS_IN_90D = 13;

const RANGES: ReadonlyArray<InsightsRange> = ["today", "7d", "30d", "90d"];
const RANGE_DAYS: Record<Exclude<InsightsRange, "today">, number> = { "7d": 7, "30d": 30, "90d": 90 };
const RANGE_COPY: Record<InsightsRange, { label: string; compare: string }> = {
  today: { label: "Today", compare: "vs yesterday, same time" },
  "7d": { label: "Last 7 days", compare: "vs prior 7 days" },
  "30d": { label: "Last 30 days", compare: "vs prior 30 days" },
  "90d": { label: "Last 90 days", compare: "vs prior 90 days" },
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseRange(value: unknown): InsightsRange {
  return RANGES.includes(value as InsightsRange) ? (value as InsightsRange) : "7d";
}

/** Midnight (store time) of the day containing `d`, as a UTC instant. */
export function storeDayStart(d: Date): Date {
  const local = new Date(d.getTime() + STORE_UTC_OFFSET_MS);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - STORE_UTC_OFFSET_MS,
  );
}

export type InsightsWindow = { start: Date; end: Date; prevStart: Date; prevEnd: Date };

export function windowFor(range: InsightsRange, now: Date): InsightsWindow {
  const today = storeDayStart(now);
  if (range === "today") {
    return {
      start: today,
      end: new Date(today.getTime() + DAY),
      prevStart: new Date(today.getTime() - DAY),
      // "So far" comparison: yesterday up to this same time of day.
      prevEnd: new Date(now.getTime() - DAY),
    };
  }
  const days = RANGE_DAYS[range];
  const end = new Date(today.getTime() + DAY);
  const start = new Date(end.getTime() - days * DAY);
  return { start, end, prevStart: new Date(start.getTime() - days * DAY), prevEnd: start };
}

// ── buckets ──────────────────────────────────────────────────────────────────

type Bucket = { start: number; end: number; label: string; longLabel: string; revenue: number; orders: number };

/** Calendar parts of a UTC instant, read in store time. */
function local(ms: number) {
  const d = new Date(ms + STORE_UTC_OFFSET_MS);
  return { weekday: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth() };
}

function hourLabel(h: number, long: boolean): string {
  const suffix = h < 12 ? (long ? " AM" : "a") : long ? " PM" : "p";
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`;
}

function makeBuckets(range: InsightsRange, w: InsightsWindow): Bucket[] {
  const start = w.start.getTime();
  const end = w.end.getTime();

  if (range === "today") {
    return Array.from({ length: 24 }, (_, h) => ({
      start: start + h * HOUR,
      end: start + (h + 1) * HOUR,
      label: hourLabel(h, false),
      longLabel: `${hourLabel(h, true)} – ${hourLabel((h + 1) % 24, true)}`,
      revenue: 0,
      orders: 0,
    }));
  }

  if (range === "90d") {
    // Whole weeks counted back from the end; the oldest one is clipped to the window.
    return Array.from({ length: WEEKS_IN_90D }, (_, i) => {
      const bEnd = end - (WEEKS_IN_90D - 1 - i) * 7 * DAY;
      const bStart = Math.max(start, bEnd - 7 * DAY);
      const p = local(bStart);
      return {
        start: bStart,
        end: bEnd,
        label: `${MONTHS[p.month]} ${p.day}`,
        longLabel: `Week of ${MONTHS[p.month]} ${p.day}`,
        revenue: 0,
        orders: 0,
      };
    });
  }

  const days = RANGE_DAYS[range];
  return Array.from({ length: days }, (_, i) => {
    const bStart = start + i * DAY;
    const p = local(bStart);
    return {
      start: bStart,
      end: bStart + DAY,
      label: range === "7d" ? WEEKDAYS[p.weekday] : `${MONTHS[p.month]} ${p.day}`,
      longLabel: `${WEEKDAYS[p.weekday]}, ${MONTHS[p.month]} ${p.day}`,
      revenue: 0,
      orders: 0,
    };
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function pctDelta(curr: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

/** The placed time; a future date is clamped just inside the window's end. */
function orderTime(o: Order, clampBefore: number): number | null {
  const t = new Date(o.date).getTime();
  if (Number.isNaN(t)) return null;
  return t >= clampBefore ? clampBefore - 1 : t;
}

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

const withoutKey = ({ key: _key, ...row }: RankedRow & { key: string }): RankedRow => row;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ── main ─────────────────────────────────────────────────────────────────────

/**
 * @param orders   active (non-trashed) orders covering at least [prevStart, now]
 * @param history  every active order the store has — only used to tell a
 *                 returning customer from a first-timer
 */
export function buildInsights(
  orders: Order[],
  history: Order[],
  opts: { range: InsightsRange; now: Date; currency: unknown },
): InsightsResponse {
  const { range, now, currency } = opts;
  const w = windowFor(range, now);
  const start = w.start.getTime();
  const end = w.end.getTime();
  const prevStart = w.prevStart.getTime();
  const prevEnd = w.prevEnd.getTime();
  const money = (n: number) => formatMoney(n, currency);
  const wholeMoney = (n: number) => formatMoney(Math.round(n), currency, { decimals: false });

  const buckets = makeBuckets(range, w);
  const statusCounts = new Map<OrderStatus, number>();
  const products = new Map<string, Agg>();
  const customers = new Map<string, Agg>();
  const payments = new Map<string, Agg>();
  const places = new Map<string, Agg>();

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
    const t = orderTime(o, end);
    if (t === null) continue;
    const isCancelled = o.status === "cancelled";
    const total = computeOrderTotals(o).total;
    const who = customerKeyOf(o);

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

    const b = buckets.find((x) => t >= x.start && t < x.end);
    if (b) {
      b.revenue += total;
      b.orders += 1;
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
  const kpi = (value: number, label: string, prev: number): Kpi => ({ value, label, delta: pctDelta(value, prev) });

  const series: InsightsPoint[] = buckets.map((b) => ({
    label: b.label,
    longLabel: b.longLabel,
    revenue: b.revenue,
    revenueLabel: wholeMoney(b.revenue),
    orders: b.orders,
  }));
  const best = series.reduce<InsightsPoint | null>((m, p) => (p.revenue > (m?.revenue ?? 0) ? p : m), null);

  return {
    range,
    rangeLabel: RANGE_COPY[range].label,
    compareLabel: RANGE_COPY[range].compare,
    kpis: {
      revenue: kpi(revenue, wholeMoney(revenue), prevRevenue),
      orders: kpi(sales, String(sales), prevSales),
      aov: kpi(aov, money(aov), prevAov),
      customers: kpi(customers.size, String(customers.size), prevCustomers.size),
      itemsSold: kpi(items, String(items), prevItems),
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
  };
}

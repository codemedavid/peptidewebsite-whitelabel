"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Brand, Order } from "../types";
import { listStorefrontOrdersAction } from "@/actions/orders";
import { ADMIN_TINTS } from "./shared";
import { formatMoney, normalizeCurrency } from "@/lib/storefront/currency";

// Sales analytics over the tenant's DB-backed orders. Reads via the same
// server action as AdminOrders (demo/DB branching lives server-side); all
// aggregation happens client-side because a tenant's order set is small.
// Revenue policy: cancelled orders are excluded from every sales metric;
// an order's total = items subtotal + shipping fee + admin fee (no order-level
// total is stored — same rule as AdminOrders/AdminOrderDetail).

type RangeId = "7d" | "30d" | "90d" | "12m" | "all";

const RANGES: { id: RangeId; label: string; prevLabel: string }[] = [
  { id: "7d", label: "7 days", prevLabel: "prior 7 days" },
  { id: "30d", label: "30 days", prevLabel: "prior 30 days" },
  { id: "90d", label: "90 days", prevLabel: "prior 90 days" },
  { id: "12m", label: "12 months", prevLabel: "prior 12 months" },
  { id: "all", label: "All time", prevLabel: "" },
];

// Monthly "all time" charts are capped so one ancient order can't render a
// sliver-bar chart with hundreds of columns. KPIs still cover every order.
const MAX_MONTH_BUCKETS = 48;

function totalOf(o: Order): number {
  return Math.max(
    0,
    (o.items || []).reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0) -
      (o.discount?.amount || 0) +
      (o.shipping?.fee || 0) +
      (o.adminFee?.amount || 0),
  );
}

// Analytics reports the STORE's revenue, so every figure prints in the store's
// currency. These three used to hardcode the peso, which meant a shop trading in
// riyals read its own takings in a currency it never sells in.

function formatPHP(n: number, currency?: unknown): string {
  return formatMoney(n, currency);
}

function formatPHPWhole(n: number, currency?: unknown): string {
  return formatMoney(Math.round(n || 0), currency, { decimals: false });
}

/** Axis / tile shorthand: "SAR 1.2M", "₱950". The suffix forms build their own
 *  string, so the symbol and its spacing come from normalizeCurrency rather than
 *  being concatenated by hand. */
function compactPHP(n: number, currency?: unknown): string {
  const money = normalizeCurrency(currency);
  const gap = /[A-Za-z]{2,}/.test(money.symbol) ? " " : "";
  if (n >= 1_000_000)
    return `${money.symbol}${gap}${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${money.symbol}${gap}${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return formatMoney(Math.round(n), currency, { decimals: false });
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

// % change vs the previous window; null when there is no baseline to compare.
function pctDelta(curr: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return (curr - prev) / prev;
}

function formatPct(p: number): string {
  const abs = Math.abs(p * 100);
  return (abs >= 10 ? abs.toFixed(0) : abs.toFixed(1)) + "%";
}

function shareLabel(part: number, whole: number): string {
  if (!(whole > 0)) return "0%";
  const p = part / whole;
  return (p * 100).toFixed(p >= 0.1 ? 0 : 1) + "%";
}

type Bucket = {
  key: string;
  label: string; // short x-axis label
  full: string; // tooltip label
  start: Date;
  end: Date;
  revenue: number;
  orders: number;
};

const STATUS_META: { id: Order["status"]; label: string }[] = [
  { id: "new", label: "New" },
  { id: "confirmed", label: "Confirmed" },
  { id: "processing", label: "Processing" },
  { id: "shipped", label: "Shipped" },
  { id: "delivered", label: "Delivered" },
  { id: "cancelled", label: "Cancelled" },
];

// Rotating bar colors for the breakdown lists, borrowed from the admin tint
// palette so the charts read as part of the same design system.
const BAR_TINTS = ["green", "cyan", "purple", "orange", "pink", "yellow", "mint", "red"];

function barColor(i: number): string {
  return ADMIN_TINTS[BAR_TINTS[i % BAR_TINTS.length]].fg;
}

function rankBy<T>(
  rows: Map<string, T>,
  score: (v: T) => number,
  limit: number,
): { name: string; value: T }[] {
  return [...rows.entries()]
    .sort((a, b) => score(b[1]) - score(a[1]))
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));
}

function BreakdownRow({
  name,
  meta,
  amount,
  pct,
  color,
}: {
  name: React.ReactNode;
  meta: string;
  amount: string;
  pct: number;
  color: string;
}) {
  return (
    <div className="admin-bar-row">
      <div className="admin-bar-row__top">
        <span className="admin-bar-row__name">{name}</span>
        <span className="admin-bar-row__val">{amount}</span>
      </div>
      <div className="admin-bar-row__meta">{meta}</div>
      <div className="admin-bar-row__track">
        <div
          className="admin-bar-row__fill"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
        />
      </div>
    </div>
  );
}

function DeltaPill({ delta, prevLabel }: { delta: number | null; prevLabel: string }) {
  if (delta === null || !prevLabel) return null;
  const kind = delta > 0.0005 ? "up" : delta < -0.0005 ? "down" : "flat";
  const arrow = kind === "up" ? "▲" : kind === "down" ? "▼" : "—";
  return (
    <span
      className={`admin-stat__delta admin-stat__delta--${kind}`}
      title={`vs ${prevLabel}`}
    >
      {arrow} {formatPct(delta)}
    </span>
  );
}

export function AdminAnalytics({
  brand,
  onBack,
}: {
  brand: Brand;
  onBack: () => void;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadFailed, setLoadFailed] = useState<boolean>(false);
  const [range, setRange] = useState<RangeId>("30d");

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await listStorefrontOrdersAction();
      if ("ok" in res) setOrders(res.orders);
      else {
        setLoadFailed(true);
        alert(res.error);
      }
    } catch {
      // Server actions reject on transport failure; without this the view
      // would stay on "Loading…" forever with the Refresh button disabled.
      setLoadFailed(true);
      alert("Couldn't load analytics — check your connection and press Refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const a = useMemo(() => {
    const today = startOfDay(new Date());

    // ---- chart buckets (also define the current window) ----
    const buckets: Bucket[] = [];
    let capped = false;
    let kpiStart: Date | null = null;
    if (range === "7d" || range === "30d") {
      const days = range === "7d" ? 7 : 30;
      for (let i = days - 1; i >= 0; i--) {
        const s = addDays(today, -i);
        buckets.push({
          key: s.toISOString(),
          label: `${s.getMonth() + 1}/${s.getDate()}`,
          full: s.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
          start: s,
          end: addDays(s, 1),
          revenue: 0,
          orders: 0,
        });
      }
    } else if (range === "90d") {
      const start = addDays(today, -89);
      for (let i = 0; i < 13; i++) {
        const s = addDays(start, i * 7);
        buckets.push({
          key: s.toISOString(),
          label: `${s.getMonth() + 1}/${s.getDate()}`,
          full:
            "Week of " +
            s.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
          start: s,
          end: addDays(s, 7),
          revenue: 0,
          orders: 0,
        });
      }
    } else {
      let first = startOfMonth(today);
      if (range === "12m") {
        first = addMonths(first, -11);
      } else {
        for (const o of orders) {
          const d = new Date(o.date);
          if (!isNaN(d.getTime()) && d < first) first = startOfMonth(d);
        }
      }
      const thisMonth = startOfMonth(today);
      for (let m = first; m <= thisMonth; m = addMonths(m, 1)) {
        buckets.push({
          key: m.toISOString(),
          label: m.toLocaleDateString(undefined, { month: "short" }),
          full: m.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
          start: m,
          end: addMonths(m, 1),
          revenue: 0,
          orders: 0,
        });
      }
      if (range === "all" && buckets.length > MAX_MONTH_BUCKETS) {
        kpiStart = buckets[0].start; // KPIs keep full history; only the chart is capped
        buckets.splice(0, buckets.length - MAX_MONTH_BUCKETS);
        capped = true;
      }
    }

    const start = kpiStart ?? buckets[0].start;
    // 13 weekly buckets tile 91 days; clamp the 90d KPI window to exactly 90
    // so it matches the prior window's length and never includes tomorrow.
    const end = range === "90d" ? addDays(today, 1) : buckets[buckets.length - 1].end;

    // Previous window of equal length, immediately before the current one.
    let prevStart: Date | null = null;
    if (range === "7d") prevStart = addDays(start, -7);
    else if (range === "30d") prevStart = addDays(start, -30);
    else if (range === "90d") prevStart = addDays(start, -90);
    else if (range === "12m") prevStart = addMonths(start, -12);
    // The 12m window only has data through today, so compare year-over-year
    // to date — 12 complete prior months would bias every delta downward.
    const prevEnd =
      range === "12m"
        ? new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1)
        : start;

    // The order date is client-supplied at checkout, so a clock-skewed or
    // crafted future date must count as "now" rather than silently vanish
    // from every range.
    const clampDate = (o: Order): Date | null => {
      const d = new Date(o.date);
      if (isNaN(d.getTime())) return null;
      return d >= end ? new Date(end.getTime() - 1) : d;
    };

    const inWindow: Order[] = [];
    const prevSales: Order[] = [];
    for (const o of orders) {
      const d = clampDate(o);
      if (!d) continue;
      if (d >= start && d < end) inWindow.push(o);
      else if (prevStart && o.status !== "cancelled" && d >= prevStart && d < prevEnd)
        prevSales.push(o);
    }
    const sales = inWindow.filter((o) => o.status !== "cancelled");

    // ---- KPIs ----
    let revenue = 0;
    let paidRevenue = 0;
    let itemsSold = 0;
    const productAgg = new Map<string, { qty: number; revenue: number }>();
    const methodAgg = new Map<string, { count: number; revenue: number }>();
    const placeAgg = new Map<string, { count: number; revenue: number }>();
    // Group buy attribution: orders carry groupBuyId/groupBuyName when placed
    // inside a live group-buy window (stamped server-side at checkout).
    const groupBuyAgg = new Map<string, { name: string; orders: number; qty: number; revenue: number }>();
    for (const o of sales) {
      const t = totalOf(o);
      revenue += t;
      if (o.paymentStatus === "paid") paidRevenue += t;
      let orderQty = 0;
      for (const it of o.items || []) {
        const qty = it.qty || 1;
        orderQty += qty;
        itemsSold += qty;
        const name = (it.name || "").trim() || "Unnamed product";
        const p = productAgg.get(name) || { qty: 0, revenue: 0 };
        p.qty += qty;
        p.revenue += (it.price || 0) * qty;
        productAgg.set(name, p);
      }

      if (o.groupBuyId || o.groupBuyName) {
        const key = o.groupBuyId || `name:${o.groupBuyName}`;
        const g = groupBuyAgg.get(key) || {
          name: (o.groupBuyName || "").trim() || "Group buy",
          orders: 0,
          qty: 0,
          revenue: 0,
        };
        g.orders += 1;
        g.qty += orderQty;
        g.revenue += t;
        groupBuyAgg.set(key, g);
      }

      const method = (o.paymentMethod || "").trim() || "Unspecified";
      const m = methodAgg.get(method) || { count: 0, revenue: 0 };
      m.count += 1;
      m.revenue += t;
      methodAgg.set(method, m);
      const place =
        (o.shipping?.province || "").trim() ||
        (o.shipping?.city || "").trim() ||
        (o.shipping?.region || "").trim() ||
        "Unspecified";
      const pl = placeAgg.get(place) || { count: 0, revenue: 0 };
      pl.count += 1;
      pl.revenue += t;
      placeAgg.set(place, pl);

      // chart fill — buckets are contiguous and sorted, so a linear scan is fine
      const d = clampDate(o);
      if (d) {
        for (const b of buckets) {
          if (d >= b.start && d < b.end) {
            b.revenue += t;
            b.orders += 1;
            break;
          }
        }
      }
    }

    const prevRevenue = prevSales.reduce((s, o) => s + totalOf(o), 0);
    const prevItems = prevSales.reduce(
      (s, o) => s + (o.items || []).reduce((q, i) => q + (i.qty || 1), 0),
      0,
    );
    const aov = sales.length ? revenue / sales.length : 0;
    const prevAov = prevSales.length ? prevRevenue / prevSales.length : 0;

    const statusCounts: Record<string, number> = {};
    for (const o of inWindow) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;

    const maxBucket = Math.max(...buckets.map((b) => b.revenue), 0);

    return {
      buckets,
      capped,
      maxBucket,
      // label every Nth column so 30 daily buckets don't collide
      labelEvery: Math.max(1, Math.ceil(buckets.length / 8)),
      sales,
      cancelledCount: inWindow.length - sales.length,
      revenue,
      paidRevenue,
      pendingRevenue: revenue - paidRevenue,
      itemsSold,
      distinctProducts: productAgg.size,
      aov,
      revenueDelta: pctDelta(revenue, prevRevenue),
      ordersDelta: pctDelta(sales.length, prevSales.length),
      aovDelta: pctDelta(aov, prevAov),
      itemsDelta: pctDelta(itemsSold, prevItems),
      topProducts: rankBy(productAgg, (v) => v.revenue, 8),
      groupBuys: [...groupBuyAgg.values()].sort((x, y) => y.revenue - x.revenue).slice(0, 8),
      groupBuyRevenue: [...groupBuyAgg.values()].reduce((s, g) => s + g.revenue, 0),
      methods: rankBy(methodAgg, (v) => v.revenue, 8),
      places: rankBy(placeAgg, (v) => v.revenue, 6),
      statusCounts,
      windowTotal: inWindow.length,
    };
  }, [orders, range]);

  const rangeMeta = RANGES.find((r) => r.id === range) || RANGES[1];
  const bucketUnit = range === "90d" ? "week" : range === "12m" || range === "all" ? "month" : "day";

  const kpis = [
    {
      label: "Revenue",
      value: formatPHPWhole(a.revenue, brand.currency),
      sub: `${formatPHPWhole(a.paidRevenue, brand.currency)} paid · ${formatPHPWhole(a.pendingRevenue, brand.currency)} pending`,
      icon: "trend",
      tint: "green",
      delta: a.revenueDelta,
    },
    {
      label: "Orders",
      value: a.sales.length.toLocaleString(),
      sub: `${a.cancelledCount.toLocaleString()} cancelled excluded`,
      icon: "cart",
      tint: "yellow",
      delta: a.ordersDelta,
    },
    {
      label: "Avg. Order Value",
      value: formatPHPWhole(a.aov, brand.currency),
      sub: "per non-cancelled order",
      icon: "tag",
      tint: "purple",
      delta: a.aovDelta,
    },
    {
      label: "Items Sold",
      value: a.itemsSold.toLocaleString(),
      sub: `across ${a.distinctProducts.toLocaleString()} product(s)`,
      icon: "box",
      tint: "pink",
      delta: a.itemsDelta,
    },
  ];

  return (
    <div className="admin">
      <main className="admin__inner">
        <div className="admin-table__head">
          <h1 className="admin-table__title">
            <a
              className="admin-table__title-back"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onBack();
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Dashboard
            </a>
            <span>Sales Analytics</span>
          </h1>
          <button className="admin-btn" onClick={() => void refresh()} disabled={loading}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Refresh
          </button>
        </div>

        <div className="admin-analytics__controls">
          <div className="admin-seg" role="tablist" aria-label="Date range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                className={`admin-seg__btn ${range === r.id ? "is-active" : ""}`}
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="admin-analytics__note">
            Cancelled orders are excluded from sales totals.
          </div>
        </div>

        {loading && orders.length === 0 ? (
          <div className="admin-empty-set" style={{ padding: "60px 20px" }}>
            Loading analytics…
          </div>
        ) : orders.length === 0 ? (
          <div className="admin-empty-set" style={{ padding: "60px 20px" }}>
            {loadFailed
              ? "Couldn't load orders — press Refresh to try again."
              : "No orders yet — analytics will appear once your store takes its first order."}
          </div>
        ) : (
          <>
            <div className="admin__stats">
              {kpis.map((s) => (
                <div key={s.label} className="admin-stat">
                  <DeltaPill delta={s.delta} prevLabel={rangeMeta.prevLabel} />
                  <div className="admin-stat__label">{s.label}</div>
                  <div className="admin-stat__value admin-stat__value--compact" title={s.value}>
                    {s.value}
                  </div>
                  <div className="admin-stat__sub">{s.sub}</div>
                </div>
              ))}
            </div>

            <div className="admin-card admin-analytics__card">
              <h2 className="admin-card__title">Revenue Over Time</h2>
              <div className="admin-card__caption">
                {formatPHP(a.revenue, brand.currency)} across {a.sales.length.toLocaleString()} order(s) · per{" "}
                {bucketUnit}
                {a.capped ? ` · showing the last ${MAX_MONTH_BUCKETS} months` : ""}
              </div>
              {a.maxBucket > 0 ? (
                <>
                  <div className="admin-chart">
                    <div className="admin-chart__ylabels">
                      <span>{compactPHP(a.maxBucket, brand.currency)}</span>
                      <span>{compactPHP(a.maxBucket / 2, brand.currency)}</span>
                      <span>{compactPHP(0, brand.currency)}</span>
                    </div>
                    <div className="admin-chart__plot">
                      <div className="admin-chart__gridline" style={{ top: 0 }} />
                      <div className="admin-chart__gridline" style={{ top: "50%" }} />
                      <div className="admin-chart__bars">
                        {a.buckets.map((b) => (
                          <div
                            key={b.key}
                            className="admin-chart__col"
                            title={`${b.full}: ${formatPHP(b.revenue, brand.currency)} · ${b.orders} order(s)`}
                          >
                            {b.revenue > 0 && (
                              <div
                                className="admin-chart__bar"
                                style={{
                                  height: `${Math.max((b.revenue / a.maxBucket) * 100, 2)}%`,
                                }}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="admin-chart__xrow">
                    {a.buckets.map((b, i) => (
                      <div key={b.key} className="admin-chart__xlabel">
                        {i % a.labelEvery === 0 ? b.label : ""}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="admin-analytics__empty">No sales in this period.</div>
              )}
            </div>

            <div className="admin__row admin-analytics__row">
              <div className="admin-card">
                <h2 className="admin-card__title">Top Products</h2>
                <div className="admin-card__caption">By revenue in the selected period</div>
                {a.topProducts.length ? (
                  <div className="admin-bars">
                    {a.topProducts.map((p, i) => (
                      <BreakdownRow
                        key={p.name}
                        name={p.name}
                        meta={`${p.value.qty.toLocaleString()} sold · ${shareLabel(p.value.revenue, a.revenue)} of revenue`}
                        amount={formatPHP(p.value.revenue, brand.currency)}
                        pct={(p.value.revenue / (a.topProducts[0].value.revenue || 1)) * 100}
                        color={barColor(i)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="admin-analytics__empty">No sales in this period.</div>
                )}
              </div>

              <div className="admin-card">
                <h2 className="admin-card__title">Payment Methods</h2>
                <div className="admin-card__caption">Where your revenue comes from</div>
                {a.methods.length ? (
                  <div className="admin-bars">
                    {a.methods.map((m, i) => (
                      <BreakdownRow
                        key={m.name}
                        name={m.name}
                        meta={`${m.value.count.toLocaleString()} order(s) · ${shareLabel(m.value.revenue, a.revenue)} of revenue`}
                        amount={formatPHP(m.value.revenue, brand.currency)}
                        pct={(m.value.revenue / (a.methods[0].value.revenue || 1)) * 100}
                        color={barColor(i)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="admin-analytics__empty">No sales in this period.</div>
                )}
              </div>
            </div>

            <div className="admin__row admin-analytics__row">
              <div className="admin-card">
                <h2 className="admin-card__title">Order Status</h2>
                <div className="admin-card__caption">
                  All {a.windowTotal.toLocaleString()} order(s) in the period, including cancelled
                </div>
                {a.windowTotal ? (
                  <div className="admin-bars">
                    {STATUS_META.filter((s) => a.statusCounts[s.id]).map((s) => (
                      <BreakdownRow
                        key={s.id}
                        name={<span className={`admin-pill admin-pill--${s.id}`}>{s.label}</span>}
                        meta={`${shareLabel(a.statusCounts[s.id], a.windowTotal)} of orders`}
                        amount={a.statusCounts[s.id].toLocaleString()}
                        pct={(a.statusCounts[s.id] / a.windowTotal) * 100}
                        color="var(--brand-accent)"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="admin-analytics__empty">No orders in this period.</div>
                )}
              </div>

              <div className="admin-card">
                <h2 className="admin-card__title">Top Locations</h2>
                <div className="admin-card__caption">Shipping destinations by revenue</div>
                {a.places.length ? (
                  <div className="admin-bars">
                    {a.places.map((p, i) => (
                      <BreakdownRow
                        key={p.name}
                        name={p.name}
                        meta={`${p.value.count.toLocaleString()} order(s) · ${shareLabel(p.value.revenue, a.revenue)} of revenue`}
                        amount={formatPHP(p.value.revenue, brand.currency)}
                        pct={(p.value.revenue / (a.places[0].value.revenue || 1)) * 100}
                        color={barColor(i)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="admin-analytics__empty">No sales in this period.</div>
                )}
              </div>
            </div>

            {brand?.showAnalyticsGroupBuys && (
              <div className="admin-card admin-analytics__card">
                <h2 className="admin-card__title">Group Buys</h2>
                <div className="admin-card__caption">
                  Revenue and orders attributed to each group buy in the selected period
                </div>
                {a.groupBuys.length ? (
                  <div className="admin-bars">
                    {a.groupBuys.map((g, i) => (
                      <BreakdownRow
                        key={g.name + i}
                        name={g.name}
                        meta={`${g.orders.toLocaleString()} order(s) · ${g.qty.toLocaleString()} unit(s) · ${shareLabel(g.revenue, a.groupBuyRevenue)} of group-buy revenue`}
                        amount={formatPHP(g.revenue, brand.currency)}
                        pct={(g.revenue / (a.groupBuys[0].revenue || 1)) * 100}
                        color={barColor(i)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="admin-analytics__empty">
                    No group-buy orders in this period.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

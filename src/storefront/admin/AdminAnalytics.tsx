"use client";

import { computeOrderTotals } from "./order-detail";
import { isForeignCurrencyOrder } from "@/lib/storefront/markets";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Brand, Order } from "../types";
import { listStorefrontOrdersAction } from "@/actions/orders";
import { ADMIN_TINTS } from "./shared";
import { formatMoney, normalizeCurrency } from "@/lib/storefront/currency";
import { dayKey, GRANULARITY_LABELS, resolvePeriod, type PeriodQuery } from "@/lib/analytics/sales-period";
import { buildSalesReport, earliestOrderTime, type Kpi } from "./analytics/aggregate";
import { PeriodControls, type PeriodPatch } from "./analytics/PeriodControls";
import { RevenueChart } from "./analytics/RevenueChart";
import { PeriodTable } from "./analytics/PeriodTable";
import { DeltaBadge } from "./analytics/DeltaBadge";
import "./analytics/analytics.css";

// Sales analytics over the tenant's DB-backed orders. Reads via the same
// server action as AdminOrders (demo/DB branching lives server-side); the
// aggregation runs client-side (analytics/aggregate.ts) because a tenant's
// order set is small. Windows, comparisons and day/week/month buckets come
// from lib/analytics/sales-period.ts — the same engine as the app's Insights.

const DEFAULT_QUERY: PeriodQuery = { preset: "30d", compare: "previous" };

// Analytics reports the STORE's revenue, so every figure prints in the store's currency.
function formatPHP(n: number, currency?: unknown): string {
  return formatMoney(n, currency);
}

function formatPHPWhole(n: number, currency?: unknown): string {
  return formatMoney(Math.round(n || 0), currency, { decimals: false });
}

/** Axis / tile shorthand: "SAR 1.2M", "₱950". */
function compactPHP(n: number, currency?: unknown): string {
  const money = normalizeCurrency(currency);
  const gap = /[A-Za-z]{2,}/.test(money.symbol) ? " " : "";
  if (n >= 1_000_000)
    return `${money.symbol}${gap}${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${money.symbol}${gap}${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return formatMoney(Math.round(n), currency, { decimals: false });
}

function shareLabel(part: number, whole: number): string {
  if (!(whole > 0)) return "0%";
  const p = part / whole;
  return (p * 100).toFixed(p >= 0.1 ? 0 : 1) + "%";
}

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

type Tile = { label: string; value: string; kpi: Kpi; prevValue: string; sub: string };

function KpiTile({ tile, compareLabel }: { tile: Tile; compareLabel: string }) {
  return (
    <div className="admin-stat ana-kpi">
      <div className="admin-stat__label">{tile.label}</div>
      <div className="admin-stat__value admin-stat__value--compact" title={tile.value}>
        {tile.value}
      </div>
      {tile.kpi.prev !== null ? (
        <div className="ana-kpi__compare" title={compareLabel}>
          <DeltaBadge value={tile.kpi.delta} />
          <span>vs {tile.prevValue}</span>
        </div>
      ) : null}
      <div className="admin-stat__sub">{tile.sub}</div>
    </div>
  );
}

export function AdminAnalytics({
  brand,
  onBack,
}: {
  brand: Brand;
  onBack: () => void;
}) {
  const [allOrders, setOrders] = useState<Order[]>([]);
  // Dual-currency stores: every figure on this screen is in the STORE's
  // currency, so orders charged in another one (International · USD) are kept
  // out of it — ₱ + $ is not a number — and summarised on their own line.
  const orders = useMemo(() => allOrders.filter((o) => !isForeignCurrencyOrder(o, brand.currency)), [allOrders, brand.currency]);
  const foreign = useMemo(() => {
    const list = allOrders.filter((o) => o.status !== "cancelled" && isForeignCurrencyOrder(o, brand.currency));
    const byCode = new Map<string, { count: number; total: number }>();
    for (const o of list) {
      const code = (o.currency ?? "").toUpperCase();
      const row = byCode.get(code) ?? { count: 0, total: 0 };
      byCode.set(code, { count: row.count + 1, total: row.total + computeOrderTotals(o).total });
    }
    return [...byCode.entries()];
  }, [allOrders, brand.currency]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadFailed, setLoadFailed] = useState<boolean>(false);
  const [query, setQuery] = useState<PeriodQuery>(DEFAULT_QUERY);
  // "Now" is pinned per load so the window doesn't drift between renders.
  const [now, setNow] = useState<number>(() => Date.now());

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await listStorefrontOrdersAction();
      if ("ok" in res) {
        setOrders(res.orders);
        setNow(Date.now());
      } else {
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

  const earliest = useMemo(() => earliestOrderTime(orders), [orders]);
  const period = useMemo(() => resolvePeriod(query, now, earliest), [query, now, earliest]);
  const a = useMemo(() => buildSalesReport(orders, period, now), [orders, period, now]);
  // A new range re-picks the best bucket size unless the owner chose one that still fits.
  const onPeriodChange = useCallback((patch: PeriodPatch) => {
    setQuery((q) => ({ ...q, ...patch, granularity: "granularity" in patch ? patch.granularity : q.granularity }));
  }, []);

  const money = (n: number) => formatPHP(n, brand.currency);
  const whole = (n: number) => formatPHPWhole(n, brand.currency);
  const comparing = period.prev !== null;
  const unit = GRANULARITY_LABELS[period.granularity].unit;
  const revenue = a.revenue.value;

  const tiles: Tile[] = [
    {
      label: "Revenue",
      value: whole(revenue),
      kpi: a.revenue,
      prevValue: whole(a.revenue.prev ?? 0),
      sub: `${whole(a.paidRevenue)} paid · ${whole(revenue - a.paidRevenue)} pending`,
    },
    {
      label: "Orders",
      value: a.orders.value.toLocaleString(),
      kpi: a.orders,
      prevValue: (a.orders.prev ?? 0).toLocaleString(),
      sub: `${a.cancelledCount.toLocaleString()} cancelled excluded`,
    },
    {
      label: "Avg. Order Value",
      value: whole(a.aov.value),
      kpi: a.aov,
      prevValue: whole(a.aov.prev ?? 0),
      sub: "per non-cancelled order",
    },
    {
      label: "Items Sold",
      value: a.items.value.toLocaleString(),
      kpi: a.items,
      prevValue: (a.items.prev ?? 0).toLocaleString(),
      sub: `across ${a.distinctProducts.toLocaleString()} product(s)`,
    },
  ];
  const best = a.series.best !== null ? a.series.points[a.series.best] : null;

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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Dashboard
            </a>
            <span>Sales Analytics</span>
          </h1>
          <button className="admin-btn" onClick={() => void refresh()} disabled={loading}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <PeriodControls period={period} today={dayKey(now)} onChange={onPeriodChange} />

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
          <div className={loading ? "ana-busy" : undefined}>
            {foreign.length > 0 && (
              <p className="admin-field__hint" role="note" style={{ margin: "0 0 14px" }}>
                {foreign
                  .map(([code, f]) => `${code}: ${f.count} order${f.count === 1 ? "" : "s"} · ${formatMoney(f.total, code)}`)
                  .join(" · ")}{" "}
                — International orders, shown separately and not included in the figures below.
              </p>
            )}
            <div className="admin__stats">
              {tiles.map((t) => (
                <KpiTile key={t.label} tile={t} compareLabel={period.compareLabel} />
              ))}
            </div>

            <div className="admin-card admin-analytics__card">
              <div className="ana-card-head">
                <div>
                  <h2 className="admin-card__title">Revenue Over Time</h2>
                  <div className="ana-card-head__caption">
                    {money(revenue)} across {a.orders.value.toLocaleString()} order(s) · per {unit}
                    {a.series.capped ? " · showing the most recent part of the range" : ""}
                  </div>
                </div>
                {best && (
                  <div className="ana-peak">
                    <span className="ana-peak__label">Best {unit}</span>
                    <span className="ana-peak__value">{best.longLabel}</span>
                    <span className="ana-peak__money">{money(best.revenue)}</span>
                  </div>
                )}
              </div>
              <RevenueChart
                points={a.series.points}
                comparing={comparing}
                unit={unit}
                money={money}
                compact={(n) => compactPHP(n, brand.currency)}
              />
            </div>

            {a.series.points.length > 1 && (
              <PeriodTable
                points={a.series.points}
                granularity={period.granularity}
                comparing={comparing}
                best={a.series.best}
                money={money}
                fileName={`sales-${period.from}_to_${period.to}-by-${unit}.csv`}
              />
            )}

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
                        meta={`${p.value.qty.toLocaleString()} sold · ${shareLabel(p.value.revenue, revenue)} of revenue`}
                        amount={money(p.value.revenue)}
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
                        meta={`${m.value.count.toLocaleString()} order(s) · ${shareLabel(m.value.revenue, revenue)} of revenue`}
                        amount={money(m.value.revenue)}
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
                        meta={`${p.value.count.toLocaleString()} order(s) · ${shareLabel(p.value.revenue, revenue)} of revenue`}
                        amount={money(p.value.revenue)}
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
                        amount={money(g.revenue)}
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
          </div>
        )}
      </main>
    </div>
  );
}

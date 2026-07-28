"use client";

import { useEffect, useMemo, useState } from "react";
import type { Brand, Order } from "../types";
import { useStore } from "../store";
import { AdminIcon } from "./shared";
import { listStorefrontOrdersAction } from "@/actions/orders";
import {
  buildAttentionAlerts,
  buildCategoryShares,
  buildMetricTiles,
  buildRecentOrders,
  buildRevenueSeries,
  buildStockPanel,
  dashboardLayoutFor,
  type DashboardCaps,
} from "@/lib/storefront/admin-dashboard";

/**
 * The redesigned dashboard body (Tenant Admin Redesign → 1A). Every number comes
 * from the pure builders in lib/storefront/admin-dashboard, so this file only
 * decides markup: with the analytics capability it leads with the revenue
 * sparkline; without it, the same region carries stock levels and recent orders.
 */

function formatPeso(n: number): string {
  return "₱" + Math.round(n || 0).toLocaleString();
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Sparkline path for the revenue series, drawn in a 0 0 660 180 viewBox. */
function sparkPath(values: number[]): { line: string; area: string } {
  if (values.length === 0) return { line: "", area: "" };
  const max = Math.max(...values, 1);
  const stepX = values.length > 1 ? 660 / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = Math.round(i * stepX);
    const y = Math.round(170 - (v / max) * 150);
    return `${x} ${y}`;
  });
  const line = `M${points.join(" L")}`;
  return { line, area: `${line} L660 170 L0 170 Z` };
}

export function AdminDashboard({
  brand,
  caps,
  greetingName,
  onOpen,
  onAddProduct,
}: {
  brand: Brand;
  caps: DashboardCaps;
  greetingName: string;
  onOpen: (view: string) => void;
  onAddProduct: () => void;
}) {
  const { products, categories } = useStore();
  const [orders, setOrders] = useState<Order[]>([]);

  // Orders back the KPI tiles, the attention list and the recent-orders table.
  // Skipped entirely for an actor without the grant — the builders return empty
  // for them anyway, so there is nothing to fetch.
  useEffect(() => {
    if (!caps.orders) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    listStorefrontOrdersAction().then((res) => {
      if (cancelled) return;
      if ("ok" in res && res.ok) setOrders(res.orders);
    });
    return () => {
      cancelled = true;
    };
  }, [caps.orders]);

  const layout = dashboardLayoutFor(caps);
  const tiles = useMemo(
    () => buildMetricTiles({ caps, products, orders }),
    [caps, products, orders],
  );
  const revenue = useMemo(() => buildRevenueSeries({ caps, orders }), [caps, orders]);
  const stock = useMemo(() => buildStockPanel(products), [products]);
  const recent = useMemo(() => buildRecentOrders({ caps, orders }), [caps, orders]);
  const alerts = useMemo(
    () => buildAttentionAlerts({ caps, products, orders, categories }),
    [caps, products, orders, categories],
  );
  const shares = useMemo(() => buildCategoryShares(categories, products), [categories, products]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const recentOrders = recent.length > 0 && (
    <section className="adm-panel adm-panel--flush">
      <header className="adm-panel__head">
        <h2 className="adm-panel__title">Recent orders</h2>
        <button type="button" className="adm-link" onClick={() => onOpen("orders")}>
          View all orders →
        </button>
      </header>
      <div className="adm-table">
        <div className="adm-table__head">
          <span>Order</span>
          <span>Customer</span>
          <span>Items</span>
          <span>Total</span>
          <span>Placed</span>
          <span>Status</span>
        </div>
        {recent.map((o) => (
          <button
            key={o.id}
            type="button"
            className="adm-table__row"
            onClick={() => onOpen("orders")}
          >
            <span className="adm-table__strong">{o.code}</span>
            <span>{o.customer}</span>
            <span className="adm-table__muted">{o.items}</span>
            <span className="adm-table__strong">{formatPeso(o.total)}</span>
            <span className="adm-table__muted">{formatDay(o.date)}</span>
            <span>
              <span className="adm-status" data-status={o.status}>
                {o.status}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );

  const stockPanel = stock.length > 0 && (
    <section className="adm-panel">
      <header className="adm-panel__head">
        <h2 className="adm-panel__title">Stock levels</h2>
        {caps.inventory && (
          <button type="button" className="adm-link" onClick={() => onOpen("inv")}>
            Manage inventory →
          </button>
        )}
      </header>
      <ul className="adm-stock">
        {stock.map((row) => (
          <li key={row.id} className="adm-stock__row">
            <div className="adm-stock__top">
              <span className="adm-stock__name">{row.name}</span>
              <span className="adm-stock__units" data-tone={row.tone}>
                {row.units === 0 ? "Out of stock" : `${row.units} left`}
              </span>
            </div>
            <div className="adm-bar">
              <div
                className="adm-bar__fill"
                data-tone={row.tone}
                style={{ width: `${row.pct}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="adm-dash">
      <header className="adm-dash__head">
        <div>
          <h1 className="adm-dash__greeting">Welcome back, {greetingName || brand.name}</h1>
          <p className="adm-dash__sub">
            {today}
            {alerts.length > 0 &&
              ` · ${alerts.length} ${alerts.length === 1 ? "thing needs" : "things need"} you today`}
          </p>
        </div>
        <div className="adm-dash__actions">
          {caps.orders && (
            <button type="button" className="adm-btn" onClick={() => onOpen("orders")}>
              Orders
            </button>
          )}
          <button type="button" className="adm-btn adm-btn--primary" onClick={onAddProduct}>
            + Add product
          </button>
        </div>
      </header>

      <div className="adm-tiles">
        {tiles.map((t) => (
          <article key={t.id} className="adm-tile">
            <div className="adm-tile__top">
              <span className="adm-tile__label">{t.label}</span>
              {t.delta && (
                <span className="adm-tile__delta" data-tone={t.delta.tone}>
                  {t.delta.label}
                </span>
              )}
            </div>
            <div className="adm-tile__value">{t.value}</div>
            <div className="adm-tile__sub">{t.sub}</div>
          </article>
        ))}
      </div>

      <div className="adm-dash__grid">
        <div className="adm-dash__main">
          {layout === "analytics" && revenue ? (
            <section className="adm-panel">
              <header className="adm-panel__head">
                <div>
                  <h2 className="adm-panel__title">Revenue</h2>
                  <p className="adm-panel__sub">Last {revenue.points.length} days</p>
                </div>
                <button type="button" className="adm-link" onClick={() => onOpen("analytics")}>
                  Full analytics →
                </button>
              </header>
              <div className="adm-revenue__figure">
                <span className="adm-revenue__total">{formatPeso(revenue.total)}</span>
                {revenue.deltaPct !== null && (
                  <span
                    className="adm-revenue__delta"
                    data-tone={revenue.deltaPct >= 0 ? "good" : "bad"}
                  >
                    {revenue.deltaPct >= 0 ? "+" : ""}
                    {revenue.deltaPct.toFixed(1)}%
                  </span>
                )}
                <span className="adm-revenue__vs">vs. previous period</span>
              </div>
              {(() => {
                const { line, area } = sparkPath(revenue.points.map((p) => p.value));
                return (
                  <svg
                    className="adm-spark"
                    viewBox="0 0 660 180"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient id="admRevFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--brand-accent)" stopOpacity="0.22" />
                        <stop offset="100%" stopColor="var(--brand-accent)" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={area} fill="url(#admRevFill)" />
                    <path
                      d={line}
                      fill="none"
                      stroke="var(--brand-accent)"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                );
              })()}
              <div className="adm-spark__axis">
                <span>{formatDay(revenue.points[0]?.day ?? "")}</span>
                <span>{formatDay(revenue.points[revenue.points.length - 1]?.day ?? "")}</span>
              </div>
            </section>
          ) : (
            stockPanel
          )}
          {recentOrders}
        </div>

        <aside className="adm-dash__side">
          {alerts.length > 0 && (
            <section className="adm-panel adm-panel--alert">
              <h2 className="adm-panel__title">Needs attention</h2>
              <ul className="adm-alerts">
                {alerts.map((a) => (
                  <li key={a.id}>
                    <button type="button" className="adm-alert" onClick={() => onOpen(a.view)}>
                      <span className="adm-alert__dot" data-tone={a.tone} />
                      <span className="adm-alert__body">
                        <span className="adm-alert__title">{a.title}</span>
                        <span className="adm-alert__sub">{a.sub}</span>
                      </span>
                      <span className="adm-alert__chev" aria-hidden="true">
                        →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {layout === "analytics" && stockPanel}

          {shares.length > 0 && (
            <section className="adm-panel">
              <header className="adm-panel__head">
                <h2 className="adm-panel__title">Top categories</h2>
                {caps.categories && (
                  <button type="button" className="adm-link" onClick={() => onOpen("categories")}>
                    Manage →
                  </button>
                )}
              </header>
              <ul className="adm-shares">
                {shares.map((c) => (
                  <li key={c.id} className="adm-shares__row">
                    <div className="adm-shares__top">
                      <span>{c.label}</span>
                      <span className="adm-shares__count">{c.count}</span>
                    </div>
                    <div className="adm-bar">
                      <div
                        className="adm-bar__fill"
                        data-tone="accent"
                        style={{ width: `${c.pct}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {brand.featureSpotlight && (
            <section className="adm-panel adm-panel--spot">
              <span className="adm-spot__badge">NEW FEATURE</span>
              <h2 className="adm-panel__title">{brand.featureSpotlight.label}</h2>
              <p className="adm-panel__sub">{brand.featureSpotlight.description}</p>
              <button
                type="button"
                className="adm-btn adm-btn--primary adm-btn--block"
                onClick={() => onOpen("upgrade")}
              >
                <AdminIcon name="sparkle" />
                Unlock with Business
              </button>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

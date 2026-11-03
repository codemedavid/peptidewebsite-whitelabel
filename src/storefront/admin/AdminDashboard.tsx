"use client";

import { isForeignCurrencyOrder } from "@/lib/storefront/markets";
import { useEffect, useMemo, useState } from "react";
import type { Brand, Order } from "../types";
import { useStore } from "../store";
import { AdminIcon } from "./shared";
import { isAdminViewVisible } from "../visibility";
import { listStorefrontOrdersAction } from "@/actions/orders";
import {
  buildAttentionAlerts,
  buildCategoryShares,
  buildMetricTiles,
  buildRecentOrders,
  buildRevenueSeries,
  buildStockPanel,
  buildTopCustomers,
  dashboardLayoutFor,
  formatDashboardMoney,
  type DashboardCaps,
} from "@/lib/storefront/admin-dashboard";
import type { TopCustomerRow } from "@/lib/storefront/customer-profile";
import type { GroupBuy } from "@/lib/storefront/group-buy";
import {
  buildGroupBuyAlerts,
  GB_VIEW_JOINS,
  GB_VIEW_MANAGE,
  GB_VIEW_ROUND,
} from "@/lib/storefront/admin-dashboard-gb";
import { GroupBuyPanel, useGroupBuyPanel } from "./DashboardGroupBuy";
import { customerInitials } from "./AdminCustomerProfile";
import "./customer-profile.css";

/**
 * The redesigned dashboard body (Tenant Admin Redesign → 1A). Every number comes
 * from the pure builders in lib/storefront/admin-dashboard, so this file only
 * decides markup: with the analytics capability it leads with the revenue
 * sparkline; without it, the same region carries stock levels and recent orders.
 */


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

function formatSince(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (Number.isNaN(days)) return "—";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return days < 30 ? `${days}d ago` : formatDay(iso);
}

interface TopCustomersPanelProps {
  rows: TopCustomerRow[];
  currency: unknown;
  /** Absent → rows are read-only. Rows without an email are never openable. */
  onOpenCustomer?: (email: string) => void;
  /** Opens the Customers list (accounts), when this store has it. */
  onViewAll?: () => void;
}

/** The store's best buyers by total spent; an inviting empty state before the first sale. */
function TopCustomersPanel({ rows, currency, onOpenCustomer, onViewAll }: TopCustomersPanelProps) {
  return (
    <section className="adm-panel" aria-labelledby="adm-top-customers">
      <header className="adm-panel__head">
        <div>
          <h2 id="adm-top-customers" className="adm-panel__title">
            Top spenders
          </h2>
          <p className="adm-panel__sub">Customers ranked by total spent</p>
        </div>
        {onViewAll && (
          <button type="button" className="adm-link" onClick={onViewAll}>
            Customers →
          </button>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="cpf-top__empty">Your best buyers show up here after their first order.</p>
      ) : (
        <ol className="cpf-top">
          {rows.map((r, i) => {
            const figure = formatDashboardMoney(r.spent, currency);
            const sub = `${r.orders} ${r.orders === 1 ? "order" : "orders"} · last ${formatSince(r.lastAt)}`;
            const body = (
              <>
                <span className="cpf-top__rank">{i + 1}</span>
                <span className="cpf-top__avatar" aria-hidden="true">
                  {customerInitials(r.name)}
                </span>
                <span className="cpf-top__who">
                  <span className="cpf-top__name">{r.name}</span>
                  <span className="cpf-top__sub">{sub}</span>
                </span>
                <span className="cpf-top__figure">{figure}</span>
              </>
            );
            return (
              <li key={r.key}>
                {onOpenCustomer && r.email ? (
                  <button
                    type="button"
                    className="cpf-top__row"
                    data-rank={i + 1}
                    onClick={() => onOpenCustomer(r.email)}
                    aria-label={`${r.name}, ${figure}. Open order history`}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="cpf-top__row" data-rank={i + 1}>
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function AdminDashboard({
  brand,
  caps,
  greetingName,
  onOpen,
  onOpenCustomer,
  onAddProduct,
  canGroupBuys = false,
  onOpenGroupBuyJoins,
  onOpenGroupBuyRound,
}: {
  brand: Brand;
  caps: DashboardCaps;
  greetingName: string;
  onOpen: (view: string) => void;
  /** Opens a buyer's order history, by the email they check out with. */
  onOpenCustomer?: (email: string) => void;
  onAddProduct: () => void;
  /** Group Buys module on AND granted to this actor — swaps "Stock levels"
   *  for the live-round panel (lib/storefront/admin-dashboard-gb). */
  canGroupBuys?: boolean;
  /** Group Buys, landed on the Join requests tab (the approval queue). */
  onOpenGroupBuyJoins?: () => void;
  /** One round's own dashboard. */
  onOpenGroupBuyRound?: (gb: GroupBuy) => void;
}) {
  const { products, categories } = useStore();
  const gb = useGroupBuyPanel({ enabled: canGroupBuys, products, showMoney: caps.analytics });
  // A group-buy store always leads with the round (or "start your first one");
  // its stock list is all pre-order "Out of stock" noise. Others keep stock.
  const showsGroupBuy = gb.status !== "off";

  // Every click the dashboard emits funnels through here, so the group-buy
  // shortcuts resolve to real views and still meet AdminPage's view guard.
  const go = (view: string) => {
    if (view === GB_VIEW_JOINS && onOpenGroupBuyJoins) return onOpenGroupBuyJoins();
    if (view === GB_VIEW_ROUND && gb.status === "ready" && onOpenGroupBuyRound) {
      return onOpenGroupBuyRound(gb.focus.round);
    }
    if (view === GB_VIEW_JOINS || view === GB_VIEW_ROUND) return onOpen(GB_VIEW_MANAGE);
    onOpen(view);
  };
  const [allOrders, setOrders] = useState<Order[]>([]);
  // Dual-currency stores: the tiles, revenue chart and recent list are the
  // STORE's money; International (USD) orders are counted on their own line
  // (Analytics) and listed in Orders, never summed into peso figures.
  const orders = useMemo(() => allOrders.filter((o) => !isForeignCurrencyOrder(o, brand.currency)), [allOrders, brand.currency]);
  const foreignCount = allOrders.length - orders.length;

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
    () => buildMetricTiles({ caps, products, orders, currency: brand.currency }),
    [caps, products, orders, brand.currency],
  );
  const revenue = useMemo(() => buildRevenueSeries({ caps, orders }), [caps, orders]);
  const stock = useMemo(() => buildStockPanel(products), [products]);
  const recent = useMemo(() => buildRecentOrders({ caps, orders }), [caps, orders]);
  const topCustomers = useMemo(() => buildTopCustomers({ caps, orders }), [caps, orders]);
  const gbPanel = gb.status === "ready" ? gb.panel : null;
  const alerts = useMemo(
    () => [
      // Group-buy items first: a join receipt waiting is a customer locked out.
      ...buildGroupBuyAlerts(gbPanel, brand.currency),
      ...buildAttentionAlerts({ caps, products, orders, categories }),
    ],
    [gbPanel, brand.currency, caps, products, orders, categories],
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
            <span className="adm-table__strong">{formatDashboardMoney(o.total, brand.currency)}</span>
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

  const groupBuyPanel = (
    <GroupBuyPanel
      state={gb}
      currency={brand.currency}
      onOpenJoins={() => go(GB_VIEW_JOINS)}
      onOpenRound={() => go(GB_VIEW_ROUND)}
      onManage={() => go(GB_VIEW_MANAGE)}
    />
  );

  const stockPanel = !showsGroupBuy && stock.length > 0 && (
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
          {groupBuyPanel}
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
                <span className="adm-revenue__total">{formatDashboardMoney(revenue.total, brand.currency)}</span>
                {foreignCount > 0 && (
                  <span className="adm-table__muted" title="International (USD) orders are reported separately in Analytics">
                    + {foreignCount} International order{foreignCount === 1 ? "" : "s"}
                  </span>
                )}
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
                    <button type="button" className="adm-alert" onClick={() => go(a.view)}>
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

          {caps.orders && (
            <TopCustomersPanel
              rows={topCustomers}
              currency={brand.currency}
              onOpenCustomer={onOpenCustomer}
              onViewAll={isAdminViewVisible(brand, "customers") ? () => onOpen("customers") : undefined}
            />
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

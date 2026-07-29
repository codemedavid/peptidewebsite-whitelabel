"use client";

// One group buy's dedicated dashboard — overview, financial analytics, product
// analytics, its own orders table and its own Excel export.
//
// SCOPED BY CONSTRUCTION. Everything on this page comes from a single
// getGroupBuyDashboardAction(id) call, which resolves the orders for THIS round
// and computes every number from that slice. No tenant-wide aggregate is
// imported here, so "analytics are per group buy, not global" is a property of
// the data flow rather than something the UI has to remember.

import { useCallback, useEffect, useMemo, useState } from "react";

import { getGroupBuyDashboardAction } from "@/actions/group-buys";
import { downloadSupplierWorkbook } from "./supplier-workbook";
import { ProofThumb, ProofLightbox, PaymentBadge } from "./gb-proof-lightbox";
import {
  filterOrderRows,
  type OrderRowFilters,
  type RoundAnalytics,
} from "@/lib/storefront/group-buy-analytics";
import type { RoundOrderRow } from "@/lib/storefront/group-buy-orders";
import type { ReportPrep } from "@/lib/storefront/group-buy-report";
import type { GroupBuy, GroupBuyCapabilities } from "@/lib/storefront/group-buy";
import type { Brand } from "../types";

const ORDER_STATUSES = ["new", "confirmed", "processing", "ready", "shipped", "delivered", "cancelled"];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function AdminGroupBuyDetail({
  brand,
  groupBuy,
  onBack,
}: {
  brand: Brand;
  groupBuy: GroupBuy;
  onBack: () => void;
}) {
  const currency = brand.currency || "₱";
  const money = (n: number) => `${currency}${n.toLocaleString()}`;

  const [analytics, setAnalytics] = useState<RoundAnalytics | null>(null);
  const [orderRows, setOrderRows] = useState<RoundOrderRow[]>([]);
  const [prep, setPrep] = useState<ReportPrep | null>(null);
  const [caps, setCaps] = useState<GroupBuyCapabilities | null>(null);
  const [unlinked, setUnlinked] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState<OrderRowFilters>({});
  const [proof, setProof] = useState<{ url: string; label: string } | null>(null);

  // One loader, reused by the initial mount and the Refresh button. The action
  // is uncached, so re-running it is how the page picks up orders that were
  // confirmed or cancelled since it was opened.
  const load = useCallback(async () => {
    setLoading(true);
    const res = await getGroupBuyDashboardAction(groupBuy.id);
    if ("error" in res) {
      setError(res.error);
    } else {
      setError(null);
      setAnalytics(res.analytics);
      setOrderRows(res.orderRows);
      setPrep(res.prep);
      setCaps(res.caps);
      setUnlinked(res.unlinked);
    }
    setLoading(false);
  }, [groupBuy.id]);

  useEffect(() => {
    let alive = true;
    getGroupBuyDashboardAction(groupBuy.id).then((res) => {
      if (!alive) return;
      if ("error" in res) setError(res.error);
      else {
        setAnalytics(res.analytics);
        setOrderRows(res.orderRows);
        setPrep(res.prep);
        setCaps(res.caps);
        setUnlinked(res.unlinked);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [groupBuy.id]);

  const visibleRows = useMemo(() => filterOrderRows(orderRows, filters), [orderRows, filters]);
  const setFilter = (patch: Partial<OrderRowFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtersActive = Object.values(filters).some((v) => v);

  if (error) {
    return (
      <div className="admin-page">
        <button className="admin-btn admin-btn--ghost" onClick={onBack}>
          ← Back to group buys
        </button>
        <div className="admin-modal__row" role="alert" style={{ color: "#d33", fontSize: 13 }}>
          {error}
        </div>
      </div>
    );
  }

  if (loading || !analytics) {
    return (
      <div className="admin-page">
        <button className="admin-btn admin-btn--ghost" onClick={onBack}>
          ← Back to group buys
        </button>
        <div className="admin-modal__row">Loading this group buy…</div>
      </div>
    );
  }

  const { overview, financial, product } = analytics;

  const cards: { label: string; value: string | number; hint?: string }[] = [
    { label: "Total Orders", value: overview.totalOrders },
    { label: "Participants", value: overview.participants },
    { label: "Gross Income", value: money(financial.grossIncome), hint: "cancelled excluded" },
    { label: "Vials Ordered", value: product.totalVials, hint: "cancelled excluded" },
    {
      label: "Completion",
      value: product.completionPct === null ? "—" : `${product.completionPct}%`,
      hint: overview.maxVials === null ? "no maximum set" : `of ${overview.maxVials} vials`,
    },
    { label: "Confirmed Payments", value: money(financial.confirmedPayments) },
    { label: "Pending Payments", value: money(financial.pendingPayments) },
    { label: "Cancelled Orders", value: financial.cancelledOrders },
  ];

  return (
    <div className="admin-page">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button className="admin-btn admin-btn--ghost" onClick={onBack}>
          ← Back to group buys
        </button>
        <button className="admin-btn admin-btn--ghost" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        {prep && caps?.reports.excel && (
          <button className="admin-btn admin-btn--ghost" onClick={() => downloadSupplierWorkbook(prep)}>
            Export Excel
          </button>
        )}
      </div>

      <h1 className="admin-page__title" style={{ marginTop: 12 }}>
        {overview.name}
      </h1>
      <p className="admin-page__sub">
        {overview.productName} · Batch {overview.batchNumber} · {overview.status}
      </p>

      {/* ── Summary cards ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
          gap: 10,
          margin: "16px 0",
        }}
      >
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(0,0,0,.04)",
              border: "1px solid rgba(0,0,0,.08)",
            }}
          >
            <div
              style={{ fontSize: 11, opacity: 0.65, textTransform: "uppercase", letterSpacing: ".04em" }}
            >
              {c.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3 }}>{c.value}</div>
            {c.hint && <div style={{ fontSize: 10.5, opacity: 0.55 }}>{c.hint}</div>}
          </div>
        ))}
      </div>

      {unlinked > 0 && (
        <div className="admin-field__hint" style={{ marginBottom: 12 }}>
          {unlinked} order{unlinked === 1 ? " was" : "s were"} placed outside every group buy&rsquo;s date
          range, so {unlinked === 1 ? "it isn't" : "they aren't"} counted here. Adjust this round&rsquo;s
          open/close dates to include {unlinked === 1 ? "it" : "them"}.
        </div>
      )}

      {/* ── Overview + analytics panels ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14 }}>
        <Panel title="Overview">
          <Row label="Product" value={overview.productName} />
          <Row label="Batch number" value={overview.batchNumber} />
          <Row label="Status" value={overview.status} />
          <Row label="Created" value={fmtDate(overview.createdAt)} />
          <Row label="Closed" value={fmtDate(overview.closedAt)} />
          <Row
            label="Progress"
            value={
              overview.maxVials === null
                ? `${overview.currentVials} vials`
                : `${overview.currentVials} / ${overview.maxVials} vials`
            }
          />
          <Row
            label="Minimum requirement"
            value={
              overview.minVials === null
                ? "Not set"
                : `${overview.minVials} vials — ${overview.minimumMet ? "met" : "not met"}`
            }
          />
          <Row label="Participants" value={overview.participants} />
          <Row label="Total orders" value={overview.totalOrders} />
        </Panel>

        <Panel title="Financial">
          <Row label="Gross income" value={money(financial.grossIncome)} />
          <Row label="Confirmed payments" value={money(financial.confirmedPayments)} />
          <Row label="Pending payments" value={money(financial.pendingPayments)} />
          <Row label="Revenue collected" value={money(financial.revenueCollected)} />
          <Row label="Outstanding balance" value={money(financial.outstandingBalance)} />
          <Row label="Cancelled orders" value={financial.cancelledOrders} />
          <div className="admin-field__hint" style={{ marginTop: 6 }}>
            Cancelled orders are excluded from gross income and revenue. Outstanding balance is the value
            of orders not yet marked paid.
          </div>
        </Panel>

        <Panel title="Vials">
          <Row label="Total ordered" value={product.totalVials} />
          <Row label="Confirmed" value={product.confirmedVials} />
          <Row label="Pending" value={product.pendingVials} />
          <Row label="Cancelled" value={`${product.cancelledVials} (not ordered)`} />
          <Row label="Remaining" value={product.remainingVials === null ? "—" : product.remainingVials} />
          <Row
            label="Completion"
            value={product.completionPct === null ? "—" : `${product.completionPct}%`}
          />
        </Panel>
      </div>

      {/* ── Products to order ── */}
      {product.productsToOrder.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <h2 className="admin-section__title">Products to order</h2>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.7 }}>
                <th style={{ padding: "4px 0" }}>Product</th>
                <th style={{ textAlign: "right" }}>Vials to order</th>
                <th style={{ textAlign: "right" }}>Orders</th>
              </tr>
            </thead>
            <tbody>
              {product.productsToOrder.map((p) => (
                <tr key={p.productId ?? p.product} style={{ borderTop: "1px solid rgba(0,0,0,.08)" }}>
                  <td style={{ padding: "6px 0" }}>{p.product}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{p.vials}</td>
                  <td style={{ textAlign: "right", opacity: 0.7 }}>{p.orders}</td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid rgba(0,0,0,.25)", fontWeight: 700 }}>
                <td style={{ padding: "6px 0" }}>TOTAL</td>
                <td style={{ textAlign: "right" }}>{product.totalVials}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {/* ── Orders ── */}
      <section style={{ marginTop: 24 }}>
        <h2 className="admin-section__title">
          Orders ({visibleRows.length}
          {filtersActive ? ` of ${orderRows.length}` : ""})
        </h2>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0 12px" }}>
          <select
            className="admin-input"
            style={{ maxWidth: 160 }}
            aria-label="Filter by payment status"
            value={filters.paymentStatus ?? ""}
            onChange={(e) =>
              setFilter({ paymentStatus: e.target.value as OrderRowFilters["paymentStatus"] })
            }
          >
            <option value="">All payments</option>
            <option value="Confirmed">Confirmed</option>
            <option value="Pending">Pending</option>
            <option value="Cancelled">Cancelled</option>
          </select>
          <select
            className="admin-input"
            style={{ maxWidth: 160 }}
            aria-label="Filter by order status"
            value={filters.orderStatus ?? ""}
            onChange={(e) => setFilter({ orderStatus: e.target.value })}
          >
            <option value="">All order statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            className="admin-input"
            type="date"
            style={{ maxWidth: 160 }}
            aria-label="Orders from date"
            value={filters.from ?? ""}
            onChange={(e) => setFilter({ from: e.target.value })}
          />
          <input
            className="admin-input"
            type="date"
            style={{ maxWidth: 160 }}
            aria-label="Orders to date"
            value={filters.to ?? ""}
            onChange={(e) => setFilter({ to: e.target.value })}
          />
          <input
            className="admin-input"
            style={{ maxWidth: 200 }}
            placeholder="Customer name…"
            aria-label="Filter by customer name"
            value={filters.customer ?? ""}
            onChange={(e) => setFilter({ customer: e.target.value })}
          />
          {filtersActive && (
            <button className="admin-btn admin-btn--ghost" onClick={() => setFilters({})}>
              Clear
            </button>
          )}
        </div>

        {visibleRows.length === 0 ? (
          <div className="admin-empty-set">
            {orderRows.length === 0
              ? "No orders have been placed under this group buy yet."
              : "No orders match these filters."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr style={{ textAlign: "left", opacity: 0.7 }}>
                  <th style={{ padding: "4px 6px 4px 0" }}>Order ID</th>
                  <th style={{ padding: "4px 6px" }}>Date</th>
                  <th style={{ padding: "4px 6px" }}>Customer</th>
                  <th style={{ padding: "4px 6px" }}>Contact</th>
                  <th style={{ padding: "4px 6px" }}>Shipping address</th>
                  <th style={{ padding: "4px 6px" }}>Product</th>
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>Vials</th>
                  <th style={{ padding: "4px 6px" }}>Payment</th>
                  <th style={{ padding: "4px 6px" }}>Pay status</th>
                  <th style={{ padding: "4px 6px" }}>Order status</th>
                  <th style={{ padding: "4px 6px" }}>Proof</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((l, i) => (
                  <tr
                    key={`${l.orderNumber}-${l.productId ?? l.product}-${i}`}
                    style={{
                      borderTop: "1px solid rgba(0,0,0,.08)",
                      opacity: l.counted ? 1 : 0.5,
                      textDecoration: l.counted ? "none" : "line-through",
                    }}
                  >
                    <td style={{ padding: "6px 6px 6px 0", whiteSpace: "nowrap" }}>{l.orderNumber}</td>
                    <td style={{ padding: "6px", whiteSpace: "nowrap" }}>{fmtDate(l.orderDate)}</td>
                    <td style={{ padding: "6px" }}>{l.customer}</td>
                    <td style={{ padding: "6px", whiteSpace: "nowrap" }}>{l.contact}</td>
                    <td style={{ padding: "6px", maxWidth: 220 }}>{l.address}</td>
                    <td style={{ padding: "6px" }}>{l.product}</td>
                    <td style={{ padding: "6px", textAlign: "right", fontWeight: 600 }}>{l.vials}</td>
                    <td style={{ padding: "6px" }}>{l.paymentMethod}</td>
                    <td style={{ padding: "6px", textDecoration: "none" }}>
                      <PaymentBadge status={l.paymentStatus} />
                    </td>
                    <td style={{ padding: "6px" }}>{l.orderStatus}</td>
                    <td style={{ padding: "6px" }}>
                      <ProofThumb
                        url={l.proofUrl}
                        orderNumber={l.orderNumber}
                        onOpen={(url) => setProof({ url, label: l.orderNumber })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {proof && <ProofLightbox url={proof.url} label={proof.label} onClose={() => setProof(null)} />}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        padding: 14,
        borderRadius: 10,
        border: "1px solid rgba(0,0,0,.1)",
        background: "rgba(0,0,0,.02)",
      }}
    >
      <h2 className="admin-section__title" style={{ marginTop: 0 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "4px 0",
        fontSize: 13,
        borderTop: "1px solid rgba(0,0,0,.06)",
      }}
    >
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Brand, Order } from "../types";
import {
  listStorefrontOrdersAction,
  trashStorefrontOrdersAction,
  restoreStorefrontOrdersAction,
  purgeStorefrontOrdersAction,
  bulkUpdateStorefrontOrderStatusAction,
} from "@/actions/orders";

const STATUS_OPTIONS: { value: Order["status"]; label: string }[] = [
  { value: "new", label: "New" },
  { value: "confirmed", label: "Confirmed" },
  { value: "processing", label: "Processing" },
  { value: "ready", label: "Ready" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

function totalOf(o: Order): number {
  return Math.max(
    0,
    (o.items || []).reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0) -
      (o.discount?.amount || 0) +
      (o.shipping?.fee || 0) +
      (o.adminFee?.amount || 0),
  );
}

function formatPHP(n: number): string {
  return (
    "₱" +
    (n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function formatDate(d: string): string {
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`;
}

function formatTime(d: string): string {
  return new Date(d).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function OrderStatusPill({ status }: { status: Order["status"] }) {
  const labels: Record<Order["status"], string> = {
    new: "🕐 New",
    confirmed: "Confirmed",
    processing: "📦 Processing",
    ready: "✅ Ready",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };
  return (
    <span className={`admin-pill admin-pill--${status}`}>
      {labels[status] || status}
    </span>
  );
}

function PaymentStatusPill({ status }: { status: Order["paymentStatus"] }) {
  if (status === "paid")
    return <span className="admin-pill admin-pill--paid">✓ Paid</span>;
  if (status === "pending")
    return <span className="admin-pill admin-pill--pending">Pending</span>;
  return null;
}

export function AdminOrders({
  brand,
  onBack,
  onView,
}: {
  brand: Brand;
  onBack: () => void;
  onView: (o: Order) => void;
}) {
  // Orders are DB-backed (source of truth). Load the tenant's set on mount and
  // re-fetch after deletes / on Refresh, rather than reading browser localStorage.
  const [orders, setOrders] = useState<Order[]>([]);
  // The trash is fetched alongside the working list rather than on demand, so
  // the tab can carry a count and switching views costs nothing.
  const [trashed, setTrashed] = useState<Order[]>([]);
  const [view, setView] = useState<"active" | "trash">("active");
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<Order["status"]>("confirmed");
  const [busy, setBusy] = useState<boolean>(false);

  void brand;

  const refresh = useCallback(async () => {
    setLoading(true);
    const [live, binned] = await Promise.all([
      listStorefrontOrdersAction(),
      listStorefrontOrdersAction("trash"),
    ]);
    if ("ok" in live) setOrders(live.orders);
    else alert(live.error);
    if ("ok" in binned) setTrashed(binned.orders);
    setLoading(false);
  }, []);

  const showingTrash = view === "trash";
  const visible = showingTrash ? trashed : orders;

  /** Switching views clears the selection — the ids belong to the other list. */
  const switchView = (next: "active" | "trash") => {
    setView(next);
    setSelected(new Set());
    setFilter("all");
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const s: Record<string, number> = {};
    for (const o of orders) {
      s[o.status] = (s[o.status] || 0) + 1;
    }
    return s;
  }, [orders]);

  const totalAll =
    (stats.new || 0) +
    (stats.confirmed || 0) +
    (stats.processing || 0) +
    (stats.ready || 0) +
    (stats.shipped || 0) +
    (stats.delivered || 0) +
    (stats.cancelled || 0);

  const filtered = useMemo(() => {
    let list = visible;
    if (filter !== "all") list = list.filter((o) => o.status === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (o) =>
          (o.orderNumber || "").toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q) ||
          o.customer?.name?.toLowerCase().includes(q) ||
          o.customer?.email?.toLowerCase().includes(q) ||
          o.customer?.phone?.includes(q),
      );
    }
    return list;
  }, [visible, filter, query]);

  const cards: {
    id: string;
    label: string;
    value: number;
    tint: string;
  }[] = [
    {
      id: "all",
      label: "All Orders",
      value: totalAll || orders.length,
      tint: "all",
    },
    {
      id: "new",
      label: "New",
      value: stats.new ?? orders.filter((o) => o.status === "new").length,
      tint: "new",
    },
    {
      id: "confirmed",
      label: "Confirmed",
      value: stats.confirmed ?? 0,
      tint: "confirmed",
    },
    {
      id: "processing",
      label: "Processing",
      value: stats.processing ?? 0,
      tint: "processing",
    },
    {
      id: "ready",
      label: "Ready",
      value: stats.ready ?? 0,
      tint: "ready",
    },
    {
      id: "shipped",
      label: "Shipped",
      value: stats.shipped ?? 0,
      tint: "shipped",
    },
    {
      id: "delivered",
      label: "Delivered",
      value: stats.delivered ?? 0,
      tint: "delivered",
    },
    {
      id: "cancelled",
      label: "Cancelled",
      value: stats.cancelled ?? 0,
      tint: "cancelled",
    },
  ];

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((o) => o.id)));
  };

  /** Run one bulk mutation, then re-read both lists so the counts stay honest. */
  const runBulk = async (action: () => Promise<{ ok: true } | { error: string }>) => {
    if (busy) return;
    setBusy(true);
    const res = await action();
    setBusy(false);
    if ("error" in res) {
      alert(res.error);
      return;
    }
    setSelected(new Set());
    await refresh();
  };

  const trashSelected = async () => {
    if (!selected.size) return;
    if (!confirm(`Move ${selected.size} order(s) to the trash?`)) return;
    await runBulk(() => trashStorefrontOrdersAction([...selected]));
  };

  const restoreSelected = async () => {
    if (!selected.size) return;
    await runBulk(() => restoreStorefrontOrdersAction([...selected]));
  };

  // The one irreversible button in the screen, so it asks for the word rather
  // than an OK a hand already on the mouse can give by reflex.
  const purge = async (ids: string[], what: string) => {
    if (!ids.length) return;
    const typed = prompt(
      `Permanently delete ${what}? This cannot be undone.\n\nType DELETE to confirm.`,
    );
    if (typed?.trim().toUpperCase() !== "DELETE") return;
    await runBulk(() => purgeStorefrontOrdersAction(ids));
  };

  const bulkChangeStatus = async () => {
    if (!selected.size || busy) return;
    const label = STATUS_OPTIONS.find((s) => s.value === bulkStatus)?.label ?? bulkStatus;
    if (!confirm(`Change ${selected.size} order(s) to "${label}"?`)) return;
    setBusy(true);
    const res = await bulkUpdateStorefrontOrderStatusAction([...selected], bulkStatus);
    setBusy(false);
    if ("error" in res) {
      alert(res.error);
      return;
    }
    setSelected(new Set());
    await refresh();
  };

  // Still here, but no longer the end of the world: everything lands in the
  // trash, where it can be picked back out.
  const trashAll = async () => {
    if (!orders.length) return;
    if (!confirm(`Move ALL ${orders.length} orders to the trash?`)) return;
    await runBulk(() => trashStorefrontOrdersAction(orders.map((o) => o.id)));
  };

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
            <span>Orders Management</span>
          </h1>
          <button
            className="admin-btn"
            onClick={() => void refresh()}
            disabled={loading}
          >
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

        <div className="admin-orders__views" role="tablist" aria-label="Orders or trash">
          <button
            className={`admin-btn ${showingTrash ? "" : "admin-btn--primary"}`}
            role="tab"
            aria-selected={!showingTrash}
            onClick={() => switchView("active")}
          >
            Orders ({orders.length.toLocaleString()})
          </button>
          <button
            className={`admin-btn ${showingTrash ? "admin-btn--primary" : ""}`}
            role="tab"
            aria-selected={showingTrash}
            onClick={() => switchView("trash")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            Trash ({trashed.length.toLocaleString()})
          </button>
        </div>

        {showingTrash && (
          <div className="admin-note" style={{ marginBottom: 14 }}>
            Deleted orders wait here until you empty the trash. They count for
            nothing while they wait — no revenue, no reports, no stock — and
            restoring one puts it back exactly as it was.
          </div>
        )}

        {!showingTrash && (
        <div className="admin-orders__stats">
          {cards.map((c) => (
            <div
              key={c.id}
              className={`admin-stat-mini ${filter === c.id ? "is-active" : ""}`}
              data-tint={c.tint}
              onClick={() => setFilter(c.id)}
            >
              <div className="admin-stat-mini__label">{c.label}</div>
              <div className="admin-stat-mini__value">
                {c.value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
        )}

        <div className="admin-orders__search">
          <label className="input-wrap">
            <svg
              className="input-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7"></circle>
              <path d="m21 21-4.3-4.3"></path>
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by order number, customer name, email, or phone…"
            />
          </label>
        </div>

        <div className="admin-orders__bulkbar">
          <label className="admin-check">
            <input
              type="checkbox"
              checked={
                selected.size === filtered.length && filtered.length > 0
              }
              onChange={toggleAll}
            />
            <span>Select All ({filtered.length})</span>
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {showingTrash ? (
              <>
                <button
                  className="admin-btn admin-btn--primary"
                  disabled={!selected.size || busy}
                  onClick={restoreSelected}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  {busy ? "Working…" : "Restore Selected"}
                </button>
                <button
                  className="admin-btn admin-btn--danger-soft"
                  disabled={!selected.size || busy}
                  onClick={() => void purge([...selected], `${selected.size} order(s)`)}
                >
                  Delete Permanently
                </button>
                <button
                  className="admin-btn admin-btn--danger"
                  disabled={!trashed.length || busy}
                  onClick={() =>
                    void purge(
                      trashed.map((o) => o.id),
                      `all ${trashed.length} order(s) in the trash`,
                    )
                  }
                >
                  Empty Trash
                </button>
              </>
            ) : (
              <>
                <div className="admin-orders__bulkstatus">
                  <label className="od-sr-only" htmlFor="bulk-status-select">
                    Change status of selected orders
                  </label>
                  <select
                    id="bulk-status-select"
                    className="admin-select"
                    value={bulkStatus}
                    disabled={!selected.size || busy}
                    onChange={(e) => setBulkStatus(e.target.value as Order["status"])}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="admin-btn"
                    disabled={!selected.size || busy}
                    onClick={bulkChangeStatus}
                  >
                    {busy ? "Updating…" : "Change Status"}
                  </button>
                </div>
                <button
                  className="admin-btn admin-btn--danger-soft"
                  disabled={!selected.size || busy}
                  onClick={trashSelected}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                  Move to Trash
                </button>
                <button
                  className="admin-btn admin-btn--danger"
                  disabled={!orders.length || busy}
                  onClick={trashAll}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                  Move All to Trash
                </button>
              </>
            )}
          </div>
        </div>

        {filtered.map((o) => (
          <div
            key={o.id}
            className={`admin-order-card ${selected.has(o.id) ? "is-selected" : ""}`}
          >
            <div className="admin-order-card__top">
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={selected.has(o.id)}
                  onChange={() => toggle(o.id)}
                />
              </label>
              <div className="admin-order-card__id">Order {o.orderNumber || `#${o.id.slice(0, 8)}`}</div>
              <OrderStatusPill status={o.status} />
              <PaymentStatusPill status={o.paymentStatus} />
            </div>
            <div className="admin-order-card__row">
              <div>
                <div className="admin-order-card__col-label">Customer</div>
                <div className="admin-order-card__col-main">
                  {o.customer?.name}
                </div>
                <div className="admin-order-card__col-sub">
                  {o.customer?.email}
                </div>
              </div>
              <div>
                <div className="admin-order-card__col-label">Items</div>
                <div className="admin-order-card__col-main">
                  {o.items.reduce((sum, i) => sum + (i.qty || 1), 0)} item(s)
                </div>
                <div className="admin-order-card__col-sub">
                  {o.items.length} product(s)
                </div>
              </div>
              <div>
                <div className="admin-order-card__col-label">Total</div>
                <div className="admin-order-card__col-main">
                  {formatPHP(totalOf(o))}
                </div>
                <div className="admin-order-card__col-sub">
                  + {formatPHP(o.shipping?.fee || 0)} shipping
                  {(o.adminFee?.amount ?? 0) > 0 && <> · + {formatPHP(o.adminFee!.amount)} fee</>}
                </div>
              </div>
              <div>
                <div className="admin-order-card__col-label">
                  {showingTrash && o.deletedAt ? "Deleted" : "Date"}
                </div>
                <div className="admin-order-card__col-main">
                  {formatDate(showingTrash && o.deletedAt ? o.deletedAt : o.date)}
                </div>
                <div className="admin-order-card__col-sub">
                  {formatTime(showingTrash && o.deletedAt ? o.deletedAt : o.date)}
                </div>
              </div>
              {showingTrash ? (
                // No View Details from the trash: the detail screen edits status
                // and tracking, and the server refuses both on a trashed order.
                // Restore it first, then open it.
                <button
                  className="admin-order-card__view"
                  disabled={busy}
                  onClick={() => void runBulk(() => restoreStorefrontOrdersAction([o.id]))}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  Restore
                </button>
              ) : (
                <button
                  className="admin-order-card__view"
                  onClick={() => onView(o)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  View Details
                </button>
              )}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="admin-empty-set" style={{ padding: "60px 20px" }}>
            {loading
              ? "Loading orders…"
              : showingTrash
                ? "The trash is empty — nothing has been deleted."
                : "No orders match the current filter."}
          </div>
        )}
      </main>
    </div>
  );
}

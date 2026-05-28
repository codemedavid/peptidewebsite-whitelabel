"use client";

import { useMemo, useState } from "react";
import type { Brand, Order } from "../types";
import { useStore } from "../store";

function totalOf(o: Order): number {
  return (
    (o.items || []).reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0) +
    (o.shipping?.fee || 0)
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
  const { orders, setOrders } = useStore();
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  void brand;

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
    (stats.shipped || 0) +
    (stats.delivered || 0) +
    (stats.cancelled || 0);

  const filtered = useMemo(() => {
    let list = orders;
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
  }, [orders, filter, query]);

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

  const deleteSelected = () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} order(s)?`)) return;
    setOrders(orders.filter((o) => !selected.has(o.id)));
    setSelected(new Set());
  };

  const deleteAll = () => {
    if (!confirm(`Delete ALL ${orders.length} orders? This cannot be undone.`))
      return;
    setOrders([]);
    setSelected(new Set());
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
            onClick={() => setOrders([...orders])}
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
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="admin-btn admin-btn--danger-soft"
              disabled={!selected.size}
              onClick={deleteSelected}
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
              Delete Selected
            </button>
            <button
              className="admin-btn admin-btn--danger"
              onClick={deleteAll}
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
              Delete All Orders
            </button>
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
                </div>
              </div>
              <div>
                <div className="admin-order-card__col-label">Date</div>
                <div className="admin-order-card__col-main">
                  {formatDate(o.date)}
                </div>
                <div className="admin-order-card__col-sub">
                  {formatTime(o.date)}
                </div>
              </div>
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
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="admin-empty-set" style={{ padding: "60px 20px" }}>
            No orders match the current filter.
          </div>
        )}
      </main>
    </div>
  );
}

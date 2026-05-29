"use client";

import { useState } from "react";
import type { Brand, Order } from "../types";
import { useStore } from "../store";

function formatPHP(n: number): string {
  return (
    "₱" +
    (n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
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

export function AdminOrderDetail({
  brand,
  order,
  onBack,
}: {
  brand: Brand;
  order: Order;
  onBack: () => void;
}) {
  const { setOrders } = useStore();
  const [o, setO] = useState<Order>(order);
  const [tracking, setTracking] = useState<string>(o.trackingNumber || "");
  const [courier, setCourier] = useState<string>(o.courier || "LBC Express");
  const [note, setNote] = useState<string>(o.shippingNote || "");

  void brand;

  const sub = (o.items || []).reduce(
    (s, i) => s + (i.price || 0) * (i.qty || 1),
    0,
  );
  const ship = o.shipping?.fee || 0;
  const total = sub + ship;

  const syncBack = (updated: Order) => {
    setOrders((prev) =>
      prev.map((x) => (x.id === updated.id ? updated : x)),
    );
  };

  const confirmOrder = () => {
    const next: Order = { ...o, status: "confirmed" };
    setO(next);
    syncBack(next);
  };

  const changeStatus = (status: Order["status"]) => {
    const next: Order = { ...o, status };
    setO(next);
    syncBack(next);
  };

  const saveTracking = () => {
    const next: Order = {
      ...o,
      courier,
      trackingNumber: tracking,
      shippingNote: note,
      status: tracking ? "shipped" : o.status,
    };
    setO(next);
    syncBack(next);
    alert("Tracking info saved.");
  };

  return (
    <div className="admin">
      <main className="admin__inner">
        <div className="admin-detail__top">
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
            Back to Orders
          </a>
          <h1 className="admin-detail__id">Order {o.orderNumber || `#${o.id.slice(0, 8)}`}</h1>
        </div>

        <div className="admin-detail__card">
          <div className="admin-detail__status-row">
            <OrderStatusPill status={o.status} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <label
                className="admin-field__label"
                htmlFor="order-status-select"
                style={{ margin: 0 }}
              >
                Order Status
              </label>
              <select
                id="order-status-select"
                className="admin-select"
                value={o.status}
                onChange={(e) =>
                  changeStatus(e.target.value as Order["status"])
                }
              >
                <option value="new">🕐 New</option>
                <option value="confirmed">Confirmed</option>
                <option value="processing">📦 Processing</option>
                <option value="shipped">Shipped</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
              {o.status === "new" && (
                <button
                  className="admin-btn admin-btn--green"
                  onClick={confirmOrder}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  Confirm Order &amp; Deduct Stock
                </button>
              )}
            </div>
          </div>

          <h2 className="admin-detail__section-title">Customer Information</h2>
          <div className="admin-detail__block">
            <div className="admin-detail__block-row">
              <strong>Name:</strong>
              {o.customer?.name}
            </div>
            <div className="admin-detail__block-row">
              <strong>Email:</strong>
              {o.customer?.email}
            </div>
            <div className="admin-detail__block-row">
              <strong>Phone:</strong>
              {o.customer?.phone}
            </div>
            <div className="admin-detail__block-row">
              <strong>Contact Method:</strong>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--brand-accent)",
                }}
              >
                💬 {o.customer?.contactMethod}
              </span>
            </div>
          </div>

          <h2
            className="admin-detail__section-title"
            style={{ marginTop: 26 }}
          >
            Shipping Address
          </h2>
          <div className="admin-detail__block">
            <div>{o.shipping?.address}</div>
            <div>Barangay: {o.shipping?.barangay}</div>
            <div>
              {o.shipping?.city}, {o.shipping?.province} {o.shipping?.postal}
            </div>
            <div>{o.shipping?.country}</div>
            <div style={{ marginTop: 8 }}>
              <strong>Region:</strong> {o.shipping?.region}
            </div>
          </div>

          <div className="admin-detail__pink-card">
            <div className="admin-detail__pink-head">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="1" y="3" width="15" height="13" />
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
              Shipping &amp; Tracking Details
            </div>
            <label
              className="admin-field__label"
              style={{ display: "block", marginBottom: 8 }}
            >
              Tracking Number
            </label>
            <div className="admin-detail__tracking-row">
              <select
                className="admin-select"
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
              >
                <option>LBC Express</option>
                <option>J&amp;T Express</option>
                <option>Flash Express</option>
                <option>Ninja Van</option>
                <option>JRS Express</option>
                <option>Grab Express</option>
              </select>
              <input
                className="admin-input"
                placeholder="Enter tracking number"
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
              />
            </div>
            <label
              className="admin-field__label"
              style={{ display: "block", marginBottom: 8 }}
            >
              Shipping Note (Optional)
            </label>
            <input
              className="admin-input"
              placeholder={`e.g., Shipped via ${courier}…`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="admin-detail__save-tracking"
              onClick={saveTracking}
            >
              Save Tracking Info
            </button>
          </div>

          <h2
            className="admin-detail__section-title"
            style={{ marginTop: 28 }}
          >
            Order Items (
            {(o.items || []).reduce((s, i) => s + (i.qty || 1), 0)} items)
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(o.items || []).map((it, i) => (
              <div key={i} className="admin-detail__item">
                <div>
                  <div className="admin-detail__item-name">{it.name}</div>
                  <div className="admin-detail__item-qty">
                    Quantity: {it.qty} × {formatPHP(it.price)}
                  </div>
                </div>
                <div style={{ fontWeight: 600 }}>
                  {formatPHP(it.price * it.qty)}
                </div>
              </div>
            ))}
          </div>

          <h2
            className="admin-detail__section-title"
            style={{ marginTop: 28 }}
          >
            🖼️ Payment Proof
          </h2>
          <div className="admin-detail__proof">
            {o.paymentProof ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={o.paymentProof} alt="Payment proof" />
            ) : (
              <div style={{ padding: 40, color: "var(--brand-text-muted)" }}>
                No payment proof uploaded yet.
              </div>
            )}
          </div>

          <h2
            className="admin-detail__section-title"
            style={{ marginTop: 28 }}
          >
            Payment Information
          </h2>
          <div className="admin-detail__block">
            <div className="admin-detail__block-row">
              <strong>Method:</strong>
              {o.paymentMethod}
            </div>
            <div className="admin-detail__block-row">
              <strong>Status:</strong>
              <PaymentStatusPill status={o.paymentStatus} />
            </div>
          </div>

          <div className="admin-detail__totals" style={{ marginTop: 28 }}>
            <div className="admin-detail__totals-row">
              <span>Subtotal:</span>
              <span>{formatPHP(sub)}</span>
            </div>
            <div className="admin-detail__totals-row">
              <span>Shipping Fee:</span>
              <span>{formatPHP(ship)}</span>
            </div>
            <div className="admin-detail__totals-row admin-detail__totals-row--final">
              <span>Total:</span>
              <span>{formatPHP(total)}</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

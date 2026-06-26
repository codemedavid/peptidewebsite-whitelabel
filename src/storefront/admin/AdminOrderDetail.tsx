"use client";

import { useState } from "react";
import type { Brand, Order } from "../types";
import { useStore } from "../store";
import { updateStorefrontOrderAction } from "@/actions/orders";

function formatPHP(n: number): string {
  return (
    "₱" +
    (n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

// One-click copy with transient "Copied!" feedback. Falls back to a hidden
// textarea + execCommand on browsers/contexts where the async clipboard API
// is unavailable (e.g. non-HTTPS or older WebViews).
function CopyButton({
  value,
  label = "Copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = (value || "").trim();
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore — nothing else we can do if the clipboard is blocked
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={`admin-copy-btn${copied ? " admin-copy-btn--done" : ""} ${className}`.trim()}
      title="Copy to clipboard"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 8,
        border: "1px solid var(--brand-border, #e5e7eb)",
        background: copied ? "var(--brand-accent, #16a34a)" : "#fff",
        color: copied ? "#fff" : "var(--brand-text, #111)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {copied ? (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      {copied ? "Copied!" : label}
    </button>
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
  const { setProducts, couriers } = useStore();
  // The configured courier list (Couriers admin view), active rows only — plus
  // the order's saved courier if it was since deleted/disabled, so an old
  // order's selection never silently changes.
  const courierOptions = couriers.filter((c) => c.active).map((c) => c.name);
  const [o, setO] = useState<Order>(order);
  const [tracking, setTracking] = useState<string>(o.trackingNumber || "");
  const [courier, setCourier] = useState<string>(o.courier || courierOptions[0] || "");
  if (courier && !courierOptions.includes(courier)) courierOptions.unshift(courier);
  const [note, setNote] = useState<string>(o.shippingNote || "");
  const [saving, setSaving] = useState<boolean>(false);

  void brand;

  const sub = (o.items || []).reduce(
    (s, i) => s + (i.price || 0) * (i.qty || 1),
    0,
  );
  const ship = o.shipping?.fee || 0;
  const fee = o.adminFee?.amount || 0;
  const discount = o.discount?.amount || 0;
  const total = Math.max(0, sub - discount + ship + fee);

  // Persist a patch to the DB (store admin gated). Optimistically apply locally,
  // roll back + surface the error if the write fails.
  const persist = async (patch: Partial<Order>) => {
    const prev = o;
    const next: Order = { ...o, ...patch };
    // The server moves inventory on status changes — confirmed deducts,
    // cancelled restocks, each only when the journey replay says the items
    // aren't / are currently deducted. Mirror the same rule here so the
    // Inventory tab updates without a refresh.
    let deducted = false;
    for (const e of prev.statusHistory ?? []) {
      if (e.status === "confirmed") deducted = true;
      else if (e.status === "cancelled") deducted = false;
    }
    const move =
      patch.status === prev.status
        ? null
        : patch.status === "confirmed" && !deducted
          ? -1
          : patch.status === "cancelled" && deducted
            ? 1
            : null;
    setO(next);
    setSaving(true);
    const res = await updateStorefrontOrderAction(o.id, patch);
    setSaving(false);
    if ("error" in res) {
      setO(prev);
      alert(res.error);
      return false;
    }
    setO(res.order);
    if (move) {
      setProducts((ps) =>
        ps.map((p) => {
          const qty = (prev.items || [])
            .filter((it) => (it.productId ? it.productId === p.id : it.name === p.name))
            .reduce((s, it) => s + (it.qty || 1), 0);
          return qty > 0 ? { ...p, stock: Math.max(0, (p.stock || 0) + move * qty) } : p;
        }),
      );
    }
    return true;
  };

  // Full shipping address as a single line for quick paste into a courier form.
  const addressLine = [
    o.shipping?.address,
    o.shipping?.barangay ? `Brgy. ${o.shipping.barangay}` : "",
    o.shipping?.city,
    o.shipping?.province,
    o.shipping?.postal,
    o.shipping?.country,
  ]
    .filter(Boolean)
    .join(", ");

  // One block holding everything a courier booking form needs, so the whole
  // parcel can be booked with a single copy → paste.
  const bookingText = [
    `Name: ${o.customer?.name || ""}`,
    `Phone: ${o.customer?.phone || ""}`,
    `Address: ${addressLine}`,
    o.shipping?.region ? `Region: ${o.shipping.region}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const confirmOrder = () => void persist({ status: "confirmed" });

  const changeStatus = (status: Order["status"]) => void persist({ status });

  const saveTracking = async () => {
    const ok = await persist({
      courier,
      trackingNumber: tracking,
      shippingNote: note,
      status: tracking ? "shipped" : o.status,
    });
    if (ok) alert("Tracking info saved.");
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

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <h2 className="admin-detail__section-title" style={{ margin: 0 }}>
              Customer Information
            </h2>
            <CopyButton
              value={bookingText}
              label="Copy details for booking"
            />
          </div>
          <div className="admin-detail__block">
            <div className="admin-detail__block-row">
              <strong>Name:</strong>
              <span>{o.customer?.name}</span>
              {o.customer?.name && (
                <CopyButton value={o.customer.name} className="admin-detail__copy-inline" />
              )}
            </div>
            <div className="admin-detail__block-row">
              <strong>Email:</strong>
              <span>{o.customer?.email}</span>
              {o.customer?.email && (
                <CopyButton value={o.customer.email} className="admin-detail__copy-inline" />
              )}
            </div>
            <div className="admin-detail__block-row">
              <strong>Phone:</strong>
              <span>{o.customer?.phone}</span>
              {o.customer?.phone && (
                <CopyButton value={o.customer.phone} className="admin-detail__copy-inline" />
              )}
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

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 26,
            }}
          >
            <h2 className="admin-detail__section-title" style={{ margin: 0 }}>
              Shipping Address
            </h2>
            {addressLine && (
              <CopyButton value={addressLine} label="Copy address" />
            )}
          </div>
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
                {courierOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
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
              onClick={() => void saveTracking()}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save Tracking Info"}
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
            {discount > 0 && (
              <div className="admin-detail__totals-row">
                <span>{o.discount?.label || "Discount"}:</span>
                <span>−{formatPHP(discount)}</span>
              </div>
            )}
            <div className="admin-detail__totals-row">
              <span>Shipping Fee:</span>
              <span>{formatPHP(ship)}</span>
            </div>
            {fee > 0 && (
              <div className="admin-detail__totals-row">
                <span>{o.adminFee?.label || "Admin fee"}:</span>
                <span>{formatPHP(fee)}</span>
              </div>
            )}
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

"use client";

import { useEffect, useState } from "react";
import type { Brand, Order } from "../types";
import { useStore } from "../store";
import { updateStorefrontOrderAction } from "@/actions/orders";
import {
  formatPHP,
  formatOrderDate,
  orEmDash,
  buildAddressLine,
  cityProvinceLine,
  buildBookingText,
  computeOrderTotals,
  itemCount,
  hasPaymentProof,
} from "./order-detail";

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
      className={`od-copy${copied ? " od-copy--done" : ""} ${className}`.trim()}
      title="Copy to clipboard"
    >
      {copied ? (
        <svg
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
    new: "New",
    confirmed: "Confirmed",
    processing: "Processing",
    ready: "Ready",
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
  // Full-screen payment-proof viewer: the thumbnail crops the receipt, so
  // clicking it opens the whole image. Only openable when a real proof exists.
  const [isProofOpen, setIsProofOpen] = useState<boolean>(false);
  const proofUrl = hasPaymentProof(o.paymentProof) ? (o.paymentProof as string) : "";

  // Close the proof viewer on Escape while it is open.
  useEffect(() => {
    if (!isProofOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsProofOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isProofOpen]);

  void brand;

  const totals = computeOrderTotals(o);
  const addressLine = buildAddressLine(o.shipping);
  const bookingText = buildBookingText(o);
  const cityProvince = cityProvinceLine(o.shipping);
  const placed = formatOrderDate(o.date);

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
      <main className="admin__inner od-page">
        {/* Top bar */}
        <div className="od-topbar">
          <button type="button" className="od-back" onClick={onBack}>
            <svg
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
          </button>
          <div className="od-heading">
            <h1 className="od-title">
              Order {o.orderNumber || `#${o.id.slice(0, 8)}`}
            </h1>
            {placed && <span className="od-placed">Placed {placed}</span>}
          </div>
        </div>

        <div className="od-grid">
          {/* ============ LEFT / MAIN ============ */}
          <div className="od-main">
            {/* Customer */}
            <section className="od-card">
              <div className="od-section-head">
                <h2 className="od-h2">
                  <span className="od-h2-ico">👤</span>
                  Customer Information
                </h2>
                <CopyButton value={bookingText} label="Copy all for booking" />
              </div>
              <div className="od-fields">
                <div className="od-field">
                  <div className="od-field-label">Name</div>
                  <div className="od-field-value-row">
                    <span className="od-field-value">{orEmDash(o.customer?.name)}</span>
                    {o.customer?.name && <CopyButton value={o.customer.name} />}
                  </div>
                </div>
                <div className="od-field">
                  <div className="od-field-label">Email</div>
                  <div className="od-field-value-row">
                    <span className="od-field-value">{orEmDash(o.customer?.email)}</span>
                    {o.customer?.email && <CopyButton value={o.customer.email} />}
                  </div>
                </div>
                <div className="od-field">
                  <div className="od-field-label">Phone</div>
                  <div className="od-field-value-row">
                    <span className="od-field-value">{orEmDash(o.customer?.phone)}</span>
                    {o.customer?.phone && <CopyButton value={o.customer.phone} />}
                  </div>
                </div>
                <div className="od-field">
                  <div className="od-field-label">Contact Method</div>
                  <div className="od-field-value-row">
                    <span className="od-contact">
                      <span className="od-contact-dot">✓</span>
                      {orEmDash(o.customer?.contactMethod)}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* Shipping address */}
            <section className="od-card">
              <div className="od-section-head">
                <h2 className="od-h2">
                  <span className="od-h2-ico">📍</span>
                  Shipping Address
                </h2>
                {addressLine && (
                  <CopyButton value={addressLine} label="Copy address" />
                )}
              </div>
              <div className="od-addr">
                <div className="od-addr-row">
                  <span className="od-addr-key">Street</span>
                  <span className="od-addr-val">{orEmDash(o.shipping?.address)}</span>
                  {o.shipping?.address && <CopyButton value={o.shipping.address} />}
                </div>
                <div className="od-addr-row">
                  <span className="od-addr-key">Barangay</span>
                  <span
                    className={`od-addr-val${o.shipping?.barangay ? "" : " od-addr-val--empty"}`}
                  >
                    {orEmDash(o.shipping?.barangay)}
                  </span>
                </div>
                <div className="od-addr-row">
                  <span className="od-addr-key">City / Province</span>
                  <span
                    className={`od-addr-val${cityProvince ? "" : " od-addr-val--empty"}`}
                  >
                    {orEmDash(cityProvince)}
                  </span>
                  {cityProvince && <CopyButton value={cityProvince} />}
                </div>
                <div className="od-addr-row">
                  <span className="od-addr-key">Country</span>
                  <span
                    className={`od-addr-val${o.shipping?.country ? "" : " od-addr-val--empty"}`}
                  >
                    {orEmDash(o.shipping?.country)}
                  </span>
                </div>
                <div className="od-addr-row">
                  <span className="od-addr-key">Region</span>
                  <span
                    className={`od-addr-val${o.shipping?.region ? "" : " od-addr-val--empty"}`}
                  >
                    {orEmDash(o.shipping?.region)}
                  </span>
                </div>
              </div>
            </section>

            {/* Shipping & tracking */}
            <section className="od-card">
              <h2 className="od-h2" style={{ marginBottom: 18 }}>
                <span className="od-h2-ico od-h2-ico--green">🚚</span>
                Shipping &amp; Tracking
              </h2>
              <div className="od-track-grid">
                <div>
                  <label className="od-label" htmlFor="od-courier">
                    Courier
                  </label>
                  <select
                    id="od-courier"
                    className="admin-select od-control"
                    value={courier}
                    onChange={(e) => setCourier(e.target.value)}
                  >
                    {courierOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="od-label" htmlFor="od-tracking">
                    Tracking Number
                  </label>
                  <input
                    id="od-tracking"
                    className="admin-input od-control"
                    placeholder="Enter tracking number"
                    value={tracking}
                    onChange={(e) => setTracking(e.target.value)}
                  />
                </div>
              </div>
              <div className="od-field-block">
                <label className="od-label" htmlFor="od-note">
                  Shipping Note <span className="od-label-opt">(optional)</span>
                </label>
                <input
                  id="od-note"
                  className="admin-input od-control"
                  placeholder={`e.g., Shipped via ${courier || "courier"}…`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="od-save"
                onClick={() => void saveTracking()}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save Tracking Info"}
              </button>
            </section>

            {/* Order items */}
            <section className="od-card">
              <h2 className="od-h2" style={{ marginBottom: 18 }}>
                Order Items <span className="od-count">{itemCount(o)}</span>
              </h2>
              <div className="od-items">
                {(o.items || []).map((it, i) => (
                  <div key={i} className="od-item">
                    <div className="od-item-thumb">💊</div>
                    <div className="od-item-main">
                      <div className="od-item-name">{it.name}</div>
                      <div className="od-item-meta">
                        Qty {it.qty} · {formatPHP(it.price)} each
                      </div>
                    </div>
                    <div className="od-item-total">
                      {formatPHP(it.price * it.qty)}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Payment proof */}
            <section className="od-card">
              <h2 className="od-h2" style={{ marginBottom: 18 }}>
                <span className="od-h2-ico">🧾</span>
                Payment Proof
              </h2>
              {proofUrl ? (
                <button
                  type="button"
                  className="od-proof od-proof--clickable"
                  onClick={() => setIsProofOpen(true)}
                  aria-label="View full payment proof"
                  title="Click to view the full image"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={proofUrl} alt="Payment proof" />
                  <span className="od-proof-zoom" aria-hidden="true">
                    ⤢
                  </span>
                </button>
              ) : (
                <div className="od-proof">
                  <div className="od-proof-empty">
                    No payment proof uploaded yet.
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* ============ RIGHT / SIDEBAR ============ */}
          <div className="od-side">
            {/* Status + action */}
            <section className="od-card od-card--pad-sm">
              <div className="od-status-head">
                <span className="od-status-label">Order Status</span>
                <OrderStatusPill status={o.status} />
              </div>
              <div className="od-select-full">
                <label htmlFor="od-status-select" className="od-sr-only">
                  Change order status
                </label>
                <select
                  id="od-status-select"
                  className="admin-select od-control"
                  value={o.status}
                  onChange={(e) => changeStatus(e.target.value as Order["status"])}
                >
                  <option value="new">New</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="processing">Processing</option>
                  <option value="ready">Ready</option>
                  <option value="shipped">Shipped</option>
                  <option value="delivered">Delivered</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              {o.status === "new" && (
                <>
                  <button
                    type="button"
                    className="od-confirm"
                    onClick={confirmOrder}
                    disabled={saving}
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
                    Confirm &amp; Deduct Stock
                  </button>
                  <p className="od-hint">
                    Confirming reduces inventory for these items.
                  </p>
                </>
              )}
            </section>

            {/* Payment summary */}
            <section className="od-card od-card--pad-sm">
              <h2 className="od-h2" style={{ marginBottom: 16 }}>
                Payment
              </h2>
              <div className="od-pay-row">
                <div>
                  <div className="od-pay-method-label">Method</div>
                  <div className="od-pay-method">{o.paymentMethod || "—"}</div>
                </div>
                <PaymentStatusPill status={o.paymentStatus} />
              </div>
              <div className="od-totals">
                <div className="od-totals-row">
                  <span>Subtotal</span>
                  <span>{formatPHP(totals.subtotal)}</span>
                </div>
                {totals.discount > 0 && (
                  <div className="od-totals-row">
                    <span>{o.discount?.label || "Discount"}</span>
                    <span>−{formatPHP(totals.discount)}</span>
                  </div>
                )}
                <div className="od-totals-row">
                  <span>Shipping Fee</span>
                  <span>{formatPHP(totals.shipping)}</span>
                </div>
                {totals.fee > 0 && (
                  <div className="od-totals-row">
                    <span>{o.adminFee?.label || "Admin fee"}</span>
                    <span>{formatPHP(totals.fee)}</span>
                  </div>
                )}
              </div>
              <div className="od-total">
                <span className="od-total-label">Total</span>
                <span className="od-total-value">{formatPHP(totals.total)}</span>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* Full-screen payment-proof viewer — the thumbnail crops the receipt,
          so this shows the whole uploaded image. Click the backdrop, the close
          button, or press Escape to dismiss. */}
      {isProofOpen && proofUrl ? (
        <div
          className="od-proof-viewer"
          role="dialog"
          aria-modal="true"
          aria-label="Payment proof"
          onClick={() => setIsProofOpen(false)}
        >
          <button
            type="button"
            className="od-proof-viewer__close"
            aria-label="Close payment proof"
            onClick={() => setIsProofOpen(false)}
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="od-proof-viewer__img"
            src={proofUrl}
            alt="Payment proof"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import type { Brand, Order } from "../types";
import { BackLink } from "../components/BackLink";
import { useStore } from "../store";

const STATUS_LABELS: Record<Order["status"], string> = {
  new: "Order Received",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const STATUS_DOT: Record<Order["status"], string> = {
  new: "#f59e0b",
  confirmed: "#3b82f6",
  processing: "#8b5cf6",
  shipped: "#06b6d4",
  delivered: "#22c55e",
  cancelled: "#ef4444",
};

export function TrackOrderPage({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { orders } = useStore();
  const [orderNumber, setOrderNumber] = useState("");
  const [result, setResult] = useState<Order | "not_found" | null>(null);
  const [searched, setSearched] = useState("");

  const lookup = () => {
    const n = orderNumber.trim().toUpperCase();
    if (!n) return;
    const order = orders.find(
      (o) =>
        (o.orderNumber || "").toUpperCase() === n ||
        o.id.toUpperCase() === n,
    );
    setSearched(orderNumber.trim());
    setResult(order ?? "not_found");
  };

  return (
    <section className="page" id="track">
      <div className="page__container">
        <BackLink onClick={onBack} label={brand.trackBackLabel || "Back to Shop"} />
        <h1 className="page__title" style={{ textAlign: "center" }}>
          {brand.trackTitle || "Track Your Order"}
        </h1>
        <p className="page__sub" style={{ textAlign: "center", margin: "16px auto 0" }}>
          {brand.trackSub || "Enter your Order Number to check the current status of your package."}
        </p>

        <div className="track-form">
          <label className="input-wrap" aria-label="Order number">
            <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={orderNumber}
              placeholder={brand.trackPlaceholder || "Enter Order Number (e.g., TBS-1234)"}
              onChange={(e) => setOrderNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") lookup();
              }}
            />
          </label>
          <button className="btn btn-primary" onClick={lookup}>
            {brand.trackCta || "Track Order"}
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {result === "not_found" && (
          <div className="track-result">
            <span className="track-result__dot" style={{ background: "#ef4444" }} />
            <div>
              <div style={{ fontWeight: 600, color: "var(--brand-main)" }}>Order not found</div>
              <div style={{ fontSize: 14, color: "var(--brand-text-muted)" }}>
                No order matching &ldquo;{searched}&rdquo; was found. Please double-check the number and try again.
              </div>
            </div>
          </div>
        )}

        {result && result !== "not_found" && (
          <div className="track-result">
            <span
              className="track-result__dot"
              style={{ background: STATUS_DOT[result.status] }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: "var(--brand-main)", marginBottom: 2 }}>
                Order {result.orderNumber || `#${result.id.slice(0, 8)}`}
              </div>
              <div style={{ fontSize: 14, color: "var(--brand-text-muted)", marginBottom: 6 }}>
                {STATUS_LABELS[result.status]} &middot;{" "}
                {new Date(result.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
              </div>
              {result.trackingNumber && (
                <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
                  <strong>Courier:</strong> {result.courier || "—"}&nbsp;&nbsp;
                  <strong>Tracking #:</strong> {result.trackingNumber}
                </div>
              )}
              {result.shippingNote && (
                <div style={{ fontSize: 13, marginTop: 4, color: "var(--brand-text-muted)" }}>
                  {result.shippingNote}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

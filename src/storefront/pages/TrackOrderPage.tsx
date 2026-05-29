"use client";

import { useState } from "react";
import type { Brand, Order, OrderStatusEvent } from "../types";
import { BackLink } from "../components/BackLink";
import { useStore } from "../store";
import { trackStorefrontOrderAction, type TrackedOrder } from "@/actions/orders";

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

// The happy-path fulfillment journey (cancelled is a branch, handled below).
const FLOW: Order["status"][] = ["new", "confirmed", "processing", "shipped", "delivered"];

type JourneyNode = {
  key: string;
  label: string;
  at?: string;
  state: "done" | "current" | "upcoming" | "cancelled";
};

/** Build the timeline: each linear step marked done / current / upcoming, with
 *  its recorded timestamp when we have one. A cancelled order keeps whatever
 *  steps it reached, then a final red "Cancelled" node. Falls back to the
 *  current-status index for legacy orders that have no recorded history. */
function buildJourney(status: Order["status"], history: OrderStatusEvent[]): JourneyNode[] {
  const at: Record<string, string> = {};
  for (const e of history) at[e.status] = e.at; // later events win
  const cancelled = status === "cancelled";
  const currentIdx = FLOW.indexOf(status);

  const nodes: JourneyNode[] = FLOW.map((s, i) => {
    let state: JourneyNode["state"];
    if (cancelled) state = at[s] ? "done" : "upcoming";
    else if (i < currentIdx) state = "done";
    else if (i === currentIdx) state = "current";
    else state = "upcoming";
    // A recorded timestamp always means the step happened (covers any ordering).
    if (at[s] && state === "upcoming") state = "done";
    return { key: s, label: STATUS_LABELS[s], at: at[s], state };
  });

  if (cancelled) {
    nodes.push({
      key: "cancelled",
      label: STATUS_LABELS.cancelled,
      at: at.cancelled,
      state: "cancelled",
    });
  }
  return nodes;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function formatDateTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function TrackOrderPage({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  // Orders live in the DB now, so look up by order number through the public,
  // tenant-scoped action (returns the status, journey and order summary — never
  // customer PII). The customer's own orders placed in THIS browser are cached
  // locally (myOrders, localStorage-backed): we list them for one-tap tracking
  // and render their last-known state INSTANTLY from cache while the server
  // confirms the latest.
  const { myOrders } = useStore();
  const [orderNumber, setOrderNumber] = useState("");
  const [result, setResult] = useState<TrackedOrder | "not_found" | null>(null);
  const [searched, setSearched] = useState("");

  const currency = brand.currency || "";
  const money = (n: number) => `${currency}${n.toLocaleString()}`;

  const toTracked = (o: Order): TrackedOrder => ({
    orderNumber: o.orderNumber || o.id,
    status: o.status,
    date: o.date,
    courier: o.courier,
    trackingNumber: o.trackingNumber,
    shippingNote: o.shippingNote,
    items: o.items,
    shippingFee: o.shipping?.fee ?? 0,
    statusHistory: o.statusHistory ?? [],
  });

  // `override` lets the recent-orders buttons track directly (one tap) without a
  // render round-trip through the input's state.
  const lookup = async (override?: string) => {
    const n = (override ?? orderNumber).trim();
    if (!n) return;
    setOrderNumber(n);
    setSearched(n);
    const local = myOrders.find(
      (o) =>
        (o.orderNumber || "").toUpperCase() === n.toUpperCase() ||
        o.id.toUpperCase() === n.toUpperCase(),
    );
    // Show the cached copy immediately so tracking appears instantly; the server
    // result below overwrites it with the authoritative latest status + journey.
    if (local) setResult(toTracked(local));
    try {
      const res = await trackStorefrontOrderAction(n);
      if ("ok" in res && res.order) setResult(res.order);
      else if (!local) setResult("not_found");
    } catch {
      if (!local) setResult("not_found");
    }
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
                if (e.key === "Enter") void lookup();
              }}
            />
          </label>
          <button className="btn btn-primary" onClick={() => void lookup()}>
            {brand.trackCta || "Track Order"}
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {myOrders.length > 0 && (
          <div className="track-recent">
            <p className="track-recent__title">Your recent orders</p>
            <ul className="track-recent__list">
              {myOrders.map((o) => {
                const num = o.orderNumber || o.id;
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      className="track-recent__item"
                      onClick={() => void lookup(num)}
                    >
                      <span className="track-recent__num">{num}</span>
                      <span className="track-recent__date">{formatDate(o.date)}</span>
                      <span className="track-recent__status">{STATUS_LABELS[o.status]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

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
          <>
            <div className="track-result">
              <span
                className="track-result__dot"
                style={{ background: STATUS_DOT[result.status] }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: "var(--brand-main)", marginBottom: 2 }}>
                  Order {result.orderNumber}
                </div>
                <div style={{ fontSize: 14, color: "var(--brand-text-muted)", marginBottom: 6 }}>
                  {STATUS_LABELS[result.status]} &middot;{" "}
                  {formatDate(result.date)}
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

            {/* Fulfillment journey — recorded status timeline, current step marked. */}
            <div className="track-journey">
              <p className="track-journey__title">Order journey</p>
              <ol className="track-journey__list">
                {buildJourney(result.status, result.statusHistory).map((node, i, arr) => (
                  <li
                    key={node.key}
                    className={`track-journey__step is-${node.state}`}
                  >
                    <span className="track-journey__marker" aria-hidden>
                      <span className="track-journey__dot" />
                      {i < arr.length - 1 && <span className="track-journey__line" />}
                    </span>
                    <span className="track-journey__body">
                      <span className="track-journey__label">
                        {node.label}
                        {node.state === "current" && (
                          <span className="track-journey__badge">Current</span>
                        )}
                      </span>
                      <span className="track-journey__time">
                        {node.at ? formatDateTime(node.at) : "—"}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Order summary — items + totals, no customer information. */}
            {result.items.length > 0 && (
              <div className="track-summary">
                <p className="track-summary__title">Order summary</p>
                <ul className="track-summary__items">
                  {result.items.map((it, i) => (
                    <li key={i} className="track-summary__item">
                      <span className="track-summary__name">
                        {it.name} <span className="track-summary__qty">× {it.qty}</span>
                      </span>
                      <span className="track-summary__amt">{money(it.price * it.qty)}</span>
                    </li>
                  ))}
                </ul>
                {(() => {
                  const subtotal = result.items.reduce((s, it) => s + it.price * it.qty, 0);
                  const shipping = result.shippingFee || 0;
                  return (
                    <div className="track-summary__totals">
                      <div className="track-summary__row">
                        <span>Subtotal</span>
                        <span>{money(subtotal)}</span>
                      </div>
                      {shipping > 0 && (
                        <div className="track-summary__row">
                          <span>Shipping</span>
                          <span>{money(shipping)}</span>
                        </div>
                      )}
                      <div className="track-summary__row track-summary__row--total">
                        <span>Total</span>
                        <span>{money(subtotal + shipping)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

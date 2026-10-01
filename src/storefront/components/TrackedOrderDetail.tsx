"use client";

// The customer-facing order view — status card, fulfillment journey and order
// summary. Shared by the public Track page and the signed-in My Account order
// history (both feed it the same TrackedOrder shape), so a shopper sees one
// order the same way wherever they open it.

import type { Order, OrderStatusEvent } from "../types";
import type { TrackedOrder } from "@/lib/orders/tracked-order";

export const STATUS_LABELS: Record<Order["status"], string> = {
  new: "Order Received",
  confirmed: "Confirmed",
  processing: "Processing",
  ready: "Ready",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const STATUS_DOT: Record<Order["status"], string> = {
  new: "#f59e0b",
  confirmed: "#3b82f6",
  processing: "#8b5cf6",
  ready: "#0ea5a3",
  shipped: "#06b6d4",
  delivered: "#22c55e",
  cancelled: "#ef4444",
};

// The happy-path fulfillment journey (cancelled is a branch, handled below).
const FLOW: Order["status"][] = ["new", "confirmed", "processing", "ready", "shipped", "delivered"];

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

export function formatDate(iso: string): string {
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

export function TrackedOrderDetail({ order: result, currency }: { order: TrackedOrder; currency: string }) {
  const money = (n: number) => `${currency}${n.toLocaleString()}`;
  return (
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
            const fee = result.adminFee;
            const payFee = result.paymentFee;
            const discount = result.discount;
            const discountAmount = discount?.amount ?? 0;
            return (
              <div className="track-summary__totals">
                <div className="track-summary__row">
                  <span>Subtotal</span>
                  <span>{money(subtotal)}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="track-summary__row">
                    <span>Discount{discount?.code ? ` · ${discount.code}` : ""}</span>
                    <span>−{money(discountAmount)}</span>
                  </div>
                )}
                {shipping > 0 && (
                  <div className="track-summary__row">
                    <span>Shipping</span>
                    <span>{money(shipping)}</span>
                  </div>
                )}
                {fee && (
                  <div className="track-summary__row">
                    <span>{fee.label}</span>
                    <span>{money(fee.amount)}</span>
                  </div>
                )}
                {payFee && (
                  <div className="track-summary__row">
                    <span>{payFee.label}</span>
                    <span>{money(payFee.amount)}</span>
                  </div>
                )}
                <div className="track-summary__row track-summary__row--total">
                  <span>Total</span>
                  <span>
                    {money(
                      Math.max(
                        0,
                        subtotal -
                          discountAmount +
                          shipping +
                          (fee?.amount ?? 0) +
                          (payFee?.amount ?? 0),
                      ),
                    )}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
}

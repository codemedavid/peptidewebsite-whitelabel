"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Brand, Order } from "../types";
import { TrackedOrderDetail, STATUS_LABELS, formatDate } from "../components/TrackedOrderDetail";
import { BackLink } from "../components/BackLink";
import { TrackNoteCard } from "../components/TrackNoteCard";
import { useStore } from "../store";
import { trackStorefrontOrderAction, type TrackedOrder } from "@/actions/orders";
import { isTrackNoteVisible } from "@/lib/storefront/track-note";
import { recallRecentOrder } from "@/lib/storefront/recent-order";
import { toTrackedOrder } from "@/lib/orders/tracked-order";

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

  // `override` lets the recent-orders buttons track directly (one tap) without a
  // render round-trip through the input's state.
  const lookup = useCallback(
    async (override?: string) => {
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
      if (local) setResult(toTrackedOrder(local));
      try {
        const res = await trackStorefrontOrderAction(n);
        if ("ok" in res && res.order) setResult(res.order);
        else if (!local) setResult("not_found");
      } catch {
        if (!local) setResult("not_found");
      }
    },
    [orderNumber, myOrders],
  );

  // Seed the page with the customer's most recent order.
  //
  // The number is remembered in a cookie at placement (see recent-order.ts), and
  // `myOrders` is the local fallback for a browser that blocks cookies. Without
  // this a channel-less store's customer — who is sent here INSTEAD of a chat
  // thread — has to transcribe "HP-000482" off the confirmation screen, which is
  // exactly the step people get wrong.
  //
  // Runs once. `seeded` is a ref, not state, so a customer who clears the box or
  // searches for a different order is never yanked back to their own last one.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    const recent = recallRecentOrder() || myOrders[0]?.orderNumber || "";
    if (!recent) return;
    seeded.current = true;
    void lookup(recent);
  }, [myOrders, lookup]);

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

        {isTrackNoteVisible(brand.trackNote) && brand.trackNote && (
          <TrackNoteCard config={brand.trackNote} />
        )}

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
          <TrackedOrderDetail order={result} currency={currency} />
        )}
      </div>
    </section>
  );
}

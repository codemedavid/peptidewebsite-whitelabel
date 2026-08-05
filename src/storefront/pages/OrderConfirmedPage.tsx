"use client";

// The "Order Confirmed" review screen. The order is ALREADY PLACED by the time
// this renders — the customer is here to check it over and then pick how they
// want to reach the store.
//
// Why a page rather than one more step in the cart drawer:
//   • It is a full order table. A 320px side panel is the wrong shape for it.
//   • Closing the drawer used to lose the hand-off entirely. This survives a
//     close, a reload and the back button (the order is in myOrders, the chat
//     message in sessionStorage).
//   • Every channel now fires from a FRESH tap. That is what finally fixes the
//     mailto: hand-off: browsers block a mail handler invoked after an awaited
//     save, which is why gmail needed its own "sent" step. That special case is
//     gone — WhatsApp, Viber, Messenger, Telegram, Instagram and Gmail all take
//     the same path through this page.

import { useEffect, useMemo, useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { BackLink } from "../components/BackLink";
import {
  buildOrderConfirmation,
  CONFIRM_HANDOFF_KEY,
} from "@/lib/storefront/order-confirmation";
import { activeChannels, channelUrl, channelPrefills, CHANNEL_LABELS } from "../checkout";

type Handoff = { orderId: string; message: string };

function readHandoff(): Handoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CONFIRM_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Handoff>;
    if (typeof parsed?.orderId !== "string" || typeof parsed?.message !== "string") return null;
    return { orderId: parsed.orderId, message: parsed.message };
  } catch {
    return null;
  }
}

export function OrderConfirmedPage({
  brand,
  onBack,
}: {
  brand: Brand;
  onBack: () => void;
}) {
  const { myOrders, products, toast } = useStore();
  // Read once on mount: sessionStorage is not reactive, and re-reading every
  // render would just churn.
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  useEffect(() => setHandoff(readHandoff()), []);

  // The order this hand-off belongs to. Falling back to the newest order this
  // browser placed keeps the page useful when sessionStorage was cleared
  // (private tab, restored session) instead of showing an error.
  const order = useMemo(() => {
    if (!myOrders.length) return null;
    return myOrders.find((o) => o.id === handoff?.orderId) ?? myOrders[0];
  }, [myOrders, handoff]);

  const view = useMemo(
    () => (order ? buildOrderConfirmation(order, products, { currency: brand.currency }) : null),
    [order, products, brand.currency],
  );

  const channels = activeChannels(brand);
  const money = (n: number) => `${view?.currency ?? ""}${n.toLocaleString()}`;

  const send = async (type: string) => {
    const channel = channels.find((c) => c.type === type);
    if (!channel || !handoff) return;
    const url = channelUrl(channel, handoff.message);
    // Telegram / Messenger / Instagram cannot carry a prefilled DM, so the
    // summary goes to the clipboard as a paste-in fallback. Awaited so the write
    // completes before we navigate the tab away.
    if (!channelPrefills(channel.type)) {
      try {
        await navigator.clipboard?.writeText(handoff.message);
        toast(`Order copied — paste it in ${CHANNEL_LABELS[channel.type]}`);
      } catch {
        /* clipboard denied — the link still opens */
      }
    }
    if (typeof window !== "undefined") window.location.href = url;
  };

  const copyReference = async () => {
    if (!view) return;
    try {
      await navigator.clipboard?.writeText(view.reference);
      toast("Order reference copied");
    } catch {
      /* clipboard denied — the reference is on screen to read */
    }
  };

  if (!order || !view) {
    return (
      <section className="section sf-confirm">
        <div className="container">
          <BackLink onClick={onBack} label="Back to shop" />
          <h1 className="sf-confirm__title font-display">No order to show</h1>
          <p className="sf-confirm__lede">
            We couldn&rsquo;t find a recent order in this browser. If you already placed one,
            look it up with your order number on the Track page.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="section sf-confirm" aria-labelledby="confirm-heading">
      <div className="container">
        <BackLink onClick={onBack} label="Back to shop" />

        <header className="sf-confirm__head">
          <span className="sf-confirm__check" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
                 strokeLinecap="round" strokeLinejoin="round" width={28} height={28}>
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <h1 id="confirm-heading" className="sf-confirm__title font-display">Order Confirmed</h1>
          <p className="sf-confirm__lede">
            Your order details have been pre-filled. Please review everything below, then
            click your preferred contact method to finalize your order.
          </p>
        </header>

        {/* ── Reference ─────────────────────────────────────────────────── */}
        <div className="sf-confirm__ref">
          <div>
            <span className="sf-confirm__ref-label">Order Reference</span>
            <strong className="sf-confirm__ref-value">#{view.reference}</strong>
          </div>
          <button type="button" className="sf-confirm__copy" onClick={() => void copyReference()}>
            Copy
          </button>
        </div>
        <p className="sf-confirm__note">
          Use this reference for tracking and customer support.
        </p>

        <div className="sf-confirm__grid">
          {/* ── Customer ───────────────────────────────────────────────── */}
          <section className="sf-confirm__card" aria-labelledby="confirm-customer">
            <h2 id="confirm-customer" className="sf-confirm__card-title">Customer Information</h2>
            <dl className="sf-confirm__dl">
              <dt>Name</dt><dd>{view.customer.name}</dd>
              <dt>Email</dt><dd>{view.customer.email}</dd>
              <dt>Phone</dt><dd>{view.customer.phone}</dd>
            </dl>
          </section>

          {/* ── Shipping ───────────────────────────────────────────────── */}
          <section className="sf-confirm__card" aria-labelledby="confirm-shipping">
            <h2 id="confirm-shipping" className="sf-confirm__card-title">Shipping Address</h2>
            <dl className="sf-confirm__dl">
              <dt>Address</dt><dd>{view.shipping.address}</dd>
              <dt>Courier</dt><dd>{view.shipping.courier}</dd>
              <dt>Payment</dt><dd>{view.paymentMethod}</dd>
            </dl>
          </section>
        </div>

        {/* ── Items ────────────────────────────────────────────────────── */}
        <section className="sf-confirm__card" aria-labelledby="confirm-items">
          <h2 id="confirm-items" className="sf-confirm__card-title">Order Details</h2>
          <div className="sf-confirm__table-wrap">
            <table className="sf-confirm__table">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Variant</th>
                  <th scope="col">Purity</th>
                  <th scope="col" className="is-num">Qty</th>
                  <th scope="col" className="is-num">Unit Price</th>
                  <th scope="col" className="is-num">Total</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((item, i) => (
                  <tr key={`${item.name}-${i}`}>
                    <td>{item.name}</td>
                    <td>{item.variation || "—"}</td>
                    <td>{item.purity || "—"}</td>
                    <td className="is-num">{item.qty}</td>
                    <td className="is-num">{money(item.unitPrice)}</td>
                    <td className="is-num">{money(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="sf-confirm__totals">
            <dt>Subtotal</dt>
            <dd>{money(view.totals.subtotal)}</dd>
            {view.totals.discount > 0 && (
              <>
                <dt>
                  Discount
                  {view.totals.discountCode ? ` (${view.totals.discountCode})` : ""}
                </dt>
                <dd>−{money(view.totals.discount)}</dd>
              </>
            )}
            {view.totals.shipping > 0 && (
              <>
                <dt>Shipping</dt>
                <dd>{money(view.totals.shipping)}</dd>
              </>
            )}
            {view.totals.fee > 0 && (
              <>
                <dt>{view.totals.feeLabel || "Fee"}</dt>
                <dd>{money(view.totals.fee)}</dd>
              </>
            )}
            <dt className="is-total">Total</dt>
            <dd className="is-total">{money(view.totals.total)}</dd>
          </dl>
        </section>

        {/* ── Hand-off ─────────────────────────────────────────────────── */}
        <section className="sf-confirm__send" aria-labelledby="confirm-send">
          <h2 id="confirm-send" className="sf-confirm__card-title">Finalize your order</h2>
          {channels.length === 0 ? (
            <p className="sf-confirm__note">
              This store hasn&rsquo;t set up a contact channel yet — please reach out using
              the details in the footer, quoting order #{view.reference}.
            </p>
          ) : (
            <>
              <p className="sf-confirm__note">
                Your message is already written. Pick a channel and press send.
              </p>
              <div className="sf-confirm__channels">
                {channels.map((c) => (
                  <button
                    key={c.type}
                    type="button"
                    className="btn btn-primary sf-confirm__channel"
                    onClick={() => void send(c.type)}
                  >
                    {CHANNEL_LABELS[c.type]}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

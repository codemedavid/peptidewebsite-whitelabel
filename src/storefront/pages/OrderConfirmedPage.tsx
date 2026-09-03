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
  formatOrderMessage,
  CONFIRM_HANDOFF_KEY,
} from "@/lib/storefront/order-confirmation";
import { activeChannels, channelUrl, channelPrefills, CHANNEL_LABELS } from "../checkout";
import { isDirectHandoff } from "@/lib/storefront/checkout-handoff";
import { isPageVisible } from "../visibility";

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

/**
 * Copy with a fallback, because the customers who most need this button are on
 * the browsers that break it. `navigator.clipboard` is undefined outside a
 * secure context and is denied outright by several in-app browsers (the
 * Facebook and Instagram webviews among them) — exactly where the chat hand-off
 * is least reliable too. The legacy execCommand path still works there.
 *
 * Returns false when both paths fail, so the caller can fall back to putting the
 * text on screen for the customer to select by hand.
 */
async function copyText(text: string): Promise<boolean> {
  if (typeof document === "undefined" || !text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* denied or unavailable — try the legacy path before giving up */
  }
  try {
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    // Off-screen but still selectable: display:none or visibility:hidden would
    // make the selection — and so the copy — a no-op.
    scratch.style.position = "fixed";
    scratch.style.top = "-9999px";
    scratch.style.opacity = "0";
    document.body.appendChild(scratch);
    scratch.select();
    scratch.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(scratch);
    return copied;
  } catch {
    return false;
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
  // The store has no chat channel, so there is nothing for the customer to send:
  // the order is already with the seller and this page is purely a receipt. Same
  // predicate the drawer branched on, so the two screens agree by construction.
  const isDirect = isDirectHandoff(brand);
  // Only offer the tracker if the owner actually serves that page — pointing at
  // a hidden #track would land them back on the home page with no explanation.
  const canTrack = isPageVisible(brand, "track");
  const money = (n: number) => `${view?.currency ?? ""}${n.toLocaleString()}`;

  // The message the customer sends. Normally it is the one the checkout already
  // wrote; when sessionStorage was unavailable (private tab, storage full, a
  // session restored into a new tab) we rebuild it from the same view the
  // customer is looking at. Before, a missing hand-off left every channel button
  // inert — the one case where the customer most needed a way out.
  const messageText = useMemo(() => {
    if (handoff?.message) return handoff.message;
    return view ? formatOrderMessage(view, { brandName: brand.name }) : "";
  }, [handoff, view, brand.name]);

  // Shown only when copying fails outright, so the customer can still select the
  // text by hand — plus a manual toggle, since some people just want to see it.
  const [showMessage, setShowMessage] = useState(false);

  const send = async (type: string) => {
    const channel = channels.find((c) => c.type === type);
    if (!channel) return;
    const url = channelUrl(channel, messageText);
    // Telegram / Messenger / Instagram cannot carry a prefilled DM, so the
    // summary goes to the clipboard as a paste-in fallback. Awaited so the write
    // completes before we navigate the tab away.
    if (!channelPrefills(channel.type)) {
      const copied = await copyText(messageText);
      toast(
        copied
          ? `Order copied — paste it in ${CHANNEL_LABELS[channel.type]}`
          : `Opening ${CHANNEL_LABELS[channel.type]} — use "Copy order details" if it opens blank`,
      );
    }
    if (typeof window !== "undefined") window.location.href = url;
  };

  const copyReference = async () => {
    if (!view) return;
    if (await copyText(view.reference)) toast("Order reference copied");
    // Otherwise: it's printed right there on screen to read off.
  };

  const copyOrder = async () => {
    if (await copyText(messageText)) {
      toast("Order details copied — paste them into your message");
      return;
    }
    // Both clipboard paths refused. Put the text on screen so the customer is
    // never stuck retyping their own order.
    setShowMessage(true);
    toast("Copy blocked by your browser — select the text below instead");
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
          <h1 id="confirm-heading" className="sf-confirm__title font-display">
            {isDirect ? "Order Received" : "Order Confirmed"}
          </h1>
          <p className="sf-confirm__lede">
            {isDirect
              ? "We've got your order and it's now with the store. Please review the details below and keep your order number handy."
              : "Your order details have been pre-filled. Please review everything below, then click your preferred contact method to finalize your order."}
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
            {view.totals.paymentFee > 0 && (
              <>
                <dt>{view.totals.paymentFeeLabel || "Processing fee"}</dt>
                <dd>{money(view.totals.paymentFee)}</dd>
              </>
            )}
            <dt className="is-total">Total</dt>
            <dd className="is-total">{money(view.totals.total)}</dd>
          </dl>
        </section>

        {/* ── What happens next (no chat channel) ──────────────────────
            Nothing to send: the order is already stored and the seller has it.
            So this section is a receipt, not a call to action — it tells the
            customer to wait, and hands them the one thing they need to follow
            it up, their order number. */}
        {isDirect ? (
          <section className="sf-confirm__next" aria-labelledby="confirm-next">
            <h2 id="confirm-next" className="sf-confirm__card-title">What happens next</h2>
            <p className="sf-confirm__next-lede">
              Thank you for placing your order! We&rsquo;ve received it and it&rsquo;s now
              waiting for confirmation. Please keep an eye out — we&rsquo;ll be in touch
              shortly.
            </p>
            {canTrack ? (
              <>
                <p className="sf-confirm__note">
                  You can check your order status any time on the Track Order page — just
                  search your order number, <strong>#{view.reference}</strong>. We&rsquo;ve
                  remembered it in this browser, so it should already be filled in for you.
                </p>
                <a className="btn btn-primary sf-confirm__track" href="#track">
                  Track my order
                </a>
              </>
            ) : (
              <p className="sf-confirm__note">
                Please keep your order number, <strong>#{view.reference}</strong> — quote it
                if you need to get in touch about this order.
              </p>
            )}
          </section>
        ) : (
          /* ── Hand-off ───────────────────────────────────────────────── */
          <section className="sf-confirm__send" aria-labelledby="confirm-send">
            <h2 id="confirm-send" className="sf-confirm__card-title">Finalize your order</h2>
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

            {/* ── Manual fallback ───────────────────────────────────────
                Deliberately always visible, not revealed after a failure: the
                page cannot detect that a chat app opened with an empty compose
                box, so the customer has to be able to reach for this themselves. */}
            <div className="sf-confirm__fallback">
              <p className="sf-confirm__fallback-note">
                Opened blank, or the details didn&rsquo;t come through? Copy your order and
                paste it into the chat.
              </p>
              <div className="sf-confirm__fallback-actions">
                <button
                  type="button"
                  className="sf-confirm__copy"
                  onClick={() => void copyOrder()}
                >
                  Copy order details
                </button>
                <button
                  type="button"
                  className="sf-confirm__reveal"
                  onClick={() => setShowMessage((shown) => !shown)}
                  aria-expanded={showMessage}
                  aria-controls="confirm-message"
                >
                  {showMessage ? "Hide order text" : "Show order text"}
                </button>
              </div>
              {showMessage && (
                <textarea
                  id="confirm-message"
                  className="sf-confirm__message"
                  readOnly
                  rows={14}
                  value={messageText}
                  aria-label="Your order details, ready to copy"
                  // Tapping it selects the lot, so a customer whose browser blocks
                  // the clipboard entirely still only needs one gesture.
                  onFocus={(e) => e.currentTarget.select()}
                />
              )}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}

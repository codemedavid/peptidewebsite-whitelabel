"use client";

// Order screen → "Buyer contact & update" card.
//
// 1. The admin records where the buyer reached them: WhatsApp (number) or
//    Telegram (@username or number). Saved on the order; a repeat buyer's
//    earlier choice is pre-filled (resolveBuyerChannel).
// 2. A ready-to-send message for the order's CURRENT status — with courier and
//    tracking number once it's shipped — that opens straight in that chat.
//    When the status changes, the card lights up so the update isn't forgotten.

import { useEffect, useRef, useState } from "react";
import type { Brand, Order } from "../types";
import { setOrderBuyerChannelAction } from "@/actions/orders";
import {
  BUYER_APPS,
  BUYER_APP_LABEL,
  buyerChannelLink,
  linkCarriesText,
  parseBuyerChannelInput,
  resolveBuyerChannel,
  type BuyerApp,
  type BuyerChannel,
} from "@/lib/orders/buyer-contact";
import { buildBuyerUpdateMessage } from "@/lib/orders/buyer-update-message";
import { copyText } from "./copy-text";
import "./buyer-contact.css";

const STATUS_LABEL: Record<Order["status"], string> = {
  new: "New",
  confirmed: "Confirmed",
  processing: "Processing",
  ready: "Ready",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const SOURCE_HINT = {
  customer: "Remembered from this buyer's earlier order — save to link it here too.",
  checkout: "The WhatsApp number the buyer typed at checkout — save to confirm it.",
} as const;

const PLACEHOLDER: Record<BuyerApp, string> = {
  whatsapp: "e.g. 0917 123 4567",
  telegram: "@username or phone number",
};

const FLASH_MS = 1800;

interface OrderBuyerContactProps {
  brand: Brand;
  order: Order;
  /** Every order the admin has loaded — used to remember a repeat buyer's chat. */
  allOrders: ReadonlyArray<Order>;
  onSaved: (order: Order) => void;
}

export function OrderBuyerContact({ brand, order, allOrders, onSaved }: OrderBuyerContactProps) {
  const resolved = resolveBuyerChannel(order, allOrders);
  const saved = resolved?.source === "order" ? resolved.channel : null;

  const [app, setApp] = useState<BuyerApp>(resolved?.channel.app ?? "whatsapp");
  const [handle, setHandle] = useState<string>(resolved?.channel.handle ?? "");
  const [isEditing, setIsEditing] = useState<boolean>(!saved);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const generated = buildBuyerUpdateMessage({
    status: order.status,
    orderNumber: order.orderNumber || order.id.slice(0, 8),
    buyerName: order.customer?.name ?? "",
    storeName: brand.name,
    courier: order.courier,
    trackingNumber: order.trackingNumber,
  });
  // The draft follows the generated text; a status/tracking change replaces any
  // edits (they were written for the old status).
  const [draft, setDraft] = useState(generated);
  const [basis, setBasis] = useState(generated);
  if (basis !== generated) {
    setBasis(generated);
    setDraft(generated);
  }

  // Light the card up when the admin moves the status, so the buyer gets told.
  const cardRef = useRef<HTMLElement>(null);
  const [prevStatus, setPrevStatus] = useState(order.status);
  const [isNudged, setIsNudged] = useState(false);
  if (prevStatus !== order.status) {
    setPrevStatus(order.status);
    setIsNudged(true);
  }
  useEffect(() => {
    if (isNudged) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [isNudged]);

  const showFlash = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(""), FLASH_MS);
  };

  const save = async (value: BuyerChannel | null) => {
    setError("");
    setIsSaving(true);
    const res = await setOrderBuyerChannelAction(order.id, value);
    setIsSaving(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onSaved(res.order);
    const stored = res.order.customer.reachedVia;
    setIsEditing(!stored);
    if (stored) setHandle(stored.handle);
    showFlash(value ? "Contact saved" : "Contact removed");
  };

  const submit = () => {
    const parsed = parseBuyerChannelInput({ app, handle });
    if (!parsed.ok) return setError(parsed.error);
    if (!parsed.value) return setError(`Enter the buyer's ${BUYER_APP_LABEL[app]} contact.`);
    void save(parsed.value);
  };

  // The channel the send button uses: the saved one, else what's typed (if valid).
  const typed = parseBuyerChannelInput({ app, handle });
  const target: BuyerChannel | null = saved && !isEditing ? saved : typed.ok ? typed.value : saved;

  const send = async () => {
    if (!target) return;
    const text = draft.trim();
    if (!linkCarriesText(target)) {
      // Telegram can't receive the text through the link, so an empty clipboard
      // would open a chat with nothing to paste — stay here and say so instead.
      if (!(await copyText(text))) {
        showFlash("Couldn't copy — select the message, copy it, then try again");
        return;
      }
      showFlash("Message copied — paste it in the Telegram chat");
    }
    window.open(buyerChannelLink(target, text), "_blank", "noopener,noreferrer");
    setIsNudged(false);
  };

  const copyDraft = async () => {
    showFlash((await copyText(draft.trim())) ? "Message copied" : "Couldn't copy — select the text instead");
  };

  const sendLabel = !target
    ? "Add a contact to send"
    : linkCarriesText(target)
      ? "Send on WhatsApp"
      : "Copy & open Telegram";

  return (
    <section
      ref={cardRef}
      className={`od-card od-card--pad-sm bc-card${isNudged ? " bc-card--nudge" : ""}`}
      aria-labelledby="bc-title"
    >
      <h2 id="bc-title" className="od-h2 bc-title">
        Buyer contact &amp; update
      </h2>

      {/* ── where the buyer reached the store ── */}
      {saved && !isEditing ? (
        <div className={`bc-saved bc-saved--${saved.app}`}>
          <span className="bc-app-dot" aria-hidden="true" />
          <div className="bc-saved-main">
            <span className="bc-saved-label">Contacted you on {BUYER_APP_LABEL[saved.app]}</span>
            <span className="bc-saved-handle">{saved.handle}</span>
          </div>
          <button type="button" className="bc-link" onClick={() => setIsEditing(true)}>
            Change
          </button>
        </div>
      ) : (
        <div className="bc-form">
          <span className="od-label">Where did the buyer contact you?</span>
          <div className="bc-seg" role="radiogroup" aria-label="Chat app">
            {BUYER_APPS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={app === a}
                className={`bc-seg-btn bc-seg-btn--${a}${app === a ? " is-on" : ""}`}
                onClick={() => {
                  setApp(a);
                  setError("");
                }}
              >
                {BUYER_APP_LABEL[a]}
              </button>
            ))}
          </div>
          <label className="od-label" htmlFor="bc-handle">
            {app === "whatsapp" ? "WhatsApp number" : "Telegram username or number"}
          </label>
          <input
            id="bc-handle"
            className="admin-input od-control"
            inputMode={app === "whatsapp" ? "tel" : "text"}
            autoComplete="off"
            placeholder={PLACEHOLDER[app]}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          {resolved && resolved.source !== "order" && <p className="bc-hint">{SOURCE_HINT[resolved.source]}</p>}
          {error && (
            <p className="bc-error" role="alert">
              {error}
            </p>
          )}
          <div className="bc-row">
            <button type="button" className="od-save bc-save" onClick={submit} disabled={isSaving}>
              {isSaving ? "Saving…" : "Save contact"}
            </button>
            {saved && (
              <>
                <button type="button" className="bc-link" onClick={() => setIsEditing(false)} disabled={isSaving}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="bc-link bc-link--danger"
                  onClick={() => void save(null)}
                  disabled={isSaving}
                >
                  Remove
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── the update for the current status ── */}
      <div className="bc-msg">
        <div className="bc-msg-head">
          <span className="od-label bc-msg-label">Update message · {STATUS_LABEL[order.status]}</span>
          {isNudged && <span className="bc-badge">Status changed — tell the buyer</span>}
        </div>
        {order.status === "shipped" && !order.trackingNumber.trim() && (
          <p className="bc-hint">Save a tracking number and it will be added to this message.</p>
        )}
        <textarea
          className="admin-input od-control bc-text"
          aria-label="Message to the buyer"
          rows={7}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="bc-row">
          <button
            type="button"
            className={`bc-send bc-send--${target?.app ?? "none"}`}
            onClick={() => void send()}
            disabled={!target || !draft.trim()}
            title={target ? undefined : "Add the buyer's WhatsApp or Telegram first"}
          >
            {sendLabel}
          </button>
          <button type="button" className="bc-link" onClick={() => void copyDraft()} disabled={!draft.trim()}>
            Copy
          </button>
          {draft !== generated && (
            <button type="button" className="bc-link" onClick={() => setDraft(generated)}>
              Reset
            </button>
          )}
        </div>
        <p className="bc-flash" aria-live="polite">
          {flash}
        </p>
      </div>
    </section>
  );
}

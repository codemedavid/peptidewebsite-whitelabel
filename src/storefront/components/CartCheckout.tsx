"use client";

// Cart drawer + checkout. Opens from the header cart button / floating cart FAB.
// Two steps: review the cart, then enter contact + shipping details and pick a
// messaging channel. Submitting hands the order off to the chosen channel
// (WhatsApp / Telegram / Messenger) with a prefilled summary — there is no
// in-app payment. The enabled channels are configured by the super admin.

import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import {
  activeChannels,
  buildOrderMessage,
  cartLines,
  cartTotal,
  channelPrefills,
  channelUrl,
  CHANNEL_LABELS,
  EMPTY_CUSTOMER,
  unitPrice,
  type CheckoutCustomer,
} from "../checkout";

type Step = "cart" | "details";

const FIELDS: { key: keyof CheckoutCustomer; label: string; required: boolean; type?: string }[] = [
  { key: "name", label: "Full name", required: true },
  { key: "email", label: "Email", required: true, type: "email" },
  { key: "phone", label: "Phone", required: true, type: "tel" },
  { key: "address", label: "Address", required: true },
  { key: "city", label: "City / Municipality", required: true },
  { key: "province", label: "Province / State", required: true },
  { key: "postal", label: "Postal code", required: false },
  { key: "country", label: "Country", required: true },
];

export function CartCheckout({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { brand, cart, addToCart, decrementCart, removeLine, clearCart, toast } = useStore();
  const [step, setStep] = useState<Step>("cart");
  const [customer, setCustomer] = useState<CheckoutCustomer>(EMPTY_CUSTOMER);
  const [touched, setTouched] = useState(false);

  const lines = useMemo(() => cartLines(cart), [cart]);
  const total = useMemo(() => cartTotal(lines), [lines]);
  const channels = useMemo(() => activeChannels(brand), [brand]);
  const currency = brand.currency || lines[0]?.product.currency || "";

  // Reset to the cart step whenever the drawer is (re)opened.
  useEffect(() => {
    if (open) {
      setStep("cart");
      setTouched(false);
    }
  }, [open]);

  // Lock background scroll + close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const set = (key: keyof CheckoutCustomer, val: string) =>
    setCustomer((c) => ({ ...c, [key]: val }));

  const missing = FIELDS.filter((f) => f.required && !customer[f.key].trim());
  const detailsValid = missing.length === 0;

  function placeOrder(channelType: string) {
    const channel = channels.find((c) => c.type === channelType);
    if (!channel) return;
    const message = buildOrderMessage(brand, lines, customer);

    // Open the chat first — synchronously within the click — so the popup
    // isn't blocked, then copy the summary as a fallback (Telegram/Messenger
    // can't prefill a DM; WhatsApp carries the text in the link).
    window.open(channelUrl(channel, message), "_blank", "noreferrer");
    void navigator.clipboard?.writeText(message).catch(() => {});
    toast(
      channelPrefills(channel.type)
        ? `Opening ${CHANNEL_LABELS[channel.type]}…`
        : `Order copied — paste it in ${CHANNEL_LABELS[channel.type]}`,
    );
    clearCart();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="sf-cart" role="dialog" aria-modal="true" aria-label="Cart">
      <button className="sf-cart__scrim" aria-label="Close cart" onClick={onClose} />
      <aside className="sf-cart__panel">
        <header className="sf-cart__head">
          <h2 className="sf-cart__title">
            {step === "cart" ? "Your cart" : brand.checkoutTitle || "Complete your order"}
          </h2>
          <button className="sf-cart__close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={22} height={22}>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="sf-cart__body">
          {lines.length === 0 ? (
            <p className="sf-cart__empty">Your cart is empty.</p>
          ) : step === "cart" ? (
            <ul className="sf-cart__lines">
              {lines.map((l) => (
                <li key={l.product.id} className="sf-cart__line">
                  <div className="sf-cart__line-info">
                    <span className="sf-cart__line-name">{l.product.name}</span>
                    <span className="sf-cart__line-price">
                      {l.product.currency || currency}
                      {unitPrice(l.product).toLocaleString()}
                    </span>
                  </div>
                  <div className="sf-cart__qty">
                    <button aria-label={`Remove one ${l.product.name}`} onClick={() => decrementCart(l.product.id)}>−</button>
                    <span>{l.qty}</span>
                    <button aria-label={`Add one ${l.product.name}`} onClick={() => addToCart(l.product)}>+</button>
                  </div>
                  <button className="sf-cart__remove" aria-label={`Remove ${l.product.name}`} onClick={() => removeLine(l.product.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <form className="sf-cart__form" onSubmit={(e) => e.preventDefault()}>
              {brand.checkoutNote && <p className="sf-cart__note">{brand.checkoutNote}</p>}
              <div className="sf-cart__fields">
                {FIELDS.map((f) => (
                  <label key={f.key} className="sf-cart__field">
                    <span>
                      {f.label}
                      {f.required && <em aria-hidden> *</em>}
                    </span>
                    <input
                      type={f.type || "text"}
                      value={customer[f.key]}
                      required={f.required}
                      aria-invalid={touched && f.required && !customer[f.key].trim() ? true : undefined}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </form>
          )}
        </div>

        {lines.length > 0 && (
          <footer className="sf-cart__foot">
            <div className="sf-cart__total">
              <span>Total</span>
              <strong>
                {currency}
                {total.toLocaleString()}
              </strong>
            </div>

            {step === "cart" ? (
              <button className="btn btn-primary sf-cart__cta" onClick={() => setStep("details")}>
                Checkout
              </button>
            ) : channels.length === 0 ? (
              <p className="sf-cart__unavailable">
                Online checkout isn&apos;t set up yet — please contact the store directly.
              </p>
            ) : (
              <>
                {touched && !detailsValid && (
                  <p className="sf-cart__error">Please fill in the required fields.</p>
                )}
                <p className="sf-cart__channels-label">Send your order via</p>
                <div className="sf-cart__channels">
                  {channels.map((c) => (
                    <button
                      key={c.type}
                      className="btn btn-primary sf-cart__channel"
                      onClick={() => {
                        setTouched(true);
                        if (detailsValid) placeOrder(c.type);
                      }}
                    >
                      {CHANNEL_LABELS[c.type]}
                    </button>
                  ))}
                </div>
                <button className="sf-cart__back" onClick={() => setStep("cart")}>
                  ← Back to cart
                </button>
              </>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}

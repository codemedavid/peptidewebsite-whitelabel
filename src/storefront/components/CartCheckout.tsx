"use client";

// Cart drawer + checkout. Opens from the header cart button / floating cart FAB.
// Three steps: review the cart, enter contact + shipping details, then pay —
// the customer picks a payment method, sends payment to the shown account / QR,
// and uploads proof of payment. Only then can they hand the order off to a
// messaging channel (WhatsApp / Telegram / Messenger) with a prefilled summary.
// When the store has no payment methods configured, the payment step is skipped
// and the order goes straight to the channel hand-off. The enabled channels and
// payment methods are configured by the store / super admin.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { readImageFile } from "../admin/shared";
import {
  activeChannels,
  activePaymentMethods,
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

type Step = "cart" | "details" | "payment";

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
  const { brand, cart, paymentMethods, addToCart, decrementCart, removeLine, clearCart, toast } = useStore();
  const [step, setStep] = useState<Step>("cart");
  const [customer, setCustomer] = useState<CheckoutCustomer>(EMPTY_CUSTOMER);
  const [touched, setTouched] = useState(false);

  // Payment step state: chosen method, uploaded proof-of-payment image, and a
  // separate "tried to send" flag so we only surface payment errors there.
  const [methodId, setMethodId] = useState("");
  const [proof, setProof] = useState("");
  const [proofName, setProofName] = useState("");
  const [drag, setDrag] = useState(false);
  const [paymentTouched, setPaymentTouched] = useState(false);
  const proofRef = useRef<HTMLInputElement>(null);

  const lines = useMemo(() => cartLines(cart), [cart]);
  const total = useMemo(() => cartTotal(lines), [lines]);
  const channels = useMemo(() => activeChannels(brand), [brand]);
  const payMethods = useMemo(() => activePaymentMethods(paymentMethods), [paymentMethods]);
  const currency = brand.currency || lines[0]?.product.currency || "";

  // The store collects payment up-front only when it has methods configured;
  // otherwise checkout hands off to a channel straight from the details step.
  const requiresPayment = payMethods.length > 0;
  const selectedMethod = payMethods.find((m) => m.id === methodId);
  const paymentValid = !requiresPayment || (!!selectedMethod && !!proof);

  // Reset to the cart step whenever the drawer is (re)opened.
  useEffect(() => {
    if (open) {
      setStep("cart");
      setTouched(false);
      setPaymentTouched(false);
      setMethodId("");
      setProof("");
      setProofName("");
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

  const handleProof = async (file: File | undefined) => {
    try {
      const dataUrl = await readImageFile(file, 4096);
      setProof(dataUrl);
      setProofName(file?.name || "proof");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Image upload failed.");
    }
  };

  function placeOrder(channelType: string) {
    const channel = channels.find((c) => c.type === channelType);
    if (!channel) return;
    const message = buildOrderMessage(
      brand,
      lines,
      customer,
      requiresPayment ? { methodName: selectedMethod?.name ?? "", hasProof: !!proof } : undefined,
    );

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
            {step === "cart"
              ? "Your cart"
              : step === "payment"
                ? "Payment"
                : brand.checkoutTitle || "Complete your order"}
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
          ) : step === "details" ? (
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
          ) : (
            <div className="sf-cart__pay">
              <p className="sf-cart__note">
                Choose a payment method, send your payment, then upload a screenshot of your
                proof of payment. We&apos;ll confirm your order once we receive it.
              </p>

              <div className="sf-cart__pay-methods" role="radiogroup" aria-label="Payment method">
                {payMethods.map((m) => {
                  const active = m.id === methodId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`sf-cart__pay-method ${active ? "is-active" : ""}`}
                      onClick={() => setMethodId(m.id)}
                    >
                      <span className="sf-cart__pay-method-dot" aria-hidden />
                      <span className="sf-cart__pay-method-name">{m.name}</span>
                    </button>
                  );
                })}
              </div>

              {selectedMethod && (
                <div className="sf-cart__pay-detail">
                  <div className="sf-cart__pay-detail-rows">
                    <div>
                      <span className="sf-cart__pay-detail-label">Account name</span>
                      <span className="sf-cart__pay-detail-val">{selectedMethod.account || "—"}</span>
                    </div>
                    <div>
                      <span className="sf-cart__pay-detail-label">Account / number</span>
                      <span className="sf-cart__pay-detail-val">{selectedMethod.number || "—"}</span>
                    </div>
                  </div>
                  {selectedMethod.qrImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="sf-cart__pay-qr" src={selectedMethod.qrImage} alt={`${selectedMethod.name} QR code`} />
                  )}
                </div>
              )}

              <div className="sf-cart__proof">
                <span className="sf-cart__proof-label">
                  Proof of payment<em aria-hidden> *</em>
                </span>
                <div
                  className={`sf-cart__proof-drop ${drag ? "is-dragover" : ""} ${
                    paymentTouched && !proof ? "is-invalid" : ""
                  }`}
                  onClick={() => proofRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    void handleProof(e.dataTransfer.files?.[0]);
                  }}
                >
                  {proof ? (
                    <div className="sf-cart__proof-preview">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={proof} alt="Proof of payment" />
                      <span className="sf-cart__proof-name">{proofName}</span>
                    </div>
                  ) : (
                    <>
                      <span className="sf-cart__proof-title">Click to upload proof of payment</span>
                      <span className="sf-cart__proof-sub">or drag and drop a screenshot</span>
                    </>
                  )}
                  <input
                    ref={proofRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => { void handleProof(e.target.files?.[0]); }}
                  />
                </div>
                {proof && (
                  <button
                    type="button"
                    className="sf-cart__proof-clear"
                    onClick={() => { setProof(""); setProofName(""); }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
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
            ) : step === "details" && requiresPayment ? (
              <>
                {touched && !detailsValid && (
                  <p className="sf-cart__error">Please fill in the required fields.</p>
                )}
                <button
                  className="btn btn-primary sf-cart__cta"
                  onClick={() => {
                    setTouched(true);
                    if (detailsValid) setStep("payment");
                  }}
                >
                  Continue to payment
                </button>
                <button className="sf-cart__back" onClick={() => setStep("cart")}>
                  ← Back to cart
                </button>
              </>
            ) : (
              <>
                {step === "details" && touched && !detailsValid && (
                  <p className="sf-cart__error">Please fill in the required fields.</p>
                )}
                {step === "payment" && paymentTouched && !paymentValid && (
                  <p className="sf-cart__error">
                    {!selectedMethod
                      ? "Please choose a payment method."
                      : "Please upload your proof of payment."}
                  </p>
                )}
                <p className="sf-cart__channels-label">Send your order via</p>
                <div className="sf-cart__channels">
                  {channels.map((c) => (
                    <button
                      key={c.type}
                      className="btn btn-primary sf-cart__channel"
                      onClick={() => {
                        if (step === "details") setTouched(true);
                        if (step === "payment") setPaymentTouched(true);
                        if (detailsValid && paymentValid) placeOrder(c.type);
                      }}
                    >
                      {CHANNEL_LABELS[c.type]}
                    </button>
                  ))}
                </div>
                <button
                  className="sf-cart__back"
                  onClick={() => setStep(step === "payment" ? "details" : "cart")}
                >
                  {step === "payment" ? "← Back to details" : "← Back to cart"}
                </button>
              </>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}

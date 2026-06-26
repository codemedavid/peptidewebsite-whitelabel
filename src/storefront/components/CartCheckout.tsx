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
import type { Order, PromoCode } from "../types";
import { uploadPaymentProofAction, placeStorefrontOrderAction } from "@/actions/orders";
import { activeAdminFee } from "@/lib/storefront/admin-fee";
import { findPromoCode, promoCodeError, promoDiscountAmount, promoLabel } from "@/lib/storefront/promo";
import { checkoutRuleViolations, normalizeCheckoutRules } from "@/lib/storefront/checkout-rules";
import {
  activeChannels,
  activePaymentMethods,
  baseProductId,
  buildOrderMessage,
  cartLines,
  cartTotal,
  channelPrefills,
  channelUrl,
  CHANNEL_LABELS,
  EMPTY_CUSTOMER,
  isResellerQty,
  resellerMinQty,
  resellerTierLabel,
  resellerUnitPrice,
  unitPrice,
  type CheckoutCustomer,
} from "../checkout";

type Step = "cart" | "details" | "payment" | "sent";

const FIELDS: { key: keyof CheckoutCustomer; label: string; required: boolean; type?: string }[] = [
  { key: "name", label: "Full name", required: true },
  { key: "email", label: "Email", required: true, type: "email" },
  { key: "phone", label: "Phone", required: true, type: "tel" },
  { key: "address", label: "Address", required: true },
  { key: "barangay", label: "Barangay", required: true },
  { key: "city", label: "City / Municipality", required: true },
  { key: "province", label: "Province / State", required: true },
  { key: "postal", label: "Postal code", required: false },
];

export function CartCheckout({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { brand, cart, products, paymentMethods, couriers, shippingLocations, promoCodes, setOrders, setMyOrders, addToCart, decrementCart, removeLine, clearCart, toast } = useStore();
  const [step, setStep] = useState<Step>("cart");
  // After an email ("gmail") order is placed we land on the "sent" step, which
  // shows an explicit "Email your order" button. The mailto: link must fire from
  // that button's own tap — a fresh user gesture — because browsers block a mail
  // handler invoked programmatically after the awaited order save.
  const [handoff, setHandoff] = useState<{ url: string; message: string; orderNum: string } | null>(null);
  const [customer, setCustomer] = useState<CheckoutCustomer>(EMPTY_CUSTOMER);
  const [touched, setTouched] = useState(false);
  // Courier + shipping location the customer picks at checkout. The customer
  // chooses a courier first; only that courier's locations are then offered, and
  // the matching fee is added to the total (see the computed values below).
  const [courierId, setCourierId] = useState("");
  const [locationId, setLocationId] = useState("");
  // Discount code the customer typed, and the validated promo it resolved to.
  // `appliedPromo` is null until a valid code is applied; the discount it grants
  // is re-derived server-side at placement (never trusted from here).
  const [discountInput, setDiscountInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<PromoCode | null>(null);
  const [promoError, setPromoError] = useState("");
  // True while the order is being persisted — drives the disabled/"Placing…"
  // button UI. `placingRef` is the SYNCHRONOUS counterpart: React state lags a
  // render, so two clicks in the same tick (fast double-click, or two different
  // channel buttons) would both read a stale `placing===false`; the ref flips
  // immediately and reliably rejects the second one.
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  // A persistent, visible error from the last placement attempt (usually a
  // server validation rejection). Rendered next to the channel buttons — unlike
  // the fleeting toast it survives focus changes / tab switches, so the customer
  // actually sees WHY the hand-off didn't happen instead of just bouncing back.
  const [placeError, setPlaceError] = useState("");
  // Stable idempotency key for one logical order. Kept across a failed attempt
  // so a retry returns the same stored order (server dedupes on it) instead of
  // creating a duplicate; reset on success and when the drawer (re)opens.
  const draftIdRef = useRef<string | null>(null);

  // Payment step state: chosen method, uploaded proof-of-payment image, and a
  // separate "tried to send" flag so we only surface payment errors there.
  const [methodId, setMethodId] = useState("");
  const [proof, setProof] = useState(""); // ImageKit-hosted URL of the uploaded proof
  const [proofName, setProofName] = useState("");
  const [uploadingProof, setUploadingProof] = useState(false);
  const [drag, setDrag] = useState(false);
  const [paymentTouched, setPaymentTouched] = useState(false);
  const proofRef = useRef<HTMLInputElement>(null);

  const lines = useMemo(() => cartLines(cart), [cart]);
  const subtotal = useMemo(() => cartTotal(lines), [lines]);
  const channels = useMemo(() => activeChannels(brand), [brand]);
  const payMethods = useMemo(() => activePaymentMethods(paymentMethods), [paymentMethods]);
  const currency = brand.currency || lines[0]?.product.currency || "";
  // Per-tenant admin fee (super admin toggle, branding.config.adminFee) — a flat
  // charge on top of the items. Displayed here for transparency; the AUTHORITATIVE
  // value is re-stamped server-side at placement from the same config.
  const adminFee = useMemo(() => activeAdminFee(brand.adminFee, subtotal), [brand, subtotal]);

  // Shipping: couriers linked to locations. A courier is offered when it's active
  // AND either it's a COD/no-location courier (Lalamove, Maxim — no location or
  // fee, the customer just pays on delivery) OR it has at least one active
  // location (a fee the customer can pick). When the store has configured none,
  // `shippingEnabled` is false and checkout behaves exactly as before — no
  // selectors, no fee — so unconfigured stores are unaffected.
  const shipCouriers = useMemo(
    () =>
      couriers.filter(
        (c) =>
          c.active &&
          (c.noLocation ||
            shippingLocations.some((l) => l.active && l.courierId === c.id)),
      ),
    [couriers, shippingLocations],
  );
  const shippingEnabled = shipCouriers.length > 0;
  // The active locations belonging to the selected courier.
  const courierLocations = useMemo(
    () => shippingLocations.filter((l) => l.active && l.courierId === courierId),
    [shippingLocations, courierId],
  );
  const selectedCourier = shipCouriers.find((c) => c.id === courierId);
  // A COD/no-location courier needs no location pick and carries no fee.
  const codCourier = selectedCourier?.noLocation === true;
  const selectedLocation = courierLocations.find((l) => l.id === locationId);
  const shippingFee = codCourier ? 0 : selectedLocation?.price ?? 0;
  // Shipping is required to proceed only when the store actually offers it. A COD
  // courier just needs to be picked; a location-based one also needs a location.
  const shippingValid =
    !shippingEnabled || (!!selectedCourier && (codCourier || !!selectedLocation));
  // Tailor the prompt: a courier is always needed; a location only when the
  // chosen courier isn't COD/no-location.
  const shippingError = !selectedCourier
    ? "Please choose a courier."
    : "Please choose a shipping location.";
  // Discount the applied code takes off the items subtotal. Displayed here for
  // transparency; the AUTHORITATIVE amount is re-derived server-side at placement
  // from the same promoCodes config, so a tampered client can't inflate it.
  const discountAmount = useMemo(
    () => promoDiscountAmount(appliedPromo, subtotal),
    [appliedPromo, subtotal],
  );
  // Total never goes below zero — a discount caps at the items subtotal, but a
  // store could in theory configure a fee larger than the cart.
  const total = Math.max(0, subtotal - discountAmount + (adminFee?.amount ?? 0) + shippingFee);

  // Smart Cart & Checkout rules (branding.config.checkoutRules) — the cart
  // restrictions and checkout validations the owner configured, plus their
  // custom copy. Blocking violations stop the checkout here AND are re-checked
  // server-side at placement, so the gate can't be bypassed.
  const rules = useMemo(() => normalizeCheckoutRules(brand.checkoutRules), [brand.checkoutRules]);
  const violations = useMemo(
    () => checkoutRuleViolations(lines, products, brand.checkoutRules),
    [lines, products, brand.checkoutRules],
  );
  const blocked = violations.some((v) => v.blocking);

  // The store collects payment up-front only when it has methods configured;
  // otherwise checkout hands off to a channel straight from the details step.
  const requiresPayment = payMethods.length > 0;
  // The super admin can turn off the mandatory proof-of-payment upload per
  // tenant (brand.requireProofOfPayment). Absent → required (historical default).
  const requiresProof = brand.requireProofOfPayment !== false;
  const selectedMethod = payMethods.find((m) => m.id === methodId);
  const paymentValid =
    !requiresPayment || (!!selectedMethod && (!requiresProof || !!proof));

  // Reset to the cart step whenever the drawer is (re)opened. A fresh open is a
  // new logical order, so clear the idempotency key and the in-flight lock.
  useEffect(() => {
    if (open) {
      setStep("cart");
      setHandoff(null);
      setTouched(false);
      setCourierId("");
      setLocationId("");
      setDiscountInput("");
      setAppliedPromo(null);
      setPromoError("");
      setPaymentTouched(false);
      setMethodId("");
      setProof("");
      setProofName("");
      setUploadingProof(false);
      setPlacing(false);
      setPlaceError("");
      placingRef.current = false;
      draftIdRef.current = null;
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

  // Validate the typed code against the store's promo codes and, if good, apply
  // it. Validity (active, not expired, under its usage limit, min-purchase met)
  // is shared with the server via promoCodeError, so the apply button and the
  // placement agree on whether a code is honored.
  const applyPromo = () => {
    const promo = findPromoCode(promoCodes, discountInput);
    const err = promoCodeError(promo, subtotal, currency);
    if (err || !promo) {
      setAppliedPromo(null);
      setPromoError(err ?? "That code isn't valid.");
      return;
    }
    setAppliedPromo(promo);
    setPromoError("");
  };

  const removePromo = () => {
    setAppliedPromo(null);
    setDiscountInput("");
    setPromoError("");
  };

  // If the cart changes after a code was applied (e.g. items removed so the
  // min-purchase is no longer met), drop the now-invalid code and tell the
  // customer, so the displayed total can never claim a discount the store
  // wouldn't honor.
  useEffect(() => {
    if (appliedPromo && promoCodeError(appliedPromo, subtotal, currency)) {
      setAppliedPromo(null);
      setPromoError("Your discount code no longer applies to this cart.");
    }
  }, [appliedPromo, subtotal, currency]);

  const missing = FIELDS.filter((f) => f.required && !customer[f.key].trim());
  const detailsValid = missing.length === 0;

  // Upload the proof screenshot to the tenant's ImageKit folder as soon as it's
  // picked (mirrors the product-image flow), then keep only the hosted URL —
  // never a base64 blob — so the order row stays small and the image is visible
  // in ImageKit. The order is persisted on hand-off in placeOrder().
  const handleProof = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Please pick an image file.");
      return;
    }
    setUploadingProof(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadPaymentProofAction(fd);
      if ("url" in res) {
        setProof(res.url);
        setProofName(file.name || "proof");
      } else {
        toast(res.error);
      }
    } catch {
      toast("Image upload failed — please try again.");
    } finally {
      setUploadingProof(false);
    }
  };

  async function placeOrder(channelType: string) {
    const channel = channels.find((c) => c.type === channelType);
    // Synchronous lock first (see placingRef note) — rejects a second click in
    // the same tick before any state update or await.
    if (!channel || placingRef.current) return;
    // A blocking Smart Checkout violation (e.g. the cart was edited from
    // another tab after passing the cart step) stops the hand-off — the server
    // would reject it anyway, this just fails before the chat window opens.
    const blocker = violations.find((v) => v.blocking);
    if (blocker) {
      toast(blocker.message);
      return;
    }
    placingRef.current = true;
    setPlacing(true);
    setPlaceError("");

    // One stable idempotency key per logical order, reused across retries so a
    // committed-but-unacknowledged write isn't duplicated on the next attempt.
    const draftId =
      draftIdRef.current ??
      (draftIdRef.current =
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

    // We deliberately do NOT pre-open a chat window here. Pre-opening
    // `about:blank` and navigating it after the awaited persist was unreliable:
    // on mobile the gesture is spent by the time the server responds (the tab
    // can't be navigated), and on desktop a server rejection closed the blank
    // tab and bounced the customer straight back to the store with no idea why.
    // Instead we persist first, then do a top-level navigation (see below) which
    // is never popup-blocked and behaves identically on every device.

    // The order NUMBER is assigned SERVER-SIDE (per tenant); `id` here is the
    // idempotency key the server stores as clientId — not the DB primary key.
    const draft: Order = {
      id: draftId,
      status: "new",
      paymentStatus: requiresPayment && proof ? "paid" : "pending",
      paymentMethod: selectedMethod?.name || "",
      date: new Date().toISOString(),
      customer: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        contactMethod: CHANNEL_LABELS[channel.type],
      },
      shipping: {
        address: customer.address,
        barangay: customer.barangay,
        city: customer.city,
        province: customer.province,
        postal: customer.postal,
        country: "Philippines",
        region: "",
        // The fee this checkout DISPLAYED. The server re-derives the
        // authoritative fee from config by `locationId` (like the admin fee), so
        // a tampered/stale client can't undercharge shipping.
        fee: shippingFee,
        ...(selectedLocation ? { locationId: selectedLocation.id } : {}),
      },
      // Courier the customer chose (its name) — the admin order detail dropdown
      // and tracking both read this. Empty when the store has no shipping set up.
      courier: selectedCourier?.name || "",
      trackingNumber: "",
      shippingNote: "",
      items: lines.map((l) => ({
        // The underlying catalog row id (a variation line carries a composite id),
        // so the server matches stock + checkout rules to the real product.
        productId: baseProductId(l.product),
        name: l.product.name,
        qty: l.qty,
        price: unitPrice(l.product, l.qty),
        ...(l.product.variantName ? { variation: l.product.variantName } : {}),
      })),
      // Echo the fee this checkout DISPLAYED (zero when none was shown). The
      // server never charges this value — it re-stamps the fee from config —
      // but the admin-fee validation rule compares the two and rejects the
      // order when the configured fee changed mid-session, so the customer is
      // never charged a total they didn't see.
      adminFee: { label: adminFee?.label ?? "", amount: adminFee?.amount ?? 0 },
      // The discount this checkout DISPLAYED. The server re-derives the
      // authoritative amount from config.promoCodes by `code` (like the admin
      // fee / shipping), so a tampered/stale client can't inflate it; it's
      // carried only so the server knows which code the customer applied.
      ...(appliedPromo && discountAmount > 0
        ? {
            discount: {
              code: appliedPromo.code,
              label: promoLabel(appliedPromo.code),
              amount: discountAmount,
            },
          }
        : {}),
      paymentProof: proof || null,
    };

    // Persist FIRST and wait for it. We only tell the customer the order is
    // placed once it's actually stored, so a failed write can never silently
    // drop the order (it previously lived only in this browser's localStorage).
    let result: Awaited<ReturnType<typeof placeStorefrontOrderAction>>;
    try {
      result = await placeStorefrontOrderAction(draft);
    } catch {
      result = { error: "Network error — please try again." };
    }

    if (!result || "error" in result) {
      placingRef.current = false;
      setPlacing(false);
      // Keep the cart and the drawer open so the customer can retry — nothing
      // was stored, so nothing is lost. draftIdRef is intentionally kept so the
      // retry carries the same idempotency key (a committed-but-unacknowledged
      // write returns the same order instead of duplicating it).
      const reason = result?.error ?? "please try again.";
      // Persistent banner (survives focus changes) AND a toast — the toast alone
      // was being missed because nothing visibly changed in the drawer.
      setPlaceError(`Couldn't place your order: ${reason}`);
      toast(`Couldn't place your order: ${reason}`);
      return;
    }

    // Reconcile the local tracking copy with the authoritative server order
    // (real per-tenant order number + DB id), so same-browser tracking and the
    // chat message reference the exact stored values.
    const order = result.order;
    const orderNum = order.orderNumber || order.id;
    setOrders((prev) => [order, ...prev.filter((o) => o.id !== order.id)]);
    // Also keep a customer-facing copy so this browser can one-tap track it from
    // the Track page without retyping the order number. Drop the (potentially
    // huge, base64) payment proof — it isn't needed for tracking and would eat
    // localStorage quota / persist PII longer than necessary.
    setMyOrders((prev) => [
      { ...order, paymentProof: null },
      ...prev.filter((o) => o.id !== order.id),
    ]);

    const message = buildOrderMessage(
      brand,
      lines,
      customer,
      requiresPayment ? { methodName: selectedMethod?.name ?? "", hasProof: !!proof } : undefined,
      orderNum,
      // The fee the server actually charged (snapshotted on the stored order),
      // so the chat total can never drift from the persisted one.
      order.adminFee ?? null,
      // Same for shipping — use the server-stamped courier + fee, not the local
      // selection, so the messaged total matches what was persisted.
      { courier: order.courier, fee: order.shipping?.fee ?? 0 },
      // The server-stamped discount (re-derived from config), so the messaged
      // total reflects what was actually persisted, not the local selection.
      order.discount ?? null,
    );

    // Copy the summary as a fallback (Telegram/Messenger can't prefill a DM;
    // WhatsApp carries the text in the link). Best-effort and awaited so the
    // write completes BEFORE we navigate the tab away — otherwise the unload
    // would abort it.
    const url = channelUrl(channel, message);
    if (!channelPrefills(channel.type)) {
      try { await navigator.clipboard?.writeText(message); } catch { /* clipboard denied — link still opens */ }
    }
    clearCart();
    // Success: release the lock and retire this order's idempotency key so the
    // next checkout starts a fresh logical order.
    draftIdRef.current = null;
    placingRef.current = false;
    setPlacing(false);

    // Email handoff (mailto:) can't be auto-fired here — the user-gesture
    // activation is spent by the time the awaited save returns, so browsers
    // block the mail handler. Keep the drawer open on a "sent" step whose button
    // fires the mailto from a fresh tap. The message is also stashed so that
    // screen can offer a copy-to-clipboard fallback.
    if (channel.type === "gmail") {
      toast(`Order ${orderNum} placed — tap to email it`);
      setHandoff({ url, message, orderNum });
      setStep("sent");
      return;
    }

    toast(
      channelPrefills(channel.type)
        ? `Order ${orderNum} placed — opening ${CHANNEL_LABELS[channel.type]}…`
        : `Order ${orderNum} — copied, paste it in ${CHANNEL_LABELS[channel.type]}`,
    );
    onClose();

    // Top-level navigation to the chat channel. Unlike window.open() this is
    // NEVER popup-blocked and works identically on desktop and mobile — the
    // customer is handed straight to WhatsApp / Telegram / Messenger, and the
    // browser Back button returns them to the store. This is the last thing we
    // do so all the state above is committed first.
    if (typeof window !== "undefined") window.location.href = url;
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
          {step === "sent" ? (
            <div className="sf-cart__sent">
              <p className="sf-cart__sent-title">Order {handoff?.orderNum} placed 🎉</p>
              <p className="sf-cart__sent-text">
                Tap <strong>Email your order</strong> below to open your mail app with the
                order details already filled in — just press send to confirm with us.
              </p>
            </div>
          ) : lines.length === 0 ? (
            <p className="sf-cart__empty">Your cart is empty.</p>
          ) : step === "cart" ? (
            <>
            {rules.cartWarning && <p className="sf-cart__notice">{rules.cartWarning}</p>}
            <ul className="sf-cart__lines">
              {lines.map((l) => {
                const cur = l.product.currency || currency;
                const reseller = isResellerQty(l.product, l.qty);
                const up = unitPrice(l.product, l.qty);
                // How many more units of THIS product unlock the wholesale price.
                const toReseller =
                  !reseller && resellerUnitPrice(l.product) != null
                    ? resellerMinQty(l.product) - l.qty
                    : 0;
                return (
                <li key={l.product.id} className="sf-cart__line">
                  <div className="sf-cart__line-info">
                    <span className="sf-cart__line-name">{l.product.name}</span>
                    <span className="sf-cart__line-price">
                      {reseller && (
                        <span className="sf-cart__line-retail">
                          <span className="sf-sr-only">Retail price </span>
                          <s>
                            {cur}
                            {l.product.price.toLocaleString()}
                          </s>
                        </span>
                      )}
                      <span>
                        {reseller && <span className="sf-sr-only">reseller price </span>}
                        {cur}
                        {up.toLocaleString()}
                      </span>
                      {reseller && (
                        <span className="sf-cart__line-reseller">
                          Reseller · {resellerTierLabel(l.product)}
                        </span>
                      )}
                    </span>
                    {toReseller > 0 && (
                      <span className="sf-cart__line-nudge">
                        Add {toReseller} more for the reseller price
                      </span>
                    )}
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
                );
              })}
            </ul>
            </>
          ) : step === "details" ? (
            <form className="sf-cart__form" onSubmit={(e) => e.preventDefault()}>
              {brand.checkoutNote && <p className="sf-cart__note">{brand.checkoutNote}</p>}
              {rules.checkoutNotice && <p className="sf-cart__note">{rules.checkoutNotice}</p>}
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

              {shippingEnabled && (
                <div className="sf-cart__ship">
                  <label className="sf-cart__field">
                    <span>
                      Courier<em aria-hidden> *</em>
                    </span>
                    <select
                      className="sf-cart__select"
                      value={courierId}
                      aria-invalid={touched && !selectedCourier ? true : undefined}
                      onChange={(e) => {
                        // Switching couriers invalidates the prior location pick.
                        setCourierId(e.target.value);
                        setLocationId("");
                      }}
                    >
                      <option value="" disabled>
                        Select a courier…
                      </option>
                      {shipCouriers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {codCourier ? (
                    // COD/no-location courier (Lalamove, Maxim…) — no location to
                    // pick and no shipping fee; the customer pays on delivery.
                    <div className="sf-cart__field sf-cart__ship-cod">
                      <span>Shipping</span>
                      <p className="sf-cart__ship-cod-note">
                        Cash on delivery — no shipping fee collected here.
                      </p>
                    </div>
                  ) : (
                    <label className="sf-cart__field">
                      <span>
                        Shipping location<em aria-hidden> *</em>
                      </span>
                      <select
                        className="sf-cart__select"
                        value={locationId}
                        disabled={!selectedCourier}
                        aria-invalid={
                          touched && !!selectedCourier && !selectedLocation ? true : undefined
                        }
                        onChange={(e) => setLocationId(e.target.value)}
                      >
                        <option value="" disabled>
                          {selectedCourier ? "Select a location…" : "Choose a courier first"}
                        </option>
                        {courierLocations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {/* No per-location fee → just the location name; don't
                                label it "Free" (the store may charge shipping another
                                way, e.g. a flat/admin fee). */}
                            {l.price
                              ? `${l.name} — ${currency}${l.price.toLocaleString()}`
                              : l.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}

              <div className="sf-cart__promo">
                <span className="sf-cart__promo-label">Discount code</span>
                {appliedPromo ? (
                  <div className="sf-cart__promo-applied">
                    <span className="sf-cart__promo-chip">
                      {appliedPromo.code} —{" "}
                      {appliedPromo.type === "percent"
                        ? `${appliedPromo.value}% off`
                        : `${currency}${appliedPromo.value.toLocaleString()} off`}
                    </span>
                    <button
                      type="button"
                      className="sf-cart__promo-remove"
                      onClick={removePromo}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="sf-cart__promo-row">
                    <input
                      type="text"
                      className="sf-cart__promo-input"
                      value={discountInput}
                      placeholder="Enter code"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      aria-invalid={promoError ? true : undefined}
                      onChange={(e) => {
                        setDiscountInput(e.target.value.toUpperCase());
                        if (promoError) setPromoError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyPromo();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="sf-cart__promo-apply"
                      disabled={!discountInput.trim()}
                      onClick={applyPromo}
                    >
                      Apply
                    </button>
                  </div>
                )}
                {promoError && (
                  <p className="sf-cart__promo-error" role="alert">
                    {promoError}
                  </p>
                )}
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
                  Proof of payment
                  {requiresProof ? (
                    <em aria-hidden> *</em>
                  ) : (
                    <span className="sf-cart__proof-optional"> (optional)</span>
                  )}
                </span>
                <div
                  className={`sf-cart__proof-drop ${drag ? "is-dragover" : ""} ${
                    requiresProof && paymentTouched && !proof ? "is-invalid" : ""
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
                  {uploadingProof ? (
                    <>
                      <span className="sf-cart__proof-title">Uploading…</span>
                      <span className="sf-cart__proof-sub">Sending your screenshot</span>
                    </>
                  ) : proof ? (
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

        {(lines.length > 0 || step === "sent") && (
          <footer className="sf-cart__foot">
            {step !== "sent" && (
            <div className="sf-cart__totals">
              {(adminFee || shippingFee > 0 || discountAmount > 0) && (
                <>
                  <div className="sf-cart__total sf-cart__total--sub">
                    <span>Subtotal</span>
                    <span>
                      {currency}
                      {subtotal.toLocaleString()}
                    </span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="sf-cart__total sf-cart__total--sub sf-cart__total--discount">
                      <span>Discount{appliedPromo ? ` · ${appliedPromo.code}` : ""}</span>
                      <span>
                        −{currency}
                        {discountAmount.toLocaleString()}
                      </span>
                    </div>
                  )}
                  {shippingFee > 0 && (
                    <div className="sf-cart__total sf-cart__total--sub">
                      <span>
                        Shipping
                        {selectedLocation ? ` · ${selectedLocation.name}` : ""}
                      </span>
                      <span>
                        {currency}
                        {shippingFee.toLocaleString()}
                      </span>
                    </div>
                  )}
                  {adminFee && (
                    <div className="sf-cart__total sf-cart__total--sub">
                      <span>{adminFee.label}</span>
                      <span>
                        {currency}
                        {adminFee.amount.toLocaleString()}
                      </span>
                    </div>
                  )}
                </>
              )}
              <div className="sf-cart__total">
                <span>Total</span>
                <strong>
                  {currency}
                  {total.toLocaleString()}
                </strong>
              </div>
            </div>
            )}

            {step === "sent" ? (
              <>
                <button
                  className="btn btn-primary sf-cart__cta"
                  onClick={() => {
                    // Fired from this tap (a fresh user gesture) so the browser
                    // doesn't block the mail handler.
                    if (handoff && typeof window !== "undefined") window.location.href = handoff.url;
                  }}
                >
                  Email your order
                </button>
                <button
                  className="sf-cart__back"
                  onClick={async () => {
                    if (!handoff) return;
                    try {
                      await navigator.clipboard?.writeText(handoff.message);
                      toast("Order details copied — paste them into an email");
                    } catch {
                      toast("Couldn't copy — please email us your order number");
                    }
                  }}
                >
                  Copy order details instead
                </button>
                <button className="sf-cart__back" onClick={onClose}>
                  Done
                </button>
              </>
            ) : step === "cart" ? (
              <>
                {violations.length > 0 && (
                  <div className="sf-cart__rules">
                    {violations.map((v) => (
                      <p
                        key={v.rule}
                        className={v.blocking ? "sf-cart__error" : "sf-cart__warn"}
                        role={v.blocking ? "alert" : "status"}
                      >
                        {v.message}
                      </p>
                    ))}
                  </div>
                )}
                <button
                  className="btn btn-primary sf-cart__cta"
                  disabled={blocked}
                  onClick={() => setStep("details")}
                >
                  Checkout
                </button>
              </>
            ) : channels.length === 0 ? (
              <p className="sf-cart__unavailable">
                Online checkout isn&apos;t set up yet — please contact the store directly.
              </p>
            ) : step === "details" && requiresPayment ? (
              <>
                {touched && !detailsValid && (
                  <p className="sf-cart__error">Please fill in the required fields.</p>
                )}
                {touched && detailsValid && !shippingValid && (
                  <p className="sf-cart__error">{shippingError}</p>
                )}
                <button
                  className="btn btn-primary sf-cart__cta"
                  onClick={() => {
                    setTouched(true);
                    if (detailsValid && shippingValid) setStep("payment");
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
                {step === "details" && touched && detailsValid && !shippingValid && (
                  <p className="sf-cart__error">{shippingError}</p>
                )}
                {step === "payment" && paymentTouched && !paymentValid && (
                  <p className="sf-cart__error">
                    {!selectedMethod
                      ? "Please choose a payment method."
                      : "Please upload your proof of payment."}
                  </p>
                )}
                {placeError && (
                  <p className="sf-cart__error" role="alert">
                    {placeError}
                  </p>
                )}
                <p className="sf-cart__channels-label">Send your order via</p>
                <div className="sf-cart__channels">
                  {channels.map((c) => (
                    <button
                      key={c.type}
                      className="btn btn-primary sf-cart__channel"
                      disabled={placing}
                      aria-busy={placing}
                      onClick={() => {
                        if (step === "details") setTouched(true);
                        if (step === "payment") setPaymentTouched(true);
                        if (detailsValid && shippingValid && paymentValid) void placeOrder(c.type);
                      }}
                    >
                      {placing ? "Placing order…" : CHANNEL_LABELS[c.type]}
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

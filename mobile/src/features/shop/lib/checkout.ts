import type {
  PlaceShopOrderRequest,
  ShopCartLine,
  ShopCheckoutConfig,
  ShopCourier,
  ShopGroupBuy,
  ShopQuote,
  ShopQuoteRequest,
  ShopShippingLocation,
} from "@shop-contract";

/**
 * Checkout form rules. Pure. The server repeats every check (and the
 * website's action owns every price and fee); these only decide what the
 * shopper still has to fill in before "Place order" enables.
 */

export type CheckoutForm = {
  name: string;
  email: string;
  phone: string;
  address: string;
  barangay: string;
  city: string;
  province: string;
  postal: string;
  courierId: string;
  locationId: string;
  paymentMethodId: string;
  /** Hosted URL from POST /shop/proof ("" = none yet). */
  proofUrl: string;
  /** The promo the shopper APPLIED (not what's still being typed). */
  promoCode: string;
  customerNote: string;
};

export function emptyForm(prefill: { name?: string; email?: string } = {}): CheckoutForm {
  return {
    name: prefill.name ?? "",
    email: prefill.email ?? "",
    phone: "",
    address: "",
    barangay: "",
    city: "",
    province: "",
    postal: "",
    courierId: "",
    locationId: "",
    paymentMethodId: "",
    proofUrl: "",
    promoCode: "",
    customerNote: "",
  };
}

/** Pre-pick the only choice when there is just one. */
export function withDefaults(form: CheckoutForm, checkout: ShopCheckoutConfig): CheckoutForm {
  const courierId = form.courierId || (checkout.couriers.length === 1 ? checkout.couriers[0].id : "");
  const locs = locationsFor(checkout, courierId);
  const locationId = form.locationId || (locs.length === 1 ? locs[0].id : "");
  const paymentMethodId = form.paymentMethodId || (checkout.paymentMethods.length === 1 ? checkout.paymentMethods[0].id : "");
  return { ...form, courierId, locationId, paymentMethodId };
}

export function courierById(checkout: ShopCheckoutConfig, id: string): ShopCourier | null {
  return checkout.couriers.find((c) => c.id === id) ?? null;
}

export function locationsFor(checkout: ShopCheckoutConfig, courierId: string): ShopShippingLocation[] {
  return checkout.shippingLocations.filter((l) => l.courierId === courierId);
}

/** Picking another courier clears a location that belonged to the old one. */
export function pickCourier(form: CheckoutForm, checkout: ShopCheckoutConfig, courierId: string): CheckoutForm {
  const locs = locationsFor(checkout, courierId);
  const keep = locs.some((l) => l.id === form.locationId);
  return { ...form, courierId, locationId: keep ? form.locationId : locs.length === 1 ? locs[0].id : "" };
}

export function proofRequired(checkout: ShopCheckoutConfig): boolean {
  return checkout.paymentMethods.length > 0 && checkout.requireProofOfPayment;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Is this cart a pay-after-close group-buy order (no payment now, invoice at
 * close)? The server's quote decides once it has answered; until then, guess
 * from the catalog — the live round takes invoices and every line is in it.
 */
export function isPayLater(
  quote: Pick<ShopQuote, "invoice"> | undefined,
  groupBuy: Pick<ShopGroupBuy, "invoice" | "ordering" | "productIds"> | null | undefined,
  lines: readonly Pick<ShopCartLine, "productId">[],
): boolean {
  if (quote) return !!quote.invoice;
  if (!groupBuy?.invoice || groupBuy.ordering !== "open" || lines.length === 0) return false;
  return lines.every((l) => groupBuy.productIds.includes(l.productId));
}

/** The first thing still missing, in form order; null = ready to place. */
export function checkoutError(form: CheckoutForm, checkout: ShopCheckoutConfig, payLater = false): string | null {
  if (!form.name.trim()) return "Please enter your name.";
  if (form.email.trim() && !EMAIL.test(form.email.trim())) return "Please check your email address.";
  if (checkout.couriers.length > 0) {
    const courier = courierById(checkout, form.courierId);
    if (!courier) return "Please choose a courier.";
    if (courier.needsLocation && !locationsFor(checkout, courier.id).some((l) => l.id === form.locationId)) {
      return "Please choose a shipping location.";
    }
  }
  if (!form.address.trim() || !form.city.trim()) return "Please enter your delivery address.";
  if (payLater) return null;
  if (checkout.paymentMethods.length > 0 && !checkout.paymentMethods.some((m) => m.id === form.paymentMethodId)) {
    return "Please choose a payment method.";
  }
  if (proofRequired(checkout) && !form.proofUrl) return "Please upload your proof of payment.";
  return null;
}

/** POST /shop/quote body. `store` only for a signed-out shopper. */
export function quoteRequest(lines: ShopCartLine[], form: Partial<CheckoutForm> | null, store?: string): ShopQuoteRequest {
  const req: ShopQuoteRequest = { lines };
  if (store) req.store = store;
  if (!form) return req;
  if (form.courierId) req.courier = form.courierId;
  if (form.locationId) req.shipping = { locationId: form.locationId };
  if (form.paymentMethodId) req.paymentMethod = form.paymentMethodId;
  if (form.promoCode?.trim()) req.promoCode = form.promoCode.trim();
  return req;
}

/** POST /shop/orders body, carrying the fees the shopper was SHOWN. */
export function orderRequest(
  id: string,
  lines: ShopCartLine[],
  form: CheckoutForm,
  checkout: ShopCheckoutConfig,
  quote: ShopQuote,
  payLater = false,
): PlaceShopOrderRequest {
  const courier = courierById(checkout, form.courierId);
  const trimmedNote = form.customerNote.trim();
  return {
    id,
    lines,
    customer: { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() },
    shipping: {
      address: form.address.trim(),
      barangay: form.barangay.trim(),
      city: form.city.trim(),
      province: form.province.trim(),
      postal: form.postal.trim(),
      ...(courier?.needsLocation && form.locationId ? { locationId: form.locationId } : {}),
    },
    courier: courier?.id ?? "",
    paymentMethod: !payLater && checkout.paymentMethods.length > 0 ? form.paymentMethodId : "",
    ...(!payLater && form.proofUrl ? { paymentProof: form.proofUrl } : {}),
    ...(form.promoCode.trim() ? { promoCode: form.promoCode.trim() } : {}),
    ...(checkout.customerNoteEnabled && trimmedNote ? { customerNote: trimmedNote } : {}),
    shown: { adminFee: quote.adminFee?.amount ?? 0, paymentFee: quote.paymentFee?.amount ?? 0 },
  };
}

/**
 * One idempotency key per checkout attempt (reused on every retry of it). Not
 * a secret — it only lets the server recognise a repeat of the same order.
 */
export function newAttemptId(now: number = Date.now(), rand: () => number = Math.random): string {
  const r = () => Math.floor(rand() * 36 ** 6).toString(36).padStart(6, "0");
  return `app-${now.toString(36)}-${r()}${r()}`;
}

/** Quote lines summed back up (for the "N items" label). */
export function quoteItemCount(quote: Pick<ShopQuote, "items">): number {
  return quote.items.reduce((n, i) => n + i.qty, 0);
}

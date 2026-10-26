import "server-only";

import { placeStorefrontOrderAction, quoteStorefrontOrderAction } from "@/actions/orders";
import { getTenantContext } from "@/lib/tenant/context";
import { gbPaymentModeFor } from "@/lib/storefront/gb-payment-mode";
import type { ApiErrorCode } from "./contract";
import type { OrderItem } from "@/storefront/types";
import type { ShopOrder, ShopQuote } from "./shop-contract";
import { readCheckoutConfig } from "./shop-checkout";
import { asShopper, type ShopStore } from "./shop";
import {
  buildOrderDraft,
  buildOrderItems,
  cleanProofUrl,
  parseLines,
  resolvePaymentMethod,
  resolveShipping,
  toShopOrder,
  type ShippingChoice,
} from "./shop-orders";

/**
 * POST /shop/quote and POST /shop/orders: validate the app's request, build the
 * website's Order payload (shop-orders.ts) and run the website's own action in
 * the shopper scope. Every price/fee/stock/promo rule is the action's; this
 * layer only adds what the website enforces in the browser (a courier and
 * location picked, an active payment method, the proof upload).
 */

type Row = Record<string, unknown>;
export type FlowResult<T> = { ok: true; data: T } | { ok: false; code: ApiErrorCode; message: string };

const invalid = (message: string): FlowResult<never> => ({ ok: false, code: "invalid_input", message });
const text = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});

async function checkoutFor(tenantId: string) {
  const { branding } = await getTenantContext(tenantId);
  return readCheckoutConfig((branding?.config ?? {}) as Row, false);
}

async function itemsFor(store: ShopStore, rawLines: unknown) {
  const lines = parseLines(rawLines);
  if (!lines.ok) return lines;
  return buildOrderItems(store.tenantId, lines.lines);
}

export async function quoteShopOrder(store: ShopStore, body: Row): Promise<FlowResult<ShopQuote>> {
  const items = await itemsFor(store, body.lines);
  if (!items.ok) return invalid(items.message);
  const checkout = await checkoutFor(store.tenantId);
  const shipping = resolveShipping(checkout, body.courier, obj(body.shipping).locationId, false);
  if ("ok" in shipping) return invalid(shipping.message);

  const draft = buildOrderDraft({
    id: "",
    items: items.items,
    shipping,
    // An unknown method is just "no QR PH fee" for a quote; placement refuses it.
    paymentMethod: resolvePaymentMethod(checkout, body.paymentMethod) ?? "",
    paymentProof: null,
    paidUpfront: false,
    promoCode: text(body.promoCode, 64),
    customer: { name: "", email: "", phone: "" },
    customerNote: "",
    shown: null,
  });
  const result = await asShopper(store, () => quoteStorefrontOrderAction(draft));
  return "error" in result ? invalid(result.error) : { ok: true, data: result.quote };
}

/**
 * Will placement treat this cart as a pay-after-close group-buy order? Only
 * pay-after-close stores (gb-payment-mode.ts) pay for the answer, and the answer is the
 * action's own (the quote runs the same validateLiveOrder placement does).
 */
async function isInvoiceCart(store: ShopStore, items: OrderItem[], shipping: ShippingChoice): Promise<boolean> {
  const { branding } = await getTenantContext(store.tenantId);
  if (gbPaymentModeFor(branding?.config) !== "pay_later") return false;
  const draft = buildOrderDraft({
    id: "",
    items,
    shipping,
    paymentMethod: "",
    paymentProof: null,
    paidUpfront: false,
    promoCode: "",
    customer: { name: "", email: "", phone: "" },
    customerNote: "",
    shown: null,
  });
  const quoted = await asShopper(store, () => quoteStorefrontOrderAction(draft));
  return "quote" in quoted && !!quoted.quote.invoice;
}

function readShown(raw: unknown): { adminFee: number; paymentFee: number } | null {
  const s = obj(raw);
  const a = Number(s.adminFee);
  const p = Number(s.paymentFee);
  return Number.isFinite(a) && Number.isFinite(p) && a >= 0 && p >= 0 ? { adminFee: a, paymentFee: p } : null;
}

type Contact = { name: string; email: string; phone: string };

function contactFor(store: ShopStore, raw: unknown): Contact {
  const c = obj(raw);
  const me = store.customer!.customer;
  return {
    name: text(c.name) || me.name,
    email: text(c.email) || me.email,
    phone: text(c.phone, 60) || me.phone,
  };
}

/** What the website's checkout form requires before its button enables. */
function checkoutError(contact: Contact, address: Row): string | null {
  if (!contact.name) return "Please enter your name.";
  if (!text(address.address) || !text(address.city)) return "Please enter your delivery address.";
  return null;
}

export async function placeShopOrder(store: ShopStore, body: Row): Promise<FlowResult<ShopOrder>> {
  const id = text(body.id, 64);
  if (!id) return invalid("Missing order id.");
  const items = await itemsFor(store, body.lines);
  if (!items.ok) return invalid(items.message);

  const checkout = await checkoutFor(store.tenantId);
  const address = obj(body.shipping);
  const shipping = resolveShipping(checkout, body.courier, address.locationId, true);
  if ("ok" in shipping) return invalid(shipping.message);
  // A pay-after-close group-buy cart is paid on the invoice sent at close:
  // no method, no proof now (the action stamps it unpaid either way).
  const payLater = await isInvoiceCart(store, items.items, shipping as ShippingChoice);
  const paymentMethod = payLater ? "" : resolvePaymentMethod(checkout, body.paymentMethod);
  if (paymentMethod === null) return invalid("Please choose a payment method.");
  const paidUpfront = !payLater && checkout.paymentMethods.length > 0;
  const paymentProof = payLater ? null : cleanProofUrl(body.paymentProof);
  if (paidUpfront && checkout.requireProofOfPayment && !paymentProof) {
    return invalid("Please upload your proof of payment.");
  }
  const contact = contactFor(store, body.customer);
  const formError = checkoutError(contact, address);
  if (formError) return invalid(formError);

  const draft = buildOrderDraft({
    id,
    items: items.items,
    shipping: { ...(shipping as ShippingChoice), address },
    paymentMethod,
    paymentProof,
    paidUpfront,
    promoCode: text(body.promoCode, 64),
    customer: contact,
    customerNote: typeof body.customerNote === "string" ? body.customerNote : "",
    shown: readShown(body.shown),
  });
  const result = await asShopper(store, () => placeStorefrontOrderAction(draft));
  return "error" in result ? invalid(result.error) : { ok: true, data: toShopOrder(result.order) };
}

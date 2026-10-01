import "server-only";

import { withTenant } from "@/lib/db/tenant-client";
import { dbProductToStorefront, type DbProductRow } from "@/lib/storefront/product-mapping";
import { buildProductOptions } from "@/lib/storefront/variations";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import { dbOrderToStorefront, type DbOrderRow } from "@/lib/orders/db-mapping";
import { toTrackedOrder } from "@/lib/orders/tracked-order";
import { computeOrderTotals } from "@/storefront/admin/order-detail";
import { cartDisplayName, makeVariationEntry, unitPrice } from "@/storefront/checkout";
import type { Order, OrderItem, Product } from "@/storefront/types";
import type { ShopCheckoutConfig, ShopOrder } from "./shop-contract";

/**
 * Turn the app's cart ({ productId, variation?, qty }) into the SAME Order
 * payload the website checkout (CartCheckout.tsx) sends to
 * placeStorefrontOrderAction / quoteStorefrontOrderAction. Names come from the
 * catalog (cartDisplayName), prices from the cart's unitPrice — and the action
 * re-prices every line regardless, so nothing the phone sends is trusted.
 *
 * Checkout choices (courier, location, payment method) arrive as ids from
 * ShopCatalog.checkout and are resolved to the NAMES the website stores.
 */

type Fail = { ok: false; message: string };
type Row = Record<string, unknown>;

export type ShopLine = { productId: string; variation?: string; qty: number };

const MAX_LINES = 50;
const MAX_QTY = 999;
/** What the admin order view shows as "Contact via" for an app order. */
export const APP_CONTACT_METHOD = "App";

const text = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

function parseLine(raw: unknown): ShopLine | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Row;
  const productId = text(r.productId, 64);
  const variation = text(r.variation, 120);
  const qty = Number(r.qty);
  if (!productId || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return null;
  return variation ? { productId, variation, qty } : { productId, qty };
}

/** Validate and de-duplicate the cart: one line per product + option, like the website cart. */
export function parseLines(input: unknown): { ok: true; lines: ShopLine[] } | Fail {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, message: "Your cart is empty." };
  if (input.length > MAX_LINES) return { ok: false, message: "Your cart has too many items." };
  const parsed = input.map(parseLine);
  if (parsed.some((l) => l === null)) return { ok: false, message: "Your cart has an invalid item." };
  const merged = new Map<string, ShopLine>();
  for (const line of parsed as ShopLine[]) {
    const key = `${line.productId}::${line.variation ?? ""}`;
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, qty: Math.min(MAX_QTY, prev.qty + line.qty) } : line);
  }
  return { ok: true, lines: [...merged.values()] };
}

/** The listed (non-draft, non-archived) catalog rows the lines name — this tenant only. */
async function loadLineProducts(tenantId: string, ids: string[]): Promise<Map<string, Product>> {
  const rows = await withTenant(tenantId, (db) =>
    db.product.findMany({ where: { id: { in: ids }, status: { notIn: ["draft", "archived"] } } }),
  );
  return new Map(rows.map((r) => [r.id, dbProductToStorefront(r as unknown as DbProductRow, "")]));
}

function lineItem(product: Product, line: ShopLine): OrderItem | Fail {
  if (line.variation) {
    const v = (product.variations ?? []).find((x) => x.name === line.variation);
    if (!v) return { ok: false, message: `"${line.variation}" of "${product.name}" is no longer available.` };
    const entry = makeVariationEntry(product, v);
    return { productId: product.id, name: cartDisplayName(entry), qty: line.qty, price: unitPrice(entry, line.qty), variation: v.name };
  }
  const options = buildProductOptions(product);
  if (options.length > 0 && !options.some((o) => !o.variation)) {
    return { ok: false, message: `Choose an option for "${product.name}".` };
  }
  return { productId: product.id, name: cartDisplayName(product), qty: line.qty, price: unitPrice(product, line.qty) };
}

export async function buildOrderItems(tenantId: string, lines: ShopLine[]): Promise<{ ok: true; items: OrderItem[] } | Fail> {
  const products = await loadLineProducts(tenantId, [...new Set(lines.map((l) => l.productId))]);
  const items: OrderItem[] = [];
  for (const line of lines) {
    const product = products.get(line.productId);
    if (!product) return { ok: false, message: "An item in your cart is no longer available. Please remove it." };
    const item = lineItem(product, line);
    if ("ok" in item) return item;
    items.push(item);
  }
  return { ok: true, items };
}

// ── Checkout choices ─────────────────────────────────────────────────────────

export type ShippingChoice = { courier: string; fee: number; locationId?: string };

/**
 * Resolve the courier (+ location) to the name and fee the website sends.
 * `strict` (placement) mirrors CartCheckout's shippingValid; a quote may be
 * asked before anything is picked.
 */
export function resolveShipping(
  checkout: ShopCheckoutConfig,
  courierId: unknown,
  locationId: unknown,
  strict: boolean,
): ShippingChoice | Fail {
  const id = text(courierId, 64);
  const courier = checkout.couriers.find((c) => c.id === id);
  if (!courier) {
    if (id || (strict && checkout.couriers.length > 0)) return { ok: false, message: "Please choose a courier." };
    return { courier: "", fee: 0 };
  }
  if (!courier.needsLocation) return { courier: courier.name, fee: 0 };
  const loc = checkout.shippingLocations.find((l) => l.id === text(locationId, 64) && l.courierId === courier.id);
  if (!loc) {
    return strict ? { ok: false, message: "Please choose a shipping location." } : { courier: courier.name, fee: 0 };
  }
  return { courier: courier.name, fee: loc.fee ?? 0, locationId: loc.id };
}

/** An active method by id (or exact name); "" when the store lists none. */
export function resolvePaymentMethod(checkout: ShopCheckoutConfig, raw: unknown): string | null {
  if (checkout.paymentMethods.length === 0) return "";
  const v = text(raw, 120);
  const method = checkout.paymentMethods.find((m) => m.id === v || m.name === v);
  return method ? method.name : null;
}

/** A proof URL from POST /shop/proof: hosted https, or the inline image
 *  fallback uploadPaymentProofAction returns when ImageKit isn't configured. */
export function cleanProofUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 12_000_000) return null;
  return /^https:\/\/\S+$/.test(raw) || raw.startsWith("data:image/") ? raw : null;
}

// ── Payload ──────────────────────────────────────────────────────────────────

export type DraftInput = {
  id: string;
  items: OrderItem[];
  shipping: ShippingChoice & { address?: Row };
  paymentMethod: string;
  paymentProof: string | null;
  paidUpfront: boolean;
  promoCode: string;
  customer: { name: string; email: string; phone: string };
  customerNote: string;
  shown: { adminFee: number; paymentFee: number } | null;
};

/** The website checkout's Order draft (CartCheckout.tsx → placeStorefrontOrderAction). */
export function buildOrderDraft(d: DraftInput): Record<string, unknown> {
  const a = d.shipping.address ?? {};
  return {
    id: d.id,
    status: "new",
    paymentStatus: d.paidUpfront && d.paymentProof ? "paid" : "pending",
    paymentMethod: d.paymentMethod,
    date: new Date().toISOString(),
    customer: { ...d.customer, contactMethod: APP_CONTACT_METHOD },
    shipping: {
      address: text(a.address, 400),
      barangay: text(a.barangay, 120),
      city: text(a.city, 120),
      province: text(a.province, 120),
      postal: text(a.postal, 40),
      country: "Philippines",
      region: "",
      fee: d.shipping.fee,
      ...(d.shipping.locationId ? { locationId: d.shipping.locationId } : {}),
    },
    courier: d.shipping.courier,
    trackingNumber: "",
    shippingNote: "",
    customerNote: d.customerNote,
    items: d.items,
    // Echoed only when the app showed a quote, so the server can refuse an
    // order whose fees rose since (the website's admin-fee / QR PH checks).
    ...(d.shown
      ? {
          adminFee: { label: "", amount: d.shown.adminFee },
          paymentFee: { label: "", amount: d.shown.paymentFee },
        }
      : {}),
    // Only the CODE matters: the action re-derives the amount from the store's
    // promo codes (stampDiscount) and refuses an invalid one. The normalizer
    // drops a zero-amount discount, hence the placeholder 1.
    ...(d.promoCode ? { discount: { code: d.promoCode, label: "", amount: 1 } } : {}),
    paymentProof: d.paymentProof,
  };
}

// ── My orders ────────────────────────────────────────────────────────────────

export function toShopOrder(o: Order): ShopOrder {
  const { date, ...tracked } = toTrackedOrder(o);
  return { ...tracked, placedAt: date, paymentStatus: o.paymentStatus, total: computeOrderTotals(o).total };
}

/** The customer's own orders, newest first — listMyOrdersAction's query. */
export async function listShopOrders(tenantId: string, customerId: string): Promise<ShopOrder[]> {
  const rows = await withTenant(tenantId, (db) =>
    db.storefrontOrder.findMany({
      where: { ...ACTIVE_ORDERS_WHERE, customerAccountId: customerId },
      orderBy: { placedAt: "desc" },
      take: 100,
    }),
  );
  return rows.map((r) => toShopOrder(dbOrderToStorefront(r as DbOrderRow)));
}

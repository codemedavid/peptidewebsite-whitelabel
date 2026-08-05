// The view-model behind the "Order Confirmed" review screen — everything the
// customer checks over before they tap through to WhatsApp / Viber / Messenger.
//
// The one rule this module exists to enforce: the review screen is built from
// the STORED order, never from the local cart. At placement the server re-derives
// prices (authoritativeItemPrice), the shipping fee by locationId, the admin fee
// from config and any discount from config.promoCodes — so a screen rebuilt out
// of client state could quote the customer a total the store will not honor. By
// taking the persisted order as its only numeric source, what the customer
// reviews, what the chat message says, and what the seller has on file are the
// same three numbers by construction.
//
// Pure (no DB, no React) so the page and the tests resolve identically —
// npm run test:order-confirmation.

/** The persisted order, narrowed to what the review screen reads. Structural, so
 *  the storefront `Order` type satisfies it without a cast. */
export interface ConfirmationOrder {
  id: string;
  /** Server-assigned, per tenant. Empty on the rare order that never got one. */
  orderNumber?: string;
  date?: string;
  paymentMethod?: string;
  courier?: string;
  customer: { name: string; email: string; phone: string };
  shipping: {
    address: string;
    barangay?: string;
    city?: string;
    province?: string;
    postal?: string;
    fee?: number;
  };
  items: {
    productId?: string;
    name: string;
    qty: number;
    price: number;
    variation?: string;
  }[];
  adminFee?: { label: string; amount: number } | null;
  discount?: { code?: string; label: string; amount: number } | null;
}

/** The catalog rows the item table joins against, for purity. */
export interface ConfirmationCatalogProduct {
  id: string;
  name: string;
  purity?: string;
}

export interface ConfirmationItem {
  name: string;
  /** The chosen option ("5mg"), or "" when the line had none. */
  variation: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  /** Joined from the catalog; "" when unknown or not recorded. */
  purity: string;
}

export interface OrderConfirmation {
  /** What the customer quotes to support — the order number, else the id. */
  reference: string;
  date: string;
  paymentMethod: string;
  currency: string;
  customer: { name: string; email: string; phone: string };
  shipping: { address: string; courier: string };
  items: ConfirmationItem[];
  totals: {
    subtotal: number;
    discount: number;
    discountCode: string;
    shipping: number;
    fee: number;
    feeLabel: string;
    total: number;
  };
}

/** Blank contact/courier fields render as a dash — an empty cell reads as a bug,
 *  and "undefined" reads worse. */
const DASH = "—";
const orDash = (v: string | undefined): string => (v && v.trim() ? v.trim() : DASH);

const money = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Build the review screen's data from a stored order.
 *
 * `catalog` is only ever consulted for purity — never for price. Re-pricing here
 * would reintroduce exactly the drift this screen exists to rule out: a catalog
 * edited between placement and review would show the customer a different total
 * than the one on their order.
 */
export function buildOrderConfirmation(
  order: ConfirmationOrder,
  catalog: readonly ConfirmationCatalogProduct[],
  opts: { currency?: string } = {},
): OrderConfirmation {
  const items: ConfirmationItem[] = order.items.map((item) => {
    // Match the way every other server-side lookup does it: by productId, else
    // by exact name for legacy lines that predate productId stamping.
    const live = catalog.find((p) =>
      item.productId ? p.id === item.productId : p.name === item.name,
    );
    const qty = Math.max(0, Math.round(money(item.qty)));
    const unitPrice = money(item.price);
    return {
      name: item.name,
      variation: item.variation ?? "",
      qty,
      unitPrice,
      lineTotal: unitPrice * qty,
      // Purity is a data column: unknown stays EMPTY rather than becoming a
      // dash, so a product that simply has none recorded doesn't read as
      // "purity: —" next to one that does.
      purity: live?.purity ?? "",
    };
  });

  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const discount = Math.max(0, money(order.discount?.amount));
  const shipping = Math.max(0, money(order.shipping?.fee));
  const fee = Math.max(0, money(order.adminFee?.amount));
  // Floored at zero, matching buildOrderMessage — an over-large discount must
  // never show the customer a negative amount due.
  const total = Math.max(0, subtotal - discount + shipping + fee);

  const address = [
    order.shipping.address,
    order.shipping.barangay,
    order.shipping.city,
    order.shipping.province,
    order.shipping.postal,
  ]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(", ");

  return {
    reference: order.orderNumber?.trim() || order.id,
    date: order.date ?? "",
    paymentMethod: orDash(order.paymentMethod),
    currency: opts.currency ?? "",
    customer: {
      name: orDash(order.customer?.name),
      email: orDash(order.customer?.email),
      phone: orDash(order.customer?.phone),
    },
    shipping: { address: address || DASH, courier: orDash(order.courier) },
    items,
    totals: {
      subtotal,
      discount,
      discountCode: order.discount?.code ?? "",
      shipping,
      fee,
      feeLabel: order.adminFee?.label ?? "",
      total,
    },
  };
}

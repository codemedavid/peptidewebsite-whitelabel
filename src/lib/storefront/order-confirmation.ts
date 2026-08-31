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

/** Where the checkout leaves the pre-built chat message for the confirmation
 *  page. sessionStorage, so it survives a reload of that page but never outlives
 *  the tab. Lives here (not on the page) so the drawer can write it without
 *  importing a page component. */
export const CONFIRM_HANDOFF_KEY = "sf_confirm";

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
  /** The buyer's own note from checkout. Shown back to them here so a typo in a
   *  delivery instruction is discoverable before the order is handed off. */
  customerNote?: string;
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
    note: (order.customerNote ?? "").trim(),
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

/**
 * The reviewed order as one pasteable block of text.
 *
 * Only WhatsApp and Gmail carry a prefilled body; Telegram, Messenger and
 * Instagram open an empty compose box, and even a prefilling channel can land
 * empty (an in-app browser that drops the query string, a link opened in the
 * wrong app). When that happens the customer's only recourse used to be
 * retyping the order — so the confirmation screen offers this text on a button.
 *
 * Built from the already-built VIEW, not from the order, so the pasted message
 * and the table the customer just read are the same numbers by construction.
 * The layout deliberately mirrors `buildOrderMessage` in storefront/checkout.ts
 * — the seller should not be able to tell whether a message was prefilled or
 * pasted.
 */
export function formatOrderMessage(
  view: OrderConfirmation,
  opts: { brandName?: string } = {},
): string {
  const amount = (n: number) => `${view.currency}${n.toLocaleString()}`;
  // The view renders missing values as a dash, which is right for a table. In a
  // chat message "Shipping (—)" reads as a glitch, so absent means absent here.
  const present = (v: string) => (v && v !== DASH ? v : "");

  const brandName = opts.brandName?.trim();
  const header = `Order #${view.reference}${brandName ? ` — ${brandName}` : ""}`;

  const items = view.items.map((item) => {
    const option = item.variation.trim();
    // The cart stamps the chosen option into the stored line name at placement
    // ("Semaglutide — 5mg"), so appending it again would print the size twice.
    // Only spell it out when the name doesn't already carry it.
    const label = option && !item.name.includes(option) ? `${item.name} (${option})` : item.name;
    return `• ${label} ×${item.qty} — ${amount(item.lineTotal)}`;
  });

  const { subtotal, discount, discountCode, shipping, fee, feeLabel, total } = view.totals;
  const courier = present(view.shipping.courier);
  // Show the arithmetic only when something moved the total off the subtotal —
  // otherwise a simple order reads as a wall of identical figures.
  const totals =
    discount > 0 || shipping > 0 || fee > 0
      ? [
          `Subtotal: ${amount(subtotal)}`,
          ...(discount > 0
            ? [`Discount${discountCode ? ` (${discountCode})` : ""}: -${amount(discount)}`]
            : []),
          ...(shipping > 0
            ? [`Shipping${courier ? ` (${courier})` : ""}: ${amount(shipping)}`]
            : []),
          ...(fee > 0 ? [`${feeLabel || "Fee"}: ${amount(fee)}`] : []),
          `Total: ${amount(total)}`,
        ]
      : [`Total: ${amount(total)}`];

  return [
    header,
    "",
    "Items:",
    ...items,
    "",
    ...totals,
    "",
    "Customer:",
    `Name: ${view.customer.name}`,
    `Email: ${view.customer.email}`,
    `Phone: ${view.customer.phone}`,
    `Ship to: ${view.shipping.address}`,
    `Payment: ${view.paymentMethod}`,
    // Mirrors buildOrderMessage's block so a pasted message and a prefilled one
    // are indistinguishable to the seller.
    ...(view.note ? ["", "Customer note:", view.note] : []),
  ].join("\n");
}

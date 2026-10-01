// The Pepweb app's in-app SHOP contract — /api/mobile/v1/shop/*.
// Design: docs/mobile-admin/SHOP.md.
//
// TYPES ONLY, zero imports — same rule as contract.ts: the Expo app imports
// this file with `import type` through the `@shop-contract` tsconfig path, so a
// runtime import here would break the app's build. Errors use contract.ts's
// { ok: false, error: { code, message } } envelope.
//
// Every price, fee and total here is computed by the WEBSITE's own code on the
// server. The app displays them; it never derives a price itself.

// ── Catalog (GET /shop/catalog?store=) ───────────────────────────────────────

export type ShopVariation = {
  name: string;
  /** Unit price for qty 1 — what the website cart charges for this option. */
  price: number;
  /** Struck-through figure when this option is marked down, else null. */
  compareAtPrice: number | null;
  /** Units left; null = not stock-limited (made to order). */
  stock: number | null;
  image: string | null;
};

export type ShopProduct = {
  id: string;
  name: string;
  /** A ShopCategory id, or "" when unassigned. */
  category: string;
  description: string;
  image: string | null;
  extraImages: string[];
  /** Unit price for qty 1 of the base option, sale / live group-buy price applied. */
  price: number;
  compareAtPrice: number | null;
  /** Units left; null = not stock-limited (made to order). */
  stock: number | null;
  /** False = listed but not buyable now (paused, price on request, sold out,
   *  held for a group buy, or the store is closed). */
  purchasable: boolean;
  /** Short label for the card ("25% off", "Made to order", "Sold out"…). */
  badge?: string;
  /** Sold at the live group-buy round's price (a pre-order). */
  isGroupBuy: boolean;
  /** Can be bought WITHOUT choosing a variation (no variations, or the base
   *  price is offered as its own "Standard" option). */
  baseSelectable: boolean;
  variations: ShopVariation[];
};

export type ShopCategory = { id: string; label: string };

export type ShopPaymentMethod = {
  id: string;
  name: string;
  account: string;
  number: string;
  qrImage: string;
  /** Tagged QR PH: a processing fee is added (shown by the quote). */
  qrph: boolean;
};

export type ShopCourier = {
  id: string;
  name: string;
  /** True = pick one of this courier's shippingLocations; false = cash on
   *  delivery, no location, no fee. */
  needsLocation: boolean;
};

export type ShopShippingLocation = {
  id: string;
  courierId: string;
  name: string;
  /** Fee before any free-shipping product waiver; null = no per-location fee. */
  fee: number | null;
};

export type ShopCheckoutConfig = {
  /** Active methods, in the owner's order. Empty = the store takes no upfront payment. */
  paymentMethods: ShopPaymentMethod[];
  /** When true AND paymentMethods is non-empty, placing an order needs a proof upload. */
  requireProofOfPayment: boolean;
  /** Active couriers that can actually ship (COD, or with an active location). */
  couriers: ShopCourier[];
  shippingLocations: ShopShippingLocation[];
  /** The owner's checkout note / heading ("" when unset). */
  note: string;
  title: string;
  customerNoteEnabled: boolean;
  customerNoteLabel: string;
};

export type ShopCatalog = {
  store: { slug: string; name: string; logoUrl: string | null; currency: string };
  /** False = the owner closed the shop: browse only, every order is refused. */
  open: boolean;
  /** The owner's closed-shop copy ("" when open). */
  closedMessage: string;
  /** Always false — a private store answers `forbidden` to signed-out callers instead. */
  private: false;
  categories: ShopCategory[];
  products: ShopProduct[];
  checkout: ShopCheckoutConfig;
};

// ── Cart, quote, place ───────────────────────────────────────────────────────

export type ShopCartLine = {
  productId: string;
  /** The variation NAME; omit for the base option. */
  variation?: string;
  qty: number;
};

export type ShopShippingAddress = {
  address: string;
  barangay: string;
  city: string;
  province: string;
  postal: string;
  /** A ShopShippingLocation id — required when the courier needsLocation. */
  locationId?: string;
};

/** POST /shop/quote. `store` is only read for a signed-out caller. */
export type ShopQuoteRequest = {
  store?: string;
  lines: ShopCartLine[];
  /** A ShopCourier id. */
  courier?: string;
  shipping?: { locationId?: string };
  /** A ShopPaymentMethod id (decides the QR PH fee). */
  paymentMethod?: string;
  promoCode?: string;
};

export type ShopOrderItem = {
  name: string;
  qty: number;
  /** Server-authoritative unit price. */
  price: number;
  productId?: string;
  variation?: string;
};

export type ShopFee = { label: string; amount: number };

export type ShopQuote = {
  items: ShopOrderItem[];
  subtotal: number;
  shippingFee: number;
  courier: string;
  adminFee: ShopFee | null;
  paymentFee: ShopFee | null;
  discount: { code: string; label: string; amount: number } | null;
  total: number;
};

/** POST /shop/orders (customer session). Retrying with the same `id` returns
 *  the already-placed order instead of placing a second one. */
export type PlaceShopOrderRequest = {
  /** Client idempotency key — one per logical checkout, reused on retry. */
  id: string;
  lines: ShopCartLine[];
  /** Blank fields default to the signed-in account's details. */
  customer?: { name?: string; email?: string; phone?: string };
  shipping: ShopShippingAddress;
  /** A ShopCourier id ("" when the store ships nothing). */
  courier: string;
  /** A ShopPaymentMethod id ("" when the store lists none). */
  paymentMethod: string;
  /** URL from POST /shop/proof. */
  paymentProof?: string;
  promoCode?: string;
  customerNote?: string;
  /** The fees the checkout SHOWED (from the quote). When sent, the server
   *  refuses an order whose fees rose since, instead of charging more. */
  shown?: { adminFee: number; paymentFee: number };
};

export type ShopOrderStatus =
  | "new"
  | "confirmed"
  | "processing"
  | "ready"
  | "shipped"
  | "delivered"
  | "cancelled";

/** A shopper's view of their order — no PII, no proof of payment. */
export type ShopOrder = {
  orderNumber: string;
  status: ShopOrderStatus;
  /** ISO. */
  placedAt: string;
  courier: string;
  trackingNumber: string;
  shippingNote: string;
  items: ShopOrderItem[];
  shippingFee: number;
  adminFee: ShopFee | null;
  paymentFee: ShopFee | null;
  discount: { code: string; label: string; amount: number } | null;
  statusHistory: { status: ShopOrderStatus; at: string }[];
  paymentStatus: "pending" | "paid";
  total: number;
};

export type PlaceShopOrderResponse = { order: ShopOrder };
export type ShopOrdersResponse = { orders: ShopOrder[] };
/** POST /shop/proof, multipart `file` (image ≤ 10 MB). */
export type ShopProofResponse = { url: string };

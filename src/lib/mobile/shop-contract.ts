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

/**
 * The live group-buy round, as the website's group-buy page shows it. Absent
 * (null) with no live round, when the owner HID the group-buy way, or when no
 * listed product is in the round. Prices still come from each ShopProduct —
 * this only frames them.
 */
export type ShopGroupBuy = {
  id: string;
  /** The owner's label — "GB #5", "Holiday Round". */
  name: string;
  description: string;
  /** Customer-facing, e.g. "3–4 weeks after close" ("" when unset). */
  deliveryEta: string;
  /** ISO close boundary; null = open-ended. */
  endsAt: string | null;
  /** "closed" = the owner paused ordering: browse the round, buy nothing. */
  ordering: "open" | "closed";
  /** Progress-bar goal; 0 = no bar. */
  slotGoal: number;
  /** Slots taken so far (the round's live orders). */
  filled: number;
  /** Listed products in the round, catalog order. */
  productIds: string[];
  /** Lowest price across the round's products and options; null when none. */
  fromPrice: number | null;
  /** Up to four product photos, for the banner's stack. */
  images: string[];
  /** "How group buys work" — the owner's copy, {eta} already filled in. */
  howTitle: string;
  steps: string[];
  terms: string;
  /**
   * The strip pinned above the customer app's tab bar while the round is live
   * — the owner's text (branding.config.groupBuyLiveBanner) with blanks filled
   * from the round. null = the owner switched the strip off.
   */
  liveBanner: ShopGroupBuyLiveBanner | null;
  /**
   * Pay after the round closes (branding.config.groupBuyInvoice): checkout
   * takes no payment, adds `shippingFee` once per customer per round, and the
   * invoice arrives in chat at close. null/absent = pay at checkout as usual.
   */
  invoice?: { shippingFee: number } | null;
};

export type ShopGroupBuyLiveBanner = {
  headline: string;
  message: string;
  ctaLabel: string;
};

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
  /** The live group-buy round, or null. Older servers omit it. */
  groupBuy?: ShopGroupBuy | null;
  /** Paid group-buy access: set only when this shopper is locked out of the
   *  store's governing round. `groupBuy` is then null and the round's products
   *  and group-buy prices are absent from `products`. */
  groupBuyTeaser?: ShopGroupBuyTeaser | null;
};

/** Paid Access (src/modules/paid-access): the customer's way into a gated round — ONE
 *  shape for the website (#groupbuy) and the app (GET/POST
 *  /shop/group-buy/join). Declared here, not imported, because the Expo app
 *  compiles this file; the module's actions map its JoinState onto it, so a
 *  type error there means the two drifted. Every rule is decided server-side;
 *  clients only render `stepper` and offer `stepper.action`. */
export type GroupBuyStepper = {
  steps: { key: "form" | "payment" | "approval"; label: string; state: "done" | "current" | "upcoming" }[];
  /** 1-based position of the current step; null when not inside a step. */
  position: number | null;
  total: number;
  /** e.g. "Step 2 of 3: Waiting for admin approval". */
  headline: string;
  detail: string;
  tone: "neutral" | "pending" | "success" | "danger";
  action: { kind: "join" | "fill_form" | "pay"; label: string } | null;
  /** The last stop's name ("Access", or the store's own). Absent from older servers. */
  accessLabel?: string;
};

export type GroupBuyJoinQuestion = { id: string; label: string; kind: "short" | "long" | "choice"; required: boolean; options: string[] };

export type GroupBuyJoinState = {
  groupBuyId: string;
  roundName: string;
  /** false = Open: no join needed, everyone has access. */
  gated: boolean;
  status: string | null;
  canAccess: boolean;
  membershipId: string | null;
  stepper: GroupBuyStepper;
  /** Centavos — the member's own (snapshot) price. */
  amountCents: number;
  amountLabel: string;
  amountMode: "full" | "deposit";
  paymentOptions: { manual: boolean; online: boolean };
  /** Where to send a manual payment — the store's checkout payment methods. */
  paymentAccounts: ShopPaymentMethod[];
  /** The application form, while it is the member's step. */
  formQuestions: GroupBuyJoinQuestion[];
  /** ISO — when an unpaid slot is released. */
  holdExpiresAt: string | null;
  window: { open: boolean; opensAt: string | null; closesAt: string | null; message: string };
  capacity: { maxSlots: number | null; slotsTaken: number; waitlist: boolean };
  /** The member's latest manual proof (the image itself never rides here). */
  proof: { reference: string; method: string; submittedAt: string | null; hasReceipt: boolean; rejectReason: string } | null;
  reviewReason: string;
  refundStatus: string;
  canJoin: boolean;
  visibility: "nothing" | "summary";
};

export type GroupBuyJoinErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "closed"
  | "full"
  | "unavailable"
  | "rate_limited"
  | "server_error";

export type GroupBuyJoinResult =
  | { ok: true; state: GroupBuyJoinState; checkout?: { url: string; ref: string } }
  | { ok: false; code: GroupBuyJoinErrorCode; message: string };

/** What a viewer who isn't in a gated round is told about it (built by
 *  lib/storefront/gb-access) — never its products or prices. */
export type ShopGroupBuyTeaser = {
  id: string;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  state: "upcoming" | "live" | "closed";
  /** The round's "what pending members may see" setting. */
  visibility: "nothing" | "summary";
  /** Only with visibility "summary". */
  summary: { description: string; deliveryEta: string; productCount: number; maxSlots: number | null; slotsTaken: number } | null;
  /** The way in, in order, e.g. ["Pay ₱500", "Admin approval", "Access"]. */
  steps: string[];
  /** Centavos a newcomer pays (0 = free). */
  joinFeeCents: number;
  amountLabel: string;
  /** The viewer's own membership on this round; null = none (or anonymous). */
  membership: { status: string; reviewReason: string; headline: string } | null;
  /** The store's own join-page words; "" (or absent) = the built-in wording. */
  copy?: ShopGroupBuyTeaserCopy;
};

export type ShopGroupBuyTeaserCopy = { intro: string; button: string; note: string };

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
  /**
   * Set when this cart is a pay-after-close group-buy order: no payment now,
   * the invoice comes at close. `addOn` = the shopper already ordered in this
   * round, so this joins that invoice and shippingFee is 0. Older servers omit it.
   */
  invoice?: { addOn: boolean; roundName: string } | null;
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
  /** The group-buy round it was placed in (null = an on-hand order). */
  groupBuyId: string | null;
  /** The round's name when the order was placed. */
  groupBuyName: string | null;
};

/** A round the shopper has orders in — the My orders section header. */
export type ShopOrderRound = {
  id: string;
  name: string;
  /** Owner's batch label, "" when unset. */
  batch: string;
  state: "live" | "upcoming" | "closed";
  /** Customer-facing ETA, e.g. "3–4 weeks after close"; "" when unset. */
  deliveryEta: string;
  /** ISO — scheduled close while live, actual close once closed. */
  endsAt: string | null;
  closedAt: string | null;
};

export type PlaceShopOrderResponse = { order: ShopOrder };
export type ShopOrdersResponse = { orders: ShopOrder[]; rounds: ShopOrderRound[] };
/** POST /shop/proof, multipart `file` (image ≤ 10 MB). */
export type ShopProofResponse = { url: string };

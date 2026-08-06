// Domain types for the white-label storefront + its admin.
// Ported from the Claude Design handoff bundle (window.PRODUCTS, CATEGORIES, …).

import type { HeroTextField, HeroFieldStyle } from "@/lib/theme/tokens";
import type { CheckoutRulesConfig } from "@/lib/storefront/checkout-rules";
import type { StorefrontBanner } from "@/lib/storefront/banner";
import type { HeroMedia } from "@/lib/storefront/hero-media";
import type { GroupBuyRules } from "@/lib/storefront/group-buy-rules";
import type { TwoWaysMode } from "@/lib/storefront/two-ways-mode";
import type { StoreStatus } from "@/lib/storefront/store-status";
import type { ProductClass } from "@/lib/storefront/product-class";
import type { SortCategory } from "@/lib/storefront/sort-categories";
import type { NoticeModalConfig } from "@/lib/storefront/notice-modal";
import type { TrackNoteConfig } from "@/lib/storefront/track-note";
import type { BrandTrial } from "@/lib/trial/trial-state";
import type { BrandSubscription } from "@/lib/subscription/subscription-state";
import type { FeatureSpotlight } from "@/lib/features/feature-spotlight";
import type {
  GroupBuyCapabilities,
  GroupBuySettings,
  GroupBuyStorefrontGate,
} from "@/lib/storefront/group-buy";
import type { GroupBuyBanner } from "@/lib/storefront/group-buy-banner";
import type { GroupBuyContent } from "@/lib/storefront/gb-content";
import type { CardDesign, CardTemplate } from "./cardDesign";

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  purity?: string;
  category: string;
  /** The admin-managed SORT category this product belongs to (a `group` entry in
   *  branding.config.sortCategories). Distinct from `category`, which is the
   *  storefront's filter chip. Absent = unassigned: the product still shows,
   *  just after every assigned block. Stored in `metadata.sortCategory`. */
  sortCategory?: string;
  /** Pins the product to the very top of the catalog (and badges it). */
  featured: boolean;
  /** ISO timestamp of the catalog row, so the "New Arrivals" sort has real data
   *  to rank by. Absent on demo/seed products → those sort last. */
  createdAt?: string;
  image: string | null;
  stock?: number;
  available?: boolean;
  discountPrice?: number | null;
  discountEnabled?: boolean;
  isSet?: boolean;
  inclusions?: { name: string; qty: number }[];
  molecularWeight?: string;
  cas?: string;
  storage?: string;
  sequence?: string;
  sizes?: string;
  /** Per-product variations (e.g. dosage/size options like "5mg", "10mg"), each
   *  with its own price in the storefront's major units. Empty/absent = the
   *  product is sold as a single option at the base `price`. Stored in
   *  `metadata.variations`; the admin Products screen edits these.
   *
   *  `stock` is optional per variation: a number tracks that option's own
   *  inventory; absent falls back to the base product `stock`. See
   *  effectiveStock in lib/storefront/inventory.ts.
   *
   *  `gbPrice` is optional per variation and works the same opt-in way: it is
   *  what THIS option costs inside a live group-buy round. It exists because the
   *  product-level `gbPrice` is a single number, so a multi-size listing had no
   *  way to price each size in a round — every option was charged the base
   *  option's group price. Absent means "no group price for this option", and
   *  the option sells at its own `price`; it deliberately does NOT fall back to
   *  the product's `gbPrice`, which would undercharge every larger size. See
   *  makeVariationEntry in storefront/checkout.ts. */
  variations?: { name: string; price: number; stock?: number; gbPrice?: number }[];
  /** Set on a CART ENTRY that represents a chosen variation (a catalog product
   *  is cloned with the variation's price + a composite `id`). `variantOf` is the
   *  underlying catalog product id — used so the shared product stock is counted
   *  correctly and the order's stock deduction matches the real row. `variantName`
   *  is the chosen option label. Both absent on catalog products. */
  variantOf?: string;
  variantName?: string;
  /** Wholesale / reseller pricing tier. Both price legs optional — "vials only" =
   *  peptide + bac water; "complete set" = with syringes/swabs. `minQty` is the
   *  per-product minimum order that unlocks the wholesale price; unset falls back
   *  to the global RESELLER_MIN_QTY default. */
  reseller?: { vialsOnly?: number; completeSet?: number; minQty?: number };
  /** Order Ratio Control classification the storefront admin set on this product
   *  (peptide / bacWater / other). Absent → the ratio engine falls back to the
   *  name/category/sequence heuristic. Stored in `metadata.productClass`. */
  productClass?: ProductClass;
  /** "gb" = group-buy listing (sold under a buying window, priced by gbPrice);
   *  "onhand" / absent = regular stocked item. */
  productType?: "gb" | "onhand";
  /** Group-buy price for productType "gb"; 0/absent = uses the regular price. */
  gbPrice?: number;
  /** False keeps the product visible in the catalog but blocks add-to-cart. */
  purchasable?: boolean;
  /** "Price on request": the item is on hand but has no fixed price. The catalog
   *  shows an "On hand — message for price" label instead of a price and blocks
   *  add-to-cart (the customer messages the store to order). */
  priceOnRequest?: boolean;
};

export type Category = { id: string; label: string };

/** `productId` links the line back to the catalog so confirming the order can
 *  deduct stock; absent on legacy orders, which fall back to a name match. */
export type OrderItem = {
  name: string;
  qty: number;
  price: number;
  productId?: string;
  /** The chosen variation/option label (e.g. "10mg") when the line was a product
   *  variation. The `name` already carries it for display; this keeps it as a
   *  structured field for reports. Absent on single-option lines. */
  variation?: string;
};

export type OrderStatus =
  | "new"
  | "confirmed"
  | "processing"
  | "ready"
  | "shipped"
  | "delivered"
  | "cancelled";

/** One entry in an order's fulfillment journey — a status and when it was set. */
export type OrderStatusEvent = { status: OrderStatus; at: string };

export type Order = {
  id: string;
  /** Tenant-facing formatted code, e.g. ABC-1001. Assigned at checkout hand-off. */
  orderNumber?: string;
  status: OrderStatus;
  paymentStatus: "pending" | "paid";
  paymentMethod: string;
  date: string;
  customer: {
    name: string;
    email: string;
    phone: string;
    contactMethod: string;
  };
  shipping: {
    address: string;
    barangay: string;
    city: string;
    province: string;
    postal: string;
    country: string;
    region: string;
    fee: number;
    /** The ShippingLocation the customer picked at checkout (ShippingLocation.id).
     *  Sent so the server can re-derive the authoritative fee from config — the
     *  client's `fee` is only what was displayed. Absent on legacy/demo orders
     *  and when the store has no shipping locations configured. */
    locationId?: string;
  };
  courier: string;
  trackingNumber: string;
  shippingNote: string;
  items: OrderItem[];
  /** Fulfillment journey, oldest event first. Optional on legacy/demo orders. */
  statusHistory?: OrderStatusEvent[];
  /** Admin/service fee charged on this order, snapshotted SERVER-SIDE at
   *  placement from the tenant's branding.config so a later config change never
   *  rewrites what an existing order was charged. Absent on legacy orders and
   *  when the tenant's fee is off. Total = items + shipping.fee + adminFee. */
  adminFee?: { label: string; amount: number };
  /** Discount code applied at checkout, snapshotted SERVER-SIDE at placement
   *  from the tenant's branding.config.promoCodes (re-derived, never trusted from
   *  the client) so the saved amount can't be inflated and a later code change
   *  never rewrites what an existing order received. Absent when no code was used.
   *  It REDUCES the total: Total = items − discount.amount + shipping.fee + adminFee. */
  discount?: { code: string; label: string; amount: number };
  /** Group buy this order was placed under, stamped SERVER-SIDE at placement
   *  (id + name snapshot — see lib/storefront/group-buy). Null/absent = placed
   *  outside any group buy or before the module existed. */
  groupBuyId?: string | null;
  groupBuyName?: string | null;
  paymentProof: string | null;
  /** Carried over from the store's previous system instead of placed through
   *  this checkout (lib/orders/legacy-import). Counts as history and revenue
   *  like any other order, but its stock moved on the old system — so a status
   *  change never deducts or restocks it (see order-status/inventoryMove). */
  imported?: boolean;
};

export type ShippingLocation = {
  id: string;
  /** The courier this location's fee belongs to (Courier.id). A shipping
   *  location is configured per courier: the customer picks a courier first,
   *  then only that courier's locations are offered, and the fee shown is the
   *  one defined for this courier + location combination. Empty on legacy rows
   *  saved before couriers were linked (treated as "unassigned"). */
  courierId: string;
  code: string;
  name: string;
  /** The shipping fee for this location. Optional: leave it unset to make the
   *  location a label only (no per-location fee) — e.g. when the store charges a
   *  single flat shipping/admin fee instead. Absent/undefined shows just the
   *  location name at checkout (no "Free" label) and adds 0 to the order total. */
  price?: number;
  active: boolean;
};

export type Courier = {
  id: string;
  name: string;
  /** Optional tracking page URL shared with customers (e.g. LBC's tracker). */
  trackingUrl: string;
  active: boolean;
  /** When true, this courier needs NO shipping location or fee — the customer
   *  just pays cash on delivery (e.g. Lalamove, Maxim, same-day riders). It's
   *  offered at checkout WITHOUT a location selector, adds 0 to the total, and
   *  doesn't trigger the "no shipping location" warning in admin. Absent/false →
   *  the courier behaves normally (requires an active linked location). */
  noLocation?: boolean;
};

export type CoaReport = {
  id: string;
  name: string;
  lab: string;
  date: string;
  purity: string;
  image: string;
  link: string;
};

export type PromoCode = {
  id: string;
  code: string;
  type: "fixed" | "percent";
  value: number;
  minPurchase: number;
  usageLimit: number | null;
  used: number;
  expiry: string | null;
  active: boolean;
};

export type PaymentMethod = {
  id: string;
  name: string;
  account: string;
  number: string;
  qrImage: string;
  order: number;
  active: boolean;
};

export type FaqItem = { q: string; a: string };
export type FaqGroup = { id: string; label: string; icon: string; items: FaqItem[] };

export type Protocol = {
  category: string;
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  notes: string[];
  storage: string;
  /** Multiple protocol images (hosted on the tenant's ImageKit folder, or data
   *  URLs in demo mode). When `mode` is "image" these images *are* the protocol
   *  (e.g. dosing charts / infographics) and the written fields are hidden; in
   *  "details" mode they're an optional supplement rendered below the fields.
   *  Resolve via `resolveProtocolImages()` — never read this field directly. */
  images?: string[];
  /** @deprecated Legacy single image, kept so protocols saved before the
   *  multi-image change still render. New writes set `images` and mirror its
   *  first entry here. Readers must go through `resolveProtocolImages()`. */
  image?: string;
  /** How the owner chose to present this protocol: type the structured fields
   *  ("details", the default) or upload a single image ("image"). Left optional
   *  for backward-compat — undefined is treated as "details". */
  mode?: "details" | "image";
};

export type Review = {
  headline: string;
  title: string;
  subtitle: string;
  badge: string;
  image: string;
  productId?: string;
};

/** Messaging channels the customer can complete an order through. The set of
 *  enabled channels + their destinations is configured per tenant by the
 *  super admin (BrandingEditor → storefront config). */
export type ContactChannelType = "whatsapp" | "telegram" | "messenger" | "viber" | "gmail" | "instagram";

export type ContactChannel = {
  type: ContactChannelType;
  /** WhatsApp / Viber: phone in international format (digits). Telegram: a
   *  username, or a phone number (resolved via t.me/+<digits>). Messenger:
   *  the page username (with or without a leading "@"). Gmail: an email address. */
  destination: string;
  enabled: boolean;
};

export type FooterSocial = { label: string; href: string; icon: string; show: boolean };
export type FooterLink = { label: string; href: string };
export type FooterColumn = { title: string; links: FooterLink[] };
export type NavItem = { label: string; href: string };

/** The brand configuration that drives storefront copy, colors and admin gating. */
export type Brand = {
  name: string;
  logoUrl: string;
  // Corner rounding for the logo everywhere it renders (header, hero logo
  // card, footer), as a border-radius percentage 0–50. Unset/0 = square (the
  // pre-feature look). Edited via the branding editor's "Logo curve" presets;
  // rendered through logoCurveCss() (src/lib/storefront/logo-curve.ts).
  logoCurve?: number;
  ctaLabel: string;
  industry: string;
  currency?: string;

  // colors (also written to --brand-* custom properties at runtime)
  main: string;
  accent: string;
  button: string;
  button2: string;
  buttonText: string;
  background: string;
  surface: string;
  text: string;
  // Header bar colors — optional overrides for the sticky site header. Unset =
  // inherit the existing behavior (background from `surface`, text from `main`/
  // `text` per element), so existing tenants are unaffected. Both are hex.
  headerBg?: string;
  headerText?: string;
  // Storefront border overrides — optional. `borderColor` (hex) recolors every
  // --brand-border hairline/panel/card frame; `borderWidth` (px, 1–6) thickens
  // the standard 1px borders via --brand-border-width. Unset = theme default
  // border at 1px, so existing tenants are unaffected. Normalized fail-closed
  // through @/lib/storefront/brand-border on render (applyBrandStyle).
  borderColor?: string;
  borderWidth?: number;
  headingFont: string;
  bodyFont: string;
  // CTA / button label font. Optional — unset means buttons follow the body
  // font (the storefront.css default), so existing tenants are unaffected. Set
  // explicitly by a Global Font Style preset or the "Button font" picker.
  buttonFont?: string;
  // Price font — the face prices render in (product cards + detail). Optional:
  // unset means prices follow the body/sans font (the storefront.css default
  // --brand-price-font: var(--brand-body-font)), which is the SaaS-wide default.
  // Set to pin a distinct price face. Resolved via @/lib/storefront/price-font.
  priceFont?: string;

  // Per-tenant fallback photo for products with no image of their own (e.g. a
  // branded vial shot). Normalized server-side (page.tsx) through
  // @/lib/storefront/product-image; absent = the built-in SVG placeholder.
  defaultProductImage?: string;

  // NOTE: there is deliberately no `adminPassword` here. The store-admin
  // credential lives on the Tenant row (storeAdminEmail + storeAdminPasswordHash)
  // because this whole object is serialized to every storefront visitor.
  adminLoginTitle: string;
  adminLoginSub: string;

  // Announcement banner under the header (owner-managed, default off). Absent
  // until the owner configures it; normalized through @/lib/storefront/banner
  // both on save (server) and at render (client).
  banner?: StorefrontBanner;

  // Storefront notice/disclaimer modal — the per-tenant pop-up shown on every
  // visit. Two-flag entitlement gate: the super admin grants it per tenant
  // (noticeModal.operatorEnabled, platform settings page) and the store owner
  // controls day-to-day on/off + edits the copy (noticeModal.enabled, store
  // admin's Notice Modal view). Visible only when BOTH are on — no tenant gets
  // it automatically. Normalized both on save (server) and at render (client)
  // through @/lib/storefront/notice-modal. Absent → feature off.
  noticeModal?: NoticeModalConfig;

  // Track-order delivery note — the per-tenant informational card shown on the
  // Track Order page, under the order-number search box. Single-flag gate: the
  // store owner switches it on + edits the copy (trackNote.enabled, store admin's
  // Track Note view). No operator entitlement — any store may use it. Normalized
  // both on save (server) and at render (client) through @/lib/storefront/
  // track-note. Absent → feature off. Business/Automated exclusive since the
  // trial system: the editor tile locks via trackNoteEntitled (visibility.ts).
  trackNote?: TrackNoteConfig;

  // ── Trial system (server-projected, page.tsx) ──────────────────────────────
  // JSON-safe trial window for the admin countdown banner + expiry gates.
  // Absent for every tenant not governed by a trial (legacy brands unchanged).
  trial?: BrandTrial;
  // Server-derived entitlements for the two Business-exclusive admin modules.
  // Undefined (legacy / non-entitlement render) is treated as entitled so the
  // lock only ever engages on an explicit false or an active trial.
  adminFeeEntitled?: boolean;
  trackNoteEntitled?: boolean;
  // Operator-flagged "new feature" advertised on the trial dashboard as a
  // Business exclusive (pickFeatureSpotlight). Absent → no spotlight strip.
  featureSpotlight?: FeatureSpotlight;

  // ── Subscription duration (server-projected, page.tsx) ─────────────────────
  // JSON-safe paid-subscription window for the store-admin countdown banner.
  // Absent for every tenant without an operator-set window (trial tenants and
  // legacy brands stay byte-identical — the trial banner owns trial chrome).
  subscription?: BrandSubscription;

  // Optional editorial site frame — a thin border around the whole viewport
  // plus a hairline divider under the hero, completing the "framed" look. The
  // header + category bar already carry hairlines; turning this on ties them
  // together into one frame. Owner-toggleable in the branding editor. Absent /
  // false = off, so every existing tenant is unaffected. Rendered by
  // .sf-root[data-sf-frame="on"] in storefront.css.
  siteBorder?: boolean;

  // Home layout style. "two-ways" renders the "two ways to order" home — the
  // on-hand product list + live group-buy card split (design "K Glow Store.dc.html")
  // — driven entirely by the --brand-* vars. Resolved server-side
  // (resolveHomeLayout): the OPERATOR grant (FEATURES.GB_TWO_WAYS_HOME) is the
  // only way in; branding.config.homeLayout can only opt back OUT ("classic").
  // Absent / "classic" = the default hero → categories → catalog home.
  homeLayout?: "classic" | "two-ways";

  // Section + page visibility (driven by the branding editor)
  showHeader: boolean;
  showHero: boolean;
  showCategories: boolean;
  showCatalog: boolean;
  showFooter: boolean;
  showPageTrack: boolean;
  showPageFAQ: boolean;
  showPageCOA: boolean;
  // Server-derived: is the Lab Reports (COA) page (FEATURES.STORE_COA) entitled
  // for this tenant? Operator-grantable, default OFF. Drives whether the store
  // admin even offers the "Lab Reports (COA) page" toggle. Undefined outside the
  // entitlement-aware storefront render (treated as entitled there).
  coaEntitled?: boolean;
  showPageProtocols: boolean;
  // Server-derived: is the Protocols page (FEATURES.STORE_PROTOCOLS) entitled for
  // this tenant? Operator-grantable, default OFF. Drives whether the store admin
  // even offers the "Protocols page" toggle. Undefined outside the entitlement-
  // aware storefront render (treated as entitled there).
  protocolsEntitled?: boolean;
  showPageCalculator: boolean;
  // Server-derived: is the reconstitution calculator (FEATURES.STORE_CALCULATOR)
  // entitled for this tenant? Drives whether the store-admin even offers the
  // "Calculator page" toggle. Undefined outside the entitlement-aware storefront
  // render (treated as entitled there).
  calculatorEntitled?: boolean;
  showPageReviews: boolean;
  // Server-derived: is the Reviews page (FEATURES.STORE_REVIEWS) entitled for
  // this tenant? Operator-grantable, default OFF. Drives whether the store-admin
  // even offers the "Reviews page" toggle. Undefined outside the entitlement-
  // aware storefront render (treated as entitled there).
  reviewsEntitled?: boolean;
  // Reseller / merchant wholesale price list (#merchant). Default OFF — only
  // tenants that sell wholesale enable it from the store admin. Gated behind an
  // access code so the wholesale list isn't shown to regular shoppers.
  showPageMerchant?: boolean;
  // Store-admin Sales Analytics view. Derived server-side: the platform
  // entitlement (FEATURES.STORE_SALES_ANALYTICS, admin → Features) AND the
  // branding-editor toggle must both be on. Default ON for every package.
  showAdminAnalytics?: boolean;
  // Store-admin Card Studio view. Derived server-side: the platform entitlement
  // (FEATURES.STORE_CARD_STUDIO, admin → Features) AND the branding-editor
  // toggle must both be on. Default ON for every package.
  showAdminCardStudio?: boolean;
  // Store-admin Group Buy Rules view. Derived server-side from the platform
  // entitlement (FEATURES.GB_RULES, admin → Features). Default OFF.
  showAdminGroupBuy?: boolean;
  // Store-admin Smart Checkout view. Derived server-side from the platform
  // entitlement (FEATURES.STORE_SMART_CHECKOUT, admin → Features). Operator-
  // grantable, so default OFF for every tenant.
  showAdminCheckout?: boolean;
  // Store-admin Access Code manager. Derived server-side from the platform
  // entitlement (FEATURES.STORE_ACCESS_CODE, admin → Features). Operator-
  // grantable, so default OFF — hidden until the operator turns it on.
  showAdminAccessCode?: boolean;
  // Store-admin Staff Accounts manager. Derived server-side from the platform
  // entitlement (FEATURES.STORE_STAFF_ACCOUNTS, admin → Features). In the
  // Business/Automated plan ceilings (default ON there) and operator-grantable on
  // Starter — so OFF for Starter until the operator turns it on.
  showAdminStaff?: boolean;
  // Server-projected from FEATURES.NOTIFY_ADMIN_ORDER: shows the store-admin
  // "Order Notifications" view (owner-only). Off → the view and its dashboard
  // tile are hidden and the order-alert email is never sent (admin-notify.ts
  // re-checks the same entitlement). See page.tsx projection + visibility.ts.
  showAdminOrderNotify?: boolean;
  // Server-derived from branding.config.noticeModal.operatorEnabled: shows the
  // store-admin "Notice Modal" view (owner-only). Off → the view + its dashboard
  // tile are hidden and the store owner can neither toggle nor edit the notice.
  // The modal itself additionally needs the owner's own `enabled` flag on. See
  // page.tsx projection + visibility.ts (ADMIN_VIEW_TOGGLE.notice).
  showAdminNotice?: boolean;
  // Store-admin Reseller Portal manager. Derived server-side from the platform
  // entitlement (FEATURES.STORE_RESELLER_PORTAL, admin → Features). In every
  // plan ceiling so it defaults ON; the #merchant page additionally needs an
  // access code (showPageMerchant).
  showAdminReseller?: boolean;
  // Store-admin module ids (Quick Actions) that the platform operator has flagged
  // as newly available — the storefront admin shows a "New" tag next to each.
  // Server-derived from the operator-controlled feature registry (feature_registry
  // PlatformSetting) intersected with this tenant's entitled modules. See
  // storefront/visibility.ts (newModulesFor) + app/(tenant)/(storefront)/page.tsx.
  newModules?: string[];
  // Group Buy MANAGEMENT module (the "Group Buys" manager view, distinct from
  // the rules editor above). Derived server-side from the groupbuy.* feature
  // entitlements — see lib/storefront/group-buy-server. Absent = module off.
  groupBuyCaps?: GroupBuyCapabilities;
  // Per-tenant defaults for the "New group buy" form (status / duration /
  // delivery ETA). Set by the platform operator on the tenant's Features page;
  // persisted in branding.config.groupBuySettings.
  groupBuySettings?: GroupBuySettings;
  // While a group buy is live, may customers still add on-hand (non-group-buy)
  // products to the cart? Store-admin choice, persisted in
  // branding.config.groupBuyAllowOnHand. Absent = true (on-hand stays buyable).
  groupBuyAllowOnHand?: boolean;
  // Per-way management of the two order paths — the EFFECTIVE states, already
  // folded with groupBuyAllowOnHand and the live round server-side (see
  // lib/storefront/two-ways-mode.resolveWays). A store that sells only one way
  // (group-buy-only) hides the other here. Absent = both open.
  twoWaysMode?: TwoWaysMode;
  // The owner's shop switch (store admin → Store Status). Closed keeps the whole
  // catalog browsable — prices and all — but every buy control reads "Closed"
  // and nothing reaches the cart. Sits ABOVE twoWaysMode: that closes one order
  // path, this closes the shop. Normalized server-side via normalizeStoreStatus;
  // absent = open, so no existing tenant moves.
  storeStatus?: StoreStatus;
  // The resolved storefront gate for the live run(s): which products are covered
  // and whether on-hand products are blocked. Computed server-side in page.tsx
  // so a stale client can't bypass it; absent = no live run / module off.
  groupBuyGate?: GroupBuyStorefrontGate;
  // Public banner for the live run: name/eta shown above the catalog plus the
  // products it covers, driving the "Explore GB #N" scope toggle. Computed
  // server-side (buildGroupBuyBanner); absent = no live run / module off. Also
  // feeds the cart's two-ways rules (two-ways-cart.ts: pre-order stock
  // exemption + no mixed on-hand/GB carts) as a UX hint — the server re-derives
  // the same scope at placement, so it still never decides what can be bought.
  groupBuyBanner?: GroupBuyBanner;
  // Owner-editable Group Buy storefront copy: the "How group buys work" section
  // (title + steps) and the live-round terms line, shared by the two-ways home
  // and the group-buy page. Normalized server-side from
  // branding.config.groupBuyContent; absent = the built-in default copy.
  groupBuyContent?: GroupBuyContent;
  // Group buy slice of the Sales Analytics view. Derived server-side from
  // FEATURES.SA_SECTION_GROUP_BUYS (default-on in every plan ceiling, but only
  // meaningful while the Sales Analytics module itself is on). Absent/false =
  // the per-group-buy breakdown card is hidden.
  showAnalyticsGroupBuys?: boolean;

  headerShowBrand: boolean;
  // Show the upper-left logo mark (brand.logoUrl image, or the letter-tile
  // fallback). Default-on: checked as !== false, so existing tenants keep their
  // logo. Set false to render NO logo in the header while keeping the brand
  // text (headerShowBrand), nav, cart, and CTA.
  headerShowLogo?: boolean;
  headerShowCart: boolean;
  headerShowCta: boolean;

  heroVariant: "centered" | "split" | "editorial" | "card" | "minimal" | "spotlight" | "wordmark";
  heroShowLogo: boolean;
  // Hero logo card size (px). Unset = the storefront.css default for the variant.
  // Larger values shrink the surrounding whitespace by enlarging the logo card.
  heroLogoSize?: number;
  heroShowChip: boolean;
  // Hide the small accent dot inside the hero chip (default true = shown).
  heroChipShowDot?: boolean;
  heroShowSub: boolean;
  heroShowCtas: boolean;
  heroShowCta2: boolean;
  heroChipLabel: string;
  heroLine1: string;
  heroLine2: string;
  heroSub: string;
  heroCta1: string;
  heroCta2: string;

  // Hero CTA link targets (edited in the store-admin Hero editor). Each button
  // links to either a page on this storefront (a route key resolved by the
  // hash router) or a custom URL. Unset = the legacy default (primary scrolls
  // to the catalog, secondary is inert), so existing tenants are unaffected.
  heroCta1LinkType?: "page" | "custom";
  heroCta1LinkPage?: string; // "home" | "catalog" | "reviews" | "faq" | "coa" | "protocols" | "calculator" | "track" | "merchant"
  heroCta1LinkUrl?: string;
  heroCta2LinkType?: "page" | "custom";
  heroCta2LinkPage?: string;
  heroCta2LinkUrl?: string;

  // Hero image mode (edited in the store-admin Hero editor). When present with
  // mode "image" AND a safe url, the whole hero becomes one uploaded banner
  // instead of the written headline/CTA layout. Unset — or image mode with no
  // image — keeps the written hero, so existing tenants are unaffected. See
  // @/lib/storefront/hero-media (covered by npm run test:hero-media).
  heroMedia?: HeroMedia;

  // Hero typography (edited in the admin "Hero" tab). All optional — anything
  // unset inherits from the theme/brand fonts and the storefront.css defaults.
  // Fonts are family names ("" / undefined = inherit); sizes are friendly keys
  // that map to responsive clamps; highlight is a hex color for the chip/accent.
  heroTitleFont?: string;
  heroTitleSize?: "sm" | "md" | "lg" | "xl";
  heroTitleWeight?: 400 | 500 | 600 | 700 | 800;
  heroBodyFont?: string;
  heroBodySize?: "sm" | "md" | "lg";
  heroAlign?: "left" | "center";
  heroHighlight?: string;

  // Per-field hero text styling (edited in the Hero copy section of the tweaks
  // panel). Each of the six hero copy elements may carry its own font / size /
  // weight / italic / transform / tracking overrides; unset attributes inherit
  // the grouped hero typography above. See HeroFieldStyle in lib/theme/tokens.
  heroFieldStyles?: Partial<Record<HeroTextField, HeroFieldStyle>>;

  catalogEyebrow: string;
  catalogTitle: string;
  catalogShowSearch: boolean;
  catalogShowSort: boolean;
  catalogShowCount: boolean;
  /** Which sort dropdown the catalog renders — "classic" (default) is today's
   *  Name / Price low-high / Price high-low menu; "simple" is the 3-option
   *  Sort by Name / Sort by Price / Sort by Best Sellers menu (HP Glow).
   *  Normalized server-side via normalizeCatalogSortStyle. */
  catalogSortStyle?: "classic" | "simple";
  /** Units sold per product id (server-computed from storefront orders via
   *  buildBestSellerCounts) — powers "Sort by Best Sellers". Only shipped when
   *  catalogSortStyle is "simple". */
  bestSellerCounts?: Record<string, number>;

  /** How the "two ways to order" home orders its ON-HAND shelf — "catalog"
   *  (default) is createdAt order; "per-vial-first" floats single per-vial
   *  listings above the multi-vial kits (K Glow). Nothing is hidden either way.
   *  Normalized server-side via normalizeOnHandOrder. */
  onHandOrder?: "catalog" | "per-vial-first";

  /** Footer layout — "columns" (default) is today's link-column footer;
   *  "compact" is the dark, single-row footer (logo + tagline + pill
   *  quick-links + centered "Made with ♥" line, HP Glow). Unset inherits
   *  "columns" via normalizeFooterStyle, so existing tenants are unaffected. */
  footerStyle?: "columns" | "compact";
  footerShowBrand: boolean;
  footerShowBlurb: boolean;
  footerShowSocials: boolean;
  footerShowColumns: boolean;
  footerShowLegal: boolean;
  footerBlurb: string;
  footerDisclaimer: string;
  footerCopyright: string;
  footerSocials: FooterSocial[];
  footerColumns: FooterColumn[];

  trackTitle: string;
  trackSub: string;
  trackPlaceholder: string;
  trackCta: string;
  trackBackLabel: string;

  faqTitle: string;
  faqBackLabel: string;

  coaTitle: string;
  coaVerifiedLabel: string;
  coaBackLabel: string;
  coaEmptyMsg: string;
  coaInfoTitle: string;
  coaInfoBody: string;
  coaPartners: { label: string; href: string }[];
  coaBadges: { label: string; icon: string }[];

  protocolsEyebrow: string;
  protocolsTitle: string;
  protocolsSub: string;
  protocolsBackLabel: string;
  protocolsGuidelinesTitle: string;
  protocolsGuidelines: { label: string; text: string }[];
  protocolsStorageTitle: string;
  protocolsStorage: { title: string; text: string }[];

  // Reconstitution / dosing calculator copy (#calculator).
  calculatorEyebrow?: string;
  calculatorTitle?: string;
  calculatorSub?: string;
  calculatorBackLabel?: string;
  calculatorDisclaimer?: string;

  reviewsTitle: string;
  reviewsBackLabel: string;

  // Merchant / reseller portal copy (the gated wholesale price list at #merchant).
  merchantTitle?: string;
  merchantEyebrow?: string;
  merchantSub?: string;
  merchantBackLabel?: string;
  merchantGateTitle?: string;
  merchantGateSub?: string;
  // The reseller access code that unlocks #merchant. Set in the store admin and
  // persisted in branding.config. Validated SERVER-SIDE (verifyResellerCodeAction)
  // and stripped from the client brand so the code itself never ships to the
  // browser. Blank → the merchant page stays locked even if showPageMerchant is on.
  resellerAccessCode?: string;

  // Checkout / order contact. Customers complete an order by messaging the
  // store through one of the enabled channels (no in-app payment). Configured
  // by the super admin; an empty/all-disabled list disables checkout.
  contactChannels?: ContactChannel[];
  checkoutTitle?: string;
  checkoutNote?: string;
  // Link-preview / SEO description — shown when the storefront URL is shared
  // (WhatsApp, social, search). Falls back to a generic line when blank.
  metaDescription?: string;

  // Payment methods the customer pays through (bank/e-wallet + QR). Edited in the
  // storefront #admin and persisted server-side in branding.config so every
  // device/customer sees the same configured set (not the seed defaults). Absent
  // until the store owner saves at least once → storefront falls back to seeds.
  paymentMethods?: PaymentMethod[];

  // Whether the customer must upload a proof-of-payment screenshot to complete
  // checkout when payment methods are configured. Toggled per-tenant by the
  // super admin and persisted in branding.config. Absent → treated as required
  // (the historical default); set to false to make the proof upload optional.
  requireProofOfPayment?: boolean;

  // Admin (service) fee added on top of the order total at checkout. Toggled
  // and configured per tenant from the platform settings (settings → Admin fee)
  // and the store admin's Group Buy Rules view — both edit this same key. The
  // label says what the fee is for; the charge is a flat amount or a percentage
  // of the items subtotal (mode/percent absent on legacy configs → fixed).
  // Persisted in branding.config; absent or disabled → checkout shows no fee
  // (the historical behavior). See lib/storefront/admin-fee.
  adminFee?: {
    enabled: boolean;
    label: string;
    amount: number;
    mode?: "fixed" | "percentage";
    percent?: number;
  };

  // Group Buy Rules Engine — vial minimums (per product / per order), bac water
  // limits and the cart/checkout validation toggles. Edited in the storefront
  // #admin ("Group Buy Rules", gated on the FEATURES.GB_RULES entitlement) and
  // persisted in branding.config. Absent → no rules are enforced. See
  // lib/storefront/group-buy-rules.
  groupBuyRules?: GroupBuyRules;

  // Smart Cart & Checkout Logic — cart restrictions (single order type, mixed
  // cart prevention), checkout rules (min quantity, admin fee, bac water,
  // rule-based checkout) and the customizable validation copy. Edited in the
  // storefront #admin ("Smart Checkout") and persisted in branding.config.
  // Absent → the defaults in lib/storefront/checkout-rules apply.
  checkoutRules?: CheckoutRulesConfig;

  // Protocol guide entries. Edited in the storefront #admin and persisted
  // server-side in branding.config (same mechanism as paymentMethods) so the
  // owner's edits show on every device/customer rather than only the editing
  // browser. Absent until the owner saves once → storefront falls back to seeds.
  protocols?: Protocol[];

  // FAQ groups shown on the public #faq page. Edited in the storefront #admin
  // and persisted server-side in branding.config (same mechanism as protocols)
  // so the owner's edits show on every device/customer rather than only the
  // editing browser. Absent until the owner saves once → storefront falls back
  // to the seed FAQ.
  faqGroups?: FaqGroup[];

  // Lab reports (COAs) shown on the public #coa page. Edited in the storefront
  // #admin (Lab Results) and persisted server-side in branding.config (same
  // mechanism as protocols) so the owner's reports show on every device/customer
  // rather than only the editing browser. Absent until the owner saves once →
  // storefront falls back to the seed reports.
  coaReports?: CoaReport[];

  // Couriers the store ships with (the dropdown the admin picks from when
  // saving tracking info on an order). Edited in the storefront #admin and
  // persisted server-side in branding.config (same mechanism as categories) so
  // the owner's couriers show on every device. Absent until the owner saves
  // once → admin falls back to the seed couriers.
  couriers?: Courier[];

  // Shipping locations + their fees, each linked to a courier (courierId). At
  // checkout the customer picks a courier, then one of that courier's locations,
  // and the matching fee is added to the total. Edited in the storefront #admin
  // and persisted server-side in branding.config (same mechanism as couriers) so
  // every device/customer sees the same set — not the editing browser's
  // localStorage. Absent until the owner saves once → falls back to the seeds.
  shippingLocations?: ShippingLocation[];

  // Discount / promo codes the store offers. Created in the storefront #admin
  // (Promo Codes) and persisted server-side in branding.config (same mechanism
  // as couriers) so the owner's codes are honored for every customer on every
  // device — not only the editing browser. The customer enters a code at
  // checkout; placeStorefrontOrderAction re-derives the discount from this same
  // stored set. Absent until the owner saves once → falls back to the seeds.
  promoCodes?: PromoCode[];

  // Store-owner "you received an order" email alert. The owner toggles it on and
  // sets the recipient in the storefront #admin (Order Notifications); persisted
  // server-side in branding.config. On every new order, placeStorefrontOrderAction
  // emits admin_order_placed to the tenant's PostHog so Messaging emails this
  // address (see lib/analytics/admin-notify). Gated on FEATURES.NOTIFY_ADMIN_ORDER;
  // absent/disabled → no alert. See resolveAdminNotifyEmail for the read gate.
  orderNotifications?: { enabled: boolean; email: string };

  // Storefront product categories (the tabs customers filter by, and the
  // dropdown the admin's product form offers). Edited in the storefront #admin
  // and persisted server-side in branding.config (same mechanism as protocols)
  // so the owner's categories show on every device/customer — not only the
  // editing browser. Absent until the owner saves once → storefront falls back
  // to the seed categories.
  categories?: Category[];

  // The owner-editable sort menu behind the catalog's "Sort: …" dropdown, in
  // dropdown order. Each entry is a built-in behavior (name / price / best
  // sellers / newest) or a group the owner named and assigns products to. Absent
  // until the owner saves once → seeded from the legacy catalogSortStyle, so a
  // live store's menu is unchanged on deploy day. See lib/storefront/
  // sort-categories.ts.
  sortCategories?: SortCategory[];

  // Product card design chosen in the store admin's Card Studio. Persisted in
  // branding.config (same mechanism as paymentMethods). Absent → the catalog
  // renders the classic card exactly as before, so existing tenants are
  // unaffected until the owner applies a design.
  cardDesign?: CardDesign;
  // Reusable card designs the owner saved from the Card Studio ("Save as
  // Template"). Persisted in branding.config alongside cardDesign.
  cardTemplates?: CardTemplate[];

  /** Order-number format configured by the super admin (prefix, separator, scheme, digits).
   *  Used by the storefront store to generate order numbers at checkout time. */
  orderNumberFormat?: {
    prefix: string;
    separator: string;
    scheme: "random" | "sequential";
    digits: number;
  };

  // static
  nav: NavItem[];
};

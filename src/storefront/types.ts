// Domain types for the white-label storefront + its admin.
// Ported from the Claude Design handoff bundle (window.PRODUCTS, CATEGORIES, …).

import type { HeroTextField, HeroFieldStyle } from "@/lib/theme/tokens";
import type { CheckoutRulesConfig } from "@/lib/storefront/checkout-rules";
import type { GroupBuyRules } from "@/lib/storefront/group-buy-rules";
import type {
  GroupBuyCapabilities,
  GroupBuySettings,
  GroupBuyStorefrontGate,
} from "@/lib/storefront/group-buy";
import type { CardDesign, CardTemplate } from "./cardDesign";

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  purity?: string;
  category: string;
  featured: boolean;
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
   *  `metadata.variations`; the admin Products screen edits these. */
  variations?: { name: string; price: number }[];
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
  /** Optional protocol image (hosted on the tenant's ImageKit folder, or a
   *  data URL in demo mode). When `mode` is "image" this image *is* the
   *  protocol (e.g. a dosing chart / infographic) and the written fields are
   *  hidden; in "details" mode it's an optional supplement. */
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
export type ContactChannelType = "whatsapp" | "telegram" | "messenger" | "viber" | "gmail";

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
  headingFont: string;
  bodyFont: string;
  // CTA / button label font. Optional — unset means buttons follow the body
  // font (the storefront.css default), so existing tenants are unaffected. Set
  // explicitly by a Global Font Style preset or the "Button font" picker.
  buttonFont?: string;

  adminPassword: string;
  adminLoginTitle: string;
  adminLoginSub: string;

  // Section + page visibility (driven by the branding editor)
  showHeader: boolean;
  showHero: boolean;
  showCategories: boolean;
  showCatalog: boolean;
  showFooter: boolean;
  showPageTrack: boolean;
  showPageFAQ: boolean;
  showPageCOA: boolean;
  showPageProtocols: boolean;
  showPageCalculator: boolean;
  // Server-derived: is the reconstitution calculator (FEATURES.STORE_CALCULATOR)
  // entitled for this tenant? Drives whether the store-admin even offers the
  // "Calculator page" toggle. Undefined outside the entitlement-aware storefront
  // render (treated as entitled there).
  calculatorEntitled?: boolean;
  showPageReviews: boolean;
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
  // Store-admin Reseller Portal manager. Derived server-side from the platform
  // entitlement (FEATURES.STORE_RESELLER_PORTAL, admin → Features). In every
  // plan ceiling so it defaults ON; the #merchant page additionally needs an
  // access code (showPageMerchant).
  showAdminReseller?: boolean;
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
  // The resolved storefront gate for the live run(s): which products are covered
  // and whether on-hand products are blocked. Computed server-side in page.tsx
  // so a stale client can't bypass it; absent = no live run / module off.
  groupBuyGate?: GroupBuyStorefrontGate;
  // Group buy slice of the Sales Analytics view. Derived server-side from
  // FEATURES.SA_SECTION_GROUP_BUYS (default-on in every plan ceiling, but only
  // meaningful while the Sales Analytics module itself is on). Absent/false =
  // the per-group-buy breakdown card is hidden.
  showAnalyticsGroupBuys?: boolean;

  headerShowBrand: boolean;
  headerShowCart: boolean;
  headerShowCta: boolean;

  heroVariant: "centered" | "split" | "editorial" | "card" | "minimal" | "spotlight";
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

  // Storefront product categories (the tabs customers filter by, and the
  // dropdown the admin's product form offers). Edited in the storefront #admin
  // and persisted server-side in branding.config (same mechanism as protocols)
  // so the owner's categories show on every device/customer — not only the
  // editing browser. Absent until the owner saves once → storefront falls back
  // to the seed categories.
  categories?: Category[];

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

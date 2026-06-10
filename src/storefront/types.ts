// Domain types for the white-label storefront + its admin.
// Ported from the Claude Design handoff bundle (window.PRODUCTS, CATEGORIES, …).

import type { HeroTextField, HeroFieldStyle } from "@/lib/theme/tokens";

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
  /** Wholesale / reseller pricing tier. Both price legs optional — "vials only" =
   *  peptide + bac water; "complete set" = with syringes/swabs. `minQty` is the
   *  per-product minimum order that unlocks the wholesale price; unset falls back
   *  to the global RESELLER_MIN_QTY default. */
  reseller?: { vialsOnly?: number; completeSet?: number; minQty?: number };
};

export type Category = { id: string; label: string };

export type OrderItem = { name: string; qty: number; price: number };

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
  };
  courier: string;
  trackingNumber: string;
  shippingNote: string;
  items: OrderItem[];
  /** Fulfillment journey, oldest event first. Optional on legacy/demo orders. */
  statusHistory?: OrderStatusEvent[];
  paymentProof: string | null;
};

export type ShippingLocation = {
  id: string;
  code: string;
  name: string;
  price: number;
  active: boolean;
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
export type ContactChannelType = "whatsapp" | "telegram" | "messenger";

export type ContactChannel = {
  type: ContactChannelType;
  /** WhatsApp: phone in international format (digits, no "+"). Telegram /
   *  Messenger: the username (with or without a leading "@"). */
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
  showPageReviews: boolean;
  // Reseller / merchant wholesale price list (#merchant). Default OFF — only
  // tenants that sell wholesale enable it from the store admin. Gated behind an
  // access code so the wholesale list isn't shown to regular shoppers.
  showPageMerchant?: boolean;

  headerShowBrand: boolean;
  headerShowCart: boolean;
  headerShowCta: boolean;

  heroVariant: "centered" | "split" | "editorial" | "card" | "minimal" | "spotlight";
  heroShowLogo: boolean;
  // Hero logo card size (px). Unset = the storefront.css default for the variant.
  // Larger values shrink the surrounding whitespace by enlarging the logo card.
  heroLogoSize?: number;
  heroShowChip: boolean;
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

  // Protocol guide entries. Edited in the storefront #admin and persisted
  // server-side in branding.config (same mechanism as paymentMethods) so the
  // owner's edits show on every device/customer rather than only the editing
  // browser. Absent until the owner saves once → storefront falls back to seeds.
  protocols?: Protocol[];

  // Storefront product categories (the tabs customers filter by, and the
  // dropdown the admin's product form offers). Edited in the storefront #admin
  // and persisted server-side in branding.config (same mechanism as protocols)
  // so the owner's categories show on every device/customer — not only the
  // editing browser. Absent until the owner saves once → storefront falls back
  // to the seed categories.
  categories?: Category[];

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

// Domain types for the white-label storefront + its admin.
// Ported from the Claude Design handoff bundle (window.PRODUCTS, CATEGORIES, …).

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
};

export type Category = { id: string; label: string };

export type OrderItem = { name: string; qty: number; price: number };

export type Order = {
  id: string;
  /** Tenant-facing formatted code, e.g. ABC-1001. Assigned at checkout hand-off. */
  orderNumber?: string;
  status: "new" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled";
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
  headingFont: string;
  bodyFont: string;

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

  headerShowBrand: boolean;
  headerShowCart: boolean;
  headerShowCta: boolean;

  heroVariant: "centered" | "split" | "editorial" | "card" | "minimal" | "spotlight";
  heroShowLogo: boolean;
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

  // Checkout / order contact. Customers complete an order by messaging the
  // store through one of the enabled channels (no in-app payment). Configured
  // by the super admin; an empty/all-disabled list disables checkout.
  contactChannels?: ContactChannel[];
  checkoutTitle?: string;
  checkoutNote?: string;

  // Payment methods the customer pays through (bank/e-wallet + QR). Edited in the
  // storefront #admin and persisted server-side in branding.config so every
  // device/customer sees the same configured set (not the seed defaults). Absent
  // until the store owner saves at least once → storefront falls back to seeds.
  paymentMethods?: PaymentMethod[];

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

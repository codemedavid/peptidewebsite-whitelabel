import type { Tone } from "@contract";
import type { AdminBrand } from "../bridge";

/**
 * The website's Team & account rules the native screens need BEFORE a call:
 * labels, the grantable-module list, the client-side checks the web forms run,
 * and the shapes the website actions answer with. Each block names the website
 * file it mirrors — the server re-checks every call, so these only keep the
 * forms honest (same limits, same wording, same summaries).
 */

// ── staff — storefront/admin/staff-permissions + actions/storefront-staff ────

export type StaffStatus = "active" | "suspended";

/** actions/storefront-staff StaffListItem. */
export type StaffMember = {
  id: string;
  fullName: string;
  email: string;
  username: string;
  status: string;
  permissions: string[];
  createdAt: string;
};

/** The payload createStaffAction / updateStaffAction read (AdminStaffForm). */
export type StaffInput = {
  fullName: string;
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
  status: StaffStatus;
  permissions: string[];
};

export type StaffModule = { key: string; label: string };

/** STAFF_MODULES, in dashboard order. */
export const STAFF_MODULES: readonly StaffModule[] = [
  { key: "store-status", label: "Store Status" },
  { key: "currency", label: "Currency" },
  { key: "add-product", label: "Add Product" },
  { key: "products", label: "Manage Products" },
  { key: "categories", label: "Categories" },
  { key: "sort-categories", label: "Product Sort Categories" },
  { key: "hero", label: "Hero Section" },
  { key: "banner", label: "Announcement Banner" },
  { key: "orders", label: "Orders" },
  { key: "customers", label: "Customers" },
  { key: "inv", label: "Inventory" },
  { key: "shipping", label: "Shipping" },
  { key: "fee", label: "Checkout Fee" },
  { key: "couriers", label: "Couriers" },
  { key: "lab", label: "Lab Results" },
  { key: "promo", label: "Promo Codes" },
  { key: "pay", label: "Payments" },
  { key: "faq", label: "FAQ" },
  { key: "proto", label: "Protocols" },
  { key: "reseller", label: "Reseller Portal" },
  { key: "design", label: "Card Studio" },
  { key: "analytics", label: "Sales Analytics" },
  { key: "reviews", label: "Reviews" },
  { key: "access-code", label: "Access Code" },
  { key: "checkout", label: "Smart Checkout" },
  { key: "groupbuys", label: "Group Buys" },
  { key: "groupbuy", label: "Order Ratio Control" },
  { key: "community", label: "Community" },
];

const LABEL_BY_KEY = new Map(STAFF_MODULES.map((m) => [m.key, m.label]));

/**
 * storefront/visibility ADMIN_VIEW_TOGGLE — which modules this store exposes.
 * The brand is the same server projection the website admin reads, so an owner
 * can only grant what the store actually has (AdminStaffForm's filter).
 */
const VIEW_TOGGLE: Record<string, (b: AdminBrand) => boolean> = {
  faq: (b) => b.showPageFAQ !== false,
  lab: (b) => b.showPageCOA !== false,
  proto: (b) => b.showPageProtocols !== false,
  reviews: (b) => b.showPageReviews !== false,
  analytics: (b) => b.showAdminAnalytics !== false,
  reseller: (b) => b.showAdminReseller !== false,
  design: (b) => b.showAdminCardStudio !== false,
  groupbuy: (b) => b.showAdminGroupBuy === true,
  checkout: (b) => b.showAdminCheckout === true,
  "access-code": (b) => b.showAdminAccessCode === true,
  groupbuys: (b) => (b.groupBuyCaps as { enabled?: unknown } | undefined)?.enabled === true,
  customers: (b) => b.customerAccountsEnabled === true,
};

export function grantableModules(brand: AdminBrand): StaffModule[] {
  return STAFF_MODULES.filter((m) => VIEW_TOGGLE[m.key]?.(brand) ?? true);
}

/** AdminStaffList permissionSummary: a short, human "what can they open". */
export function permissionSummary(permissions: readonly string[]): string {
  if (permissions.length === 0) return "No modules yet";
  if (permissions.length === STAFF_MODULES.length) return "Full access";
  const labels = permissions.map((k) => LABEL_BY_KEY.get(k) ?? k);
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 3).join(", ")} +${labels.length - 3}`;
}

/** AdminStaffForm canSave — the server's parser has the real rules. */
export function canSaveStaff(input: StaffInput, isEdit: boolean): boolean {
  return (
    input.fullName.trim().length > 0 &&
    input.email.trim().length > 0 &&
    input.username.trim().length >= 3 &&
    (isEdit || input.password.length >= 6)
  );
}

export const moduleLabel = (key: string): string | undefined => LABEL_BY_KEY.get(key);

// ── billing — lib/subscription/{payments,billing-cycle,subscription-state} ──

export type BillingCycle = "monthly" | "quarterly" | "semi_annual" | "yearly";

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semi_annual: "Semi-annual",
  yearly: "Yearly",
};

/** brand.subscription (BrandSubscription) — projected server-side. */
export type BrandSubscription = {
  onSubscription: true;
  expired: boolean;
  daysLeft: number;
  endsAt: string;
  amountDueCents?: number;
  cycle?: BillingCycle;
};

/** brand.trial (BrandTrial). */
export type BrandTrial = { onTrial: true; expired: boolean; daysLeft: number; endsAt: string };

export function subscriptionOf(brand: AdminBrand): BrandSubscription | null {
  const s = brand.subscription as BrandSubscription | undefined;
  return s && s.onSubscription === true ? s : null;
}

export function trialOf(brand: AdminBrand): BrandTrial | null {
  const t = brand.trial as BrandTrial | undefined;
  return t && t.onTrial === true ? t : null;
}

/** actions/subscription-payments BillingPaymentChannel (also PackagePaymentMethod's shape). */
export type PayChannel = { id: string; method: string; account: string; number: string; note: string; qrUrl: string };

export type BillingInfo = { instructions: string; channels: PayChannel[] };

export type InvoiceStatus = "pending" | "confirmed" | "failed";

/** TenantInvoiceRow. */
export type InvoiceRow = { id: string; code: string; amountCents: number; method: string; status: InvoiceStatus; dateIso: string };

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  pending: "Awaiting confirmation",
  confirmed: "Paid",
  failed: "Failed",
};

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, Tone> = {
  pending: "warning",
  confirmed: "success",
  failed: "danger",
};

/** "1499" / "₱1,499.00" → centavos, or null (parsePaymentAmountCents). */
export function parsePaymentAmountCents(raw: string): number | null {
  const cleaned = raw.replace(/[₱,\s]/g, "");
  if (cleaned === "") return null;
  const pesos = Number(cleaned);
  if (!Number.isFinite(pesos) || pesos <= 0) return null;
  return Math.round(pesos * 100);
}

const DEFAULT_PAYMENT_METHODS = ["GCash", "Maya", "Bank transfer", "Card", "Other"];

/** The Billing form's method options (paymentMethodOptions). */
export function paymentMethodOptions(platformNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const raw of platformNames) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    options.push(name);
  }
  if (options.length === 0) return [...DEFAULT_PAYMENT_METHODS];
  return seen.has("other") ? options : [...options, "Other"];
}

/** ISO → "Aug 10, 2026". */
export function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Centavos → "₱1,499" (keeps real centavos). */
export function fmtPesos(cents: number): string {
  return `₱${(cents / 100).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

/** A proof must be a hosted https URL — the server drops anything else. */
export const isHostedUrl = (url: string): boolean => /^https:\/\//i.test(url.trim());

// ── upgrade — actions/upgrade + lib/trial/{upgrade-quote,starter-downgrade} ──

export type UpgradeContext = {
  quote: { businessCents: number; creditCents: number; dueTodayCents: number };
  methods: PayChannel[];
  pendingRequest: boolean;
  trialGoverned: boolean;
  starterCents: number;
};

export const STARTER_DOWNGRADE_PRODUCT_CAP = 10;

/** STARTER_COMBOS, display only — the server owns what each combo grants. */
export const STARTER_COMBOS: readonly { id: "a" | "b"; title: string; sub: string }[] = [
  { id: "a", title: "FAQ Page + Protocols Page", sub: "Includes 20 free peptide protocols" },
  { id: "b", title: "Peptide Calculator + Order Tracking Page", sub: "Dosage calculator & customer track page" },
];

/** TrialPlansScreen businessFeatures. */
export const BUSINESS_FEATURES: readonly { text: string; exclusive?: boolean }[] = [
  { text: "Unlimited products" },
  { text: "Everything in your trial — orders, inventory, shipping" },
  { text: "Promo codes, couriers, lab results & protocols" },
  { text: "Hero, banner & FAQ management" },
  { text: "Sales Analytics", exclusive: true },
  { text: "Product Card Customization", exclusive: true },
  { text: "Checkout Fee & Delivery Note tools", exclusive: true },
  { text: "Priority support" },
];

// ── data export — lib/storefront/data-export + AdminDataExport ───────────────

export type ExportFile = { filename: string; mime: string; content: string };
export type ExportBundle = {
  files: ExportFile[];
  counts: { products: number; orders: number; orderItems: number; customers: number };
};

/** What each file in the bundle is, in the owner's words (FILE_BLURB). */
export const EXPORT_FILES: readonly { match: string; label: string; hint: string }[] = [
  { match: "-products-", label: "Products", hint: "Your full catalog — one row per size/option, with prices and stock." },
  { match: "-orders-", label: "Orders", hint: "Every order with its customer, address, fees and total." },
  { match: "-order-items-", label: "Order items", hint: "One row per line item — what was bought, how many, at what price." },
  { match: "-customers-", label: "Customers", hint: "Your customer list, merged across repeat orders, with lifetime spend." },
  { match: "-store-data-", label: "Everything (JSON)", hint: "The same data in developer format, for importing elsewhere." },
];

export const exportLabelFor = (filename: string): string =>
  EXPORT_FILES.find((b) => filename.includes(b.match))?.label ?? filename;

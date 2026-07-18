/**
 * Plan presentation + pricing for the Super Admin app.
 *
 * The DB's Plan model carries no price column, so package pricing lives here as
 * the single source of truth (easy to migrate into Plan.priceCents later).
 * Prices are in PHP centavos. Internal keys stay starter | pro | enterprise to
 * match lib/features/catalog; the display labels are Starter / Business /
 * Automated. Legacy aliases below cover older fixtures + the display names.
 */

export type PlanTone = "neutral" | "info" | "accent" | "violet";

export const PLAN_CURRENCY = "PHP" as const;

export type PlanMeta = {
  key: string;
  label: string;
  priceCents: number; // PHP centavos
  rank: number; // tier ordering for plan-gating comparisons
  tone: PlanTone;
};

export const PLAN_META: Record<string, PlanMeta> = {
  starter: { key: "starter", label: "Starter", priceCents: 79900, rank: 1, tone: "neutral" },
  pro: { key: "pro", label: "Business", priceCents: 149900, rank: 2, tone: "info" },
  enterprise: { key: "enterprise", label: "Automated", priceCents: 299900, rank: 3, tone: "accent" },
};

const PLAN_ALIASES: Record<string, string> = {
  basic: "starter",
  ecommerce: "pro",
  growth: "enterprise",
  professional: "pro",
  business: "pro",
  automated: "enterprise",
};

/** Format PHP centavos as pesos, e.g. ₱5,999 (or ₱5,999.00 with decimals). */
export function formatPesos(cents: number, opts?: { decimals?: boolean }): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: PLAN_CURRENCY,
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  }).format(cents / 100);
}

/** Compact peso amount for KPI tiles, e.g. ₱1.7k / ₱2.4M. */
export function formatPesosCompact(cents: number): string {
  const p = cents / 100;
  if (p >= 1_000_000) return "₱" + (p / 1_000_000).toFixed(1) + "M";
  if (p >= 1_000) return "₱" + (p / 1_000).toFixed(1) + "k";
  return "₱" + p.toLocaleString("en-PH");
}

/** Resolve any plan key (incl. legacy aliases) to its presentation metadata. */
export function planMeta(key: string): PlanMeta {
  const resolved = PLAN_META[key] ? key : (PLAN_ALIASES[key] ?? "starter");
  return PLAN_META[resolved] ?? PLAN_META.starter;
}

export function planPriceCents(key: string): number {
  return planMeta(key).priceCents;
}

/** Pricing cards for the create-tenant flow + Plans page. Mirrors the Pepweb
 *  landing design: monthly subscription prices + a one-time setup fee
 *  (waived on Business). The ₱699 / 1-month Business trial offer was retired
 *  (2026-07) — no default first-month `discountPriceCents`. An operator can
 *  still set a first-month promo per plan on /admin/plans if desired. */
export const PLAN_CARDS = [
  {
    key: "starter",
    name: "Starter",
    priceCents: 79900,
    setupFeeCents: 49900,
    setupFeeWaived: false,
    blurb: "Perfect for new peptide sellers who want a simple way to start accepting orders.",
    feats: [
      "Ordering form",
      "Order success + order-details page",
      "Auto-send to Messenger / WhatsApp",
      "Choose any 2 add-on features",
      "Hosting included",
      "Continuous updates",
      "Standard support",
    ],
  },
  {
    key: "pro",
    name: "Business",
    priceCents: 149900,
    setupFeeCents: 99900,
    setupFeeWaived: true,
    blurb: "Everything you need to run a professional peptide storefront.",
    tag: "Most Popular",
    feats: [
      "Everything in Starter, plus:",
      "Full online storefront + cart",
      "Order tracking page",
      "COA + FAQ pages",
      "Peptide calculator",
      "Protocol library (20+)",
      "Sales analytics",
      "Product card customization",
      "Continuous feature updates",
      "Priority support",
    ],
  },
  {
    key: "enterprise",
    name: "Automated",
    priceCents: 299900,
    setupFeeCents: 199900,
    setupFeeWaived: false,
    blurb: "Scale your business with analytics and automation.",
    feats: [
      "Everything in Business, plus:",
      "Analytics dashboard",
      "Gmail integration",
      "Automated order notifications",
      "Automation tools",
      "Early access to new features",
      "VIP support",
    ],
  },
] as const;

/** Per-plan soft limits used by the usage bars (no metering backend yet). */
export function planLimits(key: string) {
  const rank = planMeta(key).rank;
  return {
    ordersPerMonth: rank >= 3 ? null : rank === 2 ? 5000 : 500,
    staffSeats: rank >= 3 ? null : rank === 2 ? 5 : 1,
    storageGb: rank >= 3 ? 100 : 25,
    bandwidthGb: rank >= 3 ? null : 500,
    emailSends: rank === 1 ? 5000 : 50000,
  };
}

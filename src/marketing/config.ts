// Single source of truth for the Pepweb marketing site copy + data.
// PURE module (no server-only) so the onboarding wizard can import the packages
// and payment instructions too. Packages re-use PLAN_CARDS / PLAN_META so the
// sales site, the onboarding package step, and the admin never diverge on price.
//
// Copy follows the 2026-07 "Pepweb Landing" design (claude.ai/design, Website UI
// improvement project): monthly-subscription pricing, all Taglish preserved verbatim.

import { PLAN_META, formatPesos } from "@/lib/admin/plans";
import { defaultPlanConfig, type EditablePlanCard } from "@/lib/platform/plan-config";

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

/** A storefront URL for a tenant slug. http for dev hosts (port / lvh / localhost),
 *  https for a real apex. */
export function storeUrl(slug: string): string {
  const dev = /localhost|lvh\.me|127\.0\.0\.1|:\d+/.test(ROOT);
  return `${dev ? "http" : "https"}://${slug}.${ROOT}`;
}

export const SITE = {
  brand: "Pepweb",
  brandSuffix: ".",
  tagline: "Mas kaunting oras sa chat, mas maraming oras sa paglago.",
  hero: {
    eyebrow: "The all-in-one platform for peptide businesses",
    // H1: the em part renders italic + green ("peptides online").
    h1Lead: "Everything you need to sell",
    h1Em: "peptides online",
    sub: "Launch a professional peptide storefront with ordering, tracking, COAs, protocols, analytics, and automation — all in one platform that keeps improving every month.",
    primaryCta: "Start Today",
    secondaryCta: "View Demo",
    demoSlug: "ar-jonina",
  },
  contactEmail: "hello@jonina.store",
};

// ──────────────────────────── Hero stat row ────────────────────────────
export const HERO_STATS = [
  { value: "24/7", label: "Sumasagot kahit tulog ka" },
  { value: "2–5 days", label: "Done-for-you setup" },
  { value: "₱799/mo", label: "Simula ng pinakamurang plan" },
] as const;

// ──────────────────────────── Pricing intro ────────────────────────────
export const PRICING_INTRO = {
  eyebrow: "Simple monthly pricing",
  title: "Pick the plan that fits",
  body: "Hosting, maintenance, and continuous updates included in every plan. Cancel anytime.",
} as const;

// ──────────────────────────── Intro offer (1-month Business trial) ────────────────────────────
// The green banner above the pricing cards. Prices are rendered live from the
// plan config (trialPriceCents + the Business monthly price) so operator edits
// on /admin/plans stay in sync; this holds the non-price copy.
export const INTRO_OFFER = {
  tag: "Introductory offer",
  // Rendered as: "Business plan — first month {trialPrice}, FREE setup"
  titleLead: "Business plan — first month",
  titleTail: ", FREE setup",
  // Rendered as: "Then {monthlyPrice}/month. {bodyTail}"
  bodyTail: "Buong platform, hosting, at updates — kasama lahat.",
  cta: "Start Growing",
  // Trial signs up onto the Business plan; the operator confirms the trial arrangement.
  href: "/get-started?plan=pro&trial=1",
} as const;

// ──────────────────────────── Packages ────────────────────────────
// Derived from the admin plan source of truth. `key` is the DB plan key
// (starter | pro | enterprise) — what the onboarding submission stores.
// Pricing surfaces should call packagesFrom(getPlanConfig().plans) so
// operator edits (Super Admin → Plans & Billing) show up; PACKAGES is the
// code-default fallback.
export type Package = {
  key: string;
  name: string;
  priceLabel: string; // list price (monthly)
  discountLabel?: string; // first-month promo price when set; show as the headline with priceLabel as "then …/month"
  priceCents: number; // effective price (discount when set, else list) — used for checkout totals
  setupFeeCents: number; // one-time setup fee (0 = none)
  setupFeeWaived: boolean; // fee shown struck through as FREE setup
  blurb: string;
  feats: readonly string[];
  tag?: string;
  highlighted: boolean;
};

export function packagesFrom(plans: EditablePlanCard[]): Package[] {
  return plans.map((p) => {
    const discounted = Boolean(p.discountPriceCents && p.discountPriceCents < p.priceCents);
    return {
      key: p.key,
      name: p.name,
      priceLabel: formatPesos(p.priceCents),
      discountLabel: discounted ? formatPesos(p.discountPriceCents as number) : undefined,
      priceCents: discounted ? (p.discountPriceCents as number) : p.priceCents,
      setupFeeCents: p.setupFeeCents,
      setupFeeWaived: p.setupFeeWaived,
      blurb: p.blurb,
      feats: p.feats,
      tag: p.tag || undefined,
      highlighted: p.key === "pro",
    };
  });
}

export const PACKAGES: Package[] = packagesFrom(defaultPlanConfig().plans);

/** Per-plan CTA labels on the pricing cards. */
export const PLAN_CTAS: Record<string, string> = {
  starter: "Get Started",
  pro: "Start Growing",
  enterprise: "Scale Now",
};

export function packageLabel(key: string): string {
  return (PLAN_META[key] ?? PLAN_META.starter).label;
}

// ──────────────────────────── Why monthly ────────────────────────────
export const WHY_MONTHLY = {
  eyebrow: "Why monthly?",
  title: "Your business keeps growing — and so does Pepweb.",
  body: "Your subscription includes everything needed to keep your business running smoothly — hindi lang website, kundi buong system na patuloy na ginagalingan.",
  items: [
    "Secure cloud hosting",
    "Platform maintenance",
    "Continuous feature updates",
    "Performance improvements",
    "Security patches",
    "Customer support",
    "Bug fixes",
    "Future integrations",
  ],
} as const;

// ──────────────────────────── Plan comparison ────────────────────────────
export type ComparisonRow = {
  label: string;
  starter: boolean;
  pro: boolean;
  enterprise: boolean;
};

const row = (label: string, starter: boolean, pro: boolean, enterprise: boolean): ComparisonRow => ({
  label,
  starter,
  pro,
  enterprise,
});

export const COMPARISON: ComparisonRow[] = [
  row("Ordering form", true, true, true),
  row("Messenger orders", true, true, true),
  row("WhatsApp orders", true, true, true),
  row("Storefront", false, true, true),
  row("Shopping cart", false, true, true),
  row("Order tracking", false, true, true),
  row("COA page", false, true, true),
  row("FAQ page", false, true, true),
  row("Peptide calculator", false, true, true),
  row("Protocol library", false, true, true),
  row("Analytics dashboard", false, false, true),
  row("Gmail integration", false, false, true),
  row("Automation", false, false, true),
  row("Priority support", false, true, true),
];

// ──────────────────────────── Why Pepweb (value props) ────────────────────────────
export type ValueProp = { title: string; body: string };

export const VALUE_PROPS: ValueProp[] = [
  { title: "Built for peptide businesses", body: "Purpose-built tools designed specifically for peptide brands." },
  { title: "Launch faster", body: "Get online without spending weeks building a website." },
  { title: "Everything in one place", body: "Storefront, ordering, tracking, COAs, protocols, analytics, and automation." },
  { title: "Always improving", body: "Your subscription includes new features and improvements as Pepweb evolves." },
];

// ──────────────────────────── FAQ ────────────────────────────
export type Faq = { q: string; a: string };

export const FAQS: Faq[] = [
  { q: "Can I cancel anytime?", a: "Yes. There are no long-term contracts." },
  { q: "Is hosting included?", a: "Yes. Every plan includes secure cloud hosting." },
  { q: "Are updates included?", a: "Yes. Every subscription includes new features, maintenance, and security updates." },
  { q: "Can I upgrade later?", a: "Yes. Upgrade anytime as your business grows." },
  {
    q: "What domain does my store use?",
    a: "Every plan includes a free default domain: yourbusinessname.pepweb.store. Want your own .com? It's ₱1,400 — this covers the domain for 1 year, plus service, tax, and processing fees. Already own a domain? We'll connect it for a ₱500 service and setup fee.",
  },
  {
    q: "Can I change the branding or color theme?",
    a: "Yes, you can! We will customize your store based on your branding — logo, colors, and fonts.",
  },
  {
    q: "Why is there a setup fee?",
    a: "The one-time setup fee covers the initial onboarding and configuration of your storefront, ensuring everything is ready before launch.",
  },
];

// ──────────────────────────── Final CTA ────────────────────────────
export const FINAL_CTA = {
  title: "Mas kaunting oras sa chat. Mas maraming oras sa paglago.",
  body: "Sagutin ang ilang simpleng tanong tungkol sa business mo, at kami na ang bahala sa setup. Sa loob ng ilang araw, may platform ka nang gumagana para sa'yo.",
  cta: "Start Today",
} as const;

// ──────────────────────────── Onboarding payment instructions ────────────────────────────
// Jonina's OWN receiving details, shown on the checkout step so the client can
// pay for their package before uploading proof. Fill these in with your accounts.
export type PayTo = { method: string; account: string; number: string; note?: string; qr?: string };

export const PACKAGE_PAYMENT: { instructions: string; methods: PayTo[] } = {
  instructions:
    "Pay your selected package using any method below, then upload a screenshot of your payment to finish. We'll confirm and start building your store.",
  methods: [
    { method: "GCash", account: "JO*N AN***O D.", number: "0992 821 ••••", note: "Scan the QR or send to this number, then screenshot the receipt.", qr: "/payment/gcash-qr.png" },
    { method: "Maya", account: "Ma. Jonina Cassandra Donaire", number: "+63 *** *** 4519", note: "Scan the QR with your Maya app. Transfer fees may apply.", qr: "/payment/maya-qr.png" },
    { method: "Bank Transfer", account: "Jonina Store", number: "BPI 0000 0000 00", note: "Use your business name as the reference." },
  ],
};

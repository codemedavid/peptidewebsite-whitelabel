// Single source of truth for the jonina.store marketing site copy + data.
// PURE module (no server-only) so the onboarding wizard can import the packages
// and payment instructions too. Packages re-use PLAN_CARDS / PLAN_META so the
// sales site, the onboarding package step, and the admin never diverge on price.

import { PLAN_CARDS, PLAN_META, formatPesos } from "@/lib/admin/plans";

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

/** A storefront URL for a tenant slug. http for dev hosts (port / lvh / localhost),
 *  https for a real apex. */
export function storeUrl(slug: string): string {
  const dev = /localhost|lvh\.me|127\.0\.0\.1|:\d+/.test(ROOT);
  return `${dev ? "http" : "https"}://${slug}.${ROOT}`;
}

export const SITE = {
  brand: "Jonina",
  brandSuffix: ".store",
  tagline: "Websites that sell, ready fast.",
  hero: {
    chip: "Website creation, done-for-you",
    line1: "Get Your Business Website",
    line2: "Ready Fast",
    sub: "Professional websites for peptide sellers, beauty businesses, resellers, online shops, and small businesses — built, branded, and ready to take orders.",
    primaryCta: "Get Started",
    secondaryCta: "View Demo Websites",
  },
  contactEmail: "hello@jonina.store",
};

// ──────────────────────────── Features ────────────────────────────
export type Feature = { icon: string; title: string; body: string };

export const FEATURES: Feature[] = [
  { icon: "ClipboardList", title: "Easy Order Management", body: "Every order in one tidy dashboard — status, customer, items, and proof of payment." },
  { icon: "MessageCircle", title: "WhatsApp Checkout", body: "Customers complete their order straight to your WhatsApp, Messenger, or Telegram." },
  { icon: "Smartphone", title: "Mobile-Friendly Website", body: "Looks beautiful and loads fast on every phone — where your customers actually shop." },
  { icon: "Palette", title: "Custom Branding", body: "Your logo, colors, and fonts. A store that looks unmistakably yours from day one." },
  { icon: "PackagePlus", title: "Product Upload Ready", body: "Add products with photos, prices, and categories in seconds — no developer needed." },
  { icon: "QrCode", title: "Payment QR Support", body: "Show your GCash, Maya, and bank QR codes so customers pay in a tap." },
  { icon: "Truck", title: "Order Tracking", body: "Give customers a tracking page and keep every order moving to delivered." },
  { icon: "LayoutDashboard", title: "Admin Dashboard", body: "Manage products, orders, payments, and content from one simple control center." },
];

// ──────────────────────────── Demo websites ────────────────────────────
// Sample storefronts shown in the "Demo Websites" grid. Point `slug` at any live
// tenant; the seeded `acme` store works out of the box. Edit freely.
export type DemoSite = { name: string; category: string; blurb: string; slug: string };

export const DEMO_SITES: DemoSite[] = [
  { name: "Peppertones", category: "Peptides & Research", blurb: "Clean clinical storefront with COA pages and order tracking.", slug: "peppertones" },
  { name: "Peppies Intl", category: "Wellness & Peptides", blurb: "Curated catalog with WhatsApp checkout and QR payments.", slug: "peppies-intl" },
];

// ──────────────────────────── Packages ────────────────────────────
// Re-exported from the admin plan source of truth. `key` is the DB plan key
// (starter | pro | enterprise) — what the onboarding submission stores.
export type Package = {
  key: string;
  name: string;
  priceLabel: string;
  blurb: string;
  feats: readonly string[];
  tag?: string;
  highlighted: boolean;
};

export const PACKAGES: Package[] = PLAN_CARDS.map((p) => ({
  key: p.key,
  name: p.name,
  priceLabel: formatPesos(p.priceCents),
  blurb: p.blurb,
  feats: p.feats,
  tag: "tag" in p ? (p as { tag?: string }).tag : undefined,
  highlighted: p.key === "pro",
}));

export function packageLabel(key: string): string {
  return (PLAN_META[key] ?? PLAN_META.starter).label;
}

// ──────────────────────────── Testimonials ────────────────────────────
export type Testimonial = { quote: string; name: string; role: string; initials: string };

export const TESTIMONIALS: Testimonial[] = [
  { quote: "I had my store live in two days and got my first WhatsApp order the same week. The whole thing just works.", name: "Bea Santos", role: "Founder, Glow Manila", initials: "BS" },
  { quote: "The QR payment setup was the selling point for me. My customers pay with GCash and I see the proof instantly.", name: "Marco Reyes", role: "Reseller, MNL Supplies", initials: "MR" },
  { quote: "It looks like I paid a fortune for a custom site. I didn't. Branding matched my Instagram perfectly.", name: "Patricia Lim", role: "Owner, Petite Skincare", initials: "PL" },
  { quote: "Order tracking and a clean admin made me look way more professional than my competitors overnight.", name: "Jonas Cruz", role: "Founder, Apex Research PH", initials: "JC" },
];

// ──────────────────────────── FAQ ────────────────────────────
export type Faq = { q: string; a: string };

export const FAQS: Faq[] = [
  { q: "How long does setup take?", a: "Most stores go live within 2–5 business days after you complete onboarding and we receive your payment. Larger catalogs may take a little longer." },
  { q: "Can I use my own domain?", a: "Yes. You start on a free businessname.jonina.store subdomain, and we can connect your own custom domain on the Business and Automated packages." },
  { q: "Can I customize the colors and branding?", a: "Absolutely. Onboarding collects your logo, brand colors, and style preferences, and we tailor the whole storefront to match. You can request revisions during setup." },
  { q: "Do you support WhatsApp orders?", a: "Yes — WhatsApp, Messenger, and Telegram. Customers tap checkout and their order is sent straight to your chosen inbox, formatted and ready." },
  { q: "Can I upload products later?", a: "Of course. You can add products during onboarding and anytime after from your admin dashboard — names, photos, prices, and categories." },
  { q: "How do customers pay?", a: "You display your GCash, Maya, bank, or QR details and customers upload proof of payment with their order. No payment gateway or extra fees required." },
];

// ──────────────────────────── Onboarding payment instructions ────────────────────────────
// Jonina's OWN receiving details, shown on the checkout step so the client can
// pay for their package before uploading proof. Fill these in with your accounts.
export type PayTo = { method: string; account: string; number: string; note?: string };

export const PACKAGE_PAYMENT: { instructions: string; methods: PayTo[] } = {
  instructions:
    "Pay your selected package using any method below, then upload a screenshot of your payment to finish. We'll confirm and start building your store.",
  methods: [
    { method: "GCash", account: "Jonina Store", number: "0917 000 0000", note: "Send to this number and screenshot the receipt." },
    { method: "Maya", account: "Jonina Store", number: "0917 000 0000" },
    { method: "Bank Transfer", account: "Jonina Store", number: "BPI 0000 0000 00", note: "Use your business name as the reference." },
  ],
};

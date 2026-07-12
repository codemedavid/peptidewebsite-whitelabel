// Single source of truth for the jonina.store marketing site copy + data.
// PURE module (no server-only) so the onboarding wizard can import the packages
// and payment instructions too. Packages re-use PLAN_CARDS / PLAN_META so the
// sales site, the onboarding package step, and the admin never diverge on price.
//
// Copy follows the 2026-07 editorial redesign handoff (design_handoff_jonina_landing):
// 8 sections, all Taglish preserved verbatim.

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
  brand: "Jonina",
  brandSuffix: ".store",
  tagline: "Mas kaunting oras sa chat, mas maraming oras sa paglago.",
  hero: {
    eyebrow: "Business automation, done-for-you",
    // H1: the em part renders italic + green ("peptide business").
    h1Lead: "Stop being the customer support of your own",
    h1Em: "peptide business",
    sub: "Ang automation system ang sasagot sa paulit-ulit na tanong, magpapakita ng products at COAs, at mangongolekta ng orders — automated, 24/7. Para ikaw, focus sa paglago ng negosyo, hindi sa kaka-reply.",
    primaryCta: "Get Started",
    secondaryCta: "View Demo Store",
    demoSlug: "ar-jonina",
  },
  contactEmail: "hello@jonina.store",
};

// ──────────────────────────── Hero stat row ────────────────────────────
export const HERO_STATS = [
  { value: "3+ oras", label: "Nababawi mo kada araw" },
  { value: "24/7", label: "Sumasagot kahit tulog ka" },
  { value: "2–5 days", label: "Done-for-you setup" },
] as const;

// ──────────────────────────── Pain ("Pamilyar ba 'to?") ────────────────────────────
export const PAIN_INTRO = {
  eyebrow: "Pamilyar ba ’to?",
  title: "Parehong tanong. Araw-araw. Buong araw.",
  body: "Hindi ka tamad. Sobrang busy ka lang sa mga bagay na pwede namang i-automate.",
} as const;

export type Pain = { q: string; body: string };

export const PAINS: Pain[] = [
  { q: "“Magkano po?”", body: "Pang-30 na today. Copy-paste ka na naman ng parehong sagot." },
  { q: "“Pa-send po ng product info”", body: "Ise-send mong isa-isa. Ulit. Ulit. Ulit." },
  { q: "“May COA po ba?”", body: "Nasa files mo — ikaw ang maghahanap tuwing may magtatanong." },
  { q: "“Paano po umorder?”", body: "Ipapaliwanag mo ulit ang steps, sa pang-sampung tao ngayong araw." },
  { q: "“Sent na po payment”", body: "Ikaw pa rin ang magve-verify — screenshot by screenshot." },
  { q: "“Saan na po order ko?”", body: "Bubuksan mo pa ang courier app para sa pang-limang follow-up." },
];

// Dark stats band under the pain list.
export const COST_STATS = [
  { value: "3 oras", label: "kada araw na nauubos sa kakasagot ng parehong tanong" },
  { value: "90 oras", label: "kada buwan na napupunta sa chat, hindi sa negosyo" },
  { value: "2+ linggo", label: "ng full-time na trabaho — nawawala buwan-buwan" },
] as const;

// ──────────────────────────── Journey ("Imagine this") ────────────────────────────
export const JOURNEY_INTRO = {
  eyebrow: "Imagine this",
  title: "Paano kung hindi ka na kailangan sa bawat order?",
  body: "Ganito ang isang sale kapag may system ka — mula dating ng customer hanggang confirmed na order.",
} as const;

export const JOURNEY_STEPS = [
  { n: "01", title: "Dumating ang customer", body: "Nakita niya ang branded store mo — mukhang legit, mukhang professional." },
  { n: "02", title: "Nag-browse ng products", body: "Kumpleto: photos, presyo, descriptions, COAs. Halos wala nang itatanong." },
  { n: "03", title: "Nabasa paano umorder", body: "Malinaw ang steps at payment instructions. Hindi ka niya kailangang kulitin." },
  { n: "04", title: "Naka-order na siya", body: "Pumili, nagbayad, nag-upload ng proof — lahat sa store, hindi sa DMs." },
  { n: "05", title: "Ikaw, na-notify ka lang", body: "Bukas mo ang dashboard, kumpleto na ang detalye. Confirm na lang. Tapos." },
] as const;

// ──────────────────────────── Features ────────────────────────────
export type Feature = { title: string; body: string };

export const FEATURES: Feature[] = [
  { title: "Easy Order Management", body: "Every order in one tidy dashboard — status, customer, items, and proof of payment." },
  { title: "WhatsApp Checkout", body: "Customers complete their order straight to your WhatsApp, Messenger, or Telegram." },
  { title: "Payment QR Support", body: "Show your GCash, Maya, and bank QR codes so customers pay in a tap." },
  { title: "Custom Branding", body: "Your logo, colors, and fonts. A store that looks unmistakably yours from day one." },
  { title: "Order Tracking", body: "Give customers a tracking page and keep every order moving to delivered." },
  { title: "Admin Dashboard", body: "Manage products, orders, payments, and content from one simple control center." },
];

// ──────────────────────────── Packages ────────────────────────────
// Derived from the admin plan source of truth. `key` is the DB plan key
// (starter | pro | enterprise) — what the onboarding submission stores.
// Pricing surfaces should call packagesFrom(getPlanConfig().plans) so
// operator edits (Super Admin → Plans & Billing) show up; PACKAGES is the
// code-default fallback.
export type Package = {
  key: string;
  name: string;
  priceLabel: string; // list price
  discountLabel?: string; // promo price when set; show it as the headline with priceLabel struck through
  priceCents: number; // effective price (discount when set, else list) — used for checkout totals
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
      blurb: p.blurb,
      feats: p.feats,
      tag: p.tag || undefined,
      highlighted: p.key === "pro",
    };
  });
}

export const PACKAGES: Package[] = packagesFrom(defaultPlanConfig().plans);

// ──────────────────────────── 1-month trial promo ────────────────────────────
// Banner above the pricing cards + the trial note on the Business card.
export const TRIAL_PROMO = {
  tag: "New · 1-month trial",
  title: "Subukan ang Business package nang isang buwan — ₱699 lang",
  body: "Hindi ka pa sigurado sa ₱9,899? Subukan muna ang buong system nang isang buwan. Kung sulit para sa'yo, saka ka mag-commit.",
  cta: "Start 1-month trial",
  // Shown under the Business card's price.
  cardNote: "o subukan muna: ₱699 / 1 month trial",
  // Trial signs up onto the Business plan; the operator confirms the trial arrangement.
  href: "/get-started?plan=pro&trial=1",
} as const;

export function packageLabel(key: string): string {
  return (PLAN_META[key] ?? PLAN_META.starter).label;
}

// ──────────────────────────── FAQ ────────────────────────────
export type Faq = { q: string; a: string };

export const FAQS: Faq[] = [
  { q: "How long does setup take?", a: "Most stores go live within 2–5 business days after you complete onboarding and we receive your payment. Larger catalogs may take a little longer." },
  { q: "Can I use my own domain?", a: "Yes — we can connect a domain you already own, or help you register a new one so your store lives at your own address." },
  { q: "Can I customize the colors and branding?", a: "Every store is built with your logo, colors, and fonts so it looks unmistakably yours from day one." },
  { q: "Do you support WhatsApp orders?", a: "Yes. Customers complete their order and it lands straight in your WhatsApp, Messenger, or Telegram — complete and organized." },
  { q: "Can I upload products later?", a: "Anytime. Add products with photos, prices, and categories in seconds from your admin dashboard — no developer needed." },
  { q: "How do customers pay?", a: "Show your GCash, Maya, and bank QR codes so customers pay in a tap, then upload proof of payment right on the store." },
];

// ──────────────────────────── Final CTA ────────────────────────────
export const FINAL_CTA = {
  title: "Mas kaunting oras sa chat. Mas maraming oras sa paglago.",
  body: "Sagutin ang ilang simpleng tanong tungkol sa business mo, at kami na ang bahala sa setup. Sa loob ng ilang araw, may system ka nang sumasagot para sa'yo.",
  cta: "Get Started",
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

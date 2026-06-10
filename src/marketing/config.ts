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
  tagline: "Mas kaunting oras sa chat, mas maraming oras sa paglago.",
  hero: {
    chip: "Business automation, done-for-you",
    line1: "Stop Being The Customer Support",
    line2: "Of Your Own Peptide Business",
    sub: "Si Jonina ang sasagot sa paulit-ulit na tanong, magpapakita ng products at COAs, at kokolekta ng orders — 24/7. Para ikaw, focus sa paglago ng negosyo, hindi sa kaka-reply.",
    primaryCta: "Get Started",
    secondaryCta: "View Demo Stores",
  },
  contactEmail: "hello@jonina.store",
};

// ──────────────────────────── Hero bullets ────────────────────────────
// Outcome-first benefit bullets under the hero sub. Taglish, entrepreneur voice.
export const HERO_BULLETS = [
  "Hindi mo na sasagutin ang “magkano po?” nang 40 beses sa isang araw",
  "Products, presyo, at COAs — nakikita ng customers nang mag-isa",
  "Orders dumarating nang kumpleto at organized, hindi nakakalat sa DMs",
  "Tumatakbo ang business kahit tulog ka o nasa byahe",
] as const;

// ──────────────────────────── The problem (pain cards) ────────────────────────────
export type Pain = { q: string; body: string };

export const PAINS: Pain[] = [
  { q: "“Magkano po?”", body: "Pang-30 na today. Copy-paste ka na naman ng parehong sagot." },
  { q: "“Pa-send po ng product info”", body: "Hahanapin mo pa sa gallery, ise-send mong isa-isa. Ulit. Ulit. Ulit." },
  { q: "“May COA po ba?”", body: "Meron naman — pero nasa files mo, at ikaw ang maghahanap tuwing may magtatanong." },
  { q: "“Paano po umorder?”", body: "Ipapaliwanag mo ulit ang steps, sa pang-sampung tao ngayong araw." },
  { q: "“Sent na po payment”", body: "Ikaw pa rin ang magve-verify — isa-isa, screenshot by screenshot." },
  { q: "“Saan na po order ko?”", body: "Bubuksan mo pa ang courier app para sa pang-limang follow-up today." },
];

export const PAIN_CLOSER =
  "Hindi ka tamad. Sobrang busy ka lang sa mga bagay na pwede namang i-automate.";

// ──────────────────────────── The hidden cost ────────────────────────────
export const COST_STATS = [
  { value: "3 oras", label: "kada araw na nauubos sa kakasagot ng parehong tanong" },
  { value: "90 oras", label: "kada buwan na napupunta sa chat, hindi sa negosyo" },
  { value: "2+ linggo", label: "ng full-time na trabaho — nawawala buwan-buwan" },
] as const;

export const COST_CARDS: Feature[] = [
  { icon: "UserX", title: "Missed opportunities", body: "May seryosong buyer na nag-message kahapon. Hindi mo nasagot agad — sa iba na siya bumili." },
  { icon: "TrendingDown", title: "Slower growth", body: "Walang oras mag-restock, mag-promote, o mag-isip ng bago. Ubos ang araw mo sa inbox." },
  { icon: "Flame", title: "Burnout", body: "Kahit Sunday, naka-standby ka. Yung “off” mo, may kasamang kaba na baka may nag-message." },
  { icon: "BellRing", title: "Distractions", body: "Bawat ding ng notification, naputol ang ginagawa mo. Hirap tuloy mag-focus sa malalaking bagay." },
];

// ──────────────────────────── The real problem ────────────────────────────
export const REAL_PROBLEM = {
  line1: "The problem isn’t your product.",
  line2: "The problem is that you are the system.",
  beats: [
    { lead: "Pag online ka,", rest: "may benta." },
    { lead: "Pag busy ka,", rest: "bumabagal ang lahat." },
    { lead: "Pag wala ka,", rest: "naghihintay ang customers." },
  ],
  closer:
    "Hindi mo kailangan ng mas mahabang working hours. Kailangan mo ng system na hindi umaasa sa’yo para gumana.",
} as const;

// ──────────────────────────── Future vision (customer flow) ────────────────────────────
export const VISION_STEPS = [
  { n: "01", title: "Dumating ang customer", body: "Nakita niya ang branded store mo — mukhang legit, mukhang professional." },
  { n: "02", title: "Nag-browse siya ng products", body: "Kumpleto: photos, presyo, descriptions, COAs. Halos wala nang itatanong." },
  { n: "03", title: "Nabasa niya paano umorder", body: "Malinaw ang steps at payment instructions. Hindi ka niya kailangang kulitin." },
  { n: "04", title: "Naka-order na siya", body: "Pumili, nagbayad, nag-upload ng proof — lahat sa store, hindi sa DMs." },
  { n: "05", title: "Ikaw, na-notify ka lang", body: "Bukas mo ang dashboard, kumpleto na ang detalye. Confirm na lang. Tapos." },
] as const;

export const VISION_CLOSER =
  "Walang paulit-ulit na tanong. Walang nakakalat na screenshots. Isang organized na system — habang ginagawa mo ang mas mahalagang trabaho.";

// ──────────────────────────── Introduce Jonina (system intro) ────────────────────────────
export const SYSTEM_CARDS: Feature[] = [
  { icon: "Globe", title: "Hindi lang website", body: "Ang website ang mukha. Ang system ang gumagawa ng trabaho — sumasagot, nag-oorganize, kumukuha ng orders." },
  { icon: "Layers", title: "Hindi lang software", body: "Done-for-you ang setup, branding, at products. Hindi DIY na tool na ikaw pa ang mag-aaral." },
  { icon: "Workflow", title: "Hindi lang storefront", body: "Catalog, FAQs, COAs, ordering, payment proof, tracking — buong operasyon, hindi isang page lang." },
];

export const SYSTEM_CLOSER =
  "Hindi lang ito website. System ito para mas organized ang business mo — at para hindi na ikaw ang customer support nito.";

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

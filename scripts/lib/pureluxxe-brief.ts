// The Pureluxxe client brief, as data.
//
// Split out of the provisioning script so it can be CHECKED before it is
// APPLIED. Provisioning writes a live shop in one transaction; the 21 prices
// below were transcribed by hand from a photographed price list, and a mistyped
// one becomes a real customer being quoted the wrong number. The gate
// (npm run test:pureluxxe) re-states the same list independently and refuses to
// pass unless the two agree, per item and by total.
//
// Client brief (2026-08-08):
//   Business    Pureluxxe — beauty and wellness, delivered at home
//   Contact     Jeraldine · jgraceparfan@gmail.com · WhatsApp +966 59 230 2130
//   Market      Saudi Arabia — the shop trades in SAR, not pesos
//   Branding    Coral pink, taken from the logo
//   Package     Business (pro)
//   Launch      Active immediately
//
// Payment methods are deliberately EMPTY: the client said the owner will upload
// their own. An invented payment instruction is worse than none — a customer
// would send money to the wrong account.

import type { OnboardingInput } from "../../src/lib/onboarding/schema";

export const SLUG = "pureluxxe";

/** Saudi riyal. The whole point of the currency work — this store never sees a
 *  peso, on the storefront or in its owner's own dashboard. */
export const CURRENCY = "SAR";

/**
 * The palette, sampled from the client's logo (white lotus mark on coral).
 *
 * `button` is the logo's coral itself. `buttonText` is the deep cocoa ink rather
 * than white: white on #F2726A is about 2.6:1 and fails WCAG AA outright, while
 * the cocoa clears it at roughly 5.3:1. `accent` is a deepened coral for links
 * and highlights, where the raw logo colour would be too light on white.
 */
export const PALETTE = {
  /** Brand ink — headings, body, and the button label. */
  main: "#3A1F1C",
  /** Deepened coral for links, highlights and small text. */
  accent: "#C2412F",
  /** The logo's coral, used for CTAs. */
  button: "#F2726A",
  /** Secondary CTA / hover. */
  button2: "#C2412F",
  /** Label colour on the coral button — cocoa, not white. See above. */
  buttonText: "#3A1F1C",
} as const;

/** One row of the client's price list. Prices are whole SAR. */
export type PriceRow = { name: string; price: number; category: string; description: string };

/**
 * The catalog, in the order the client listed it. Four families, because a flat
 * 21-item list has no browsable structure — the storefront renders categories.
 */
export const PRICE_LIST: PriceRow[] = [
  // ── Weight management ─────────────────────────────────────────────────────
  { name: "TIRZE 15", price: 200, category: "Weight Loss", description: "Tirzepatide 15mg — dual GIP/GLP-1 research peptide." },
  { name: "TIRZE 30", price: 300, category: "Weight Loss", description: "Tirzepatide 30mg — dual GIP/GLP-1 research peptide." },
  { name: "TIRZE 60", price: 400, category: "Weight Loss", description: "Tirzepatide 60mg — dual GIP/GLP-1 research peptide, best value per mg." },
  { name: "RETA 30", price: 450, category: "Weight Loss", description: "Retatrutide 30mg — triple-agonist research peptide." },
  { name: "Cagri 10mg", price: 250, category: "Weight Loss", description: "Cagrilintide 10mg — amylin analogue, commonly paired with a GLP-1." },
  { name: "Fat Blaster", price: 250, category: "Weight Loss", description: "Lipolytic blend for targeted body contouring support." },
  { name: "5-Amino 50mg", price: 250, category: "Weight Loss", description: "5-Amino-1MQ 50mg — metabolic support compound." },

  // ── Skin, glow and aesthetics ─────────────────────────────────────────────
  { name: "GHK-Cu", price: 200, category: "Skin & Glow", description: "GHK-Cu copper peptide — skin repair, collagen and firmness support." },
  { name: "GHK Topical", price: 150, category: "Skin & Glow", description: "GHK-Cu in a topical base — daily surface application." },
  { name: "GTT (Gluta)", price: 250, category: "Skin & Glow", description: "Glutathione — antioxidant support for brightening protocols." },
  { name: "Klow Stack", price: 350, category: "Skin & Glow", description: "The K-Glow stack — combined glow protocol in one kit." },
  { name: "Snap-8", price: 120, category: "Skin & Glow", description: "SNAP-8 peptide — expression-line softening for topical routines." },
  { name: "Lemon Bottle", price: 150, category: "Skin & Glow", description: "Lemon Bottle lipolytic solution — original formulation." },
  { name: "Lemon Bottle China", price: 100, category: "Skin & Glow", description: "Lemon Bottle lipolytic solution — China-sourced formulation." },

  // ── Wellness and longevity ────────────────────────────────────────────────
  { name: "NAD+", price: 200, category: "Wellness", description: "NAD+ — cellular energy and longevity support." },
  { name: "MOTS-C 10mg", price: 250, category: "Wellness", description: "MOTS-c 10mg — mitochondrial-derived peptide for metabolic support." },
  { name: "KPV 10mg", price: 220, category: "Wellness", description: "KPV 10mg — tripeptide studied for inflammatory and gut support." },
  { name: "LipoC B12", price: 200, category: "Wellness", description: "Lipotropic blend with B12 — energy and metabolism support." },
  { name: "Tesamorelin", price: 400, category: "Wellness", description: "Tesamorelin — growth-hormone-releasing research peptide." },

  // ── Focus and mood ────────────────────────────────────────────────────────
  { name: "Semax 10mg", price: 150, category: "Focus & Mood", description: "Semax 10mg — nootropic research peptide for focus and clarity." },
  { name: "Selank 10mg", price: 150, category: "Focus & Mood", description: "Selank 10mg — anxiolytic research peptide, often paired with Semax." },
];

/**
 * The brief in the exact shape the self-serve wizard produces, so provisioning
 * runs the real onboardingSchema + buildProvisioning rather than hand-rolling a
 * branding blob. The store lands byte-identical to a wizard sign-up.
 */
export const BRIEF: OnboardingInput = {
  businessName: "Pureluxxe",
  businessType: "Beauty and Wellness",
  description:
    "Beauty and wellness, delivered at home. Research-grade peptides and glow protocols — lab-tested, high purity, discreetly delivered across Saudi Arabia.",
  contactPerson: "Jeraldine",
  email: "jgraceparfan@gmail.com",
  whatsapp: "+966 59 230 2130",
  facebook: "",

  themeStyle: "luxury",
  // Nearest preset in the warm-red family; the palette above overrides its
  // main/accent/button anyway, so the preset only seeds surfaces and fonts.
  themeId: "imperial-cinnabar",
  primaryColor: PALETTE.main,
  secondaryColor: PALETTE.accent,
  // The client's logo is a PNG they sent in chat, not a file in this repo. It
  // is uploaded to ImageKit separately and set on the tenant afterwards — see
  // the provisioning script's closing notes.
  logoUrl: "",

  products: PRICE_LIST.map((p) => ({
    name: p.name,
    price: p.price,
    category: p.category,
    description: p.description,
  })),

  orderDestination: "whatsapp",
  orderDestinationValue: "+966 59 230 2130",

  // The owner uploads their own bank/transfer details. See the header note.
  paymentMethods: [],

  packageKey: "pro",
  billingCycle: "monthly",
  trial: false,
  selectedFeatures: [],

  paymentProofUrl: "",
  termsAccepted: true, // operator-entered intake on the client's behalf
};

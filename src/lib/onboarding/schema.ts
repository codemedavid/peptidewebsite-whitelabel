// Shared, PURE onboarding payload schema (no server-only / Prisma / React imports)
// so the client wizard can pre-validate with the exact same rules the server
// action enforces authoritatively. Images are passed as URLs only — they're
// uploaded first via POST /api/onboarding/upload, so this payload stays tiny and
// well under the server-action body-size limit.

import { z } from "zod";

export const THEME_STYLES = ["minimal", "luxury", "ecommerce", "dark", "custom"] as const;
export const ORDER_DESTINATIONS = ["whatsapp", "messenger", "telegram", "email"] as const;
export const PACKAGE_KEYS = ["starter", "pro", "enterprise"] as const;

// Starter add-on features: the storefront ships with ordering/catalog always on;
// a Starter client picks exactly STARTER_FEATURE_LIMIT of these. Each key maps to
// a storefront `showPage*` toggle in the brand config (see lib/onboarding/mapping).
export const STARTER_FEATURE_KEYS = ["track", "faq", "calculator", "protocols", "coa"] as const;
export type StarterFeatureKey = (typeof STARTER_FEATURE_KEYS)[number];
export const STARTER_FEATURE_LIMIT = 2;
export const STARTER_FEATURE_LABELS: Record<StarterFeatureKey, string> = {
  track: "Order Tracking",
  faq: "FAQ Page",
  calculator: "Peptide Calculator",
  protocols: "Protocols (20+)",
  coa: "Lab Results (COA)",
};

const url = z.string().trim().max(2_000_000); // permits hosted URLs and demo data-URLs

export const onboardingProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required.").max(120),
  price: z.coerce.number().min(0).max(100_000_000),
  description: z.string().trim().max(2000).optional().default(""),
  category: z.string().trim().max(80).optional().default(""),
  imageUrl: url.optional().default(""),
});

export const onboardingPaymentMethodSchema = z.object({
  name: z.string().trim().min(1).max(120),
  account: z.string().trim().max(200).optional().default(""),
  number: z.string().trim().max(200).optional().default(""),
  qrUrl: url.optional().default(""),
  instructions: z.string().trim().max(1000).optional().default(""),
});

export const onboardingSchema = z.object({
  // Step 1 — business information
  businessName: z.string().trim().min(2, "Business name is required.").max(120),
  businessType: z.string().trim().max(80).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  contactPerson: z.string().trim().max(120).optional().default(""),
  email: z.string().trim().email("A valid email is required.").max(200),
  whatsapp: z.string().trim().max(40).optional().default(""),
  facebook: z.string().trim().max(300).optional().default(""),

  // Step 2 — branding & design
  themeStyle: z.enum(THEME_STYLES).optional(),
  themeId: z.string().trim().min(1).max(60).default("clinical-white"),
  primaryColor: z.string().trim().max(40).optional().default(""),
  secondaryColor: z.string().trim().max(40).optional().default(""),
  logoUrl: url.optional().default(""),
  bannerUrls: z.array(url).max(8).optional().default([]),
  inspirationUrls: z.array(url).max(8).optional().default([]),
  inspirationNotes: z.string().trim().max(3000).optional().default(""),

  // Step 3 — products
  products: z.array(onboardingProductSchema).max(100).optional().default([]),

  // Step 4 — order destination
  orderDestination: z.enum(ORDER_DESTINATIONS).default("whatsapp"),
  orderDestinationValue: z.string().trim().max(300).optional().default(""),

  // Step 5 — payment methods
  paymentMethods: z.array(onboardingPaymentMethodSchema).max(20).optional().default([]),

  // Step 6 — package selection (marketing label or alias → normalized server-side)
  packageKey: z.string().trim().min(1).max(40).default("starter"),

  // Step 6 — Starter add-on features (exactly STARTER_FEATURE_LIMIT for Starter;
  // ignored/empty for other tiers, which ship with all pages on). Enforced for
  // Starter in the server action.
  selectedFeatures: z.array(z.enum(STARTER_FEATURE_KEYS)).max(STARTER_FEATURE_LIMIT).optional().default([]),

  // Step 7 — checkout
  paymentProofUrl: url.optional().default(""),
  termsAccepted: z.boolean(),

  // Anti-spam honeypot — must be empty (real users never see/fill it).
  website: z.string().max(0).optional().default(""),
});

export type OnboardingPayload = z.infer<typeof onboardingSchema>;
export type OnboardingProductInput = z.infer<typeof onboardingProductSchema>;
export type OnboardingPaymentMethodInput = z.infer<typeof onboardingPaymentMethodSchema>;

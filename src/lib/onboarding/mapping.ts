// PURE mapping layer: onboarding payload → the shapes the provisioner persists.
// Produces (a) the storefront `Brand` config blob (Partial<Brand>) that the
// storefront merges over BRAND + theme palette (see (tenant)/(storefront)/page.tsx),
// (b) the per-product DB write payloads, and (c) the tenant settings. No Prisma /
// server-only imports so it can be unit-tested and shared.

import type { Brand, Category, ContactChannel, PaymentMethod, Product } from "@/storefront/types";
import { normalizeContactChannels } from "@/lib/storefront/contact-channels";
import { normalizeCurrency } from "@/lib/storefront/currency";
import {
  productToDbWrite,
  slugify,
  type ProductDbWrite,
} from "@/lib/storefront/product-mapping";
import { META_DESCRIPTION_MAX } from "@/lib/storefront/contact-channels";
import { planMeta } from "@/lib/admin/plans";
import type { OnboardingPayload } from "./schema";

// Each Starter add-on feature maps to a storefront `showPage*` toggle, which
// reveals both its public page and (where coupled) its store-admin manager.
// Anything not chosen is forced off; reviews/merchant aren't part of the Starter
// offer either. Other tiers keep storefront defaults (all pages on).
function starterPageToggles(selected: string[]): Partial<Brand> {
  const chosen = new Set(selected);
  return {
    showPageTrack: chosen.has("track"),
    showPageFAQ: chosen.has("faq"),
    showPageCalculator: chosen.has("calculator"),
    showPageProtocols: chosen.has("protocols"),
    showPageCOA: chosen.has("coa"),
    showPageReviews: false,
  };
}

// The platform was born PH-focused (GCash/Maya/bank), so the peso is the
// DEFAULT — not the only option. A store sold in riyals is provisioned in
// riyals; passing nothing keeps the peso every existing caller expects.
const CURRENCY_SYMBOL = "₱";
const CURRENCY_ISO = "PHP";

/** The symbol + ISO code one provisioning run should stamp everywhere.
 *
 *  Both matter and they are not the same field: brand config and product cards
 *  render the SYMBOL, while StoreSettings.currency and Product.currency hold the
 *  ISO CODE. Deriving both from one normalizeCurrency call is what stops a store
 *  being written as "SAR" in one column and "PHP" in the next. */
function currencyFor(currency?: unknown): { symbol: string; iso: string } {
  const money = normalizeCurrency(currency);
  // A bare custom glyph ("₸") has no ISO identity we can honestly claim, so the
  // ISO column falls back rather than inventing a code the world doesn't use.
  return { symbol: money.symbol, iso: money.code || CURRENCY_ISO };
}

export type ProvisioningPlan = {
  brandConfig: Partial<Brand>;
  productWrites: ProductDbWrite[];
  settings: { storeName: string; supportEmail: string; currency: string };
};

/** Map the order-destination choice to the storefront's 3 canonical channels. */
function contactChannelsFrom(payload: OnboardingPayload): ContactChannel[] {
  const channels = normalizeContactChannels([]); // whatsapp / telegram / messenger
  const dest = payload.orderDestination;
  const value = (payload.orderDestinationValue || payload.whatsapp || "").trim();
  // Email/Messenger-page can't be a storefront checkout channel of the same kind;
  // map the three the storefront supports, leave the rest for the operator.
  if (value && (dest === "whatsapp" || dest === "telegram" || dest === "messenger")) {
    return channels.map((c) => (c.type === dest ? { ...c, destination: value, enabled: true } : c));
  }
  // WhatsApp number given separately even if the picked destination was email.
  const wa = (payload.whatsapp || "").trim();
  if (wa) return channels.map((c) => (c.type === "whatsapp" ? { ...c, destination: wa, enabled: true } : c));
  return channels;
}

function paymentMethodsFrom(payload: OnboardingPayload): PaymentMethod[] {
  return payload.paymentMethods.map((m, i) => ({
    id: `pm${i + 1}`,
    name: m.name,
    account: m.account ?? "",
    number: m.number ?? "",
    qrImage: m.qrUrl ?? "",
    order: i + 1,
    active: true,
  }));
}

/** Unique storefront categories derived from the products, with the synthetic
 *  "all" tab first (matches the storefront's normalizeCategories contract). */
function categoriesFrom(payload: OnboardingPayload): Category[] {
  const out: Category[] = [{ id: "all", label: "All Products" }];
  const seen = new Set<string>(["all"]);
  for (const p of payload.products) {
    const label = (p.category || "").trim();
    if (!label) continue;
    const id = slugify(label);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
  }
  return out;
}

/** Build the Partial<Brand> config blob written to Branding.config. Only fields
 *  the client actually provided are set, so the chosen theme palette still drives
 *  surfaces/fonts for everything left blank. */
function brandConfigFrom(payload: OnboardingPayload, symbol: string): Partial<Brand> {
  const config: Partial<Brand> = {
    name: payload.businessName,
    industry: payload.businessType || "small business",
    currency: symbol,
    contactChannels: contactChannelsFrom(payload),
    paymentMethods: paymentMethodsFrom(payload),
    categories: categoriesFrom(payload),
    // Hero copy seeded from the business info; the operator refines later.
    heroChipLabel: payload.businessType || "Now open",
    heroLine1: payload.businessName,
    heroSub:
      payload.description?.trim() ||
      `Shop ${payload.businessName} — quality products, fast checkout.`,
    metaDescription: (payload.description || "").trim().slice(0, META_DESCRIPTION_MAX),
  };
  if (payload.logoUrl) config.logoUrl = payload.logoUrl;
  // Accent colors override the theme palette; surfaces/text stay theme-driven.
  const primary = (payload.primaryColor || "").trim();
  const secondary = (payload.secondaryColor || "").trim();
  if (primary) config.main = primary;
  if (secondary || primary) {
    const accent = secondary || primary;
    config.accent = accent;
    config.button = accent;
    config.button2 = accent;
    config.buttonText = "#ffffff";
  }
  // Starter ships ordering/catalog only; the client's 2 picks gate the rest.
  // Other tiers keep every page on (storefront defaults), so leave them untouched.
  if (planMeta(payload.packageKey).key === "starter") {
    Object.assign(config, starterPageToggles(payload.selectedFeatures));
  }
  return config;
}

function productWritesFrom(
  payload: OnboardingPayload,
  symbol: string,
  iso: string,
): ProductDbWrite[] {
  return payload.products
    .filter((p) => p.name.trim())
    .map((p) => {
      const product = {
        name: p.name,
        description: p.description ?? "",
        price: p.price,
        currency: symbol,
        category: p.category ?? "",
        featured: false,
        image: p.imageUrl || null,
        available: true,
      } as Product;
      return productToDbWrite(product, iso, symbol);
    });
}

/**
 * Turn a validated onboarding payload into the writes that create a tenant.
 *
 * `currency` is optional and defaults to the peso, so every existing caller —
 * the public wizard, the operator's onboarding screen, the provisioning scripts
 * — keeps producing exactly the store it produces today. Pass one to sell a shop
 * in another currency; it is stamped on the brand config, on every product row
 * and on StoreSettings in a single consistent pair.
 */
export function buildProvisioning(
  payload: OnboardingPayload,
  currency?: unknown,
): ProvisioningPlan {
  const { symbol, iso } = currencyFor(currency);
  return {
    brandConfig: brandConfigFrom(payload, symbol),
    productWrites: productWritesFrom(payload, symbol, iso),
    settings: {
      storeName: payload.businessName,
      supportEmail: payload.email,
      currency: iso,
    },
  };
}

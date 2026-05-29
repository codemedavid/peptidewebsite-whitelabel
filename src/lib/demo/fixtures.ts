import fs from "node:fs";
import path from "node:path";
import type { Product } from "@/storefront/types";
import { slugify } from "@/lib/storefront/product-mapping";
import { planFeatureSet, type FeatureKey } from "@/lib/features/catalog";
import type { HeroTypography } from "@/lib/theme/tokens";
import {
  defaultOrderNumberFormat,
  formatOrderNumber,
  normalizeOrderNumberFormat,
  SEQ_START,
  type OrderNumberFormat,
} from "@/lib/orders/order-number-format";

/**
 * DEMO MODE — renders the platform with no database AND demonstrates the
 * white-label core: multiple branded tenants resolved by subdomain from ONE
 * codebase. Tenants created in the demo admin are persisted to
 * .demo-data/tenants.json so they survive reloads and go live immediately at
 * <slug>.localhost. Wiring a real Supabase DATABASE_URL turns all of this off.
 */
export function isDemoMode(): boolean {
  if (process.env.DEMO_MODE === "true") return true;
  const url = process.env.DATABASE_URL ?? "";
  return url === "" || url.includes("u:p@localhost:5432/db");
}

export type DemoProduct = {
  id: string;
  name: string;
  slug: string;
  description: string;
  priceCents: number;
  currency: string;
  images: string[];
  status: string;
  active: boolean;
  metadata: { purity?: string; coaUrl?: string };
};

export type DemoTenant = {
  id: string; // == slug in demo
  name: string;
  slug: string;
  plan: string; // starter | pro | enterprise
  themeId: string;
  colors: Record<string, string>;
  storeName: string;
  compliance: string;
  hero: { eyebrow: string; title: string; subtitle: string };
  products: DemoProduct[];
};

function p(slug: string, name: string, priceCents: number, purity: string, description: string): DemoProduct {
  return { id: slug, slug, name, description, priceCents, currency: "USD", images: [], status: "active", active: true, metadata: { purity } };
}

/** Built-in seed tenants — three brands, one codebase. */
const BUILTIN_TENANTS: Record<string, DemoTenant> = {
  acme: {
    id: "acme", name: "Acme Peptides", slug: "acme", plan: "enterprise", themeId: "midnight-lab", colors: {},
    storeName: "Acme Peptides",
    compliance: "For laboratory research use only. Not for human or animal consumption.",
    hero: { eyebrow: "Research-grade", title: "Precision peptides for serious labs", subtitle: "99%+ purity, third-party COAs on every batch. Trusted by research teams worldwide." },
    products: [
      p("bpc-157", "BPC-157 5mg", 4999, "99.2%", "Stable lyophilized peptide with third-party COA on file."),
      p("tb-500", "TB-500 5mg", 5999, "98.8%", "Research peptide, lyophilized. Bulk pricing available."),
      p("ghk-cu", "GHK-Cu 50mg", 3499, "99.0%", "Copper peptide for research applications."),
      p("semaglutide", "Semaglutide 5mg", 12999, "99.5%", "High-purity research-grade peptide."),
    ],
  },
  apex: {
    id: "apex", name: "Apex Research", slug: "apex", plan: "pro", themeId: "apex-performance", colors: {},
    storeName: "Apex Research Chemicals",
    compliance: "Sold strictly for in-vitro research. Not for diagnostic or therapeutic use.",
    hero: { eyebrow: "Performance series", title: "Push the limits of your research", subtitle: "Lab-tested compounds, shipped fast. Built for performance research labs." },
    products: [
      p("ipamorelin", "Ipamorelin 5mg", 5499, "99.1%", "Selective research peptide."),
      p("cjc-1295", "CJC-1295 5mg", 6499, "98.9%", "Lyophilized, COA available."),
      p("mots-c", "MOTS-c 10mg", 8999, "99.3%", "Mitochondrial-derived research peptide."),
      p("tesamorelin", "Tesamorelin 10mg", 13999, "99.4%", "High-purity research compound."),
    ],
  },
  helix: {
    id: "helix", name: "Helix Biolabs", slug: "helix", plan: "starter", themeId: "clinical-white", colors: {},
    storeName: "Helix Biolabs",
    compliance: "Research use only. These products are not intended to treat, cure, or prevent any disease.",
    hero: { eyebrow: "Clinical-grade supply", title: "Reliable peptides, transparent sourcing", subtitle: "Every vial traceable to its certificate of analysis. Clean, clinical, dependable." },
    products: [
      p("epithalon", "Epithalon 10mg", 4499, "99.0%", "Research peptide, lyophilized."),
      p("ghrp-6", "GHRP-6 5mg", 3999, "98.7%", "Lab-tested research compound."),
      p("pt-141", "PT-141 10mg", 5999, "99.2%", "High-purity research peptide."),
      p("aod-9604", "AOD-9604 5mg", 6999, "99.1%", "Research-grade lyophilized peptide."),
    ],
  },
};

const DEFAULT_SLUG = "acme";
const DATA_DIR = path.join(process.cwd(), ".demo-data");
const DATA_FILE = path.join(DATA_DIR, "tenants.json");
const BRANDING_FILE = path.join(DATA_DIR, "branding.json");
const FEATURES_FILE = path.join(DATA_DIR, "features.json");
const ORDER_FORMAT_FILE = path.join(DATA_DIR, "order-format.json");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");

export type DemoBranding = {
  themeId?: string;
  colors?: Record<string, string>; // role map (HSL triples)
  fonts?: { heading?: string; body?: string };
  hero?: HeroTypography; // per-tenant hero typography overrides
  config?: Record<string, unknown>; // full storefront Brand config (Partial<Brand>) — see storefront/types
  logoUrl?: string | null; // storefront logo (data URL in demo, ImageKit URL in prod)
  faviconUrl?: string | null; // overrides /api/favicon when set
};

function readBranding(): Record<string, DemoBranding> {
  try {
    return JSON.parse(fs.readFileSync(BRANDING_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function getDemoBranding(slug: string): DemoBranding {
  return readBranding()[slug] ?? {};
}

export function saveDemoBranding(slug: string, branding: DemoBranding): void {
  const all = readBranding();
  // Merge so partial writes (theme/colors vs. logo/favicon uploads) don't
  // clobber each other — each editor section persists only its own fields.
  all[slug] = { ...all[slug], ...branding };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BRANDING_FILE, JSON.stringify(all, null, 2));
}

// ── Storefront products (demo persistence) ──
// The file-backed analogue of the real `products` table. Once the store owner
// saves/deletes a product in demo mode, the whole tenant's storefront product
// set lives here (keyed by slug) and survives reloads. Until then the builtin
// fixture products (DemoTenant.products) are the seed — see the page loader.

function readStoreProducts(): Record<string, Product[]> {
  try {
    return JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
  } catch {
    return {};
  }
}

/** Saved storefront products for a tenant, or null if none have been saved. */
export function getDemoStoreProducts(slug: string): Product[] | null {
  return readStoreProducts()[slug] ?? null;
}

/** Persist the full storefront product set for a tenant (demo mode). */
export function saveDemoStoreProducts(slug: string, products: Product[]): void {
  const all = readStoreProducts();
  all[slug] = products;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(all, null, 2));
}

/**
 * Per-tenant feature override map (mirrors the branding.json pattern).
 * A key set to `false` revokes a feature the plan would otherwise allow;
 * absent or `true` means "on if the plan permits". Plan is still the ceiling.
 */
export type DemoFeatureMap = Partial<Record<FeatureKey, boolean>>;

function readFeatures(): Record<string, DemoFeatureMap> {
  try {
    return JSON.parse(fs.readFileSync(FEATURES_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function getDemoFeatures(slug: string): DemoFeatureMap {
  return readFeatures()[slug] ?? {};
}

export function saveDemoFeatures(slug: string, map: DemoFeatureMap): void {
  const all = readFeatures();
  all[slug] = map;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FEATURES_FILE, JSON.stringify(all, null, 2));
}

/**
 * Resolved entitlements in demo mode: plan ceiling minus any feature the saved
 * override map turns off. Features outside the plan stay locked off.
 */
export function getDemoEntitlements(idOrSlug: string): Set<FeatureKey> {
  const t = getDemoTenant(idOrSlug);
  const ceiling = planFeatureSet(t.plan);
  const overrides = getDemoFeatures(t.slug);
  const set = new Set<FeatureKey>();
  for (const key of ceiling) if (overrides[key] !== false) set.add(key);
  return set;
}

// ── Order-number format (demo persistence) ──
// Mirrors the real Tenant.orderNumberFormat + Tenant.orderSeq, but file-backed.
type DemoOrderFormatEntry = { format: OrderNumberFormat; seq: number };

function readOrderFormats(): Record<string, DemoOrderFormatEntry> {
  try {
    return JSON.parse(fs.readFileSync(ORDER_FORMAT_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeOrderFormats(all: Record<string, DemoOrderFormatEntry>): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ORDER_FORMAT_FILE, JSON.stringify(all, null, 2));
}

/** Resolved format for a tenant — saved override, else default from its name. */
export function getDemoOrderFormat(slug: string): OrderNumberFormat {
  const saved = readOrderFormats()[slug];
  const t = loadAll()[slug];
  const fallbackName = t?.name ?? slug;
  return saved
    ? normalizeOrderNumberFormat(saved.format, fallbackName)
    : defaultOrderNumberFormat(fallbackName);
}

/** Persist a tenant's order-number format, preserving its sequential counter. */
export function saveDemoOrderFormat(slug: string, format: OrderNumberFormat): void {
  const all = readOrderFormats();
  all[slug] = { format, seq: all[slug]?.seq ?? SEQ_START };
  writeOrderFormats(all);
}

/**
 * Demo generator — the file-backed analogue of lib/orders/order-number.ts.
 * Sequential increments the per-tenant counter; random returns an N-digit code.
 */
export function nextDemoOrderNumber(slug: string): string {
  const all = readOrderFormats();
  const t = loadAll()[slug];
  const fallbackName = t?.name ?? slug;
  const format = all[slug]
    ? normalizeOrderNumberFormat(all[slug].format, fallbackName)
    : defaultOrderNumberFormat(fallbackName);

  if (format.scheme === "sequential") {
    const seq = (all[slug]?.seq ?? SEQ_START) + 1;
    all[slug] = { format, seq };
    writeOrderFormats(all);
    return formatOrderNumber(format, seq);
  }
  return formatOrderNumber(format, Math.floor(Math.random() * 10 ** format.digits));
}

function readCreated(): DemoTenant[] {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

/** Built-ins + admin-created tenants, keyed by slug. */
function loadAll(): Record<string, DemoTenant> {
  const map: Record<string, DemoTenant> = { ...BUILTIN_TENANTS };
  for (const t of readCreated()) map[t.slug] = t;
  return map;
}

export function listDemoTenants(): DemoTenant[] {
  return Object.values(loadAll());
}

export function getDemoTenant(idOrSlug: string): DemoTenant {
  const all = loadAll();
  return all[idOrSlug] ?? all[DEFAULT_SLUG];
}

/** host like "apex.localhost" → "apex" (falls back to acme). */
export function demoSlugFromHost(host: string | null): string {
  if (!host) return DEFAULT_SLUG;
  const label = host.split(".")[0];
  return loadAll()[label] ? label : DEFAULT_SLUG;
}

export function getDemoContext(idOrSlug: string) {
  const t = getDemoTenant(idOrSlug);
  const override = getDemoBranding(t.slug);
  const features = getDemoEntitlements(t.slug);
  const planNames: Record<string, string> = { starter: "Starter", pro: "Pro", enterprise: "Enterprise" };
  return {
    tenant: {
      id: t.id, name: t.name, slug: t.slug, status: "active",
      plan: { key: t.plan, name: planNames[t.plan] ?? t.plan },
      branding: null, settings: null,
      orderNumberFormat: getDemoOrderFormat(t.slug),
    },
    branding: {
      themeId: override.themeId ?? t.themeId,
      colors: { ...t.colors, ...(override.colors ?? {}) }, // role map
      fonts: override.fonts ?? {},
      hero: override.hero ?? {}, // hero typography overrides
      config: override.config ?? {}, // full storefront Brand config
      radius: "0.5rem",
      logoUrl: (override.logoUrl ?? null) as string | null,
      faviconUrl: (override.faviconUrl ?? null) as string | null,
    },
    settings: { storeName: t.storeName, compliance: { researchUseOnly: t.compliance } },
    features,
    has: (key: FeatureKey) => features.has(key),
  };
}

export function getDemoProducts(idOrSlug: string) {
  return getDemoTenant(idOrSlug).products;
}

export function findDemoProduct(idOrSlug: string, slug: string): DemoProduct | null {
  // Once the owner has saved/added/deleted in demo mode, that file-backed set is
  // authoritative — so the detail page round-trips edits and new products just
  // like the catalog does. Storefront products have no slug, so match on the
  // slug derived from the name (same rule new DB products get).
  const saved = getDemoStoreProducts(idOrSlug);
  if (saved) {
    const p = saved.find((x) => slugify(x.name) === slug);
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      slug,
      description: p.description,
      priceCents: Math.round((p.price || 0) * 100),
      currency: p.currency,
      images: p.image ? [p.image] : [],
      status: p.available === false ? "draft" : "active",
      active: p.available !== false,
      metadata: { purity: p.purity },
    };
  }
  return getDemoTenant(idOrSlug).products.find((x) => x.slug === slug) ?? null;
}

export type CreateDemoTenantInput = {
  name: string;
  slug: string;
  plan: string;
  themeId: string;
  orderNumberFormat?: OrderNumberFormat; // defaults to one derived from `name`
};

/** Persist a new demo tenant. Returns { ok } or { error }. */
export function createDemoTenant(input: CreateDemoTenantInput): { ok: true } | { error: string } {
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Slug must be lowercase letters, numbers, hyphens (min 2)." };
  if (loadAll()[slug]) return { error: `Slug "${slug}" is already taken.` };

  const tenant: DemoTenant = {
    id: slug, name: input.name.trim(), slug, plan: input.plan, themeId: input.themeId, colors: {},
    storeName: input.name.trim(),
    compliance: "For laboratory research use only. Not for human or animal consumption.",
    hero: {
      eyebrow: "Research-grade",
      title: `${input.name.trim()} — research peptides`,
      subtitle: "High-purity peptides with third-party COAs. Built for research teams.",
    },
    products: [
      p("bpc-157", "BPC-157 5mg", 4999, "99.0%", "Stable lyophilized research peptide."),
      p("tb-500", "TB-500 5mg", 5999, "98.9%", "Lyophilized research peptide."),
    ],
  };

  const created = readCreated().filter((t) => t.slug !== slug);
  created.push(tenant);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(created, null, 2));

  // Persist the order-number format (default derived from the business name).
  saveDemoOrderFormat(slug, input.orderNumberFormat ?? defaultOrderNumberFormat(tenant.name));
  return { ok: true };
}

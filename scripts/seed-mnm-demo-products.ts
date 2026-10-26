/**
 * Sample catalog for `mnm-pepsabuy` so the owner can see the two-ways home
 * (group buy + on-hand) with products in it before loading the real list.
 *
 * Eight group-buy pre-orders (productType "gb" + gbPrice) — the store sells
 * group buy only (twoWaysMode.onHand "hidden"). One is a bac water, so the 1:1
 * ratio rule from the two-ways preset has something to pair with. Every SKU starts with `DEMO-` and every description says it is a
 * sample, so they are easy to spot in the store admin and `--remove` takes
 * exactly these back out.
 *
 * No product carries its own photo: the store's MNM logo is set as
 * branding.config.defaultProductImage, the render-time fallback for imageless
 * products (see src/lib/storefront/product-image.ts). Real products uploaded
 * later keep their own photos. `--remove` leaves the default image in place —
 * it is a store setting, not demo data.
 *
 * SAFE BY DEFAULT — dry run unless a flag is passed:
 *   npx tsx --env-file=.env scripts/seed-mnm-demo-products.ts            # print the plan
 *   npx tsx --env-file=.env scripts/seed-mnm-demo-products.ts --apply    # write
 *   npx tsx --env-file=.env scripts/seed-mnm-demo-products.ts --remove   # undo
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import type { ProductMetadata } from "../src/lib/storefront/product-mapping";
import type { Category } from "../src/storefront/types";

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes("--apply");
const REMOVE = ARGS.includes("--remove");
const TENANT_SLUG = "mnm-pepsabuy";
const SKU_PREFIX = "DEMO-";
const SYMBOL = "₱";
const ONHAND_STOCK = 20;
const SAMPLE_NOTE = "Sample listing for previewing the store layout.";

/** The store's logo (already on ImageKit from the tenant seed). */
const DEFAULT_PRODUCT_IMAGE =
  "https://ik.imagekit.io/jl17byaav/tenant/mnm-pepsabuy/logo-mnm-pepsabuy-IMG_0074_fy6zoNSxu.jpg";

const ALL_TAB: Category = { id: "all", label: "All Products" };
const CATEGORIES: Category[] = [
  { id: "peptides", label: "Peptides" },
  { id: "supplies", label: "Supplies" },
];

type DemoProduct = {
  key: string;
  name: string;
  price: number;
  /** Present = a group-buy pre-order at this price. */
  gbPrice?: number;
  category: string;
  featured: boolean;
  blurb: string;
  productClass?: ProductMetadata["productClass"];
};

const PRODUCTS: DemoProduct[] = [
  // Group-buy only store (owner, 2026-10-25: on-hand hidden) — every listing is
  // a group-buy pre-order, bac water included so the 1:1 ratio rule can pair.
  { key: "tirzepatide-15mg", name: "Tirzepatide 15mg", price: 2200, gbPrice: 1700, category: "peptides", featured: true, blurb: "Lyophilized research peptide, single 15mg vial." },
  { key: "ghk-cu-50mg", name: "GHK-Cu 50mg", price: 1100, gbPrice: 850, category: "peptides", featured: true, blurb: "Copper peptide, single 50mg vial." },
  { key: "nad-500mg", name: "NAD+ 500mg", price: 1300, gbPrice: 1000, category: "peptides", featured: false, blurb: "Research-grade NAD+, single 500mg vial." },
  { key: "bac-water-10ml", name: "Bacteriostatic Water 10ml", price: 150, gbPrice: 120, category: "supplies", featured: false, blurb: "0.9% benzyl alcohol, 10ml vial.", productClass: "bacWater" },
  { key: "retatrutide-20mg", name: "Retatrutide 20mg", price: 3800, gbPrice: 2900, category: "peptides", featured: true, blurb: "Research peptide, single 20mg vial." },
  { key: "tirzepatide-30mg", name: "Tirzepatide 30mg", price: 3200, gbPrice: 2450, category: "peptides", featured: true, blurb: "Lyophilized research peptide, single 30mg vial." },
  { key: "bpc157-tb500", name: "BPC-157 + TB-500 10mg", price: 2100, gbPrice: 1600, category: "peptides", featured: false, blurb: "Blend, 5mg + 5mg in one vial." },
  { key: "mots-c-10mg", name: "MOTS-c 10mg", price: 1800, gbPrice: 1350, category: "peptides", featured: false, blurb: "Research peptide, single 10mg vial." },
];

const peso = (n: number) => `${SYMBOL}${n.toLocaleString("en-PH")}`;

function toWrite(p: DemoProduct) {
  const metadata: ProductMetadata = {
    currencySymbol: SYMBOL,
    category: p.category,
    featured: p.featured,
    ...(p.gbPrice ? { productType: "gb" as const, gbPrice: p.gbPrice } : {}),
    ...(p.productClass ? { productClass: p.productClass } : {}),
    // Group-buy only store: no inventory behind any listing (needs the
    // storefront.made_to_order grant, or the flag is stripped at render).
    madeToOrder: true,
  };
  return {
    name: p.name,
    description: `${p.blurb}\n\n${SAMPLE_NOTE}`,
    priceCents: Math.round(p.price * 100),
    currency: "PHP",
    // Group-buy listings are pre-orders with no ready stock behind them.
    stock: p.gbPrice ? 0 : ONHAND_STOCK,
    status: "active",
    active: true,
    images: [],
    metadata: metadata as unknown as Prisma.InputJsonValue,
  };
}

function readCategories(config: Record<string, unknown>): Category[] {
  return Array.isArray(config.categories) ? (config.categories as Category[]) : [];
}

/** Saved categories + ours, with the "all" tab first and no duplicate ids. */
function withDemoCategories(saved: Category[]): Category[] {
  const real = saved.filter((c) => c?.id && c.id !== ALL_TAB.id);
  const ids = new Set(real.map((c) => c.id));
  return [ALL_TAB, ...real, ...CATEGORIES.filter((c) => !ids.has(c.id))];
}

async function writeConfig(tenantId: string, config: Record<string, unknown>) {
  const next = config as Prisma.InputJsonValue;
  await prisma.branding.upsert({
    where: { tenantId },
    update: { config: next },
    create: { tenantId, config: next },
  });
}

async function apply(tenantId: string, config: Record<string, unknown>) {
  for (const p of PRODUCTS) {
    const sku = `${SKU_PREFIX}${p.key}`;
    const slug = `demo-${p.key}`;
    const write = toWrite(p);
    await prisma.product.upsert({
      where: { tenantId_sku: { tenantId, sku } },
      update: { ...write, slug },
      create: { ...write, tenantId, sku, slug },
    });
  }
  await writeConfig(tenantId, {
    ...config,
    categories: withDemoCategories(readCategories(config)),
    defaultProductImage: DEFAULT_PRODUCT_IMAGE,
  });
  console.log(`\n✓ upserted ${PRODUCTS.length} demo products + categories + default product image`);
}

async function remove(tenantId: string, config: Record<string, unknown>) {
  const { count } = await prisma.product.deleteMany({
    where: { tenantId, sku: { startsWith: SKU_PREFIX } },
  });
  console.log(`\n✓ deleted ${count} demo product(s)`);

  // Keep any demo category a real product still uses.
  const remaining = await prisma.product.findMany({ where: { tenantId }, select: { metadata: true } });
  const inUse = new Set(remaining.map((r) => (r.metadata as ProductMetadata | null)?.category));
  const demoIds = new Set(CATEGORIES.map((c) => c.id));
  const kept = readCategories(config).filter((c) => !demoIds.has(c.id) || inUse.has(c.id));
  const realLeft = kept.filter((c) => c.id !== ALL_TAB.id);
  await writeConfig(tenantId, { ...config, categories: realLeft.length > 0 ? kept : [] });
  console.log(`✓ categories now: ${realLeft.map((c) => c.label).join(" · ") || "(none)"}`);
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  const mode = APPLY ? "APPLY" : REMOVE ? "REMOVE" : "DRY RUN";
  console.log(`Tenant: ${tenant.name} (${tenant.id}) — ${mode}`);

  const branding = await prisma.branding.findUnique({
    where: { tenantId: tenant.id },
    select: { config: true },
  });
  const config = (branding?.config ?? {}) as Record<string, unknown>;

  for (const p of PRODUCTS) {
    const path = p.gbPrice ? `GROUP BUY ${peso(p.gbPrice)}` : `on-hand ×${ONHAND_STOCK}`;
    console.log(`  ${peso(p.price).padStart(8)}  ${p.name.padEnd(28)} ${path}${p.featured ? "  ★" : ""}`);
  }
  console.log(`\ndefaultProductImage: ${JSON.stringify(config.defaultProductImage)} → ${DEFAULT_PRODUCT_IMAGE}`);
  console.log(`categories after apply: ${withDemoCategories(readCategories(config)).map((c) => c.label).join(" · ")}`);

  if (APPLY) await apply(tenant.id, config);
  else if (REMOVE) await remove(tenant.id, config);
  else console.log("\nDRY RUN — nothing written. Re-run with --apply (or --remove to undo).");

  if (APPLY || REMOVE) {
    console.log(
      "\nThe storefront caches its catalog: press Save in the store admin, or restart\n" +
        "the server, for the live page to pick this up.",
    );
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

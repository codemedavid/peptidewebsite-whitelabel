/**
 * Sample catalog for `pepsys-compound` — the SHOWCASE layout's test tenant — so
 * the category badges, the featured shelf and the collection card have
 * something to show (see scripts/configure-pepsys-showcase.ts).
 *
 * Eight listings across three categories, four of them featured. Every SKU starts
 * with `DEMO-` and every description says it is a sample, so they are easy to
 * spot in the store admin and `--remove` takes exactly these back out.
 *
 * Every listing uses the store's own branded "peps by jene" pink vial photo
 * (the owner's file "Luxury Pink Cosmetic Vial.png", uploaded once to the
 * tenant's ImageKit folder). Never another store's product photos — those carry
 * that store's brand.
 *
 * Categories: only adds the three ids below, keeping anything already saved
 * (and the synthetic "all" tab first). `--remove` takes the three back out
 * ONLY if no non-demo product is filed under them.
 *
 * SAFE BY DEFAULT — dry run unless a flag is passed:
 *   npx tsx scripts/seed-pepsys-demo-products.ts            # print the plan
 *   npx tsx scripts/seed-pepsys-demo-products.ts --apply    # write
 *   npx tsx scripts/seed-pepsys-demo-products.ts --remove   # undo
 */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import type { ProductMetadata } from "../src/lib/storefront/product-mapping";
import type { Category } from "../src/storefront/types";

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes("--apply");
const REMOVE = ARGS.includes("--remove");
const TENANT_SLUG = "pepsys-compound";
const SKU_PREFIX = "DEMO-";
const SYMBOL = "₱";
const DEMO_STOCK = 25;
const SAMPLE_NOTE = "Sample listing for previewing the store layout.";

/** The store's own branded vial photo — one image for every sample listing. */
const DEMO_IMAGE =
  "https://ik.imagekit.io/jl17byaav/tenant/pepsys-compound/product-pepsbyjene-vial_wMx-1b61L.png";

const ALL_TAB: Category = { id: "all", label: "All Products" };
const CATEGORIES: Category[] = [
  { id: "peptides", label: "Peptides" },
  { id: "skincare", label: "Skincare" },
  { id: "supplies", label: "Supplies" },
];

type DemoProduct = {
  key: string;
  name: string;
  price: number;
  category: string;
  featured: boolean;
  blurb: string;
};

const PRODUCTS: DemoProduct[] = [
  {
    key: "tirzepatide-30mg",
    name: "Tirzepatide 30mg",
    price: 2499,
    category: "peptides",
    featured: true,
    blurb: "Lyophilized research peptide, single 30mg vial.",
  },
  {
    key: "nad-500mg",
    name: "NAD+ 500mg",
    price: 1299,
    category: "peptides",
    featured: true,
    blurb: "Research-grade NAD+, single 500mg vial.",
  },
  {
    key: "ghk-cu-50mg",
    name: "GHK-Cu 50mg",
    price: 1199,
    category: "peptides",
    featured: true,
    blurb: "Copper peptide, single 50mg vial.",
  },
  {
    key: "epitalon-50mg",
    name: "Epitalon 50mg",
    price: 1599,
    category: "peptides",
    featured: false,
    blurb: "Research peptide, single 50mg vial.",
  },
  {
    key: "ghk-cu-hydrogel-mask",
    name: "GHK-Cu Hydrogel Mask (5 pcs)",
    price: 699,
    category: "skincare",
    featured: true,
    blurb: "Copper-peptide hydrogel sheet masks, box of five.",
  },
  {
    key: "pdrn-eye-patches",
    name: "PDRN Collagen Eye Patches",
    price: 699,
    category: "skincare",
    featured: false,
    blurb: "Hydrogel under-eye patches with PDRN and collagen.",
  },
  {
    key: "pdrn-serum",
    name: "Pure PDRN Serum (10-day set)",
    price: 1189,
    category: "skincare",
    featured: false,
    blurb: "Ten single-use PDRN serum ampoules.",
  },
  {
    key: "insulin-syringes",
    name: "Insulin Syringes 31G × 8mm",
    price: 12,
    category: "supplies",
    featured: false,
    blurb: "1ml / 100-unit insulin syringe, sold per piece.",
  },
];

const peso = (n: number) => `${SYMBOL}${n.toLocaleString("en-PH")}`;

function toWrite(p: DemoProduct) {
  const metadata: ProductMetadata = {
    currencySymbol: SYMBOL,
    category: p.category,
    featured: p.featured,
  };
  return {
    name: p.name,
    description: `${p.blurb}\n\n${SAMPLE_NOTE}`,
    priceCents: Math.round(p.price * 100),
    currency: "PHP",
    stock: DEMO_STOCK,
    status: "active",
    active: true,
    images: [DEMO_IMAGE],
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

async function writeCategories(tenantId: string, config: Record<string, unknown>, categories: Category[]) {
  const next = { ...config, categories } as Prisma.InputJsonValue;
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
  await writeCategories(tenantId, config, withDemoCategories(readCategories(config)));
  console.log(`\n✓ upserted ${PRODUCTS.length} demo products + categories`);
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
  await writeCategories(tenantId, config, realLeft.length > 0 ? kept : []);
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

  for (const cat of CATEGORIES) {
    console.log(`\n  — ${cat.label} —`);
    for (const p of PRODUCTS.filter((x) => x.category === cat.id)) {
      console.log(`  ${peso(p.price).padStart(8)}  ${p.name}${p.featured ? "  ★ featured" : ""}`);
    }
  }
  console.log(`\ncategories after apply: ${withDemoCategories(readCategories(config)).map((c) => c.label).join(" · ")}`);

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

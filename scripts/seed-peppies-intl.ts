/**
 * Seed the product catalog for tenant `peppies-intl`.
 *
 * Idempotent: upserts each product by (tenantId, slug). Rows are built through
 * the app's own mapping helper `productToDbWrite`, so the storefront-only fields
 * (category, featured, availability, inclusions, display currency symbol) are
 * packed into Product.metadata exactly the way the storefront/admin read them
 * back — no hand-rolled column guessing.
 *
 * Run from the project root:
 *   npx tsx scripts/seed-peppies-intl.ts
 *
 * PH price list effective March 21, 2026.
 * Retail inclusions: peptide, bac water, 5 alcohol swabs, 5 insulin syringes,
 *                    1 x 3 ml syringe.
 * Reseller pricing (min. 10 orders) is stored under metadata.reseller.
 */
import { PrismaClient } from "@prisma/client";
import {
  productToDbWrite,
  currencySymbolToIso,
  slugify,
} from "../src/lib/storefront/product-mapping";
import type { Product } from "../src/storefront/types";

const prisma = new PrismaClient();

const TENANT_SLUG = "peppies-intl";
const SYMBOL = "₱"; // PHP display symbol
const STOCK = 999; // generic on-hand so everything shows in-stock

// Full retail inclusions (complete set).
const FULL_INCLUSIONS = [
  { name: "Bacteriostatic water", qty: 1 },
  { name: "Alcohol swabs", qty: 5 },
  { name: "Insulin syringes", qty: 5 },
  { name: "3 ml syringe", qty: 1 },
];
// Lighter inclusions for the aesthetic solutions.
const LITE_INCLUSIONS = [
  { name: "Alcohol swabs", qty: 5 },
  { name: "Insulin syringes", qty: 5 },
];

interface Reseller {
  // PHP per unit, minimum 10 orders
  vialsOnly?: number; // peptide + bac water only
  completeSet?: number; // full inclusions
}

interface Seed {
  slug: string;
  name: string;
  price: number; // PHP retail (complete set)
  category: string;
  description: string;
  featured?: boolean;
  isSet?: boolean;
  inclusions?: { name: string; qty: number }[];
  reseller?: Reseller;
}

// Retail PH price list (complete set).
const SEEDS: Seed[] = [
  {
    slug: "tirzepatide-15mg",
    name: "Tirzepatide 15 mg",
    price: 1800,
    category: "Weight Loss",
    description: "Tirzepatide (GLP-1/GIP) research peptide, 15 mg vial. Complete set.",
    featured: true,
    isSet: true,
    inclusions: FULL_INCLUSIONS,
    reseller: { vialsOnly: 1200, completeSet: 1450 },
  },
  {
    slug: "tirzepatide-30mg",
    name: "Tirzepatide 30 mg",
    price: 2450,
    category: "Weight Loss",
    description: "Tirzepatide (GLP-1/GIP) research peptide, 30 mg vial. Complete set.",
    featured: true,
    isSet: true,
    inclusions: FULL_INCLUSIONS,
    reseller: { vialsOnly: 1600, completeSet: 1850 },
  },
  {
    slug: "retatrutide-15mg",
    name: "Retatrutide 15 mg",
    price: 2000,
    category: "Weight Loss",
    description: "Retatrutide (triple agonist) research peptide, 15 mg vial. Complete set.",
    featured: true,
    isSet: true,
    inclusions: FULL_INCLUSIONS,
  },
  {
    slug: "retatrutide-30mg",
    name: "Retatrutide 30 mg",
    price: 2700,
    category: "Weight Loss",
    description: "Retatrutide (triple agonist) research peptide, 30 mg vial. Complete set.",
    isSet: true,
    inclusions: FULL_INCLUSIONS,
  },
  {
    slug: "nad-plus-500mg",
    name: "NAD+ 500 mg",
    price: 1700,
    category: "Anti-Aging",
    description: "NAD+ 500 mg vial for cellular energy and longevity research. Complete set.",
    isSet: true,
    inclusions: FULL_INCLUSIONS,
    reseller: { vialsOnly: 1300 },
  },
  {
    slug: "ghk-cu-50mg",
    name: "GHK-Cu 50 mg",
    price: 900,
    category: "Anti-Aging",
    description: "GHK-Cu copper peptide, 50 mg vial for skin repair and anti-aging research. Complete set.",
    isSet: true,
    inclusions: FULL_INCLUSIONS,
  },
  {
    slug: "ghk-cu-100mg",
    name: "GHK-Cu 100 mg",
    price: 1500,
    category: "Anti-Aging",
    description: "GHK-Cu copper peptide, 100 mg vial for skin repair and anti-aging research. Complete set.",
    isSet: true,
    inclusions: FULL_INCLUSIONS,
    reseller: { vialsOnly: 1150 },
  },
  {
    slug: "snap-8",
    name: "SNAP-8",
    price: 1300,
    category: "Skin & Beauty",
    description: "SNAP-8 peptide for anti-wrinkle / expression-line research. Complete set.",
    isSet: true,
    inclusions: FULL_INCLUSIONS,
  },
  {
    slug: "epitalon-50mg",
    name: "Epitalon 50 mg",
    price: 1600,
    category: "Anti-Aging",
    description: "Epitalon 50 mg vial for telomere / longevity research. Complete set.",
    isSet: true,
    inclusions: FULL_INCLUSIONS,
  },
  {
    slug: "mots-c-40mg",
    name: "MOTS-c 40 mg",
    price: 2400,
    category: "Anti-Aging",
    description: "MOTS-c 40 mg vial for metabolic and longevity research. Complete set.",
    isSet: true,
    inclusions: FULL_INCLUSIONS,
  },
  {
    slug: "lipo-c-10mg",
    name: "Lipo-C 10 mg",
    price: 1650,
    category: "Weight Loss",
    description: "Lipo-C lipotropic blend, 10 mg, for fat-metabolism research. Complete set.",
    isSet: true,
    inclusions: FULL_INCLUSIONS,
  },
  {
    slug: "aod-9604-5mg",
    name: "AOD-9604 5 mg",
    price: 1400,
    category: "Weight Loss",
    description: "AOD-9604 5 mg vial for fat-loss research. Complete set.",
    isSet: true,
    inclusions: FULL_INCLUSIONS,
  },
  {
    slug: "lemon-bottle-10ml",
    name: "Lemon Bottle 10 ml",
    price: 850,
    category: "Skin & Beauty",
    description: "Lemon Bottle 10 ml fat-dissolving / aesthetic solution.",
    inclusions: LITE_INCLUSIONS,
    // Reseller list shows 8,200 for Lemon Bottle vials-only — likely per-box;
    // left out until confirmed.
  },
  {
    slug: "glutathione-1500mg",
    name: "Glutathione 1500 mg",
    price: 1650,
    category: "Skin & Beauty",
    description: "Glutathione 1500 mg antioxidant / skin-brightening research vial.",
    inclusions: LITE_INCLUSIONS,
  },
];

/** Build a clean storefront Product object for the mapping helper. */
function toStorefrontProduct(s: Seed): Product {
  return {
    id: "",
    name: s.name,
    description: s.description,
    price: s.price,
    currency: SYMBOL,
    purity: "",
    category: s.category,
    featured: s.featured ?? false,
    image: null,
    stock: STOCK,
    available: true,
    discountPrice: 0,
    discountEnabled: false,
    isSet: s.isSet ?? false,
    inclusions: s.inclusions ?? [],
    molecularWeight: "",
    cas: "",
    storage: "",
    sequence: "",
    sizes: "",
  } as Product;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const currencyIso = currencySymbolToIso(SYMBOL); // "PHP"

  for (const s of SEEDS) {
    const product = toStorefrontProduct(s);
    const write = productToDbWrite(product, currencyIso, SYMBOL);

    // Preserve the reseller tier alongside the mapped metadata.
    const metadata = {
      ...((write.metadata as Record<string, unknown>) ?? {}),
      ...(s.reseller ? { reseller: s.reseller } : {}),
    };

    const slug = s.slug;
    const sku = slugify(s.name).toUpperCase();

    await prisma.product.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug } },
      update: {
        name: write.name,
        description: write.description,
        priceCents: write.priceCents,
        currency: write.currency,
        stock: write.stock,
        status: write.status,
        active: write.active,
        images: write.images as never,
        metadata: metadata as never,
      },
      create: {
        tenantId: tenant.id,
        sku,
        slug,
        name: write.name,
        description: write.description,
        priceCents: write.priceCents,
        currency: write.currency,
        stock: write.stock,
        status: write.status,
        active: write.active,
        images: write.images as never,
        metadata: metadata as never,
      },
    });
    console.log(`  ✓ ${s.name} — ${SYMBOL}${s.price.toLocaleString()} [${s.category}]`);
  }

  const count = await prisma.product.count({ where: { tenantId: tenant.id } });
  console.log(`Done. ${SEEDS.length} products upserted (${count} total for this tenant).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

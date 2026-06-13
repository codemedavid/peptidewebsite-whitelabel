/**
 * Seed the product catalog for tenant `ar-jonina` (AR Jonina) from the
 * "✨ ON HAND PRICE LIST ✨" the owner provided.
 *
 * Idempotent: upserts each product by (tenantId, slug). Rows are built through
 * the app's own mapping helper `productToDbWrite`, so the storefront-only fields
 * (category, availability, display currency symbol, reseller pricing) are packed
 * into Product.metadata exactly the way the storefront/admin read them back.
 *
 * Also installs the storefront category tabs (config.categories) so every
 * product lands under a real, filterable category.
 *
 * Names are expanded from the owner's shorthand (TR15 + BA3 → Tirzepatide 15mg
 * + Bac Water 3ml, GHKCU → GHK-Cu, RETA → Retatrutide, CAGRI → Cagrilintide,
 * GTT → Glutathione, etc.).
 *
 * 📦 PER BOX PRICE rows are stored as reseller/wholesale pricing. The merchant
 * (#merchant) page renders reseller prices PER UNIT at a minimum order quantity,
 * so a box price is stored as `completeSet = boxPrice / 10` with `minQty = 10`
 * — buying the 10-unit minimum reconstructs the exact box total
 * (e.g. ₱950 × 10 = ₱9,500 for TR15 + BA3).
 *
 * Run from the project root:
 *   npx tsx scripts/seed-ar-jonina.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  productToDbWrite,
  currencySymbolToIso,
} from "../src/lib/storefront/product-mapping";
import type { Product } from "../src/storefront/types";

const prisma = new PrismaClient();

const TENANT_SLUG = "ar-jonina";
const SYMBOL = "₱"; // PHP display symbol
const BOX_UNITS = 10; // assumed vials per box for the PER BOX PRICE rows

// Storefront category tabs to install (id + label). The product `category`
// stores the label, so these labels must match the per-product categories below.
const CATEGORIES = [
  { id: "all", label: "All Products" },
  { id: "weightloss", label: "Weight Loss" },
  { id: "healing", label: "Healing & Recovery" },
  { id: "longevity", label: "Longevity" },
  { id: "beauty", label: "Beauty & Skin" },
  { id: "nootropics", label: "Nootropics" },
  { id: "wellness", label: "Wellness" },
  { id: "supplies", label: "Supplies" },
];

interface Seed {
  slug: string;
  name: string;
  price: number; // PHP retail per vial
  category: string;
  stock: number;
  description: string;
  boxPrice?: number; // PER BOX PRICE total → stored as reseller completeSet/unit
}

const SEEDS: Seed[] = [
  // ── Peptides / Blends (on-hand, per vial) ──
  {
    slug: "tirzepatide-15mg-ba3",
    name: "Tirzepatide 15mg + Bac Water 3ml",
    price: 1500,
    category: "Weight Loss",
    stock: 28,
    description: "Tirzepatide (GLP-1/GIP) 15 mg research vial, paired with 3 ml bacteriostatic water.",
    boxPrice: 9500,
  },
  {
    slug: "tirzepatide-30mg-ba5",
    name: "Tirzepatide 30mg + Bac Water 5ml",
    price: 1900,
    category: "Weight Loss",
    stock: 23,
    description: "Tirzepatide (GLP-1/GIP) 30 mg research vial, paired with 5 ml bacteriostatic water.",
    boxPrice: 11500,
  },
  {
    slug: "tirzepatide-60mg-ba10",
    name: "Tirzepatide 60mg + Bac Water 10ml",
    price: 1800,
    category: "Weight Loss",
    stock: 5,
    description: "Tirzepatide (GLP-1/GIP) 60 mg research vial, paired with 10 ml bacteriostatic water.",
    boxPrice: 18000,
  },
  {
    slug: "retatrutide-20mg-ba3",
    name: "Retatrutide 20mg + Bac Water 3ml",
    price: 2000,
    category: "Weight Loss",
    stock: 7,
    description: "Retatrutide (triple agonist) 20 mg research vial, paired with 3 ml bacteriostatic water.",
    boxPrice: 13500,
  },
  {
    slug: "cagrilintide-5mg-ba3",
    name: "Cagrilintide 5mg + Bac Water 3ml",
    price: 1400,
    category: "Weight Loss",
    stock: 5,
    description: "Cagrilintide (amylin analog) 5 mg research vial, paired with 3 ml bacteriostatic water.",
  },
  {
    slug: "aod-9604-bac-water",
    name: "AOD-9604 + Bac Water",
    price: 1300,
    category: "Weight Loss",
    stock: 1,
    description: "AOD-9604 fat-metabolism research peptide, with bacteriostatic water.",
  },
  {
    slug: "lipo-c-fat-blaster",
    name: "Lipo-C (Fat Blaster)",
    price: 1300,
    category: "Weight Loss",
    stock: 2,
    description: "Lipo-C lipotropic 'Fat Blaster' blend for fat-metabolism research.",
  },
  {
    slug: "ghk-cu-50mg-ba10",
    name: "GHK-Cu 50mg + Bac Water 10ml",
    price: 1100,
    category: "Beauty & Skin",
    stock: 4,
    description: "GHK-Cu copper peptide, 50 mg vial for skin-repair / anti-aging research, with 10 ml bac water.",
  },
  {
    slug: "ghk-cu-100mg-ba10",
    name: "GHK-Cu 100mg + Bac Water 10ml",
    price: 1500,
    category: "Beauty & Skin",
    stock: 17,
    description: "GHK-Cu copper peptide, 100 mg vial for skin-repair / anti-aging research, with 10 ml bac water.",
  },
  {
    slug: "glow-70mg-ba10",
    name: "GLOW 70mg + Bac Water 10ml",
    price: 2100,
    category: "Beauty & Skin",
    stock: 2,
    description: "GLOW 70 mg skin & recovery peptide blend, with 10 ml bacteriostatic water.",
  },
  {
    slug: "glutathione-1500mg-ba10",
    name: "Glutathione 1500mg + Bac Water 10ml",
    price: 1500,
    category: "Beauty & Skin",
    stock: 2,
    description: "Glutathione 1500 mg antioxidant / skin-brightening research vial, with 10 ml bac water.",
    boxPrice: 11500,
  },
  {
    slug: "nad-500mg-ba10",
    name: "NAD+ 500mg + Bac Water 10ml",
    price: 1300,
    category: "Longevity",
    stock: 8,
    description: "NAD+ 500 mg vial for cellular-energy / longevity research, with 10 ml bac water.",
  },
  {
    slug: "mnm-blend-ba10",
    name: "MNM Blend + Bac Water 10ml",
    price: 2000,
    category: "Longevity",
    stock: 2,
    description: "MNM research peptide blend, with 10 ml bacteriostatic water.",
  },
  {
    slug: "kpv-10mg-ba3",
    name: "KPV 10mg + Bac Water 3ml",
    price: 1200,
    category: "Healing & Recovery",
    stock: 8,
    description: "KPV 10 mg anti-inflammatory / gut-healing research peptide, with 3 ml bac water.",
  },
  {
    slug: "klow-ba10",
    name: "KLOW + Bac Water 10ml",
    price: 2200,
    category: "Healing & Recovery",
    stock: 2,
    description: "KLOW healing & recovery peptide blend, with 10 ml bacteriostatic water.",
  },
  {
    slug: "bpc-157-10mg",
    name: "BPC-157 10mg",
    price: 561,
    category: "Healing & Recovery",
    stock: 2,
    description: "BPC-157 10 mg recovery / tissue-repair research peptide.",
  },
  {
    slug: "semax-10mg",
    name: "Semax 10mg",
    price: 609,
    category: "Nootropics",
    stock: 5,
    description: "Semax 10 mg nootropic / cognitive research peptide.",
  },
  {
    slug: "selank-10mg",
    name: "Selank 10mg",
    price: 609,
    category: "Nootropics",
    stock: 5,
    description: "Selank 10 mg anxiolytic / nootropic research peptide.",
  },
  {
    slug: "pt-141-10mg-ba3",
    name: "PT-141 10mg + Bac Water 3ml",
    price: 1500,
    category: "Wellness",
    stock: 2,
    description: "PT-141 (Bremelanotide) 10 mg research peptide, with 3 ml bacteriostatic water.",
  },
  // ── Supplies ──
  {
    slug: "bac-water-10ml",
    name: "Bacteriostatic Water 10mL",
    price: 93,
    category: "Supplies",
    stock: 30,
    description: "Bacteriostatic water, 10 mL (BA10), for reconstituting research peptides.",
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
    featured: false,
    image: null,
    stock: s.stock,
    available: true,
    discountPrice: 0,
    discountEnabled: false,
    isSet: false,
    inclusions: [],
    molecularWeight: "",
    cas: "",
    storage: "",
    sequence: "",
    sizes: "",
    // PER BOX PRICE → wholesale per-unit at the 10-unit box minimum.
    reseller: s.boxPrice
      ? { completeSet: Math.round(s.boxPrice / BOX_UNITS), minQty: BOX_UNITS }
      : undefined,
  } as Product;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const currencyIso = currencySymbolToIso(SYMBOL); // "PHP"

  // 1) Install the category tabs (replace whatever's there with the full set).
  const branding = await prisma.branding.findFirst({ where: { tenantId: tenant.id } });
  if (branding) {
    const cfg = { ...((branding.config as Record<string, unknown>) ?? {}) };
    cfg.categories = CATEGORIES;
    await prisma.branding.update({
      where: { id: branding.id },
      data: { config: cfg as never },
    });
    console.log(`  ✓ categories installed (${CATEGORIES.length})`);
  } else {
    console.warn("  ! no branding row found — skipped category install");
  }

  // 2) Upsert each product.
  for (const s of SEEDS) {
    const product = toStorefrontProduct(s);
    const write = productToDbWrite(product, currencyIso, SYMBOL);
    const sku = s.slug.toUpperCase();

    await prisma.product.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: s.slug } },
      update: {
        name: write.name,
        description: write.description,
        priceCents: write.priceCents,
        currency: write.currency,
        stock: write.stock,
        status: write.status,
        active: write.active,
        images: write.images as never,
        metadata: write.metadata as never,
      },
      create: {
        tenantId: tenant.id,
        sku,
        slug: s.slug,
        name: write.name,
        description: write.description,
        priceCents: write.priceCents,
        currency: write.currency,
        stock: write.stock,
        status: write.status,
        active: write.active,
        images: write.images as never,
        metadata: write.metadata as never,
      },
    });
    const box = s.boxPrice ? `  📦 box ${SYMBOL}${s.boxPrice.toLocaleString()}` : "";
    console.log(
      `  ✓ ${s.name} — ${SYMBOL}${s.price.toLocaleString()} (${s.stock} left) [${s.category}]${box}`,
    );
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

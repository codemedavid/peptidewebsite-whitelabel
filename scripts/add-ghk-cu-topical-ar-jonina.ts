/**
 * Add a single product — "GHK-Cu Topical Only" — to tenant `ar-jonina`.
 *
 * ₱700 retail, Beauty & Skin. Built through the app's own `productToDbWrite`
 * mapping helper so the storefront-only fields (category, display symbol) land
 * in Product.metadata exactly the way the storefront/admin read them back.
 *
 * Idempotent: upserts by (tenantId, slug).
 *
 * Run from the project root:
 *   npx tsx scripts/add-ghk-cu-topical-ar-jonina.ts
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

const SLUG = "ghk-cu-topical-only";
const NAME = "GHK-Cu Topical Only";
const PRICE = 700; // PHP retail
const CATEGORY = "Beauty & Skin";
const STOCK = 2;
const DESCRIPTION =
  "GHK-Cu copper peptide, topical only — for skin-repair / anti-aging research.";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const currencyIso = currencySymbolToIso(SYMBOL); // "PHP"

  const product = {
    id: "",
    name: NAME,
    description: DESCRIPTION,
    price: PRICE,
    currency: SYMBOL,
    purity: "",
    category: CATEGORY,
    featured: false,
    image: null,
    stock: STOCK,
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
  } as Product;

  const write = productToDbWrite(product, currencyIso, SYMBOL);
  const sku = SLUG.toUpperCase();

  const result = await prisma.product.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: SLUG } },
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
      slug: SLUG,
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

  console.log(
    `  ✓ ${result.name} — ${SYMBOL}${(result.priceCents / 100).toLocaleString()} (${result.stock} left) [${CATEGORY}]`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

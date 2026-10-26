/**
 * Enter the owner's "Raw Glow - Pricelist" sheet into tenant `raw-glow-wellness`
 * and remove the five sample products the owner made while testing.
 *
 *   npx tsx --env-file=.env scripts/seed-raw-glow-pricelist.ts --dry
 *   npx tsx --env-file=.env scripts/seed-raw-glow-pricelist.ts
 *
 * Idempotent: upserts each row by (tenantId, slug) through the app's own
 * `productToDbWrite`, so metadata is packed the way the storefront reads it.
 *
 * Beyond the plain fill:
 *  - Saves the tenant's own categories. `branding.config.categories` was null,
 *    which makes store.tsx fall back to the SEED peptide chips; products are
 *    filed under the category *id* (the catalog filters on the id).
 *  - Publishes the 14 rows (pens, accessories, skincare) the owner had already
 *    entered as drafts with `purchasable: false` — they are on the sheet, so
 *    they go live like the rest. Their photos are carried over.
 *  - Writes `branding.config.productOrder` in sheet order, so the default
 *    catalog view follows the pricelist instead of A–Z.
 */
import { PrismaClient } from "@prisma/client";
import {
  productToDbWrite,
  currencySymbolToIso,
  slugify,
} from "../src/lib/storefront/product-mapping";
import type { Product } from "../src/storefront/types";
import {
  RAW_GLOW_PRICELIST,
  RAW_GLOW_CATEGORIES,
  RAW_GLOW_SAMPLE_SLUGS,
  RAW_GLOW_TENANT_SLUG,
  RAW_GLOW_CURRENCY_SYMBOL as SYMBOL,
  RAW_GLOW_STOCK as STOCK,
  VIAL_CATEGORIES,
  type RawGlowRow,
} from "./raw-glow-pricelist";

const DRY = process.argv.includes("--dry");
const VIAL_NOTE = "Price includes the vial and bacteriostatic water.";

const prisma = new PrismaClient();

function toStorefrontProduct(row: RawGlowRow, image: string | null): Product {
  return {
    id: "",
    name: row.name,
    description: VIAL_CATEGORIES.has(row.category) ? VIAL_NOTE : "",
    price: row.price,
    currency: SYMBOL,
    purity: "",
    category: row.category,
    featured: false,
    image,
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
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: RAW_GLOW_TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${RAW_GLOW_TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})${DRY ? "  [DRY RUN]" : ""}\n`);

  const slugs = RAW_GLOW_PRICELIST.map((r) => slugify(r.name));
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  if (dupes.length) throw new Error(`Duplicate slugs in pricelist: ${dupes.join(", ")}`);

  const currencyIso = currencySymbolToIso(SYMBOL); // "PHP"
  const existing = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, slug: true, images: true, metadata: true },
  });
  const bySlug = new Map(existing.map((p) => [p.slug ?? "", p]));

  // 1. Remove the owner's sample products.
  const samples = existing.filter((p) => RAW_GLOW_SAMPLE_SLUGS.includes(p.slug ?? ""));
  console.log(`Deleting ${samples.length} sample product(s): ${samples.map((s) => s.slug).join(", ")}`);
  if (!DRY && samples.length) {
    await prisma.product.deleteMany({
      where: { tenantId: tenant.id, id: { in: samples.map((s) => s.id) } },
    });
  }

  // 2. Upsert every pricelist row, in sheet order.
  const orderedIds: string[] = [];
  for (const [i, row] of RAW_GLOW_PRICELIST.entries()) {
    const slug = slugs[i];
    const prior = bySlug.get(slug);
    const priorImage = Array.isArray(prior?.images) ? (prior.images as string[])[0] : undefined;
    const write = productToDbWrite(toStorefrontProduct(row, priorImage ?? null), currencyIso, SYMBOL);

    // Keep anything the owner set that the sheet has no opinion on, but drop
    // `purchasable: false` — every sheet row is for sale.
    const { purchasable: _dropped, ...priorMeta } = (prior?.metadata ?? {}) as Record<string, unknown>;
    const metadata = { ...priorMeta, ...((write.metadata as Record<string, unknown>) ?? {}) };

    const fields = {
      name: write.name,
      description: write.description,
      priceCents: write.priceCents,
      currency: write.currency,
      stock: write.stock,
      status: write.status,
      active: write.active,
      images: write.images as never,
      metadata: metadata as never,
    };

    console.log(
      `  ${prior ? "~" : "+"} ${row.name.padEnd(48)} ${SYMBOL}${row.price.toLocaleString().padStart(6)}  ${row.category}`,
    );
    if (DRY) continue;

    const saved = await prisma.product.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug } },
      update: fields,
      create: { tenantId: tenant.id, sku: slug.toUpperCase(), slug, ...fields },
      select: { id: true },
    });
    orderedIds.push(saved.id);
  }

  // 3. Categories + sheet order into branding.config (read-modify-write).
  const branding = await prisma.branding.findUnique({ where: { tenantId: tenant.id } });
  if (!branding) throw new Error("Tenant has no branding row");
  const config = (branding.config ?? {}) as Record<string, unknown>;
  const categories = [{ id: "all", label: "All Products" }, ...RAW_GLOW_CATEGORIES];
  const priorCats = Array.isArray(config.categories) ? config.categories : null;
  console.log(
    `\nCategories: ${priorCats ? `replacing ${priorCats.length} saved` : "none saved (was showing SEED chips)"} → ` +
      RAW_GLOW_CATEGORIES.map((c) => c.label).join(", "),
  );
  if (!DRY) {
    await prisma.branding.update({
      where: { tenantId: tenant.id },
      data: { config: { ...config, categories, productOrder: orderedIds } as never },
    });
  }

  const total = await prisma.product.count({ where: { tenantId: tenant.id } });
  const live = await prisma.product.count({
    where: { tenantId: tenant.id, active: true, status: "active" },
  });
  console.log(
    `\nDone. ${RAW_GLOW_PRICELIST.length} pricelist rows — ${live} live of ${total} products.` +
      "\nNext: the storefront caches the catalog; press Save on any store-admin branding" +
      " screen (or redeploy) if the old products still show.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

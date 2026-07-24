/**
 * Seed the k-glow tenant's ON-HAND (ready-stock) catalog from the handwritten
 * price note (scripts/lib/kglow-onhand.ts — verified by
 * scripts/test-kglow-onhand.ts).
 *
 * 11 note lines → 6 on-hand products with per-size variations. These are ADDED
 * ALONGSIDE the group-buy (PasaBuy) products, never replacing them: on-hand and
 * group-buy are K Glow's two ways to order. On-hand products carry no
 * productType (the storefront treats absent-type as on-hand) and seed with a
 * positive placeholder stock so they are purchasable — the owner adjusts real
 * counts in the store admin.
 *
 * Distinct "-OH" SKUs and "-on-hand" slugs keep the Tirzepatide / GHK-CU
 * on-hand rows from colliding with their group-buy namesakes (both are unique on
 * (tenantId, sku) and (tenantId, slug)). Upsert on the SKU makes re-runs
 * idempotent — nothing is ever deleted.
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed:
 *   npx tsx scripts/seed-kglow-onhand.ts            # print plan, no writes
 *   npx tsx scripts/seed-kglow-onhand.ts --apply    # upsert 6 on-hand products
 */

import "dotenv/config";

import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import type { ProductMetadata } from "../src/lib/storefront/product-mapping";
import { buildKglowOnHandProducts } from "./lib/kglow-onhand";

const APPLY = process.argv.slice(2).includes("--apply");
const SLUG = "k-glow";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`tenant '${SLUG}' not found`);

  const products = buildKglowOnHandProducts();
  console.log(
    `tenant ${SLUG} (${tenant.id}) — ${APPLY ? "APPLY" : "DRY RUN"}\n` +
      `${products.length} on-hand products from the note:\n`,
  );

  for (const p of products) {
    console.log(
      `  ${p.name}  [${p.sku}]  base ₱${p.price.toLocaleString()}  stock ${p.stock}  (${p.productClass})`,
    );
    for (const v of p.variations) console.log(`      · ${v.name} — ₱${v.price.toLocaleString()}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — would upsert ${products.length} on-hand products. Re-run with --apply.`);
    return;
  }

  for (const p of products) {
    const metadata: ProductMetadata = {
      currencySymbol: p.currencySymbol,
      // No productType → on-hand (the storefront default).
      variations: p.variations,
      sizes: p.sizes,
      productClass: p.productClass,
    };
    const write = {
      name: p.name,
      description: p.description,
      priceCents: p.priceCents,
      currency: p.currency,
      stock: p.stock, // on-hand ready stock — owner adjusts in admin
      status: "active",
      active: true,
      images: [] as string[], // defaultProductImage fallback covers imageless cards
      metadata: metadata as Prisma.InputJsonValue,
    };
    await prisma.product.upsert({
      where: { tenantId_sku: { tenantId: tenant.id, sku: p.sku } },
      // Do NOT overwrite stock on re-run — the owner may have adjusted it since.
      update: {
        name: write.name,
        description: write.description,
        priceCents: write.priceCents,
        currency: write.currency,
        status: write.status,
        active: write.active,
        metadata: write.metadata,
        slug: p.slug,
      },
      create: { ...write, tenantId: tenant.id, sku: p.sku, slug: p.slug },
    });
  }

  const count = await prisma.product.count({ where: { tenantId: tenant.id } });
  console.log(`\n✓ upserted ${products.length} on-hand products — ${SLUG} now has ${count} products`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * Seed the k-glow tenant's product catalog from the PasaBuy pricelist sheet
 * (scripts/lib/kglow-pricelist.ts — verified by scripts/test-kglow-pricelist.ts).
 *
 * 53 sheet rows → 25 group-buy ("gb") products with per-size variations, priced
 * from the sheet's PESO column. The 3 pre-existing kglow products (Tirzepatide
 * 15mg/30mg, GHK-cu 100mg) are ABSORBED: their rows are deleted (verified: zero
 * order/cart references) and replaced by the grouped listings, per the owner.
 *
 * Existing pricelist products are matched by SKU and updated in place
 * (upsert on the (tenantId, sku) unique), so re-running is idempotent.
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed:
 *   npx tsx scripts/seed-kglow-products.ts            # print plan, no writes
 *   npx tsx scripts/seed-kglow-products.ts --apply    # delete absorbed + upsert 25
 */

import "dotenv/config";

import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import type { ProductMetadata } from "../src/lib/storefront/product-mapping";
import { buildKglowPricelistProducts } from "./lib/kglow-pricelist";

const APPLY = process.argv.slice(2).includes("--apply");
const SLUG = "k-glow";

/** The pre-pricelist rows the owner asked to merge away (by SKU). */
const ABSORBED_SKUS = ["TIRZEPATIDE15MG", "TIRZEPATIDE30MG", "GHKCU100MG"];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`tenant '${SLUG}' not found`);

  const products = buildKglowPricelistProducts();
  console.log(
    `tenant ${SLUG} (${tenant.id}) — ${APPLY ? "APPLY" : "DRY RUN"}\n` +
      `${products.length} products from the pricelist:\n`,
  );

  for (const p of products) {
    console.log(`  ${p.name}  [${p.sku}]  base ₱${p.price.toLocaleString()}`);
    for (const v of p.variations) console.log(`      · ${v.name} — ₱${v.price.toLocaleString()}`);
  }

  // Old rows being absorbed — refuse to delete anything an order/cart references
  // (should be none; checked here so a future re-run stays safe).
  const newSkus = new Set(products.map((p) => p.sku));
  const absorbed = await prisma.product.findMany({
    where: { tenantId: tenant.id, sku: { in: ABSORBED_SKUS.filter((s) => !newSkus.has(s)) } },
    select: { id: true, sku: true, name: true },
  });
  for (const old of absorbed) {
    const refs =
      (await prisma.orderItem.count({ where: { productId: old.id } })) +
      (await prisma.cartItem.count({ where: { productId: old.id } }));
    if (refs > 0) throw new Error(`refusing to delete ${old.sku} — ${refs} order/cart reference(s)`);
  }
  console.log(`\nabsorbing ${absorbed.length} old product(s): ${absorbed.map((o) => o.name).join(", ") || "none"}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — would delete ${absorbed.length} and upsert ${products.length}. Re-run with --apply.`);
    return;
  }

  await prisma.product.deleteMany({ where: { id: { in: absorbed.map((o) => o.id) } } });

  for (const p of products) {
    const metadata: ProductMetadata = {
      currencySymbol: p.currencySymbol,
      productType: p.productType,
      variations: p.variations,
      sizes: p.sizes,
      productClass: "peptide", // Order Ratio Control: every sheet row is a peptide kit
    };
    const write = {
      name: p.name,
      description: p.description,
      priceCents: p.priceCents,
      currency: p.currency,
      stock: 0, // group-buy listings are pre-order (GB stock exemption)
      status: "active",
      active: true,
      images: [] as string[], // defaultProductImage fallback covers imageless cards
      metadata: metadata as Prisma.InputJsonValue,
    };
    await prisma.product.upsert({
      where: { tenantId_sku: { tenantId: tenant.id, sku: p.sku } },
      update: { ...write, slug: p.slug },
      create: { ...write, tenantId: tenant.id, sku: p.sku, slug: p.slug },
    });
  }

  const count = await prisma.product.count({ where: { tenantId: tenant.id } });
  console.log(`\n✓ upserted ${products.length} products — ${SLUG} now has ${count} products`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

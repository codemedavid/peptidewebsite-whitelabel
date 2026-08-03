/**
 * Seed the dragon-peptides tenant's catalog from the supplier sheet
 * (scripts/lib/dragon-pricelist.ts — verified by scripts/test-dragon-pricelist.ts).
 *
 * 175 sheet rows → 172 unique rows → 88 group-buy products, 48 of them carrying
 * per-size variations. Every option carries BOTH legs the sheet prints: its
 * on-hand price (the list price) and its own gbPrice (what it costs inside a
 * live buying window). Per-variation gbPrice is what makes the grouping safe —
 * without it every size would bill at the cheapest size's group price.
 *
 * Products are upserted on the (tenantId, sku) unique, so re-running is
 * idempotent and never duplicates a row. Nothing is deleted: the tenant starts
 * empty, and a later run that finds extra products reports them and moves on.
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed:
 *   npx tsx scripts/seed-dragon-products.ts            # print the plan
 *   npx tsx scripts/seed-dragon-products.ts --apply    # upsert 88 products
 */

import "dotenv/config";

import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import type { ProductMetadata } from "../src/lib/storefront/product-mapping";
import { buildDragonPricelistProducts } from "./lib/dragon-pricelist";

const APPLY = process.argv.slice(2).includes("--apply");
const SLUG = "dragon-peptides";

const peso = (n: number) => `₱${n.toLocaleString("en-PH")}`;

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`tenant '${SLUG}' not found`);

  const products = buildDragonPricelistProducts();
  const options = products.reduce((n, p) => n + Math.max(1, p.variations.length), 0);

  console.log(
    `\ntenant ${SLUG} (${tenant.id}) — ${APPLY ? "APPLY" : "DRY RUN"}\n` +
      `${products.length} products / ${options} sellable options:\n`,
  );

  let section = "";
  for (const p of products) {
    if (p.category !== section) {
      section = p.category;
      console.log(`\n  — ${section} —`);
    }
    console.log(`  ${p.name}  [${p.sku}]  ${peso(p.price)} on-hand · ${peso(p.gbPrice)} GB`);
    for (const v of p.variations) {
      console.log(`      · ${v.name.padEnd(16)} ${peso(v.price)} · GB ${peso(v.gbPrice)}`);
    }
  }

  // The sheet is a supplier price list, so a re-run should only ever move
  // prices. Report anything already in the catalog that this seed does NOT
  // cover, rather than silently leaving a stale product behind.
  const existing = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    select: { sku: true, name: true },
  });
  const seeded = new Set(products.map((p) => p.sku));
  const orphans = existing.filter((e) => !seeded.has(e.sku));
  console.log(
    `\n${existing.length} product(s) already in the catalog; ` +
      `${orphans.length} not covered by this sheet` +
      (orphans.length ? `:\n  ${orphans.map((o) => `${o.sku} ${o.name}`).join("\n  ")}` : ""),
  );
  if (orphans.length) {
    console.log(`  (left untouched — remove them in the store admin if they are stale)`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply.\n`);
    return;
  }

  for (const p of products) {
    const metadata: ProductMetadata = {
      currencySymbol: p.currencySymbol,
      category: p.category,
      productClass: p.productClass,
      productType: p.productType,
      gbPrice: p.gbPrice,
      ...(p.sizes ? { sizes: p.sizes } : {}),
      ...(p.variations.length ? { variations: p.variations } : {}),
    };
    const write = {
      name: p.name,
      description: null,
      priceCents: p.priceCents,
      currency: p.currency,
      stock: 0, // group-buy listings are pre-order (GB stock exemption)
      status: "active",
      active: true,
      images: [] as string[], // defaultProductImage fallback covers imageless cards
      metadata: metadata as unknown as Prisma.InputJsonValue,
    };
    await prisma.product.upsert({
      where: { tenantId_sku: { tenantId: tenant.id, sku: p.sku } },
      update: { ...write, slug: p.slug },
      create: { ...write, tenantId: tenant.id, sku: p.sku, slug: p.slug },
    });
  }

  const count = await prisma.product.count({ where: { tenantId: tenant.id } });
  console.log(`\n✓ upserted ${products.length} products — ${SLUG} now has ${count}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

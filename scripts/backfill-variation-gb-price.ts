/**
 * Backfill the per-variation group-buy price onto products that predate it.
 *
 * WHY: `metadata.gbPrice` was a single per-product number applied to whichever
 * option the shopper picked. Now that each variation carries its OWN gbPrice
 * (see scripts/test-variation-gb-pricing.ts), an option with none sells at its
 * own price. That is the correct, fail-safe default — but it silently drops the
 * discount on the ONE option the old single number was actually right for: the
 * base option, when the product's gbPrice sat below it.
 *
 * So restore exactly that leg and nothing else:
 *
 *   base option  = the variation whose price equals the product's base price
 *                  (else the first variation — the order the seller arranged)
 *   restore when = product.gbPrice > 0 AND product.gbPrice < baseOption.price
 *
 * Every other option is deliberately left WITHOUT a group price. Those are the
 * larger sizes the old code undercharged (k-glow's Retatrutide 30mg listed at
 * ₱9,924 and billed ₱3,866); giving them a group price here would be inventing
 * a discount the seller never entered. The owner can price them per-option in
 * the product editor whenever they want to.
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed:
 *   npx tsx scripts/backfill-variation-gb-price.ts              # print plan
 *   npx tsx scripts/backfill-variation-gb-price.ts --apply      # write
 *   npx tsx scripts/backfill-variation-gb-price.ts --tenant k-glow
 */

import "dotenv/config";

import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import type { ProductMetadata } from "../src/lib/storefront/product-mapping";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const tenantArg = argv.indexOf("--tenant");
const TENANT_SLUG = tenantArg >= 0 ? argv[tenantArg + 1] : undefined;

type Variation = NonNullable<ProductMetadata["variations"]>[number];

/** Smallest saving that counts as a real discount rather than rounding. Prices
 *  round-trip through integer centavos, so a base of ₱4,854.60 against a gbPrice
 *  of ₱4,854 shows a ₱0.60 "saving" that the seller never entered. Restoring
 *  that would persist a group price which buys the shopper nothing. */
const MIN_SAVINGS = 1;

/** The option the product-level gbPrice was actually meant for: the one priced
 *  at the product's base price, else the first the seller arranged. */
function baseOptionIndex(variations: Variation[], basePrice: number): number {
  const exact = variations.findIndex((v) => v.price === basePrice);
  return exact >= 0 ? exact : 0;
}

async function main() {
  const products = await prisma.product.findMany({
    where: TENANT_SLUG ? { tenant: { slug: TENANT_SLUG } } : {},
    select: {
      id: true,
      sku: true,
      name: true,
      priceCents: true,
      metadata: true,
      tenant: { select: { slug: true } },
    },
    orderBy: [{ tenant: { slug: "asc" } }, { name: "asc" }],
  });

  const planned: { id: string; line: string; metadata: ProductMetadata }[] = [];
  let scanned = 0;
  let skipped = 0;

  for (const p of products) {
    const meta = (p.metadata ?? {}) as ProductMetadata;
    const variations = Array.isArray(meta.variations) ? meta.variations : [];
    const gbPrice = typeof meta.gbPrice === "number" ? meta.gbPrice : 0;
    if (meta.productType !== "gb" || gbPrice <= 0 || variations.length === 0) continue;
    scanned++;

    // Already migrated by hand or by an earlier run — never overwrite.
    if (variations.some((v) => typeof v.gbPrice === "number" && v.gbPrice > 0)) {
      skipped++;
      continue;
    }

    const basePrice = p.priceCents / 100;
    const i = baseOptionIndex(variations, basePrice);
    const target = variations[i];
    if (target.price - gbPrice < MIN_SAVINGS) {
      skipped++;
      continue; // no real discount on the base option — nothing to restore
    }

    const next = variations.map((v, n) => (n === i ? { ...v, gbPrice } : v));
    planned.push({
      id: p.id,
      line:
        `${p.tenant.slug}/${p.sku}  ${p.name}  ·  "${target.name}" ` +
        `₱${target.price} → gb ₱${gbPrice} (save ₱${target.price - gbPrice})`,
      metadata: { ...meta, variations: next },
    });
  }

  console.log(
    `\n${APPLY ? "APPLY" : "DRY RUN"} — ${products.length} products, ` +
      `${scanned} with a product-level gbPrice + variations\n` +
      `${skipped} left alone (already per-option, or no discount on the base option)\n` +
      `${planned.length} to backfill:\n`,
  );
  for (const p of planned) console.log(`  ${p.line}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply.\n`);
    return;
  }
  for (const p of planned) {
    await prisma.product.update({
      where: { id: p.id },
      data: { metadata: p.metadata as unknown as Prisma.InputJsonValue },
    });
  }
  console.log(`\nBackfilled ${planned.length} product(s).\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

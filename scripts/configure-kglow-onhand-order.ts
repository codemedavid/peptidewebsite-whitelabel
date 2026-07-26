/**
 * Put K Glow's ON-HAND shelf on the per-vial-first order.
 *
 * K Glow sells the same peptides two ways, so its on-hand shelf carries both
 * single per-vial listings (Tirzepatide 30mg ₱1,050, KPV ₱700) and the older
 * multi-vial kits seeded from the bulk sheet (Tirzepatide · 15mg × 10 vials).
 * Catalog order is createdAt-ascending, so the kits — created first — led the
 * shelf. This flips the store to branding.config.onHandOrder = "per-vial-first"
 * so the per-vial listings lead and the 10-vial kits sit underneath.
 *
 * Nothing is hidden, archived, or re-priced: every product stays listed and
 * purchasable, only the running order changes (see
 * src/lib/storefront/on-hand-order.ts, npm run test:onhand-order).
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed:
 *   npx tsx scripts/configure-kglow-onhand-order.ts            # print plan
 *   npx tsx scripts/configure-kglow-onhand-order.ts --apply    # write config
 *
 * Pass `--revert` to put the store back on plain catalog order.
 */

import "dotenv/config";

import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { normalizeOnHandOrder, orderOnHandProducts } from "../src/lib/storefront/on-hand-order";

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes("--apply");
const REVERT = ARGS.includes("--revert");
const SLUG = "k-glow";
const TARGET = REVERT ? "catalog" : "per-vial-first";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`tenant '${SLUG}' not found`);

  const branding = await prisma.branding.findFirst({ where: { tenantId: tenant.id } });
  if (!branding) throw new Error(`tenant '${SLUG}' has no branding row`);

  const config = (branding.config ?? {}) as Record<string, unknown>;
  const current = normalizeOnHandOrder(config.onHandOrder);
  console.log(
    `tenant ${SLUG} (${tenant.id}) — ${APPLY ? "APPLY" : "DRY RUN"}\n` +
      `  onHandOrder: ${current} → ${TARGET}\n`,
  );

  // Show the shelf the shopper will actually see, straight from the live rows.
  const rows = await prisma.product.findMany({
    where: { tenantId: tenant.id, status: { not: "archived" } },
    orderBy: { createdAt: "asc" },
  });
  const onHand = rows
    .filter((r) => ((r.metadata ?? {}) as { productType?: string }).productType !== "gb")
    .map((r) => ({
      name: r.name,
      price: r.priceCents / 100,
      stock: r.stock,
      variations: ((r.metadata ?? {}) as { variations?: { name: string; price: number }[] }).variations ?? [],
    }));

  console.log(`  on-hand shelf (${onHand.length} products) in the ${TARGET} order:`);
  for (const p of orderOnHandProducts(onHand, TARGET)) {
    const sizes = p.variations.length ? ` — ${p.variations.map((v) => v.name).join(" / ")}` : "";
    console.log(`    · ${p.name}  ₱${p.price.toLocaleString()}  stock ${p.stock}${sizes}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — would set onHandOrder = "${TARGET}". Re-run with --apply.`);
    return;
  }

  // Spread-write: every other branding key is preserved untouched.
  await prisma.branding.update({
    where: { id: branding.id },
    data: { config: { ...config, onHandOrder: TARGET } as Prisma.InputJsonValue },
  });
  console.log(`\n✓ ${SLUG} on-hand shelf is now ordered "${TARGET}"`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

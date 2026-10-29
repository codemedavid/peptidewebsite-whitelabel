/**
 * Replace the `mnm-pepsabuy` sample catalog with the real supplier sheet
 * (scripts/lib/mnm-pricelist.ts — 99 sheet rows → 48 products).
 *
 * What --apply does, in order:
 *   1. deletes the eight `DEMO-` sample products (scripts/seed-mnm-demo-products.ts);
 *   2. upserts the sheet's products on (tenantId, sku), so a re-run only moves
 *      prices and never duplicates a row;
 *   3. re-points any round that is not closed and was scoped to the samples at
 *      the new catalog — otherwise its productIds name deleted rows and no real
 *      product is in scope for the group price;
 *   4. replaces the sample categories with the sheet's four.
 *
 * Every listing is a group-buy pre-order (productType "gb", stock 0,
 * madeToOrder), sold per vial at the sheet price — price and gbPrice are equal
 * because the store hides on-hand and the sheet prints a single price.
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed:
 *   npx tsx --env-file=.env scripts/seed-mnm-pricelist.ts            # print the plan
 *   npx tsx --env-file=.env scripts/seed-mnm-pricelist.ts --apply    # write
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import type { ProductMetadata } from "../src/lib/storefront/product-mapping";
import type { Category } from "../src/storefront/types";
import {
  MNM_CATEGORIES,
  VIALS_PER_KIT,
  buildMnmPricelistProducts,
  type MnmProduct,
} from "./lib/mnm-pricelist";

const APPLY = process.argv.slice(2).includes("--apply");
const TENANT_SLUG = "mnm-pepsabuy";
const DEMO_SKU_PREFIX = "DEMO-";
const SYMBOL = "₱";
const CLOSED_STATUSES = ["closed", "cancelled", "archived"];
const ALL_TAB: Category = { id: "all", label: "All Products" };

const peso = (n: number) => `${SYMBOL}${n.toLocaleString("en-PH")}`;

function toWrite(p: MnmProduct) {
  const metadata: ProductMetadata = {
    currencySymbol: SYMBOL,
    category: p.category,
    featured: p.featured,
    productType: "gb",
    gbPrice: p.price,
    productClass: p.productClass,
    // Group-buy only store: no inventory behind any listing.
    madeToOrder: true,
    vialsPerKit: VIALS_PER_KIT,
    ...(p.sizes ? { sizes: p.sizes } : {}),
    ...(p.variations.length ? { variations: p.variations } : {}),
  };
  return {
    name: p.name,
    description: p.description,
    priceCents: Math.round(p.price * 100),
    currency: "PHP",
    stock: 0, // group-buy listings are pre-orders (GB stock exemption)
    status: "active",
    active: true,
    images: [] as string[], // branding.config.defaultProductImage covers imageless cards
    metadata: metadata as unknown as Prisma.InputJsonValue,
  };
}

/** Saved categories with ours replacing any of the same id, "all" tab first. */
function withSheetCategories(saved: unknown): Category[] {
  const ours: Category[] = MNM_CATEGORIES.map((c) => ({ ...c }));
  const ourIds = new Set(ours.map((c) => c.id));
  const kept = (Array.isArray(saved) ? (saved as Category[]) : []).filter(
    (c) => c?.id && c.id !== ALL_TAB.id && !ourIds.has(c.id),
  );
  return [ALL_TAB, ...kept, ...ours];
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  const tenantId = tenant.id;

  const products = buildMnmPricelistProducts();
  const options = products.reduce((n, p) => n + Math.max(1, p.variations.length), 0);
  console.log(
    `\n${tenant.name} (${tenantId}) — ${APPLY ? "APPLY" : "DRY RUN"}\n` +
      `${products.length} products / ${options} sellable options\n`,
  );
  for (const cat of MNM_CATEGORIES) {
    console.log(`  — ${cat.label} —`);
    for (const p of products.filter((x) => x.category === cat.id)) {
      console.log(`  ${p.name}  [${p.sku}]  from ${peso(p.price)}${p.featured ? "  ★" : ""}`);
      for (const v of p.variations) console.log(`      · ${v.name.padEnd(20)} ${peso(v.price)}`);
    }
  }

  const demo = await prisma.product.findMany({
    where: { tenantId, sku: { startsWith: DEMO_SKU_PREFIX } },
    select: { id: true, name: true },
  });
  const demoIds = new Set(demo.map((d) => d.id));
  console.log(`\nremove ${demo.length} sample product(s): ${demo.map((d) => d.name).join(" · ") || "(none)"}`);

  const others = await prisma.product.findMany({
    where: { tenantId, sku: { notIn: [...products.map((p) => p.sku)] }, NOT: { sku: { startsWith: DEMO_SKU_PREFIX } } },
    select: { sku: true, name: true },
  });
  if (others.length) {
    console.log(`left untouched (not samples, not on the sheet): ${others.map((o) => `${o.sku} ${o.name}`).join(" · ")}`);
  }

  const rounds = await prisma.groupBuy.findMany({
    where: { tenantId, status: { notIn: CLOSED_STATUSES } },
    select: { id: true, name: true, status: true, productIds: true },
  });
  const scoped = rounds.filter((r) => {
    const ids = Array.isArray(r.productIds) ? (r.productIds as string[]) : [];
    return ids.some((id) => demoIds.has(id));
  });
  for (const r of scoped) console.log(`re-point round "${r.name}" (${r.status}) at the new catalog`);

  const branding = await prisma.branding.findUnique({ where: { tenantId }, select: { config: true } });
  const config = (branding?.config ?? {}) as Record<string, unknown>;
  const categories = withSheetCategories(config.categories);
  console.log(`categories after apply: ${categories.map((c) => c.label).join(" · ")}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.\n");
    return;
  }

  const { count: removed } = await prisma.product.deleteMany({
    where: { tenantId, sku: { startsWith: DEMO_SKU_PREFIX } },
  });

  const newIds: string[] = [];
  for (const p of products) {
    const write = toWrite(p);
    const row = await prisma.product.upsert({
      where: { tenantId_sku: { tenantId, sku: p.sku } },
      update: { ...write, slug: p.slug },
      create: { ...write, tenantId, sku: p.sku, slug: p.slug },
      select: { id: true },
    });
    newIds.push(row.id);
  }

  for (const r of scoped) {
    const kept = (r.productIds as string[]).filter((id) => !demoIds.has(id) && !newIds.includes(id));
    await prisma.groupBuy.update({
      where: { id: r.id },
      data: { productIds: [...kept, ...newIds] },
      // Narrow select: the local schema may carry round columns not yet pushed.
      select: { id: true },
    });
  }

  await prisma.branding.update({
    where: { tenantId },
    data: { config: { ...config, categories } as Prisma.InputJsonValue },
  });

  const total = await prisma.product.count({ where: { tenantId } });
  console.log(
    `\n✓ removed ${removed} sample(s), upserted ${products.length} products (store now has ${total}),` +
      ` re-pointed ${scoped.length} round(s), saved ${categories.length - 1} categories` +
      "\n\nThe storefront caches its catalog: press Save on any store-admin branding\n" +
      "screen (or redeploy) for the live page to pick this up.\n",
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

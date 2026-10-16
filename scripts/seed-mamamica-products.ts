/**
 * Load Mama Mica Glow's shop catalog from the owner's pricelist
 * (scripts/lib/mamamica-pricelist.ts — verified by scripts/test-mamamica-pricelist.ts)
 * into the `mamamica` tenant on MAMAMICA'S OWN database (schema "pepweb"), never
 * Pepweb's.
 *
 * Per-vial prices; sizes out of stock everywhere are left off; a product with
 * every size out is saved as a draft. Live options get a placeholder stock the
 * owner corrects in the store admin. Also sets the shop's category shelf (keeping
 * any category the owner already added).
 *
 * Idempotent: upserts on (tenantId, sku). Nothing is deleted — products already in
 * the catalog that this sheet does not cover are listed and left alone.
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed:
 *   set -a; source MamaMicaGlow/.env.mamamica; set +a
 *   npx tsx scripts/seed-mamamica-products.ts            # print the plan
 *   npx tsx scripts/seed-mamamica-products.ts --apply    # write
 */
import { Prisma, PrismaClient } from "@prisma/client";

import type { ProductMetadata } from "../src/lib/storefront/product-mapping";
import { MAMAMICA_CATEGORIES } from "./lib/mamamica-families";
import { buildMamamicaProducts, type MamamicaProduct } from "./lib/mamamica-pricelist";

const APPLY = process.argv.slice(2).includes("--apply");
const SLUG = "mamamica";
const SYMBOL = "₱";

const peso = (n: number) => `${SYMBOL}${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

function requireSchemaUrl(): string {
  const url = process.env.DIRECT_URL?.trim();
  if (!url) throw new Error("DIRECT_URL is not set — source MamaMicaGlow/.env.mamamica first (see the header).");
  if (!new URL(url).searchParams.get("schema")) throw new Error("Refusing to run: DIRECT_URL has no ?schema= (is this Pepweb's own DB?)");
  return url;
}

function toWrite(p: MamamicaProduct) {
  // A sized family keeps its sizes as named options even when one is left live,
  // so the shopper still sees (and the order still records) which size it is.
  const multi = p.allCodes.length > 1;
  const metadata: ProductMetadata = {
    currencySymbol: SYMBOL,
    category: p.category,
    featured: p.featured,
    ...(multi ? { variations: p.options.map((o) => ({ name: o.label, price: o.price, stock: o.stock })) } : {}),
  };
  return {
    name: p.name,
    description: p.description || null,
    priceCents: Math.round(p.price * 100),
    currency: "PHP",
    stock: multi ? Math.max(...p.options.map((o) => o.stock)) : p.options[0].stock,
    status: p.active ? "active" : "draft",
    active: p.active,
    images: [] as string[],
    metadata: metadata as unknown as Prisma.InputJsonValue,
  };
}

function printPlan(products: MamamicaProduct[]) {
  for (const cat of MAMAMICA_CATEGORIES) {
    const shelf = products.filter((p) => p.category === cat.id);
    console.log(`\n  — ${cat.label} (${shelf.length}) —`);
    for (const p of shelf) {
      const flags = [p.featured ? "★" : "", p.active ? "" : "HIDDEN"].filter(Boolean).join(" ");
      const opts = p.allCodes.length > 1 ? `  [${p.options.map((o) => `${o.label} ${peso(o.price)}`).join(" · ")}]` : "";
      console.log(`  ${peso(p.price).padStart(9)}  ${p.name}${flags ? `  ${flags}` : ""}${opts}`);
    }
  }
}

async function main() {
  const db = new PrismaClient({ datasourceUrl: requireSchemaUrl() });
  try {
    const tenant = await db.tenant.findUnique({ where: { slug: SLUG } });
    if (!tenant) throw new Error(`tenant '${SLUG}' not found — run scripts/provision-mamamica.ts first`);

    const products = buildMamamicaProducts();
    const live = products.filter((p) => p.active).length;
    console.log(`\ntenant ${SLUG} (${tenant.id}) — ${APPLY ? "APPLY" : "DRY RUN"}`);
    console.log(`${products.length} products (${live} live, ${products.length - live} hidden)`);
    printPlan(products);

    const existing = await db.product.findMany({ where: { tenantId: tenant.id }, select: { sku: true, name: true } });
    const seeded = new Set(products.map((p) => p.sku));
    const orphans = existing.filter((e) => !seeded.has(e.sku));
    console.log(`\n${existing.length} product(s) already in the catalog; ${orphans.length} not covered by this sheet`);
    for (const o of orphans) console.log(`  · ${o.sku} ${o.name} (left untouched)`);

    const branding = await db.branding.findUnique({ where: { tenantId: tenant.id } });
    const config = (branding?.config ?? {}) as Record<string, unknown>;
    const saved = Array.isArray(config.categories) ? (config.categories as Array<{ id: string; label: string }>) : [];
    const savedIds = new Set(saved.map((c) => c.id));
    const categories = [...saved, ...MAMAMICA_CATEGORIES.filter((c) => !savedIds.has(c.id))];
    console.log(`categories: ${categories.map((c) => c.label).join(" · ")}`);

    if (!APPLY) {
      console.log(`\nDRY RUN — nothing written. Re-run with --apply.\n`);
      return;
    }

    for (const p of products) {
      const write = toWrite(p);
      await db.product.upsert({
        where: { tenantId_sku: { tenantId: tenant.id, sku: p.sku } },
        update: { ...write, slug: p.slug },
        create: { ...write, tenantId: tenant.id, sku: p.sku, slug: p.slug },
      });
    }
    const nextConfig = { ...config, categories } as Prisma.InputJsonValue;
    await db.branding.upsert({
      where: { tenantId: tenant.id },
      update: { config: nextConfig },
      create: { tenantId: tenant.id, config: nextConfig },
    });

    const count = await db.product.count({ where: { tenantId: tenant.id } });
    console.log(`\n✓ upserted ${products.length} products — ${SLUG} now has ${count}`);
    console.log(`Next: the shop caches its catalog — restart the Mamamica server (port 3200) or press Save in store admin to see them now.\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

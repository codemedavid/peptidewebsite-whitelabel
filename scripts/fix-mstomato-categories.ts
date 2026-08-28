/**
 * Give mstomato its own categories and file every product under one.
 *
 * TWO problems, one migration:
 *
 *  1. `branding.config.categories` was never saved (null), so store.tsx fell
 *     back to SEED_CATEGORIES and the storefront advertised a peptide shop —
 *     "Peptides", "GLP-1 Agonists", "Insulin Resistance" — for a store that
 *     sells vial caps and cases. This writes the owner's real list, which is
 *     what "delete the existing categories" means here: there was nothing saved
 *     to delete, only a seed fallback to displace.
 *
 *  2. Every product's `metadata.category` held a human LABEL ("Vial Cases",
 *     "Sample Products"). Catalog.tsx filters with `p.category === category`
 *     where `category` is a category ID, so no chip ever matched anything. Same
 *     bug, same fix as scripts/fix-peppies-categories.ts.
 *
 * Categories created: Vial Caps, Vial Cases, Accessories. The classification
 * lives in ./lib/mstomato-categories and is covered by
 * `npm run test:mstomato-categories` — run that before this.
 *
 * Idempotent: re-running REUSES any category whose label already exists (so
 * product ids stay valid) and only writes products whose category actually
 * changes. Pass --dry to preview without writing.
 *
 *   npx tsx --env-file=.env scripts/fix-mstomato-categories.ts --dry
 *   npx tsx --env-file=.env scripts/fix-mstomato-categories.ts
 */
import { PrismaClient } from "@prisma/client";

import {
  MSTOMATO_CATEGORY_LABELS,
  classifyMstomatoProduct,
  type CategoryRecord,
} from "./lib/mstomato-categories";

// Use the DIRECT (non-pooled) connection for this one-off migration — the
// pgbouncer pooler on :6543 has been intermittently dropping connections.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});
const TENANT_SLUG = "mstomato";
const DRY = process.argv.includes("--dry");

/** Retry a thunk a few times to ride out transient connection resets. */
async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      console.warn(`  …${label} attempt ${i}/${tries} failed: ${msg}`);
    }
  }
  throw lastErr;
}

/** The app's own id format — AdminCategoriesManager.tsx uses exactly this. */
const newCategoryId = () =>
  `cat${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

async function main() {
  const tenant = await withRetry("connect", () =>
    prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } }),
  );
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})${DRY ? "  [DRY RUN]" : ""}\n`);

  const branding = await withRetry("load branding", () =>
    prisma.branding.findFirst({ where: { tenantId: tenant.id } }),
  );
  if (!branding) throw new Error(`No Branding row for "${TENANT_SLUG}"`);

  const config = { ...((branding.config ?? {}) as Record<string, unknown>) };
  const existing = Array.isArray(config.categories)
    ? (config.categories as CategoryRecord[])
    : [];
  console.log(
    existing.length
      ? `Existing saved categories: ${existing.map((c) => c.label).join(", ")}`
      : "Existing saved categories: none (storefront was showing the SEED peptide chips)",
  );

  // Reuse an id when the label already exists, so a re-run doesn't orphan every
  // product's category. New labels get a fresh id.
  const byLabel = new Map(
    existing
      .filter((c) => c && c.id && c.id !== "all")
      .map((c) => [String(c.label).toLowerCase(), c.id] as const),
  );
  const categories: CategoryRecord[] = [
    { id: "all", label: "All Products" },
    ...MSTOMATO_CATEGORY_LABELS.map((label) => ({
      id: byLabel.get(label.toLowerCase()) ?? newCategoryId(),
      label,
    })),
  ];
  const idFor = new Map(categories.map((c) => [c.label, c.id] as const));

  console.log("\nNew category list:");
  for (const c of categories) console.log(`  ${c.label.padEnd(14)} ${c.id}`);

  const products = await withRetry("load products", () =>
    prisma.product.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, name: true, metadata: true },
      orderBy: { name: "asc" },
    }),
  );

  console.log(`\n${products.length} product(s):`);
  const tally: Record<string, number> = {};
  let changed = 0;

  for (const p of products) {
    const label = classifyMstomatoProduct(p.name);
    const targetId = idFor.get(label)!;
    tally[label] = (tally[label] ?? 0) + 1;

    const meta = { ...((p.metadata ?? {}) as Record<string, unknown>) };
    const before = typeof meta.category === "string" ? meta.category : "";
    if (before === targetId) {
      console.log(`  = ${p.name.padEnd(40)} already ${label}`);
      continue;
    }
    meta.category = targetId;
    console.log(`  → ${p.name.padEnd(40)} ${JSON.stringify(before)} ⇒ ${label}`);
    if (!DRY) {
      await withRetry(`update ${p.name}`, () =>
        prisma.product.update({
          where: { id: p.id },
          data: { metadata: meta as never },
        }),
      );
    }
    changed++;
  }

  // Written LAST: if a product update fails part-way, the tenant keeps its old
  // (already broken) category list rather than gaining a list whose ids only
  // some products point at.
  if (!DRY) {
    await withRetry("save categories", () =>
      prisma.branding.update({
        where: { id: branding.id },
        data: { config: { ...config, categories } as never },
      }),
    );
  }

  console.log("\nShelf counts:");
  for (const label of MSTOMATO_CATEGORY_LABELS) {
    console.log(`  ${label.padEnd(14)} ${tally[label] ?? 0}`);
  }
  console.log(
    `\n${DRY ? "Would update" : "Updated"} ${changed} product(s) and ${
      DRY ? "would write" : "wrote"
    } ${categories.length - 1} categories.`,
  );

  if (!DRY) {
    // The storefront reads branding through `unstable_cache` keyed on the tags
    // in lib/tenant/cache-tags.ts, and `revalidateTag` only works inside a Next
    // request — a standalone script cannot bust it. Until something does, the
    // live site keeps serving the OLD category chips even though the DB is
    // correct. Saying so beats letting the operator conclude the migration
    // silently failed.
    console.log(
      "\n⚠ NEXT STEP — the storefront caches branding (unstable_cache + tenant tags).\n" +
        "  This script writes the DB but cannot call revalidateTag from outside a\n" +
        "  Next request, so the live page will keep showing the old chips until one\n" +
        "  of these happens:\n" +
        "    • open store admin → Branding (or Categories) and press Save, which\n" +
        "      calls revalidateTenant() for you; or\n" +
        "    • redeploy / restart the server (dev: restart `npm run dev`).",
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

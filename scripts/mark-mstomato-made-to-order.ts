/**
 * Mark mstomato's catalog "made to order".
 *
 * The store manufactures its vial cases and caps per order, so it never held
 * inventory — and every one of its products sat at `stock = 0`. The stock gate
 * read that correctly and shut the shop: "Out of stock" badges, inert "Sold
 * out" buttons, struck-through colourway pills, a cart that refused every add,
 * and a server-side rejection at placement. The storefront could not take a
 * single order.
 *
 * This sets `metadata.madeToOrder = true` on the products that are actually for
 * sale, which lifts them off the stock gate entirely (see
 * lib/storefront/made-to-order and `npm run test:made-to-order`).
 *
 * NOT marked:
 *   • the four "Sample …" rows — `status=draft` seed leftovers the owner never
 *     published. Marking them would quietly make four placeholder listings
 *     sellable the moment anyone flips them active.
 *   • any product that already carries the flag (re-running writes nothing).
 *
 * The feature grant is separate and must be in place, or the flag is stripped
 * fail-closed at render and at placement:
 *   npx tsx --env-file=.env scripts/grant-feature.ts mstomato storefront.made_to_order on
 *
 * After this runs the storefront still serves the OLD catalog until the cache
 * turns over — a direct-Prisma script can't invalidate unstable_cache. Have the
 * owner hit Save in the store admin (or restart the server) to see the change.
 *
 * Idempotent. Pass --dry to preview without writing.
 *
 *   npx tsx --env-file=.env scripts/mark-mstomato-made-to-order.ts --dry
 *   npx tsx --env-file=.env scripts/mark-mstomato-made-to-order.ts
 */
import { PrismaClient } from "@prisma/client";

// Direct (non-pooled) connection, same as the categories migration: the
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

async function main() {
  const tenant = await withRetry("connect", () =>
    prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } }),
  );
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})${DRY ? "  [DRY RUN]" : ""}\n`);

  const products = await withRetry("load products", () =>
    prisma.product.findMany({
      where: { tenantId: tenant.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true, stock: true, metadata: true },
    }),
  );

  let marked = 0;
  let already = 0;
  let skipped = 0;

  for (const p of products) {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;

    if (p.status !== "active") {
      console.log(`  ·  skip (${p.status})      ${p.name}`);
      skipped++;
      continue;
    }
    if (meta.madeToOrder === true) {
      console.log(`  =  already made-to-order  ${p.name}`);
      already++;
      continue;
    }

    console.log(`  ✓  mark made-to-order     ${p.name}  (stock was ${p.stock})`);
    marked++;
    if (DRY) continue;

    await withRetry(`write ${p.name}`, () =>
      prisma.product.update({
        where: { id: p.id },
        data: { metadata: { ...meta, madeToOrder: true } },
      }),
    );
  }

  console.log(
    `\n${marked} marked, ${already} already set, ${skipped} skipped (not active).` +
      (DRY ? "  [DRY RUN — nothing written]" : ""),
  );
  if (!DRY && marked > 0) {
    console.log(
      "\nNext:\n" +
        "  1. Grant the feature if it isn't already:\n" +
        `     npx tsx --env-file=.env scripts/grant-feature.ts ${TENANT_SLUG} storefront.made_to_order on\n` +
        "  2. Have the owner press Save in the store admin (or restart the server)\n" +
        "     — this script cannot invalidate the storefront's unstable_cache.",
    );
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

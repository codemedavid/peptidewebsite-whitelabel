/**
 * Import a store's order history from the system it ran on BEFORE the whitelabel.
 *
 * Reads a plain-text `pg_dumpall` backup, maps its `public.orders` rows with the
 * pure core in src/lib/orders/legacy-import.ts, and writes them to the tenant's
 * storefront_orders. Built for HP GLOW's Supabase app (487 orders, 2025-11 →
 * 2026-08); the tenant, dump path and order-number prefix are all flags, so the
 * next migration reuses it.
 *
 * DRY RUN BY DEFAULT — it prints exactly what it would write (counts, date
 * range, revenue, and every line that did NOT resolve to a live product) and
 * touches nothing. Add --apply to write.
 *
 * Idempotent: the legacy uuid is stored as `clientId`, which is unique per
 * tenant, so a re-run inserts only what is missing. Safe to interrupt and rerun.
 *
 *   npx tsx --env-file=.env scripts/import-legacy-orders.ts                 # dry run
 *   npx tsx --env-file=.env scripts/import-legacy-orders.ts --apply         # write
 *   npx tsx --env-file=.env scripts/import-legacy-orders.ts --tenant=hpglow \
 *       --prefix=HPG-IMP --dump="db_cluster-05-08-2026@01-12-58.backup"
 *
 * Covered by scripts/test-legacy-order-import.ts (the mapping) — this file is
 * the I/O shell around it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PrismaClient, Prisma } from "@prisma/client";

import {
  parseLegacyOrders,
  buildCatalogIndex,
  mapLegacyOrder,
  importOrderNumber,
  type LegacyCatalogProduct,
  type ImportedOrder,
} from "../src/lib/orders/legacy-import";

// ── flags ────────────────────────────────────────────────────────────────────

function flag(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const APPLY = process.argv.includes("--apply");
const TENANT = flag("tenant", "hpglow");
const PREFIX = flag("prefix", "HPG-IMP");
const DUMP = flag("dump", "db_cluster-05-08-2026@01-12-58.backup");
/** Insert in chunks so one oversized statement can't stall the pooler. */
const BATCH = 50;

const db = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

/** items − discount + shipping, the same total the admin renders (orderTotal). */
function total(o: ImportedOrder): number {
  const subtotal = o.items.reduce((s, i) => s + i.price * i.qty, 0);
  return Math.max(0, subtotal - (o.discount?.amount ?? 0) + o.shipping.fee);
}

async function main() {
  console.log(`\n  Legacy order import — tenant "${TENANT}"`);
  console.log(`  mode: ${APPLY ? "APPLY (writes to the database)" : "DRY RUN (no writes)"}\n`);

  const tenant = await db.tenant.findUnique({
    where: { slug: TENANT },
    select: { id: true, name: true },
  });
  if (!tenant) throw new Error(`No tenant with slug "${TENANT}".`);

  // 1. Parse the dump.
  const rows = parseLegacyOrders(readFileSync(join(process.cwd(), DUMP), "utf8"));
  if (rows.length === 0) throw new Error(`No "COPY public.orders" block found in ${DUMP}.`);
  // Oldest first, so HPG-IMP-0001 really is the store's first order.
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  console.log(`  parsed  ${rows.length} orders from ${DUMP}`);
  console.log(
    `          ${rows[0].createdAt.slice(0, 10)} → ${rows[rows.length - 1].createdAt.slice(0, 10)}`,
  );

  // 2. Index the LIVE catalog so lines link to real products.
  const products = await db.product.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true, metadata: true },
  });
  const catalog: LegacyCatalogProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    variations: (
      ((p.metadata as Record<string, unknown> | null)?.variations ?? []) as { name?: unknown }[]
    ).filter((v): v is { name: string } => typeof v?.name === "string"),
  }));
  const index = buildCatalogIndex(catalog);
  console.log(`  catalog ${catalog.length} live products\n`);

  // 3. Map every row.
  const mapped = rows.map((row, i) =>
    mapLegacyOrder(row, { index, orderNumber: importOrderNumber(PREFIX, i + 1) }),
  );

  // 4. Report what this WOULD write, before writing it.
  const byStatus = new Map<string, number>();
  const unlinked = new Map<string, number>();
  let linkedLines = 0;
  let allLines = 0;
  let revenue = 0;
  for (const o of mapped) {
    byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
    if (o.status !== "cancelled") revenue += total(o);
    for (const line of o.items) {
      allLines++;
      if (line.productId) linkedLines++;
      else unlinked.set(line.name, (unlinked.get(line.name) ?? 0) + 1);
    }
  }

  console.log("  status breakdown");
  for (const [status, n] of [...byStatus].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${status}`);
  }
  console.log(`\n  lines   ${linkedLines}/${allLines} linked to a live product`);
  if (unlinked.size > 0) {
    // Not an error: a discontinued product still imports with its historical
    // name and price, it just contributes nothing to per-product reporting.
    console.log(`  ${unlinked.size} product name(s) no longer in the catalog — imported unlinked:`);
    for (const [name, n] of [...unlinked].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}× ${name}`);
    }
  }
  const cancelled = byStatus.get("cancelled") ?? 0;
  console.log(
    `\n  revenue ${peso(revenue)} across ${mapped.length - cancelled} non-cancelled orders`,
  );
  console.log("  proofs  0 carried (the old Supabase project is gone — see the module header)");

  const existing = await db.storefrontOrder.count({ where: { tenantId: tenant.id } });
  console.log(`\n  tenant currently holds ${existing} order(s)`);

  if (!APPLY) {
    console.log("\n  DRY RUN — nothing written. Re-run with --apply to import.\n");
    return;
  }

  // 5. Write. skipDuplicates + the (tenantId, clientId) unique index makes a
  //    re-run insert only what is missing.
  let written = 0;
  for (let i = 0; i < mapped.length; i += BATCH) {
    const chunk = mapped.slice(i, i + BATCH);
    const result = await db.storefrontOrder.createMany({
      skipDuplicates: true,
      data: chunk.map((o) => ({
        // Deterministic and obviously an import, so a row is traceable straight
        // back to the legacy record it came from.
        id: `imp-${o.clientId}`,
        tenantId: tenant.id,
        orderNumber: o.orderNumber,
        clientId: o.clientId,
        status: o.status,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
        paymentProofUrl: o.paymentProofUrl,
        customer: o.customer as unknown as Prisma.InputJsonValue,
        shipping: o.shipping as unknown as Prisma.InputJsonValue,
        items: o.items as unknown as Prisma.InputJsonValue,
        statusHistory: o.statusHistory as unknown as Prisma.InputJsonValue,
        ...(o.discount ? { discount: o.discount as unknown as Prisma.InputJsonValue } : {}),
        courier: o.courier,
        trackingNumber: o.trackingNumber,
        shippingNote: o.shippingNote,
        placedAt: new Date(o.placedAt),
        createdAt: new Date(o.placedAt),
        imported: true,
      })),
    });
    written += result.count;
    console.log(`  wrote ${String(written).padStart(4)}/${mapped.length}`);
  }

  const after = await db.storefrontOrder.count({ where: { tenantId: tenant.id } });
  const importedCount = await db.storefrontOrder.count({
    where: { tenantId: tenant.id, imported: true },
  });
  console.log(`\n  inserted ${written} new order(s) (${mapped.length - written} already present)`);
  console.log(`  tenant now holds ${after} order(s), ${importedCount} of them imported\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

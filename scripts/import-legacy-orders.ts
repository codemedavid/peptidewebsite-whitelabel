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
 * A legacy project that is still LIVE (The Peppy Lab) needs no dump: export its
 * `orders` table off the PostgREST API to a JSON array file and pass --rest.
 * With --rest the old order numbers are kept (customers still hold them), the
 * buyer's note stays private (customerNote), and lines link by legacy product id
 * via the `leg-…` SKUs scripts/import-legacy-store.ts gave the catalog.
 * --rehost-proofs copies each proof image onto the tenant's ImageKit folder
 * (APPLY only; new orders only — rows already imported are left alone).
 *
 *   npx tsx --env-file=.env scripts/import-legacy-orders.ts --tenant=thepeppylab \
 *       --rest=.migration/thepeppylab/orders.json --rehost-proofs --apply
 *
 * Covered by scripts/test-legacy-order-import.ts (the mapping) — this file is
 * the I/O shell around it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PrismaClient, Prisma } from "@prisma/client";

import {
  parseLegacyOrders,
  legacyOrderRowFromJson,
  buildCatalogIndex,
  mapLegacyOrder,
  importOrderNumber,
  type LegacyCatalogProduct,
  type LegacyOrderRow,
  type ImportedOrder,
} from "../src/lib/orders/legacy-import";
import { legacySku } from "../src/lib/migration/legacy-store";

// ── flags ────────────────────────────────────────────────────────────────────

function flag(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const APPLY = process.argv.includes("--apply");
const TENANT = flag("tenant", "hpglow");
const PREFIX = flag("prefix", "HPG-IMP");
const DUMP = flag("dump", "db_cluster-05-08-2026@01-12-58.backup");
const REST = flag("rest", "");
const REHOST_PROOFS = process.argv.includes("--rehost-proofs");
/** Parallel proof transfers — enough to be quick, few enough to be polite. */
const PROOF_CONCURRENCY = 6;
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

  // 1. Read the source: a REST JSON export, or the pg dump.
  const source = REST || DUMP;
  const rows = REST ? readRestRows(REST) : parseLegacyOrders(readFileSync(join(process.cwd(), DUMP), "utf8"));
  if (rows.length === 0) throw new Error(`No orders found in ${source}.`);
  // Oldest first, so HPG-IMP-0001 really is the store's first order.
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  console.log(`  parsed  ${rows.length} orders from ${source}`);
  console.log(
    `          ${rows[0].createdAt.slice(0, 10)} → ${rows[rows.length - 1].createdAt.slice(0, 10)}`,
  );

  // 2. Index the LIVE catalog so lines link to real products.
  const products = await db.product.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true, sku: true, metadata: true },
  });
  // A catalog imported off the old app carries `leg-…` SKUs derived from the
  // legacy uuid, and SKUs stay put through admin edits — so the SKU is the
  // rename-proof join key. Lines get their product_id mapped the same way.
  const catalog: LegacyCatalogProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    ...(p.sku?.startsWith("leg-") ? { legacyId: p.sku } : {}),
    variations: (
      ((p.metadata as Record<string, unknown> | null)?.variations ?? []) as { name?: unknown }[]
    ).filter((v): v is { name: string } => typeof v?.name === "string"),
  }));
  const index = buildCatalogIndex(catalog);
  console.log(`  catalog ${catalog.length} live products\n`);

  // 3. Map every row. Proofs are filled in later, only for rows actually written.
  const mapped = rows.map((row, i) =>
    mapLegacyOrder(REST ? withSkuIds(row) : row, {
      index,
      orderNumber: (REST && row.legacyOrderNumber) || importOrderNumber(PREFIX, i + 1),
      ...(REST ? { notesAs: "customer" as const } : {}),
    }),
  );
  const proofSources = new Map(rows.map((r) => [r.id, r.paymentProofUrl]));

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
  const withProof = rows.filter((r) => r.paymentProofUrl).length;
  console.log(
    REHOST_PROOFS
      ? `  proofs  ${withProof} to re-host onto ImageKit (new orders only, on --apply)`
      : `  proofs  0 carried (pass --rehost-proofs while the old project is still up)`,
  );

  const existing = await db.storefrontOrder.count({ where: { tenantId: tenant.id } });
  console.log(`\n  tenant currently holds ${existing} order(s)`);

  if (!APPLY) {
    console.log("\n  DRY RUN — nothing written. Re-run with --apply to import.\n");
    return;
  }

  // 5. Re-host proofs for the orders this run will actually insert.
  const present = new Set(
    (
      await db.storefrontOrder.findMany({
        where: { tenantId: tenant.id, clientId: { in: mapped.map((o) => o.clientId) } },
        select: { clientId: true },
      })
    ).map((o) => o.clientId),
  );
  const fresh = mapped.filter((o) => !present.has(o.clientId));
  const ready = REHOST_PROOFS ? await rehostProofs(tenant.id, fresh, proofSources) : fresh;

  // 6. Write. skipDuplicates + the (tenantId, clientId) unique index makes a
  //    re-run insert only what is missing.
  let written = 0;
  for (let i = 0; i < ready.length; i += BATCH) {
    const chunk = ready.slice(i, i + BATCH);
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
        customerNote: o.customerNote,
        placedAt: new Date(o.placedAt),
        createdAt: new Date(o.placedAt),
        imported: true,
      })),
    });
    written += result.count;
    console.log(`  wrote ${String(written).padStart(4)}/${ready.length}`);
  }

  const after = await db.storefrontOrder.count({ where: { tenantId: tenant.id } });
  const importedCount = await db.storefrontOrder.count({
    where: { tenantId: tenant.id, imported: true },
  });
  console.log(`\n  inserted ${written} new order(s) (${mapped.length - written} already present)`);
  console.log(`  tenant now holds ${after} order(s), ${importedCount} of them imported\n`);
}

function readRestRows(path: string): LegacyOrderRow[] {
  const parsed: unknown = JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path} is not a JSON array of order rows.`);
  return parsed.map((r) => legacyOrderRowFromJson((r ?? {}) as Record<string, unknown>));
}

/** Point each line's legacy uuid at the `leg-…` SKU the catalog was imported under. */
function withSkuIds(row: LegacyOrderRow): LegacyOrderRow {
  return {
    ...row,
    orderItems: row.orderItems.map((item) =>
      item.product_id ? { ...item, product_id: legacySku(item.product_id) } : item,
    ),
  };
}

/** Copy each order's proof onto the tenant's ImageKit folder. A proof that
 *  cannot be fetched imports as "no proof on file" rather than a dead link. */
async function rehostProofs(
  tenantId: string,
  orders: ImportedOrder[],
  sources: Map<string, string | null>,
): Promise<ImportedOrder[]> {
  const { uploadTenantMedia } = await import("../src/lib/imagekit/server");
  const out: ImportedOrder[] = new Array(orders.length);
  let done = 0;
  let failed = 0;
  let next = 0;

  async function worker() {
    while (next < orders.length) {
      const i = next++;
      const order = orders[i];
      const src = sources.get(order.clientId);
      let proofUrl: string | null = null;
      if (src) {
        try {
          const res = await fetch(src);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const file = Buffer.from(await res.arrayBuffer());
          const ext = (src.split("?")[0].match(/\.(jpe?g|png|webp|gif|heic|pdf)$/i)?.[1] ?? "jpg").toLowerCase();
          const up = await uploadTenantMedia({
            tenantId,
            file,
            fileName: `proof-${order.clientId}.${ext}`,
            tags: ["payment-proof", "legacy-import"],
          });
          proofUrl = up.url;
        } catch (err) {
          failed++;
          console.log(`  ! proof for ${order.orderNumber} not carried: ${(err as Error).message}`);
        }
      }
      out[i] = { ...order, paymentProofUrl: proofUrl };
      done++;
      if (done % 50 === 0) console.log(`  proofs ${String(done).padStart(4)}/${orders.length}`);
    }
  }

  await Promise.all(Array.from({ length: PROOF_CONCURRENCY }, worker));
  console.log(`  proofs re-hosted for ${orders.length - failed} order(s), ${failed} not carried\n`);
  return out;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

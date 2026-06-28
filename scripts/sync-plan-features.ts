/**
 * Reconcile the live/dev DB feature catalog to src/lib/features/catalog.ts.
 * Run after editing PLAN_FEATURES so new tenants (and the admin Features panel)
 * resolve the right per-plan ceiling. Idempotent; prints what changed.
 *
 *   npm run db:sync-features   (needs DATABASE_URL / DIRECT_URL set)
 */
import { PrismaClient } from "@prisma/client";
import { syncPlanCatalog } from "../src/lib/features/catalog-sync";

const prisma = new PrismaClient();

async function main() {
  const summary = await syncPlanCatalog(prisma);
  console.log(`Upserted ${summary.featuresUpserted} features.`);
  let changed = 0;
  for (const p of summary.plans) {
    if (p.added.length === 0 && p.removed.length === 0) {
      console.log(`  ${p.key}: up to date`);
      continue;
    }
    changed++;
    console.log(`  ${p.key}: +${p.added.length} / -${p.removed.length}`);
    if (p.added.length) console.log(`    added:   ${p.added.join(", ")}`);
    if (p.removed.length) console.log(`    removed: ${p.removed.join(", ")}`);
  }
  console.log(changed === 0 ? "All plans already in sync." : `${changed} plan(s) reconciled.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

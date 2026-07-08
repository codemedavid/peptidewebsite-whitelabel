/**
 * Reconcile the live/dev DB feature catalog to src/lib/features/catalog.ts.
 * Run after editing PLAN_FEATURES so new tenants (and the admin Features panel)
 * resolve the right per-plan ceiling. Idempotent; prints what changed.
 *
 *   npm run db:sync-features   (needs DATABASE_URL / DIRECT_URL set)
 */
import { PrismaClient } from "@prisma/client";
import { syncPlanCatalog } from "../src/lib/features/catalog-sync";
import {
  PLAN_FEATURES_CONFIG_KEY,
  normalizePlanFeatureConfig,
  defaultPlanFeatureConfig,
  resolvePlanFeatureSets,
} from "../src/lib/platform/plan-feature-config";

const prisma = new PrismaClient();

async function main() {
  // Reconcile to the operator-edited ceiling (plan_features_config) when one is
  // saved, so re-running this never resets a package's contents to catalog
  // defaults. No row yet → catalog defaults.
  const row = await prisma.platformSetting.findUnique({ where: { key: PLAN_FEATURES_CONFIG_KEY } });
  const config = row ? normalizePlanFeatureConfig(row.value) : defaultPlanFeatureConfig();
  const summary = await syncPlanCatalog(prisma, resolvePlanFeatureSets(config));
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

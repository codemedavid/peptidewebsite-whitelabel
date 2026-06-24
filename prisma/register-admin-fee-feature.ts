/**
 * One-off, idempotent migration helper for the STORE_ADMIN_FEE feature.
 *
 * The admin-fee checkout section is now gated by the `storefront.admin_fee`
 * feature (default ON — it sits in every plan ceiling, so existing fee-charging
 * tenants keep their fee). For a tenant to be entitled, the Feature row AND its
 * PlanFeature links must exist in the DB. `prisma/seed.ts` creates them for a
 * fresh DB; this script registers just that one feature on a live DB that was
 * seeded before the feature existed — without touching the demo tenant/products
 * the full seed would also upsert.
 *
 * Run once after deploying: `tsx prisma/register-admin-fee-feature.ts`
 */
import { PrismaClient } from "@prisma/client";
import { FEATURES, PLAN_FEATURES } from "../src/lib/features/catalog";

const prisma = new PrismaClient();
const KEY = FEATURES.STORE_ADMIN_FEE; // "storefront.admin_fee"

async function main() {
  const feature = await prisma.feature.upsert({
    where: { key: KEY },
    update: {},
    create: { key: KEY },
  });

  // Attach to every plan whose ceiling includes the feature (all of them).
  const planKeys = Object.entries(PLAN_FEATURES)
    .filter(([, keys]) => keys.includes(KEY))
    .map(([planKey]) => planKey);

  for (const planKey of planKeys) {
    const plan = await prisma.plan.findUnique({ where: { key: planKey } });
    if (!plan) {
      console.warn(`Plan "${planKey}" not found — skipped.`);
      continue;
    }
    await prisma.planFeature.upsert({
      where: { planId_featureId: { planId: plan.id, featureId: feature.id } },
      update: {},
      create: { planId: plan.id, featureId: feature.id },
    });
  }

  console.log(`Registered ${KEY} on plans: ${planKeys.join(", ") || "(none)"}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

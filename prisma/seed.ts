/**
 * Seeds the feature catalog, the three plans, their feature maps, and one demo
 * tenant (acme) reachable at acme.localhost:3000 in dev.
 *
 * Run: npm run db:seed  (needs DATABASE_URL / DIRECT_URL set)
 */
import { PrismaClient } from "@prisma/client";
import { ALL_FEATURES, PLAN_FEATURES } from "../src/lib/features/catalog";

const prisma = new PrismaClient();

async function main() {
  // 1. Features
  for (const key of ALL_FEATURES) {
    await prisma.feature.upsert({ where: { key }, update: {}, create: { key } });
  }
  const features = await prisma.feature.findMany();
  const byKey = new Map(features.map((f) => [f.key, f.id]));

  // 2. Plans + plan_features
  const planNames: Record<string, string> = {
    starter: "Starter",
    pro: "Pro",
    enterprise: "Enterprise",
  };
  for (const [planKey, featureKeys] of Object.entries(PLAN_FEATURES)) {
    const plan = await prisma.plan.upsert({
      where: { key: planKey },
      update: { name: planNames[planKey] },
      create: { key: planKey, name: planNames[planKey] },
    });
    for (const fk of featureKeys) {
      const featureId = byKey.get(fk)!;
      await prisma.planFeature.upsert({
        where: { planId_featureId: { planId: plan.id, featureId } },
        update: {},
        create: { planId: plan.id, featureId },
      });
    }
  }

  // 3. Demo tenant on the enterprise plan → acme.localhost:3000
  const enterprise = await prisma.plan.findUniqueOrThrow({ where: { key: "enterprise" } });
  const acme = await prisma.tenant.upsert({
    where: { slug: "acme" },
    update: {},
    create: {
      name: "Acme Peptides",
      slug: "acme",
      status: "active",
      planId: enterprise.id,
      branding: { create: { themeId: "midnight-lab" } },
      settings: {
        create: {
          storeName: "Acme Peptides",
          compliance: { researchUseOnly: "For laboratory research use only. Not for human consumption." },
        },
      },
    },
  });

  // 4. A couple of demo products
  await prisma.product.upsert({
    where: { tenantId_sku: { tenantId: acme.id, sku: "BPC-157-5MG" } },
    update: {},
    create: {
      tenantId: acme.id,
      sku: "BPC-157-5MG",
      slug: "bpc-157",
      name: "BPC-157 5mg",
      description: "Stable lyophilized peptide. 99%+ purity, third-party COA on file.",
      priceCents: 4999,
      status: "active",
      metadata: { purity: "99.2%" },
    },
  });
  await prisma.product.upsert({
    where: { tenantId_sku: { tenantId: acme.id, sku: "TB-500-5MG" } },
    update: {},
    create: {
      tenantId: acme.id,
      sku: "TB-500-5MG",
      slug: "tb-500",
      name: "TB-500 5mg",
      description: "Research peptide, lyophilized.",
      priceCents: 5999,
      status: "active",
      metadata: { purity: "98.8%" },
    },
  });

  console.log("Seed complete. Demo tenant: acme.localhost:3000");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Seeds the feature catalog, the three plans, their feature maps, and one demo
 * tenant (acme) reachable at acme.localhost:3000 in dev.
 *
 * Run: npm run db:seed  (needs DATABASE_URL / DIRECT_URL set)
 */
import { PrismaClient } from "@prisma/client";
import { syncPlanCatalog } from "../src/lib/features/catalog-sync";

const prisma = new PrismaClient();

async function main() {
  // 1 + 2. Features, plans, and plan_features — reconciled to catalog.ts.
  const sync = await syncPlanCatalog(prisma);
  console.log(`Synced ${sync.featuresUpserted} features across ${sync.plans.length} plans.`);

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

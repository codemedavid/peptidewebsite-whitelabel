/** READ-ONLY: pepstack-davao — reseller entitlement + per-product reseller metadata. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});
async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: { contains: "pepstack" } } });
  if (!tenant) throw new Error("no pepstack tenant");
  console.log(`Tenant: ${tenant.name} (${tenant.slug}, ${tenant.id})`);

  const feature = await prisma.feature.findFirst({ where: { key: { contains: "reseller" } } });
  console.log("Feature row:", JSON.stringify(feature));
  if (feature) {
    const override = await prisma.tenantFeatureOverride.findMany({
      where: { tenantId: tenant.id, featureId: feature.id },
    });
    console.log("pepstack TenantFeatureOverride rows:", JSON.stringify(override));
    const planFeature = await prisma.planFeature.findMany({ where: { featureId: feature.id } });
    console.log("PlanFeature rows:", JSON.stringify(planFeature));
  }

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    orderBy: { name: "asc" },
    select: { name: true, priceCents: true, metadata: true },
  });
  let withReseller = 0;
  for (const p of products) {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    const r = meta.reseller as { vialsOnly?: number; completeSet?: number; minQty?: number } | undefined;
    if (!r) continue;
    withReseller++;
    console.log(`${p.name.padEnd(38)} retail=${(p.priceCents ?? 0) / 100}  reseller: vialsOnly=${r.vialsOnly ?? "—"} completeSet=${r.completeSet ?? "—"} minQty=${r.minQty ?? "—"}`);
  }
  console.log(`${withReseller}/${products.length} products carry reseller data`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

/**
 * READ-ONLY: dump everything that gates Sales Analytics visibility for luminara.
 *   npx tsx <this file>   (run from repo root)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});
const SLUG = "luminara";
const MASTER = "storefront.sales_analytics";

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: SLUG },
    select: {
      id: true,
      slug: true,
      plan: {
        select: { key: true, features: { select: { feature: { select: { key: true } } } } },
      },
      featureOverrides: {
        select: { enabled: true, expiresAt: true, feature: { select: { key: true } } },
      },
      branding: { select: { config: true } },
    },
  });

  if (!tenant) {
    console.log(`No tenant with slug "${SLUG}"`);
    return;
  }

  console.log("tenant.id:", tenant.id);
  console.log("plan.key:", tenant.plan?.key);

  const planKeys = (tenant.plan?.features ?? []).map((f) => f.feature.key);
  console.log("\nplan ceiling has master?:", planKeys.includes(MASTER));
  console.log("plan SA-related keys:", planKeys.filter((k) => k.includes("sales_analytics")));

  console.log("\nfeatureOverrides (SA-related):");
  for (const o of tenant.featureOverrides) {
    if (!o.feature.key.includes("sales_analytics")) continue;
    console.log(`  ${o.feature.key}  enabled=${o.enabled}  expiresAt=${o.expiresAt ?? "null"}`);
  }
  const masterOverride = tenant.featureOverrides.find((o) => o.feature.key === MASTER);
  console.log("\nmaster override row:", masterOverride ?? "(none)");

  // Replicate getEntitlements resolution
  const set = new Set(planKeys);
  const now = Date.now();
  for (const o of tenant.featureOverrides) {
    const expired = o.expiresAt ? o.expiresAt.getTime() < now : false;
    if (expired) continue;
    if (o.enabled) set.add(o.feature.key);
    else set.delete(o.feature.key);
  }
  const salesAnalyticsEntitled = set.has(MASTER);
  console.log("\n=> salesAnalyticsEntitled (resolved):", salesAnalyticsEntitled);

  const cfg = (tenant.branding?.config ?? {}) as Record<string, unknown>;
  console.log("=> config.showAdminAnalytics:", cfg.showAdminAnalytics);
  const brandingOk = cfg.showAdminAnalytics !== false;
  console.log("=> brandingOk (!== false):", brandingOk);

  console.log("\n=> brand.showAdminAnalytics would be:", salesAnalyticsEntitled && brandingOk);
}

main().finally(() => prisma.$disconnect());

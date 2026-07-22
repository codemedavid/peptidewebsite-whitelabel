/**
 * Grant (or revoke) a feature for a tenant via a TenantFeatureOverride — the same
 * per-tenant override the Super Admin → Features panel writes. Idempotent upsert.
 *
 *   npx tsx scripts/grant-feature.ts <slug> <feature.key> [on|off]
 *   npx tsx scripts/grant-feature.ts k-glow groupbuy.two_ways_home on
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const slug = process.argv[2];
  const key = process.argv[3];
  const enabled = (process.argv[4] ?? "on") !== "off";
  if (!slug || !key) throw new Error("usage: grant-feature.ts <slug> <feature.key> [on|off]");

  const tenant = await prisma.tenant.findFirst({ where: { slug }, select: { id: true } });
  if (!tenant) throw new Error(`No tenant with slug "${slug}"`);
  const feature = await prisma.feature.findUnique({ where: { key }, select: { id: true } });
  if (!feature) throw new Error(`No feature with key "${key}" (run db:sync-features?)`);

  await prisma.tenantFeatureOverride.upsert({
    where: { tenantId_featureId: { tenantId: tenant.id, featureId: feature.id } },
    update: { enabled, expiresAt: null },
    create: { tenantId: tenant.id, featureId: feature.id, enabled, expiresAt: null },
  });

  console.log(`✓ ${slug}: ${key} = ${enabled ? "ON" : "OFF"}`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Update the hero copy for tenant `peppertones`.
 *
 * Read-modify-write into the shared `branding.config` blob (never clobbering the
 * rest of the Brand config), exactly like configure-peppies-intl.ts. The hero
 * headline renders as two lines: heroLine1 (plain) + heroLine2 (italic accent),
 * with heroSub beneath. See storefront/components/Hero.tsx.
 *
 * Run from the project root:
 *   npx tsx scripts/configure-peppertones-hero.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "peppertones";

const HERO_LINE1 = "Premium Peptides,";
const HERO_LINE2 = "Refined.";
const HERO_SUB = "Elevating expectations through quality, precision, and care.";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const branding = await prisma.branding.findUnique({
    where: { tenantId: tenant.id },
    select: { config: true },
  });
  const current = (branding?.config ?? {}) as Record<string, unknown>;

  const config: Record<string, unknown> = {
    ...current,
    heroLine1: HERO_LINE1,
    heroLine2: HERO_LINE2,
    heroSub: HERO_SUB,
  };

  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config: config as Prisma.InputJsonValue },
    create: { tenantId: tenant.id, config: config as Prisma.InputJsonValue },
  });

  console.log("Updated branding.config hero copy:");
  console.log(`  • heroLine1: ${HERO_LINE1}`);
  console.log(`  • heroLine2: ${HERO_LINE2}`);
  console.log(`  • heroSub:   ${HERO_SUB}`);
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

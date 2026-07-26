/**
 * ONE-SHOT tenant config for `luminara` (2026-07-24; hero revised 2026-07-26).
 * Owner-requested changes, all read-modify-write into the shared branding.config
 * blob (never clobbering the rest of the Brand config):
 *
 *  1. Add "Lalamove" as a shipping courier. Luminara had no saved couriers, so
 *     it fell back to SEED_COURIERS. We persist SEED_COURIERS + Lalamove so the
 *     existing couriers stay and Lalamove is added. Lalamove is noLocation:true
 *     → offered at checkout as cash-on-delivery with no location picker and ₱0
 *     added (same treatment the admin placeholder documents).
 *  2. Hide the upper-left header logo (headerShowLogo:false). The brand-text
 *     wordmark "Luminara" stays (headerShowBrand untouched).
 *  3. Show the homepage hero (showHero:true).
 *     History: this script set showHero:false on 2026-07-24. The owner asked for
 *     the hero back on 2026-07-26, so the desired state is now true. Only the
 *     flag was ever flipped — the hero's content (heroLine1/heroLine2/heroSub/
 *     heroVariant/heroCta*) was never deleted — so flipping it back restores the
 *     hero exactly as it was.
 *
 * Idempotent: re-running won't duplicate Lalamove and re-asserts the two flags.
 *
 *   npx tsx scripts/configure-luminara-changes.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { SEED_COURIERS } from "../src/storefront/data";
import type { Courier } from "../src/storefront/types";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const SLUG = "luminara";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!tenant) {
    const slugs = await prisma.tenant.findMany({ select: { slug: true } });
    throw new Error(`tenant "${SLUG}" not found — have: ${slugs.map((t) => t.slug).join(", ")}`);
  }

  const branding = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  const config = (branding?.config ?? {}) as Record<string, unknown>;

  // 1. Couriers: base = saved couriers, else the seed defaults Luminara shows today.
  const base: Courier[] = Array.isArray(config.couriers) ? (config.couriers as Courier[]) : SEED_COURIERS;
  const hasLalamove = base.some((c) => c.name.trim().toLowerCase() === "lalamove");
  const couriers: Courier[] = hasLalamove
    ? base
    : [...base, { id: "c-lalamove", name: "Lalamove", trackingUrl: "", active: true, noLocation: true }];

  console.log(`BEFORE ${SLUG} (${tenant.name}):`);
  console.log(`  couriers: ${JSON.stringify((config.couriers as unknown) ?? "(unset → seed)")}`);
  console.log(`  headerShowLogo: ${JSON.stringify(config.headerShowLogo)}  showHero: ${JSON.stringify(config.showHero)}`);

  const next: Record<string, unknown> = {
    ...config,
    couriers,
    headerShowLogo: false, // 2. no logo in the upper-left
    showHero: true, // 3. hero restored (see header note)
  };

  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config: next as Prisma.InputJsonValue },
    create: { tenantId: tenant.id, config: next as Prisma.InputJsonValue },
  });

  const after = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  const a = (after?.config ?? {}) as Record<string, unknown>;
  console.log(`AFTER  ${SLUG}:`);
  console.log(`  couriers: ${(a.couriers as Courier[]).map((c) => c.name).join(", ")}`);
  console.log(`  headerShowLogo: ${JSON.stringify(a.headerShowLogo)}  showHero: ${JSON.stringify(a.showHero)}`);
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

/**
 * ONE-SHOT: set hpglow's storefront border color to black.
 *
 * Writes branding.config.borderColor = "#000000" for tenant slug "hpglow" —
 * the Brand border override rendered through @/lib/storefront/brand-border
 * (applyBrandStyle → --brand-border). Width is intentionally left unset so
 * hairlines stay at the 1px default. Prints before/after; touches only the
 * one key on the one tenant.
 *
 *   npx tsx scripts/set-hpglow-border-black.ts
 */
import { PrismaClient } from "@prisma/client";
import { normalizeBrandBorder } from "../src/lib/storefront/brand-border";

const SLUG = "hpglow";
const BLACK = "#000000";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!tenant) {
    const slugs = await prisma.tenant.findMany({ select: { slug: true } });
    throw new Error(`tenant "${SLUG}" not found — have: ${slugs.map((t) => t.slug).join(", ")}`);
  }

  const branding = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  if (!branding) throw new Error(`no branding row for ${SLUG}`);

  const config = (branding.config ?? {}) as Record<string, unknown>;
  console.log(`BEFORE ${SLUG} (${tenant.name}): borderColor=${JSON.stringify(config.borderColor)}`);

  // Sanity: the value we write must survive the render-side normalizer.
  const normalized = normalizeBrandBorder({ borderColor: BLACK });
  if (normalized.borderColor !== BLACK) throw new Error(`normalizer rejected ${BLACK} — aborting`);

  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config: JSON.parse(JSON.stringify({ ...config, borderColor: BLACK })) },
  });

  const after = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  console.log(`AFTER  ${SLUG}: borderColor=${JSON.stringify((after?.config as Record<string, unknown>)?.borderColor)}`);
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

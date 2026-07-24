/**
 * ONE-SHOT: pin Luminara's storefront price font to its body/sans font.
 *
 * The SaaS-wide default already renders prices in each tenant's body font
 * (--brand-price-font: var(--brand-body-font)), so Luminara's prices are sans
 * without this script. Running it PINS branding.config.priceFont explicitly so
 * the price face stays the sans even if Luminara later changes its body font.
 *
 * Reads config.bodyFont (falls back to "Inter") and writes config.priceFont to
 * the same family. Prints before/after; touches only priceFont on Luminara.
 *
 *   npx tsx scripts/set-luminara-price-font.ts
 */
import { PrismaClient } from "@prisma/client";
import { resolvePriceFont } from "../src/lib/storefront/price-font";

const SLUG = "luminara";

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
  const bodyFont = typeof config.bodyFont === "string" ? config.bodyFont : "";
  console.log(
    `BEFORE ${SLUG} (${tenant.name}): bodyFont=${JSON.stringify(config.bodyFont)} priceFont=${JSON.stringify(config.priceFont)}`,
  );

  // Pin priceFont to the effective body/sans face (the SaaS-wide price default).
  const priceFont = resolvePriceFont({ priceFont: undefined, bodyFont });
  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config: JSON.parse(JSON.stringify({ ...config, priceFont })) },
  });

  const after = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  console.log(`AFTER  ${SLUG}: priceFont=${JSON.stringify((after?.config as Record<string, unknown>)?.priceFont)}`);
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

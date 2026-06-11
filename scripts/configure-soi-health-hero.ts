/**
 * Hero tweaks for tenant `soi-health`:
 *   • Shop Now (cta1) button → white background, black text
 *   • hide the chip's accent dot before "SOI HEALTH"
 *
 * Read-modify-write into the shared `branding.config` blob (never clobbering
 * the rest of the Brand config), same pattern as configure-peppertones-hero.ts.
 * The cta1 color/bg render via heroFieldCss (lib/theme/tokens.ts); the dot is
 * gated by heroChipShowDot in storefront/components/Hero.tsx.
 *
 * Run from the project root:
 *   npx tsx scripts/configure-soi-health-hero.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "soi-health";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const branding = await prisma.branding.findUnique({
    where: { tenantId: tenant.id },
    select: { config: true },
  });
  const current = (branding?.config ?? {}) as Record<string, unknown>;
  const currentFieldStyles = (current.heroFieldStyles ?? {}) as Record<string, unknown>;

  const config: Record<string, unknown> = {
    ...current,
    heroChipShowDot: false,
    heroFieldStyles: {
      ...currentFieldStyles,
      cta1: { ...(currentFieldStyles.cta1 as object), bg: "#ffffff", color: "#000000" },
    },
  };

  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config: config as Prisma.InputJsonValue },
    create: { tenantId: tenant.id, config: config as Prisma.InputJsonValue },
  });

  console.log("Updated branding.config:");
  console.log("  • cta1 (Shop Now): bg #ffffff, color #000000");
  console.log("  • heroChipShowDot: false (dot before chip label hidden)");
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

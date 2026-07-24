/**
 * Hero design for tenant `luminara`: switch to the gold WORDMARK hero — the
 * brand name rendered as one large, thin, wide-tracked gold-gradient mark on a
 * clean background (reference: luminara's gold logo).
 *
 * Read-modify-write into the shared `branding.config` blob (never clobbering
 * the rest of the Brand config), same pattern as configure-soi-health-hero.ts.
 * The variant renders via storefront/components/Hero.tsx + storefront.css
 * (.hero[data-variant="wordmark"] / .hero__wordmark); the wordmark text comes
 * from wordmarkText() → heroLine1 ("luminara") || brand name.
 *
 * Run from the project root:
 *   npx tsx scripts/configure-luminara-hero.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG = "luminara";
const WORDMARK_TEXT = "luminara"; // lowercase mark, matches the logo

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const branding = await prisma.branding.findUnique({
    where: { tenantId: tenant.id },
    select: { config: true },
  });
  const current = (branding?.config ?? {}) as Record<string, unknown>;

  // Preserve the tenant's own tagline / CTA copy; only fill sensible defaults
  // when empty. The wordmark IS the logo, so hide the hero logo card + chip.
  const existingSub = typeof current.heroSub === "string" ? (current.heroSub as string).trim() : "";
  const existingCta1 = typeof current.heroCta1 === "string" ? (current.heroCta1 as string).trim() : "";

  const config: Record<string, unknown> = {
    ...current,
    heroVariant: "wordmark",
    heroLine1: WORDMARK_TEXT,
    heroShowLogo: false,
    heroShowChip: false,
    heroShowSub: true,
    heroSub: existingSub || "Radiance, refined.",
    heroShowCtas: true,
    heroCta1: existingCta1 || "Shop Now",
  };

  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config: config as Prisma.InputJsonValue },
    create: { tenantId: tenant.id, config: config as Prisma.InputJsonValue },
  });

  console.log("Updated branding.config:");
  console.log('  • heroVariant: "wordmark" (gold-gradient brand mark)');
  console.log(`  • heroLine1 (wordmark text): "${WORDMARK_TEXT}"`);
  console.log(`  • heroSub: "${config.heroSub as string}"`);
  console.log(`  • heroCta1: "${config.heroCta1 as string}"`);
  console.log("  • heroShowLogo / heroShowChip: false (wordmark carries the hero)");
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

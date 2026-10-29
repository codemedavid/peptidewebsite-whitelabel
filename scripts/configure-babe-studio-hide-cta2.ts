/**
 * Hide the hero's secondary "Learn More" button on The Babe Studio.
 *
 * Flips branding.config.heroShowCta2 → false (the same switch as the store
 * admin's "Show secondary CTA" tweak). The label stays stored, so turning the
 * flag back on restores the button unchanged.
 *
 * The merge goes through buildTenantBrandingUpdate — the patch-only path — so
 * no other config key is touched.
 *
 * DRY RUN BY DEFAULT — prints the diff and writes nothing:
 *   npx tsx scripts/configure-babe-studio-hide-cta2.ts
 *   npx tsx scripts/configure-babe-studio-hide-cta2.ts --apply
 *
 * Rollback: set heroShowCta2 back to true (or unset it — the default is shown).
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { buildTenantBrandingUpdate } from "@/lib/tenant/branding-update";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

const TENANT_SLUG = "the-babe-studio";

async function main() {
  const branding = await prisma.branding.findFirst({
    where: { tenant: { slug: TENANT_SLUG } },
    select: { id: true, themeId: true, config: true },
  });
  if (!branding) throw new Error(`No branding row for tenant "${TENANT_SLUG}"`);

  const merged = buildTenantBrandingUpdate(
    { themeId: branding.themeId, config: branding.config },
    { layout: { heroShowCta2: false } },
  );
  if (merged.errors.length) throw new Error(merged.errors.join("\n"));

  const current = (branding.config as Record<string, unknown>) ?? {};
  console.log(`Tenant  ${TENANT_SLUG}`);
  console.log(`  heroCta2      ${JSON.stringify(current.heroCta2 ?? "(unset)")}`);
  console.log(`  heroShowCta2  ${String(current.heroShowCta2 ?? "(unset → shown)")}  →  false`);
  console.log(`Changed: ${merged.changed.join(", ") || "(nothing — already hidden)"}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.");
    return;
  }

  await prisma.branding.update({
    where: { id: branding.id },
    data: { config: merged.config as Prisma.InputJsonValue },
  });
  console.log(
    "\n✓ Secondary CTA hidden. The storefront caches branding — restart the dev server, or press Save on any\n" +
      "  store-admin branding screen (or redeploy) for the live site to pick it up.",
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

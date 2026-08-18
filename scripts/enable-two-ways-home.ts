/**
 * Set a tenant's storefront home layout. Writes branding.config.homeLayout,
 * merged into the existing config blob (never clobbers other fields), and is
 * reversible: re-run with a different layout.
 *
 *   npx tsx scripts/enable-two-ways-home.ts <slug> [classic|two-ways|boutique|editorial]
 *   npx tsx scripts/enable-two-ways-home.ts k-glow two-ways
 *   npx tsx scripts/enable-two-ways-home.ts skn-aesthetic-supply-co editorial
 *
 * The four layouts are NOT the same kind of thing (see resolveHomeLayout):
 *   • "classic"              — the default hero → chips → catalog scroll.
 *   • "two-ways"             — a SOLD module. Writing it here is not enough on
 *                              its own; without the operator grant
 *                              (FEATURES.GB_TWO_WAYS_HOME) the storefront still
 *                              renders classic. Pair with grant-feature.ts.
 *   • "boutique"/"editorial" — owner-selectable layout choices. They need no
 *                              grant, so writing the key here is sufficient.
 *
 * Validates against HOME_LAYOUTS rather than a local list, so a layout added to
 * the enum is settable here the same day — and a typo is rejected instead of
 * being written and silently dropped by the branding allow-list.
 */

import { PrismaClient } from "@prisma/client";
import { HOME_LAYOUTS, type HomeLayout } from "../src/lib/storefront/home-layout";

const prisma = new PrismaClient();

async function main() {
  const slug = process.argv[2] ?? "k-glow";
  const layout = (process.argv[3] ?? "two-ways") as HomeLayout;
  if (!HOME_LAYOUTS.includes(layout)) {
    throw new Error(`layout must be one of ${HOME_LAYOUTS.join(" | ")}, got "${layout}"`);
  }

  const tenant = await prisma.tenant.findFirst({
    where: { slug },
    include: { branding: true },
  });
  if (!tenant) throw new Error(`No tenant with slug "${slug}"`);
  if (!tenant.branding) throw new Error(`Tenant "${slug}" has no branding row`);

  const config = (tenant.branding.config ?? {}) as Record<string, unknown>;
  const nextConfig = { ...config, homeLayout: layout };

  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config: nextConfig },
  });

  console.log(`✓ ${slug}: branding.config.homeLayout = "${layout}"`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

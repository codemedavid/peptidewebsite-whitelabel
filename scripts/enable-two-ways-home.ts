/**
 * Enable (or disable) the "two ways to order" storefront home for a tenant.
 * Sets branding.config.homeLayout — "two-ways" turns on the on-hand + live
 * group-buy split home (design "K Glow Store.dc.html"); "classic" / absent is the
 * default hero → catalog home. Merges into the existing config blob (never
 * clobbers other fields). Reversible: re-run with a different layout.
 *
 *   npx tsx scripts/enable-two-ways-home.ts <slug> [two-ways|classic]
 *   npx tsx scripts/enable-two-ways-home.ts k-glow two-ways
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const slug = process.argv[2] ?? "k-glow";
  const layout = (process.argv[3] ?? "two-ways") as "two-ways" | "classic";
  if (layout !== "two-ways" && layout !== "classic") {
    throw new Error(`layout must be "two-ways" or "classic", got "${layout}"`);
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

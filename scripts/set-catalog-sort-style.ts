/**
 * Set a tenant's catalog sort menu style. Writes
 * branding.config.catalogSortStyle — "simple" renders the 3-option menu
 * (Sort by Name / Sort by Price / Sort by Best Sellers, best sellers ranked by
 * real units sold); "classic" / absent keeps the default menu (Sort: Name /
 * Price: Low to High / Price: High to Low). Merges into the existing config
 * blob (never clobbers other fields). Reversible: re-run with "classic".
 *
 *   npx tsx scripts/set-catalog-sort-style.ts <slug> [simple|classic]
 *   npx tsx scripts/set-catalog-sort-style.ts hpglow simple
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const slug = process.argv[2];
  const style = (process.argv[3] ?? "simple") as "simple" | "classic";
  if (!slug) throw new Error("Usage: set-catalog-sort-style.ts <slug> [simple|classic]");
  if (style !== "simple" && style !== "classic") {
    throw new Error(`style must be "simple" or "classic", got "${style}"`);
  }

  const tenant = await prisma.tenant.findFirst({
    where: { slug },
    include: { branding: true },
  });
  if (!tenant) throw new Error(`No tenant with slug "${slug}"`);
  if (!tenant.branding) throw new Error(`Tenant "${slug}" has no branding row`);

  const config = (tenant.branding.config ?? {}) as Record<string, unknown>;
  const nextConfig = { ...config, catalogSortStyle: style };

  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config: nextConfig },
  });

  console.log(`✓ ${slug}: branding.config.catalogSortStyle = "${style}"`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

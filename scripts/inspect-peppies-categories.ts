/**
 * READ-ONLY inspection of tenant `peppies-intl`:
 *   • categories defined in branding.config  (id + label)
 *   • every product with its current metadata.category value
 *
 * Run: npx tsx scripts/inspect-peppies-categories.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT_SLUG = "peppies-intl";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  console.log(`Tenant: ${tenant.name} (${tenant.id})\n`);

  const branding = await prisma.branding.findUnique({
    where: { tenantId: tenant.id },
    select: { config: true },
  });
  const config = (branding?.config ?? {}) as Record<string, unknown>;
  const categories = (Array.isArray(config.categories) ? config.categories : []) as {
    id: string;
    label: string;
  }[];

  console.log(`=== CATEGORIES in branding.config (${categories.length}) ===`);
  for (const c of categories) console.log(`  id=${c.id}   label=${JSON.stringify(c.label)}`);
  console.log();

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true, status: true, metadata: true },
  });

  console.log(`=== PRODUCTS (${products.length}) ===`);
  const catCount: Record<string, number> = {};
  for (const p of products) {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    const cat = typeof meta.category === "string" ? meta.category : "";
    catCount[cat] = (catCount[cat] ?? 0) + 1;
    console.log(`  ${p.name.padEnd(28)} status=${p.status.padEnd(8)} metadata.category=${JSON.stringify(cat)}`);
  }

  console.log(`\n=== current metadata.category distribution ===`);
  for (const [cat, n] of Object.entries(catCount)) console.log(`  ${JSON.stringify(cat)} → ${n}`);

  // Cross-check: which current category values actually match a real category id?
  const idSet = new Set(categories.map((c) => c.id));
  const labelToId = new Map(categories.map((c) => [c.label.toLowerCase(), c.id]));
  console.log(`\n=== match analysis ===`);
  for (const [cat] of Object.entries(catCount)) {
    const matchesId = idSet.has(cat);
    const matchesLabel = labelToId.has(cat.toLowerCase());
    console.log(
      `  ${JSON.stringify(cat)} → matchesCategoryId=${matchesId} matchesLabel=${matchesLabel}${matchesLabel ? ` (→id ${labelToId.get(cat.toLowerCase())})` : ""}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

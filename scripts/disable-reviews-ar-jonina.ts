/**
 * Turn OFF the storefront "Reviews" page for tenant `ar-jonina` (AR Jonina).
 *
 * Sets branding.config.showPageReviews = false. The storefront's visibility
 * gate (src/storefront/visibility.ts) hides the page from nav, footer, direct
 * hash navigation, and the store-admin reviews manager when this is false.
 *
 * Idempotent. Run from the project root:
 *   npx tsx scripts/disable-reviews-ar-jonina.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT_SLUG = "ar-jonina";

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true, name: true },
  });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);

  const branding = await prisma.branding.findUnique({
    where: { tenantId: tenant.id },
    select: { config: true },
  });

  const config = ((branding?.config as Record<string, unknown>) ?? {});
  const nextConfig = { ...config, showPageReviews: false };

  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config: nextConfig },
    create: { tenantId: tenant.id, config: nextConfig },
  });

  console.log(
    `✅ Reviews page disabled for ${tenant.name} (${TENANT_SLUG}). showPageReviews = false`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

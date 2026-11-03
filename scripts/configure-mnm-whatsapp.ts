/**
 * ONE-SHOT tenant config for `mnm-pepsabuy` (2026-10-30): the owner wants each
 * buyer's WhatsApp number on the group-buy customer report. Sets
 * branding.config.checkoutWhatsapp = true, so checkout asks for it (see
 * lib/storefront/checkout-fields). The operator can flip it back in
 * Platform admin → tenant → Settings → "Ask for a WhatsApp number".
 *
 * Dry run by default — prints the before/after. `--apply` writes.
 *
 *   npx tsx --env-file=.env scripts/configure-mnm-whatsapp.ts [--apply]
 *
 * After --apply the storefront keeps serving its cached config until something
 * busts the tenant cache: press Save on any store-admin branding screen, or
 * redeploy (see memory: migration-script-cache-gap).
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const SLUG = "mnm-pepsabuy";
const APPLY = process.argv.includes("--apply");

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!tenant) throw new Error(`tenant ${SLUG} not found`);
  const branding = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  const config = (branding?.config ?? {}) as Record<string, unknown>;

  console.log(`${SLUG} (${tenant.name}) checkoutWhatsapp: ${JSON.stringify(config.checkoutWhatsapp)} → true`);
  if (!APPLY) return console.log("dry run — pass --apply to write");

  const next = { ...config, checkoutWhatsapp: true } as Prisma.InputJsonValue;
  await prisma.branding.update({ where: { tenantId: tenant.id }, data: { config: next } });
  console.log("applied");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

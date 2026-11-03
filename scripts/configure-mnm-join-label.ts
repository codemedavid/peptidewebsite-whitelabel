/**
 * ONE-SHOT tenant config for `mnm-pepsabuy` (2026-10-29): the owner wanted the
 * group-buy product button to read "Add to cart" instead of "Join GB". Sets
 * branding.config.groupBuyContent.joinLabel; the rest of the copy is kept.
 * The owner can change it again in Admin → Group Buys → Storefront copy.
 *
 * Dry run by default — prints the before/after. `--apply` writes.
 *
 *   npx tsx --env-file=.env scripts/configure-mnm-join-label.ts [--apply]
 *
 * After --apply the storefront keeps serving its cached config until something
 * busts the tenant cache: press Save on any store-admin branding screen, or
 * redeploy (see memory: migration-script-cache-gap).
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { normalizeGroupBuyContent } from "../src/lib/storefront/gb-content";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const SLUG = "mnm-pepsabuy";
const JOIN_LABEL = "Add to cart";
const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: SLUG },
    select: { id: true, branding: { select: { config: true } } },
  });
  if (!tenant) throw new Error(`tenant ${SLUG} not found`);
  const config = (tenant.branding?.config ?? {}) as Record<string, unknown>;
  const before = normalizeGroupBuyContent(config.groupBuyContent);
  const after = normalizeGroupBuyContent({ ...before, joinLabel: JOIN_LABEL });

  console.log("before joinLabel:", JSON.stringify(before.joinLabel));
  console.log("after  joinLabel:", JSON.stringify(after.joinLabel));
  if (!APPLY) {
    console.log("\nDry run — pass --apply to write.");
    return;
  }
  const next = { ...config, groupBuyContent: after } as Prisma.InputJsonValue;
  await prisma.branding.update({ where: { tenantId: tenant.id }, data: { config: next } });
  console.log("\nApplied.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

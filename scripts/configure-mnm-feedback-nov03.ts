/**
 * ONE-SHOT tenant config for `mnm-pepsabuy` (2026-11-03 admin feedback):
 *   - Hero: logo card removed, text + countdown only (heroShowLogo: false).
 *     The logo stays in the top-left header. Live on today's production.
 *   - Group-buy button reads "Add to cart" (groupBuyContent.joinLabel). Needs
 *     the joinLabel code deployed; the owner can change it in Admin → Group
 *     Buys → Storefront copy.
 *   - checkoutWhatsapp stays true — it now asks WhatsApp NAME + number
 *     (needs deploy).
 * Members-only sign-in (accountGate) is NOT touched here — pending the owner's
 * decision on customer accounts + the access code.
 *
 * Dry run by default — prints before/after. `--apply` writes.
 *
 *   npx tsx --env-file=.env scripts/configure-mnm-feedback-nov03.ts [--apply]
 *
 * After --apply the storefront serves its cached config until something busts
 * the tenant cache: press Save on any store-admin branding screen, or redeploy
 * (memory: migration-script-cache-gap).
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { normalizeGroupBuyContent } from "../src/lib/storefront/gb-content";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const SLUG = "mnm-pepsabuy";
const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: SLUG },
    select: { id: true, branding: { select: { config: true } } },
  });
  if (!tenant) throw new Error(`tenant ${SLUG} not found`);
  const config = (tenant.branding?.config ?? {}) as Record<string, unknown>;
  const content = normalizeGroupBuyContent(config.groupBuyContent);
  const next: Record<string, unknown> = {
    ...config,
    heroShowLogo: false,
    groupBuyContent: normalizeGroupBuyContent({ ...content, joinLabel: "Add to cart" }),
    checkoutWhatsapp: true,
  };
  const show = (c: Record<string, unknown>) => ({
    heroShowLogo: c.heroShowLogo,
    joinLabel: (c.groupBuyContent as { joinLabel?: string } | undefined)?.joinLabel,
    checkoutWhatsapp: c.checkoutWhatsapp,
    heroCountdownEnabled: (c.heroCountdown as { enabled?: boolean } | undefined)?.enabled,
  });
  console.log("before:", show(config));
  console.log("after: ", show(next));
  if (!APPLY) {
    console.log("\nDry run — pass --apply to write.");
    return;
  }
  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config: next as Prisma.InputJsonValue },
  });
  console.log("\nApplied.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

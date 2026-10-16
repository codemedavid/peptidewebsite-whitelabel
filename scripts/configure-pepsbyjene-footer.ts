/**
 * Pep's by Jene (`pepsys-compound`): switch OFF the footer's tagline and its
 * link columns (Shop / Support / Resources) at the owner's request.
 *
 * Flips the two existing whitelabel toggles — the same ones in
 * /admin/tenants/<slug>/branding → Footer — so the operator can turn them back
 * on there at any time:
 *   • footerShowBlurb   → false  ("Premium Peptide Solutions — …" tagline)
 *   • footerShowColumns → false  (every link column)
 *
 * Nothing is deleted: the saved blurb text and columns stay in branding.config,
 * the logo/name, socials, disclaimer and copyright line are untouched.
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed:
 *   npx tsx scripts/configure-pepsbyjene-footer.ts
 *   npx tsx scripts/configure-pepsbyjene-footer.ts --apply
 */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";

const APPLY = process.argv.slice(2).includes("--apply");
const TENANT_SLUG = "pepsys-compound";
const FOOTER_TOGGLES = { footerShowBlurb: false, footerShowColumns: false } as const;

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  const branding = await prisma.branding.findUnique({
    where: { tenantId: tenant.id },
    select: { config: true },
  });
  if (!branding) throw new Error(`Tenant "${TENANT_SLUG}" has no branding row`);
  const current = (branding.config ?? {}) as Record<string, unknown>;
  const config: Record<string, unknown> = { ...current, ...FOOTER_TOGGLES };

  console.log(`Tenant ${tenant.slug} (${tenant.name}) — ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`  footerBlurb (kept): ${JSON.stringify(current.footerBlurb ?? "")}`);
  for (const [key, next] of Object.entries(FOOTER_TOGGLES)) {
    console.log(`  ${key.padEnd(18)} ${String(current[key] ?? "unset (on)")} → ${next}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.");
    return;
  }

  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config: config as Prisma.InputJsonValue },
  });

  console.log("\n✓ Footer tagline + link columns switched off.");
  console.log(
    "The storefront caches branding: press Save on any branding screen in the store\n" +
      "admin, or restart the server, for the live page to pick this up.",
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

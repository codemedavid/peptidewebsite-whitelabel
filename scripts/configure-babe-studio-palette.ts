/**
 * Fix The Babe Studio's palette mapping.
 *
 * The client's brief named #0b0d14 "midnight black" as the PRIMARY colour, and
 * the onboarding mapping assigns primaryColor → config.main. But `--brand-main`
 * is the storefront's INK colour — "logo text, headings, key surfaces"
 * (storefront.css:12) — so on the dark Velvet Noir theme (background #0B0708)
 * the header wordmark, hero H1, "Our Collection", the category pills and the
 * footer column headings all rendered near-black on near-black.
 *
 * Midnight is what the client wants BEHIND the content, and Velvet Noir already
 * supplies it. So the three brand colours move up one slot:
 *
 *   main   #0b0d14 → #cdafa0   rose gold ink: wordmark, headings, nav hover
 *   accent #cdafa0 → #c08d7a   copper rose: eyebrows, chips, gradients
 *   button #c08d7a            (unchanged — CTA already reads correctly)
 *   buttonText #0b0d14        (unchanged — midnight on copper rose = 6.8:1)
 *
 * Midnight is still present as the button ink and as the theme background.
 *
 * DRY RUN BY DEFAULT — prints the diff and writes nothing:
 *   npx tsx scripts/configure-babe-studio-palette.ts
 *   npx tsx scripts/configure-babe-studio-palette.ts --apply
 */
import { PrismaClient, Prisma } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

const TENANT_SLUG = "the-babe-studio";

const ROSE_GOLD = "#cdafa0";
const COPPER_ROSE = "#c08d7a";

/** Only these keys change; everything else in the blob is preserved. */
const PATCH: Record<string, string> = {
  main: ROSE_GOLD,
  accent: COPPER_ROSE,
  button2: COPPER_ROSE,
};

async function main() {
  const branding = await prisma.branding.findFirst({
    where: { tenant: { slug: TENANT_SLUG } },
    select: { id: true, config: true },
  });
  if (!branding) throw new Error(`No branding row for tenant "${TENANT_SLUG}"`);

  const current = (branding.config as Record<string, unknown>) ?? {};
  const next = { ...current, ...PATCH };

  console.log(`Tenant  ${TENANT_SLUG}`);
  for (const [key, value] of Object.entries(PATCH)) {
    console.log(`  ${key.padEnd(10)} ${String(current[key] ?? "(unset)")}  →  ${value}`);
  }
  console.log(`  ${"button".padEnd(10)} ${String(current.button)}  (unchanged)`);
  console.log(`  ${"buttonText".padEnd(10)} ${String(current.buttonText)}  (unchanged)`);
  console.log(`Keys preserved: ${Object.keys(next).length} total`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.");
    return;
  }

  await prisma.branding.update({
    where: { id: branding.id },
    data: { config: next as unknown as Prisma.InputJsonValue },
  });
  console.log("\n✓ Palette updated. Restart the dev server (or wait 300s) for the tenant cache to roll over.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

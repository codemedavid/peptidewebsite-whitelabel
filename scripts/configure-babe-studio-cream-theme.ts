/**
 * Restyle The Babe Studio to match its new logo (cream badge, copper-bronze
 * lettering, deep-brown serif, gold ring — sampled from the client's JPG).
 *
 * The store was on the dark Velvet Noir theme with gold #c9a14a. The new logo
 * is a LIGHT cream disc, so on a near-black page it read as a sticker; the site
 * now sits on the logo's own cream and uses its browns as ink:
 *
 *   background #f5eadc   logo cream, a touch lighter so the badge still edges
 *   surface    #fffaf3   cards
 *   text       #3b2414   espresso body copy
 *   main       #5c3518   the logo's deep brown — wordmark, headings
 *   accent     #8f5a30   darker copper — eyebrows/chips stay legible on cream
 *   button     #9a6236   copper CTA  (button2 #b67c4c = the logo's copper)
 *   buttonText #fffaf3
 *
 * themeId moves velvet-noir → champagne-gold (the light luxury preset) and the
 * Branding.colors HSL roles are rewritten too: they override the shadcn tokens
 * (access-code wall, loaders), so leaving the dark triples would keep those
 * surfaces black.
 *
 * The merge goes through buildTenantBrandingUpdate — the MCP connector's
 * patch-only, contrast-checked path — so no other config key is touched.
 *
 * DRY RUN BY DEFAULT — prints the diff and writes nothing:
 *   npx tsx scripts/configure-babe-studio-cream-theme.ts
 *   npx tsx scripts/configure-babe-studio-cream-theme.ts --apply
 *
 * Previous values (for rollback): themeId velvet-noir; main/button/button2
 * #c9a14a, accent #d8b969, text #f3eadd, surface #1b1315, background #0c0809,
 * buttonText #1b1308.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { buildTenantBrandingUpdate } from "@/lib/tenant/branding-update";
import { hexToHslTriple } from "@/lib/theme/color";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

const TENANT_SLUG = "the-babe-studio";
const THEME_ID = "champagne-gold";

const PALETTE = {
  main: "#5c3518",
  accent: "#8f5a30",
  button: "#9a6236",
  button2: "#b67c4c",
  buttonText: "#fffaf3",
  background: "#f5eadc",
  surface: "#fffaf3",
  text: "#3b2414",
} as const;

/** Branding.colors roles the store already carries, rewritten as HSL triples. */
const HSL_ROLES = ["main", "text", "accent", "button", "surface", "background", "buttonText"] as const;

async function main() {
  const branding = await prisma.branding.findFirst({
    where: { tenant: { slug: TENANT_SLUG } },
    select: { id: true, themeId: true, colors: true, config: true },
  });
  if (!branding) throw new Error(`No branding row for tenant "${TENANT_SLUG}"`);

  const merged = buildTenantBrandingUpdate(
    { themeId: branding.themeId, config: branding.config },
    { themeId: THEME_ID, colors: PALETTE },
  );
  if (merged.errors.length) throw new Error(merged.errors.join("\n"));

  const current = (branding.config as Record<string, unknown>) ?? {};
  const colors = {
    ...((branding.colors as Record<string, string>) ?? {}),
    ...Object.fromEntries(HSL_ROLES.map((role) => [role, hexToHslTriple(PALETTE[role])])),
  };

  console.log(`Tenant  ${TENANT_SLUG}`);
  console.log(`  ${"themeId".padEnd(11)} ${branding.themeId}  →  ${merged.themeId ?? branding.themeId}`);
  for (const [key, value] of Object.entries(PALETTE)) {
    console.log(`  ${key.padEnd(11)} ${String(current[key] ?? "(unset)")}  →  ${value}`);
  }
  console.log(`Changed: ${merged.changed.join(", ")}`);
  console.log(merged.warnings.length ? `Warnings:\n  ${merged.warnings.join("\n  ")}` : "Contrast: all AA pairs pass");

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.");
    return;
  }

  await prisma.branding.update({
    where: { id: branding.id },
    data: {
      ...(merged.themeId ? { themeId: merged.themeId } : {}),
      colors: colors as Prisma.InputJsonValue,
      config: merged.config as Prisma.InputJsonValue,
    },
  });
  console.log(
    "\n✓ Theme updated. The storefront caches branding — restart the dev server, or press Save on any\n" +
      "  store-admin branding screen (or redeploy) for the live site to pick it up.",
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

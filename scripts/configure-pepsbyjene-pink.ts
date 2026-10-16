/**
 * Rebrand tenant `pepsys-compound` as "Pep's by Jene" on a PINK palette.
 *
 * Supersedes the teal brief in scripts/seed-pepsys-compound.ts — do NOT re-run
 * that script afterwards, it would put the old name and colours back.
 *
 * What changes (read-modify-write; every other key of the Brand config is kept):
 *   • Tenant.name, TenantSettings.storeName, branding.config.name → NEW_NAME
 *   • metaDescription: old name swapped for the new one
 *   • catalogTitle "Shop the compound" (the old name's pun) → "Shop the collection"
 *   • colour roles (config hex + Branding.colors HSL triples) → PINK below
 *   • Branding.themeId → "bubblegum-cute", the pink base preset under the roles
 *   • promise bar (Showcase layout) → hot-pink bar with white text
 *   • footer: the two support email links are removed (owner asked; FAQ stays)
 *
 * What does NOT change: the subdomain/slug (`pepsys-compound`) — renaming it
 * would break every existing link. Fonts (Poppins/Inter), the logo, copy,
 * products and contact details are untouched.
 *
 * Every text-on-fill pair is contrast-checked against WCAG AA (4.5:1) before
 * anything is written; the script refuses to run if one fails.
 *
 * SAFE BY DEFAULT — dry run unless `--apply` is passed:
 *   npx tsx scripts/configure-pepsbyjene-pink.ts
 *   npx tsx scripts/configure-pepsbyjene-pink.ts --apply
 */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { contrastRatio, hexToHslTriple } from "../src/lib/theme/color";

const APPLY = process.argv.slice(2).includes("--apply");
const TENANT_SLUG = "pepsys-compound";
const OLD_NAME = "Pep-sy's Compound";
const NEW_NAME = "Pep's by Jene";
const THEME_ID = "bubblegum-cute";
const OLD_CATALOG_TITLE = "Shop the compound";
const NEW_CATALOG_TITLE = "Shop the collection";
const WCAG_AA = 4.5;
/** Footer links the owner asked to drop. Matched on the exact href. */
const REMOVED_FOOTER_HREFS = new Set([
  "mailto:peptidewhisperer@gmail.com",
  "mailto:thepeptidepulse@gmail.com",
]);

const PINK = {
  ink: "#3D1F2E", // headings + body: deep berry, not black
  accent: "#C2266F", // pink that renders as TEXT (links, chips, hero line 2)
  button: "#D62D86", // CTA fill
  button2: "#B51F6E", // CTA gradient end — darker, so white text holds on both
  buttonText: "#FFFFFF",
  background: "#FFF5F9", // blush page
  surface: "#FFFFFF", // white cards
  border: "#F2BAD3", // soft pink hairline
  promiseBar: "#D62D86", // the strip above the header — same pink as the CTAs
  promiseBarText: "#FFFFFF",
} as const;

const CONFIG_COLORS = {
  main: PINK.ink,
  accent: PINK.accent,
  button: PINK.button,
  button2: PINK.button2,
  buttonText: PINK.buttonText,
  background: PINK.background,
  surface: PINK.surface,
  text: PINK.ink,
  headerBg: PINK.surface,
  headerText: PINK.ink,
  borderColor: PINK.border,
  heroHighlight: PINK.accent,
  promiseBarBg: PINK.promiseBar,
  promiseBarText: PINK.promiseBarText,
};

/** Same role set + HSL-triple shape the branding editor writes to Branding.colors. */
const ROLE_COLORS: Record<string, string> = {
  main: hexToHslTriple(PINK.ink),
  accent: hexToHslTriple(PINK.accent),
  button: hexToHslTriple(PINK.button),
  buttonText: hexToHslTriple(PINK.buttonText),
  background: hexToHslTriple(PINK.background),
  surface: hexToHslTriple(PINK.surface),
  text: hexToHslTriple(PINK.ink),
};

const CONTRAST_PAIRS: Array<[string, string, string]> = [
  ["body text on page", PINK.ink, PINK.background],
  ["body text on card", PINK.ink, PINK.surface],
  ["accent text on page", PINK.accent, PINK.background],
  ["accent text on card", PINK.accent, PINK.surface],
  ["button text on button", PINK.buttonText, PINK.button],
  ["button text on gradient end", PINK.buttonText, PINK.button2],
  ["promise bar text on promise bar", PINK.promiseBarText, PINK.promiseBar],
];

function checkContrast(): void {
  const failures: string[] = [];
  for (const [label, fg, bg] of CONTRAST_PAIRS) {
    const ratio = contrastRatio(hexToHslTriple(fg), hexToHslTriple(bg));
    const ok = ratio >= WCAG_AA;
    console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(34)} ${ratio.toFixed(2)}:1`);
    if (!ok) failures.push(label);
  }
  if (failures.length > 0) throw new Error(`Contrast below ${WCAG_AA}:1 — ${failures.join(", ")}`);
}

type FooterColumn = { title?: string; links?: Array<{ label?: string; href?: string }> };

/** The footer columns with the removed links filtered out (new objects; the
 *  input is not mutated). Non-array config is returned untouched. */
function withoutRemovedLinks(columns: unknown): unknown {
  if (!Array.isArray(columns)) return columns;
  return (columns as FooterColumn[]).map((col) => ({
    ...col,
    links: (col.links ?? []).filter((link) => !REMOVED_FOOTER_HREFS.has(link?.href ?? "")),
  }));
}

function footerLinkCount(columns: unknown): number {
  return Array.isArray(columns)
    ? (columns as FooterColumn[]).reduce((n, col) => n + (col.links?.length ?? 0), 0)
    : 0;
}

async function main() {
  console.log(`Contrast (WCAG AA ≥ ${WCAG_AA}:1)`);
  checkContrast();

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);
  const branding = await prisma.branding.findUnique({
    where: { tenantId: tenant.id },
    select: { config: true, themeId: true },
  });
  if (!branding) throw new Error(`Tenant "${TENANT_SLUG}" has no branding row`);
  const current = (branding.config ?? {}) as Record<string, unknown>;

  const meta = typeof current.metaDescription === "string" ? current.metaDescription : "";
  const catalogTitle = current.catalogTitle === OLD_CATALOG_TITLE ? NEW_CATALOG_TITLE : current.catalogTitle;
  const config: Record<string, unknown> = {
    ...current,
    ...CONFIG_COLORS,
    name: NEW_NAME,
    metaDescription: meta.split(OLD_NAME).join(NEW_NAME),
    catalogTitle,
    footerColumns: withoutRemovedLinks(current.footerColumns),
  };

  console.log(`\nTenant ${tenant.slug} (${tenant.id}) — ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`  name:         ${JSON.stringify(tenant.name)} → ${JSON.stringify(NEW_NAME)}`);
  console.log(`  themeId:      ${branding.themeId} → ${THEME_ID}`);
  console.log(`  catalogTitle: ${JSON.stringify(current.catalogTitle)} → ${JSON.stringify(catalogTitle)}`);
  console.log(
    `  footer links: ${footerLinkCount(current.footerColumns)} → ${footerLinkCount(config.footerColumns)}` +
      " (support emails removed)",
  );
  for (const [key, hex] of Object.entries(CONFIG_COLORS)) {
    console.log(`  ${key.padEnd(13)} ${String(current[key] ?? "—").padEnd(8)} → ${hex}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.");
    return;
  }

  await prisma.$transaction([
    prisma.tenant.update({ where: { id: tenant.id }, data: { name: NEW_NAME } }),
    prisma.tenantSettings.updateMany({ where: { tenantId: tenant.id }, data: { storeName: NEW_NAME } }),
    prisma.branding.update({
      where: { tenantId: tenant.id },
      data: {
        themeId: THEME_ID,
        colors: ROLE_COLORS,
        config: config as Prisma.InputJsonValue,
      },
    }),
  ]);

  console.log(`\n✓ ${NEW_NAME} is now pink.`);
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

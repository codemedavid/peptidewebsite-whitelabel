/**
 * SKN Aesthetic Supply Co. — deepen the reds to the logo's own maroon.
 *
 * The store was onboarded with a bright pillar-box red (main #ae1e27) while the
 * logo artwork is a much deeper maroon. Sampling the logo PNG
 * (…Elegant_Beauty_Store_Logo_8C47npkop.png) at 120×120 and bucketing the
 * saturated reds gives one overwhelming winner:
 *
 *   #64141e — 13,027 px   (the logo tile's own plate)
 *   #782832 —     45 px   (antialiasing on its edge)
 *
 * So #64141e is not a guess, it is the logo's colour. It also lands within a
 * hair of the reference design this storefront's layout came from, which used
 * #661520 for its brand red — the same colour arrived at independently.
 *
 * The change is confined to the four RED slots. Her cream, ink and surfaces are
 * already right and are deliberately left alone:
 *
 *   main    #ae1e27 → #64141e   the logo's maroon: rail, headings, borders
 *   accent  #9d1b23 → #8a1c28   lifted maroon: links, hover, focus rings
 *   button  #ae1e27 → #64141e   CTA fill
 *   button2 #ae1e27 → #8a1c28   CTA gradient stop (was flat — no gradient at all)
 *
 *   buttonText #fff8eb, background #f7efde, surface #fffdf5, text #2b1c12 — kept
 *
 * accent stays a step brighter than main ON PURPOSE. Flattening every red to one
 * value would erase the hierarchy between a heading and a link, and the layout
 * leans on that distinction (the category index hovers to --brand-accent).
 *
 * DRY RUN BY DEFAULT — prints the diff and writes nothing:
 *   npx tsx scripts/configure-skn-palette.ts
 *   npx tsx scripts/configure-skn-palette.ts --apply
 *   npx tsx scripts/configure-skn-palette.ts --revert   # back to the onboarded reds
 */
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");
const prisma = new PrismaClient();

const TENANT_SLUG = "skn-aesthetic-supply-co";

/** Sampled from the tenant's own logo artwork — see the header comment. */
const NEXT = {
  main: "#64141e",
  accent: "#8a1c28",
  button: "#64141e",
  button2: "#8a1c28",
} as const;

/** What onboarding originally wrote, so --revert is exact rather than a guess. */
const ONBOARDED = {
  main: "#ae1e27",
  accent: "#9d1b23",
  button: "#ae1e27",
  button2: "#ae1e27",
} as const;

// ── contrast, so "deeper" can't quietly become "unreadable" ──────────────────

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`no tenant with slug "${TENANT_SLUG}"`);
  const branding = await prisma.branding.findFirst({ where: { tenantId: tenant.id } });
  if (!branding) throw new Error(`tenant "${TENANT_SLUG}" has no branding row`);

  const config = (branding.config ?? {}) as Record<string, unknown>;
  const target = REVERT ? ONBOARDED : NEXT;

  console.log(`tenant: ${tenant.name} (${TENANT_SLUG})\n`);
  for (const [key, value] of Object.entries(target)) {
    const current = config[key];
    const mark = current === value ? "=" : "→";
    console.log(`  ${key.padEnd(8)} ${String(current)} ${mark} ${value}`);
  }

  const onBrand = String(config.buttonText ?? "#fff8eb");
  const page = String(config.background ?? "#f7efde");
  console.log("\ncontrast (WCAG AA needs 4.5 for text, 3.0 for large/UI):");
  console.log(`  ${onBrand} on ${target.main}  (rail text)     ${contrast(onBrand, target.main).toFixed(2)}`);
  console.log(`  ${target.main} on ${page}  (headings)      ${contrast(target.main, page).toFixed(2)}`);
  console.log(`  ${target.accent} on ${page}  (links)         ${contrast(target.accent, page).toFixed(2)}`);
  console.log(`  ${onBrand} on ${target.button}  (button label)  ${contrast(onBrand, target.button).toFixed(2)}`);

  const worst = Math.min(
    contrast(onBrand, target.main),
    contrast(target.main, page),
    contrast(target.accent, page),
    contrast(onBrand, target.button),
  );
  if (worst < 4.5) {
    console.log(`\nREFUSING: worst pair is ${worst.toFixed(2)}, below the 4.5 AA floor.`);
    process.exit(1);
  }

  if (!APPLY && !REVERT) {
    console.log("\ndry run — nothing written. Re-run with --apply.");
    return;
  }

  await prisma.branding.update({
    where: { id: branding.id },
    data: { config: { ...config, ...target } as never },
  });
  console.log(`\n✓ wrote ${Object.keys(target).join(", ")}`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

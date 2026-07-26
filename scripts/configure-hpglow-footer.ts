/**
 * HP Glow compact footer — reference gate + one-shot applier.
 *
 * The compact footer already ships as a reusable brand option
 * (`Brand.footerStyle: "compact"` — src/lib/storefront/footer-style.ts and the
 * `.site-footer--compact` block in storefront.css). What was missing is the
 * live tenant data: hpglow was still on the default "columns" footer.
 *
 * This script encodes the reference screenshot as assertions against the
 * STORED config, so the look is verifiable and not just eyeballed:
 *   • dark compact footer                → footerStyle normalizes to "compact"
 *   • "HP GLOW" + "Premium pep solutions" → footerShowBlurb + footerBlurb
 *   • Lab Reports · FAQ · Viber pills     → buildFooterQuickLinks output
 *   • "Made with ♥ © {year} HP GLOW…"     → footerCopyright template
 *
 * Modes:
 *   npx tsx scripts/configure-hpglow-footer.ts            # dry run: show diff
 *   npx tsx scripts/configure-hpglow-footer.ts --verify   # gate: exit 1 on mismatch
 *   npx tsx scripts/configure-hpglow-footer.ts --apply    # write, then verify
 */
import { PrismaClient } from "@prisma/client";
import type { Brand } from "../src/storefront/types";
import { normalizeFooterStyle, buildFooterQuickLinks } from "../src/lib/storefront/footer-style";

const SLUG = "hpglow";

/** The reference screenshot, as data. */
const REFERENCE = {
  tagline: "Premium pep solutions",
  viberNumber: "09772189091",
  pills: [
    { label: "Lab Reports", href: "#coa", variant: "outline" },
    { label: "FAQ", href: "#faq", variant: "outline" },
    { label: "Viber: 09772189091", href: "viber://chat?number=09772189091", variant: "accent" },
  ],
  copyright: "© {year} {brand}. All rights reserved.",
} as const;

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

type Config = Record<string, unknown>;

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`);
  }
}

/** Render the copyright the way Footer.tsx does, so the gate sees the real line. */
function renderCopyright(config: Config, brandName: string): string {
  return String(config.footerCopyright || REFERENCE.copyright)
    .replaceAll("{year}", String(new Date().getFullYear()))
    .replaceAll("{brand}", brandName);
}

/** Assert the STORED config renders the reference footer. */
function verify(config: Config, brandName: string) {
  console.log(`\nverify ${SLUG} against the reference footer:`);
  check("footerStyle renders compact", normalizeFooterStyle(config.footerStyle) === "compact", config.footerStyle);
  check("brand blurb is shown", config.footerShowBlurb !== false, config.footerShowBlurb);
  check(`tagline is "${REFERENCE.tagline}"`, config.footerBlurb === REFERENCE.tagline, config.footerBlurb);
  check("brand mark is shown", config.footerShowBrand !== false, config.footerShowBrand);
  check("logo is set", typeof config.logoUrl === "string" && config.logoUrl.length > 0, config.logoUrl);

  const links = buildFooterQuickLinks(config as unknown as Brand);
  check(
    `quick-links are ${REFERENCE.pills.map((p) => p.label).join(" · ")}`,
    links.length === REFERENCE.pills.length &&
      REFERENCE.pills.every(
        (want, i) =>
          links[i].label === want.label && links[i].href === want.href && links[i].variant === want.variant,
      ),
    links.map((l) => `${l.variant}:${l.label}`),
  );

  const copyright = renderCopyright(config, brandName);
  check(
    "copyright line reads '© {year} HP GLOW. All rights reserved.'",
    copyright === `© ${new Date().getFullYear()} ${brandName}. All rights reserved.`,
    copyright,
  );
  console.log(`  (footer renders: "Made with ♥ ${copyright}")`);
}

/** The config that produces the reference footer — everything else untouched. */
function referenceConfig(config: Config): Config {
  const channels = Array.isArray(config.contactChannels)
    ? (config.contactChannels as Array<Record<string, unknown>>)
    : [];
  const hasViber = channels.some((c) => c.type === "viber");
  const nextChannels = hasViber
    ? channels.map((c) =>
        c.type === "viber" ? { ...c, enabled: true, destination: REFERENCE.viberNumber } : c,
      )
    : [...channels, { type: "viber", enabled: true, destination: REFERENCE.viberNumber }];

  return {
    ...config,
    footerStyle: "compact",
    footerBlurb: REFERENCE.tagline,
    footerShowBlurb: true,
    footerShowBrand: true,
    contactChannels: nextChannels,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const verifyOnly = process.argv.includes("--verify");

  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!tenant) {
    const slugs = await prisma.tenant.findMany({ select: { slug: true } });
    throw new Error(`tenant "${SLUG}" not found — have: ${slugs.map((t) => t.slug).join(", ")}`);
  }

  const branding = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  if (!branding) throw new Error(`no branding row for ${SLUG}`);

  const config = (branding.config ?? {}) as Config;
  const brandName = typeof config.name === "string" && config.name ? config.name : tenant.name;

  if (verifyOnly) {
    verify(config, brandName);
    if (failures > 0) {
      console.error(`\n${failures} check(s) failed — hpglow is NOT on the reference footer`);
      process.exit(1);
    }
    console.log("\nhpglow matches the reference footer");
    return;
  }

  console.log(`BEFORE ${SLUG} (${tenant.name}):`);
  console.log(`  footerStyle     = ${JSON.stringify(config.footerStyle)}`);
  console.log(`  footerBlurb     = ${JSON.stringify(config.footerBlurb)}`);
  console.log(`  footerShowBlurb = ${JSON.stringify(config.footerShowBlurb)}`);
  console.log(`  contactChannels = ${JSON.stringify(config.contactChannels)}`);

  const next = referenceConfig(config);

  if (!apply) {
    console.log("\nWOULD WRITE:");
    console.log(`  footerStyle  = ${JSON.stringify(next.footerStyle)}`);
    console.log(`  footerBlurb  = ${JSON.stringify(next.footerBlurb)}`);
    console.log(`  viber        = ${JSON.stringify((next.contactChannels as unknown[]).find((c) => (c as Config).type === "viber"))}`);
    verify(next, brandName);
    console.log("\ndry run — nothing written. Re-run with --apply.");
    if (failures > 0) process.exit(1);
    return;
  }

  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config: JSON.parse(JSON.stringify(next)) },
  });

  const after = ((await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } }))
    ?.config ?? {}) as Config;
  console.log(`\nAFTER  ${SLUG}: footerStyle=${JSON.stringify(after.footerStyle)} footerBlurb=${JSON.stringify(after.footerBlurb)}`);
  verify(after, brandName);
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed after write`);
    process.exit(1);
  }
  console.log("\ndone — hpglow is on the reference footer");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

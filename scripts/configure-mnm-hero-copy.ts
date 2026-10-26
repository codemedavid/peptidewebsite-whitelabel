/**
 * ONE-SHOT tenant config for `mnm-pepsabuy` (2026-10-25). Owner-requested hero
 * copy change: the headline "Premium peptides, / premium results." becomes the
 * group-buy line that used to sit underneath it as the sub. The sub is hidden
 * (heroShowSub:false, text kept) so the same sentence doesn't print twice —
 * the owner can switch it back on from the store admin.
 *
 * Hierarchy: two full sentences at display size read as a shouted paragraph,
 * so line 1 drops to the "md" title size and line 2 becomes a smaller italic
 * tagline (heroFieldStyles.line2.size). Both are store-admin Hero settings.
 *
 * Idempotent.
 *
 *   npx tsx scripts/configure-mnm-hero-copy.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { BRAND } from "../src/storefront/data";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const SLUG = "mnm-pepsabuy";

type FooterColumn = { title: string; links: { label: string; href: string }[] };

/** Owner turned the blog off (site.blog revoked). The stock footer's "Blog"
 *  link points at "#", and dead links outside the Legal column still render,
 *  so it has to come out of the column itself. An unsaved footer falls back to
 *  the stock BRAND columns, so those get persisted minus Blog. */
function withoutBlogLink(columns: unknown): FooterColumn[] {
  const base = Array.isArray(columns) ? (columns as FooterColumn[]) : (BRAND.footerColumns as FooterColumn[]);
  return base.map((col) => ({
    ...col,
    links: (col.links ?? []).filter((l) => l.label.trim().toLowerCase() !== "blog"),
  }));
}
/** Tagline size — rendered as clamp(18px, 3vw, 30px). */
const LINE2_SIZE_PX = 30;

function heroSummary(c: Record<string, unknown>): string {
  return `heroLine1=${JSON.stringify(c.heroLine1)} heroLine2=${JSON.stringify(c.heroLine2)} heroSub=${JSON.stringify(c.heroSub)} heroShowSub=${c.heroShowSub} heroShowCta2=${c.heroShowCta2} heroTitleSize=${c.heroTitleSize} heroFieldStyles=${JSON.stringify(c.heroFieldStyles)}\n  footer: ${JSON.stringify((c.footerColumns as FooterColumn[] | undefined)?.map((col) => `${col.title}: ${col.links.map((l) => l.label).join(", ")}`))}`;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`tenant "${SLUG}" not found`);

  const branding = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  const config = (branding?.config ?? {}) as Record<string, unknown>;
  console.log(`BEFORE ${SLUG}: ${heroSummary(config)}`);

  const next: Record<string, unknown> = {
    ...config,
    heroLine1: "Join our group buys or shop on-hand.",
    heroLine2: "Every order is handled by the MNM team.",
    heroShowSub: false,
    heroShowCta2: false, // owner: no "Learn More" button
    footerColumns: withoutBlogLink(config.footerColumns),
    heroTitleSize: "md",
    heroFieldStyles: {
      ...((config.heroFieldStyles ?? {}) as Record<string, unknown>),
      line2: { ...(((config.heroFieldStyles ?? {}) as Record<string, Record<string, unknown>>).line2 ?? {}), size: LINE2_SIZE_PX },
    },
  };

  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config: next as Prisma.InputJsonValue },
  });

  const after = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  console.log(`AFTER  ${SLUG}: ${heroSummary((after?.config ?? {}) as Record<string, unknown>)}`);
  console.log("done — the storefront caches branding: press Save on any store-admin branding screen (or redeploy) to see it live.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

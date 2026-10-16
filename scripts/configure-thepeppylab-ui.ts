/**
 * UI pass for `thepeppylab` — same branding (rose / peach / blush, Tinos),
 * calmer and more premium presentation. Patches ONLY this tenant:
 *
 *   branding.config
 *     • hero: no duplicate logo, "minimal" variant (drops the decorative oval)
 *     • Card Studio design: portrait photos (the shots are 3:4), finer border,
 *       solid rounded buttons, soft badges
 *     • defaultProductImage = the brand logo tile (20 products have no photo)
 *     • variationPreselect: cards open on "Vial Only" with its price shown
 *     • trust strip with the old site's own promises + "Real-World Tested" quote
 *     • catalog heading copy, 1px brand hairline
 *   products
 *     • purity / storage removed from Add-ons + Fat Melters (syringes, alcohol
 *       pads and lemon bottles are not "99% purity", nor stored at -20°C)
 *     • the 4 best sellers (by units in the imported order history) featured
 *
 * Partial patch: every other config key is preserved. Dry run unless --apply.
 *
 *   npx tsx --env-file=.env scripts/configure-thepeppylab-ui.ts [--apply]
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { DEFAULT_CARD_DESIGN, type CardDesign } from "../src/storefront/cardDesign";

const APPLY = process.argv.includes("--apply");
const SLUG = "thepeppylab";
const FEATURED_COUNT = 4;
/** Categories whose items are supplies/branded products, not raw peptides. */
const NON_PEPTIDE_CATEGORIES = new Set(["add-ons", "fat-melters"]);

const CARD_DESIGN: CardDesign = {
  ...DEFAULT_CARD_DESIGN,
  preset: "custom",
  radius: 14,
  borderWidth: 1,
  shadow: "sm",
  hover: "lift",
  titleFont: "display",
  titleWeight: 600,
  titleSize: "md",
  buttonStyle: "solid",
  buttonShape: "rounded",
  badgeStyle: "soft",
  imageRatio: "portrait",
  spacing: "cozy",
};

const PROMISES = [
  { id: "lab-verified", label: "Lab Verified", note: "Purity guaranteed" },
  { id: "premium-quality", label: "Premium Quality", note: "Sourced for excellence" },
  { id: "real-world-tested", label: "Real-World Tested", note: "Verified by our team" },
];

const QUOTE =
  "Every peptide and supply item is used and verified by our team and community before being offered in our shop. Quality you can feel — results you can trust.";

async function main() {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: SLUG } });
  const branding = await prisma.branding.findUniqueOrThrow({ where: { tenantId: tenant.id } });
  const config = (branding.config ?? {}) as Record<string, unknown>;
  if (!branding.logoUrl) throw new Error("No logo on the Branding row — upload it first.");

  const patch: Record<string, unknown> = {
    heroVariant: "minimal",
    heroShowLogo: false,
    cardDesign: CARD_DESIGN,
    // The branded 3:4 placeholder once uploaded; the logo tile only as a first-run fallback.
    defaultProductImage: (config.defaultProductImage as string) || branding.logoUrl,
    variationPreselect: true,
    showTrustStrip: true,
    trustStripTitle: "Why The Peppy Lab",
    trustStripQuote: QUOTE,
    boutique: { ...((config.boutique as object) ?? {}), assurances: PROMISES },
    catalogEyebrow: "Shop",
    catalogTitle: "Peptides & Essentials",
    borderWidth: 1,
  };

  // Best sellers from the real (imported) order history.
  const orders = await prisma.storefrontOrder.findMany({
    where: { tenantId: tenant.id, status: { not: "cancelled" }, deletedAt: null },
    select: { items: true },
  });
  const units = new Map<string, number>();
  for (const o of orders) {
    for (const line of (o.items as { productId?: string; qty?: number }[]) ?? []) {
      if (line.productId) units.set(line.productId, (units.get(line.productId) ?? 0) + (Number(line.qty) || 0));
    }
  }
  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true, metadata: true },
  });
  const ranked = products
    .filter((p) => !NON_PEPTIDE_CATEGORIES.has(String((p.metadata as Record<string, unknown>)?.category ?? "")))
    .sort((a, b) => (units.get(b.id) ?? 0) - (units.get(a.id) ?? 0));
  const featured = new Set(ranked.slice(0, FEATURED_COUNT).map((p) => p.id));

  const productWrites = products.map((p) => {
    const meta = { ...((p.metadata as Record<string, unknown>) ?? {}) };
    const nonPeptide = NON_PEPTIDE_CATEGORIES.has(String(meta.category ?? ""));
    if (nonPeptide) {
      delete meta.purity;
      delete meta.storage;
    }
    meta.featured = featured.has(p.id);
    return { id: p.id, name: p.name, nonPeptide, featured: featured.has(p.id), meta };
  });

  console.log(`\n▶ ${SLUG} UI pass — ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`  config keys  ${Object.keys(patch).join(", ")}`);
  console.log(`  featured     ${ranked.slice(0, FEATURED_COUNT).map((p) => `${p.name} (${units.get(p.id) ?? 0})`).join(" · ")}`);
  console.log(`  purity/storage cleared on ${productWrites.filter((w) => w.nonPeptide).length} add-on / fat-melter products`);

  if (!APPLY) {
    console.log("\n  DRY RUN — nothing written. Re-run with --apply.\n");
    return;
  }

  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config: { ...config, ...patch } as Prisma.InputJsonValue },
  });
  for (const w of productWrites) {
    await prisma.product.update({ where: { id: w.id }, data: { metadata: w.meta as Prisma.InputJsonValue } });
  }
  console.log("\n  ✓ applied (restart or save once in the admin to bust the storefront cache)\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

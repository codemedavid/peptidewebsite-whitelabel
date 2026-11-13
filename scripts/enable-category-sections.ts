/**
 * Grant (or revoke) FEATURES.STORE_CATEGORY_SECTIONS for ONE tenant, by exact
 * slug. Goes through applyFeatureWrites — the same path as Super Admin →
 * Features — so the Feature row self-registers (no plan links: the feature sits
 * outside every plan ceiling, so every other tenant stays OFF).
 *
 *   npx tsx scripts/enable-category-sections.ts <slug>          # grant
 *   npx tsx scripts/enable-category-sections.ts <slug> --off    # revoke
 *
 * Refuses unless exactly one tenant has that slug. Saved arrangements
 * (branding.config.categoryProductOrder) are never touched. Entitlements are
 * cached up to 1h; toggling from Super Admin → Features busts that instantly.
 */
import { prisma } from "../src/lib/db/prisma";
import { FEATURES } from "../src/lib/features/catalog";
import { applyFeatureWrites } from "../src/lib/tenant/feature-write";

const KEY = FEATURES.STORE_CATEGORY_SECTIONS;

async function main() {
  const slug = process.argv[2]?.trim();
  const off = process.argv.includes("--off");
  if (!slug) throw new Error("Usage: enable-category-sections.ts <slug> [--off]");

  const matches = await prisma.tenant.findMany({ where: { slug }, select: { id: true, slug: true, name: true } });
  if (matches.length !== 1) throw new Error(`Expected exactly one tenant with slug "${slug}", found ${matches.length}. Nothing changed.`);
  const tenant = matches[0];

  // Grant = an override row (the plan default is OFF); revoke = back to default.
  await applyFeatureWrites(tenant.id, [{ key: KEY, enabled: !off, matchesPlanDefault: off }]);

  const rows = await prisma.tenantFeatureOverride.findMany({
    where: { feature: { key: KEY } },
    select: { enabled: true, tenant: { select: { slug: true } } },
  });
  const linkedPlans = await prisma.planFeature.count({ where: { feature: { key: KEY } } });
  console.log(`${off ? "Revoked" : "Granted"} ${KEY} for ${tenant.slug} (${tenant.name}, ${tenant.id}).`);
  console.log(`Overrides for ${KEY}: ${JSON.stringify(rows.map((r) => [r.tenant.slug, r.enabled]))}; plan links: ${linkedPlans}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });

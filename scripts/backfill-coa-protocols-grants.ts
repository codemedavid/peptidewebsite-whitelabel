/**
 * Backfill the storefront.coa + storefront.protocols grants for EXISTING tenants.
 *
 * Why: both features are new and operator-grantable / default-OFF (they sit in no
 * plan ceiling). Before they existed, the COA (Lab Results) and Protocols
 * managers were gated ONLY by the store owner's branding toggle, so every tenant
 * on every plan had them. Deploying the entitlement without this backfill would
 * silently strip both managers — and both storefront pages — from every live
 * store. This grants the two features to every tenant that exists TODAY, so
 * nothing disappears; tenants created afterwards start OFF, per the intended
 * default, until the operator grants them from admin → Features.
 *
 * The owner's branding toggle is NOT touched: a store that had already hidden its
 * COA page keeps it hidden (resolveEntitledPage ANDs the two). This backfill only
 * restores the entitlement layer that never existed before.
 *
 * Order matters — the Feature rows must exist first:
 *   npm run db:sync-features       # upserts storefront.coa / storefront.protocols
 *   npx tsx scripts/backfill-coa-protocols-grants.ts          # dry run (default)
 *   npx tsx scripts/backfill-coa-protocols-grants.ts --apply  # write the grants
 *
 * Idempotent, and never clobbers an explicit operator decision: a tenant that
 * already has an override row for either key is left exactly as-is (reported as
 * "skipped"), whether that override is on or off.
 */
import { PrismaClient } from "@prisma/client";

import { FEATURES } from "../src/lib/features/catalog";
import { planCoaProtocolsBackfill } from "./lib/coa-protocols-backfill-plan";

const prisma = new PrismaClient();

const KEYS: string[] = [FEATURES.STORE_COA, FEATURES.STORE_PROTOCOLS];
const APPLY = process.argv.includes("--apply");

/**
 * Tenants the backfill must NOT grant. They get the intended default (OFF), and
 * an explicit `enabled: false` override so the decision is RECORDED rather than
 * merely absent — a later re-run then reports them as "already set" and leaves
 * them alone, per this script's never-clobber-an-operator-decision contract.
 *
 * dragon-peptides is the reason this entitlement exists at all: its store admin
 * was showing the Lab Results (COA) and Protocols managers even though the
 * operator had never switched them on, because before these keys the only gate
 * was the store owner's branding toggle. Granting it here would re-create
 * precisely that bug. Operator decision, 2026-07-17.
 */
const EXCLUDED_SLUGS = new Set<string>(["dragon-peptides"]);

async function main() {
  const features = await prisma.feature.findMany({
    where: { key: { in: KEYS } },
    select: { id: true, key: true },
  });

  const missing = KEYS.filter((k) => !features.some((f) => f.key === k));
  if (missing.length > 0) {
    throw new Error(
      `Feature rows missing: ${missing.join(", ")}. Run "npm run db:sync-features" first — ` +
        `a grant can't reference a feature that isn't in the catalog table yet.`,
    );
  }

  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  const existing = await prisma.tenantFeatureOverride.findMany({
    where: { featureId: { in: features.map((f) => f.id) } },
    select: { tenantId: true, featureId: true, enabled: true },
  });

  // The grant/revoke/skip decision is the pure, unit-tested core
  // (scripts/lib/coa-protocols-backfill-plan.ts, npm run test:coa-protocols-backfill).
  const { planned, grants, revokes, skipped, unknownExclusions } = planCoaProtocolsBackfill(
    tenants,
    features,
    existing,
    EXCLUDED_SLUGS,
  );

  console.log(`\n${tenants.length} tenant(s) × ${features.length} feature(s)`);
  console.log(`  grant:  ${grants.length}`);
  console.log(`  OFF:    ${revokes.length}   (excluded: ${[...EXCLUDED_SLUGS].join(", ") || "none"})`);
  console.log(`  skip:   ${skipped.length}`);
  for (const s of skipped) console.log(`    - ${s}`);

  if (unknownExclusions.length > 0) {
    // Fail loudly: a typo'd slug would silently grant the tenant it meant to skip.
    throw new Error(
      `EXCLUDED_SLUGS names tenant(s) that do not exist: ${unknownExclusions.join(", ")}. ` +
        `Fix the slug — a typo here silently grants the tenant it was meant to exclude.`,
    );
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to write:`);
    for (const p of grants) console.log(`    + ${p.label}  (enabled=true)`);
    for (const p of revokes) console.log(`    - ${p.label}  (enabled=false — excluded)`);
    console.log();
    return;
  }

  await prisma.$transaction(
    planned.map((p) =>
      prisma.tenantFeatureOverride.upsert({
        where: { tenantId_featureId: { tenantId: p.tenantId, featureId: p.featureId } },
        update: { enabled: p.enabled, expiresAt: null },
        create: { tenantId: p.tenantId, featureId: p.featureId, enabled: p.enabled },
      }),
    ),
  );

  console.log(`\n✅ Wrote ${planned.length} override(s): ${grants.length} on, ${revokes.length} off.`);
  for (const p of grants) console.log(`    + ${p.label}  (enabled=true)`);
  for (const p of revokes) console.log(`    - ${p.label}  (enabled=false — excluded)`);
  console.log();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Apply or remove a TENANT PRESET (src/lib/tenant/presets.ts) on a live tenant
 * from the CLI — the operator surface for when the platform admin UI is not to
 * hand, and the only one that can show the diff before a write.
 *
 *   npx tsx scripts/apply-tenant-preset.ts <slug> [presetId]            # dry run
 *   npx tsx scripts/apply-tenant-preset.ts <slug> [presetId] --apply
 *   npx tsx scripts/apply-tenant-preset.ts <slug> [presetId] --remove   # dry run
 *   npx tsx scripts/apply-tenant-preset.ts <slug> [presetId] --remove --apply
 *
 * DRY RUN BY DEFAULT — nothing is written without --apply, matching
 * seed-dragon-products.ts and backfill-coa-protocols-grants.ts. Both directions
 * are idempotent, so re-running is safe.
 *
 * The decision of WHAT changes lives entirely in the pure applier/remover
 * (npm run test:tenant-presets, 64 assertions). This script is the persistence
 * shell, and deliberately mirrors src/actions/tenant-presets.ts — which cannot be
 * imported here because it is "use server" and pulls in next/cache.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import {
  applyTenantPreset,
  removeTenantPreset,
  getTenantPreset,
  TENANT_PRESET_LIST,
  KGLOW_TWO_WAYS_ID,
  type PresetChange,
} from "../src/lib/tenant/presets";

const prisma = new PrismaClient();

/** Compact rendering of a config value — objects report key count, not "{…}". */
function short(v: unknown): string {
  if (v === undefined) return "not set";
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === "object") return `{${Object.keys(v as object).length} keys}`;
  return JSON.stringify(v);
}

function printChanges(changes: readonly PresetChange[]): void {
  for (const c of changes) {
    if (c.kind === "config")
      console.log(
        `  config    ${c.key}: ${short(c.from)} → ${c.to === undefined ? "cleared" : short(c.to)}`,
      );
    else if (c.kind === "feature") console.log(`  grant     ${c.key}`);
    else console.log(`  REVOKE    ${c.key}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positional = args.filter((a) => !a.startsWith("--"));

  const slug = positional[0];
  const presetId = positional[1] ?? KGLOW_TWO_WAYS_ID;
  const write = flags.has("--apply");
  const removing = flags.has("--remove");

  if (!slug) {
    console.error(
      "usage: npx tsx scripts/apply-tenant-preset.ts <slug> [presetId] [--remove] [--apply]",
    );
    console.error(`presets: ${TENANT_PRESET_LIST.map((p) => p.id).join(", ")}`);
    process.exit(1);
  }

  const preset = getTenantPreset(presetId);
  if (!preset) {
    throw new Error(
      `Unknown preset "${presetId}". Known: ${TENANT_PRESET_LIST.map((p) => p.id).join(", ")}`,
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      branding: { select: { config: true } },
      plan: { select: { name: true, features: { select: { feature: { select: { key: true } } } } } },
      featureOverrides: {
        select: { enabled: true, expiresAt: true, feature: { select: { key: true } } },
      },
    },
  });
  if (!tenant) throw new Error(`No tenant with slug "${slug}"`);

  // Same resolution as lib/features/entitlements.ts: plan ∪ enabled overrides,
  // minus disabled ones, ignoring anything already expired.
  const now = Date.now();
  const enabled = new Set(tenant.plan.features.map((pf) => pf.feature.key));
  const planFeatures = new Set(enabled);
  for (const o of tenant.featureOverrides) {
    if (o.expiresAt && o.expiresAt.getTime() < now) continue;
    if (o.enabled) enabled.add(o.feature.key);
    else enabled.delete(o.feature.key);
  }

  const current = {
    config: tenant.branding?.config,
    enabledFeatures: [...enabled],
  };

  console.log(`\nTenant   ${tenant.name} (${tenant.slug})  plan: ${tenant.plan.name}`);
  console.log(`Preset   ${preset.name} [${preset.id}]`);
  console.log(`Action   ${removing ? "REMOVE" : "APPLY"}${write ? "  (WRITING)" : "  (dry run)"}\n`);

  if (removing) {
    const removal = removeTenantPreset(current, preset);
    if (removal.changes.length === 0) {
      console.log("Nothing to change — this preset is not applied.\n");
      return;
    }
    console.log(`${removal.changes.length} change(s):`);
    printChanges(removal.changes);

    const fromPlan = removal.featuresToRevoke.filter((k) => planFeatures.has(k));
    if (fromPlan.length > 0) {
      console.log(
        `\n⚠  Included in the tenant's plan: ${fromPlan.join(", ")}\n` +
          `   Revoking writes a block that outlasts the preset — the store loses a\n` +
          `   feature it pays for until an operator re-enables it under Features.`,
      );
    }

    if (!write) {
      console.log("\nDry run — nothing written. Re-run with --apply to persist.\n");
      return;
    }

    const rows = await prisma.feature.findMany({
      where: { key: { in: [...removal.featuresToRevoke] } },
      select: { id: true, key: true },
    });

    await prisma.$transaction([
      ...(removal.changes.some((c) => c.kind === "config")
        ? [
            prisma.branding.update({
              where: { tenantId: tenant.id },
              data: { config: removal.config as Prisma.InputJsonValue },
            }),
          ]
        : []),
      ...rows.map((f) =>
        prisma.tenantFeatureOverride.upsert({
          where: { tenantId_featureId: { tenantId: tenant.id, featureId: f.id } },
          update: { enabled: false, expiresAt: null },
          create: { tenantId: tenant.id, featureId: f.id, enabled: false },
        }),
      ),
    ]);

    console.log(
      `\n✓ Removed. ${removal.changes.length} change(s), ${rows.length} entitlement(s) revoked.\n`,
    );
    return;
  }

  const application = applyTenantPreset(current, preset);
  if (application.changes.length === 0) {
    console.log("Nothing to change — this tenant already matches the preset.\n");
    return;
  }
  console.log(`${application.changes.length} change(s):`);
  printChanges(application.changes);

  const rows = await prisma.feature.findMany({
    where: { key: { in: [...application.featuresToGrant] } },
    select: { id: true, key: true },
  });
  const found = new Set(rows.map((r) => r.key));
  const missing = application.featuresToGrant.filter((k) => !found.has(k));
  if (missing.length > 0) {
    console.log(
      `\n⚠  Not seeded in the feature catalog, grants will be SKIPPED: ${missing.join(", ")}\n` +
        `   Run npm run db:sync-features first.`,
    );
  }

  if (!write) {
    console.log("\nDry run — nothing written. Re-run with --apply to persist.\n");
    return;
  }

  await prisma.$transaction([
    // No themeId: a preset never changes how a store looks.
    prisma.branding.upsert({
      where: { tenantId: tenant.id },
      update: { config: application.config as Prisma.InputJsonValue },
      create: { tenantId: tenant.id, config: application.config as Prisma.InputJsonValue },
    }),
    ...rows.map((f) =>
      prisma.tenantFeatureOverride.upsert({
        where: { tenantId_featureId: { tenantId: tenant.id, featureId: f.id } },
        update: { enabled: true, expiresAt: null },
        create: { tenantId: tenant.id, featureId: f.id, enabled: true },
      }),
    ),
  ]);

  console.log(`\n✓ Applied. ${application.changes.length} change(s), ${rows.length} grant(s).\n`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

"use server";

// Apply a TENANT PRESET (lib/tenant/presets.ts) to a tenant — the operator-facing
// half of "duplicate the K Glow store". The pure applier decides WHAT changes;
// this file is the thin persistence + authorization shell around it.
//
// Two entry points, both platform-operator only:
//   • previewTenantPresetAction — read-only diff for the confirm dialog.
//   • applyTenantPresetAction   — writes Branding (themeId + config) and upserts
//                                 the preset's feature overrides in one txn.
//
// Additive by construction: the applier never emits a revoke, and this file only
// ever upserts `enabled: true` rows. Nothing a tenant already had is removed.

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getPlatformUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/fixtures";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { getEntitlements } from "@/lib/features/entitlements";
import { applyTenantPreset, getTenantPreset, type PresetChange } from "@/lib/tenant/presets";

const schema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,}$/, "Invalid tenant slug."),
  presetId: z.string().min(1, "Pick a preset."),
});

type Input = z.infer<typeof schema>;

export type PresetPreview = {
  presetName: string;
  changes: PresetChange[];
  /** Preset features that exist in the catalog and can actually be granted. */
  grantable: string[];
  /** Preset features with no seeded Feature row — grants would be skipped.
   *  Surfaced so the operator runs `npm run db:sync-features` instead of
   *  wondering why the storefront did not change. */
  missingFeatures: string[];
};

/**
 * Resolve the tenant + preset and compute the diff, or an error string.
 * Shared by preview and apply so both agree on exactly what will happen.
 */
async function plan(input: Input) {
  const fail = (error: string) => ({ ok: false as const, error });

  // Demo mode is file-backed: there is no Branding row or Feature table to write,
  // so bail with a message instead of a confusing "Tenant not found". Matches the
  // guard every sibling action on this page uses (actions/admin.ts, tenant-admin).
  if (isDemoMode()) return fail("Store presets need a database — not available in demo mode.");

  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  const { slug, presetId } = parsed.data;

  const preset = getTenantPreset(presetId);
  if (!preset) return fail(`Unknown preset: ${presetId}`);

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, branding: { select: { themeId: true, config: true } } },
  });
  if (!tenant) return fail(`Tenant not found: ${slug}`);

  const entitlements = await getEntitlements(tenant.id);

  const application = applyTenantPreset(
    {
      themeId: tenant.branding?.themeId,
      config: tenant.branding?.config,
      enabledFeatures: [...entitlements],
    },
    preset,
  );

  // A grant needs a seeded Feature row (tenant_feature_overrides.featureId is an
  // FK). Split rather than crash so a partially-synced catalog degrades loudly.
  const rows = await prisma.feature.findMany({
    where: { key: { in: [...application.featuresToGrant] } },
    select: { id: true, key: true },
  });
  const foundKeys = new Set(rows.map((r) => r.key));

  return {
    ok: true as const,
    tenantId: tenant.id,
    slug,
    preset,
    application,
    featureRows: rows,
    missingFeatures: application.featuresToGrant.filter((k) => !foundKeys.has(k)),
  };
}

/** Read-only: what applying this preset would change. Nothing is written. */
export async function previewTenantPresetAction(
  input: Input,
): Promise<{ ok: true; preview: PresetPreview } | { error: string }> {
  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const p = await plan(input);
  if (!p.ok) return { error: p.error };

  return {
    ok: true,
    preview: {
      presetName: p.preset.name,
      changes: p.application.changes,
      grantable: p.featureRows.map((r) => r.key),
      missingFeatures: p.missingFeatures,
    },
  };
}

/**
 * Persist the preset: Branding.themeId + Branding.config, plus one enabled
 * override per grantable feature. Safe to run twice — the applier is idempotent
 * and the override writes are upserts.
 */
export async function applyTenantPresetAction(
  input: Input,
): Promise<{ ok: true; changed: number; missingFeatures: string[] } | { error: string }> {
  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const p = await plan(input);
  if (!p.ok) return { error: p.error };

  const { tenantId, slug, application, featureRows, missingFeatures } = p;

  await prisma.$transaction([
    prisma.branding.upsert({
      where: { tenantId },
      update: {
        themeId: application.themeId,
        config: application.config as Prisma.InputJsonValue,
      },
      create: {
        tenantId,
        themeId: application.themeId,
        config: application.config as Prisma.InputJsonValue,
      },
    }),
    ...featureRows.map((f) =>
      prisma.tenantFeatureOverride.upsert({
        where: { tenantId_featureId: { tenantId, featureId: f.id } },
        update: { enabled: true, expiresAt: null },
        create: { tenantId, featureId: f.id, enabled: true },
      }),
    ),
  ]);

  revalidatePath("/admin");
  revalidatePath(`/admin/tenants/${slug}`);
  revalidatePath(`/admin/tenants/${slug}/features`);
  revalidatePath(`/admin/tenants/${slug}/branding`);
  revalidateTenant(tenantId, slug); // storefront re-reads branding + entitlements

  return { ok: true, changed: application.changes.length, missingFeatures };
}

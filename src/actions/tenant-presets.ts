"use server";

// Apply or REMOVE a TENANT PRESET (lib/tenant/presets.ts) — the operator-facing
// half of "duplicate the K Glow store". The pure applier decides WHAT changes;
// this file is the thin persistence + authorization shell around it.
//
// Four entry points, all platform-operator only:
//   • previewTenantPresetAction       — read-only diff for the confirm dialog.
//   • applyTenantPresetAction         — writes Branding (themeId + config) and
//                                       upserts the preset's overrides in one txn.
//   • previewRemoveTenantPresetAction — read-only diff for switching the shape off.
//   • removeTenantPresetAction        — writes the reverted config and upserts
//                                       `enabled: false` overrides in one txn.
//
// Applying is additive by construction: the applier never emits a revoke, and
// the apply path only upserts `enabled: true`. Removing is the deliberate
// exception and the ONLY destructive path here — which is why it is previewed
// separately, revokes only the preset's own features, and never touches the
// theme or the owner-editable blocks (see removeTenantPreset's contract).

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getPlatformUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/fixtures";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { getEntitlements } from "@/lib/features/entitlements";
import {
  applyTenantPreset,
  removeTenantPreset,
  getTenantPreset,
  type PresetChange,
} from "@/lib/tenant/presets";

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

const fail = (error: string) => ({ ok: false as const, error });

/**
 * Validate the input and load everything both planners need: the tenant, its
 * branding, the preset, and the tenant's current entitlements. Shared so apply
 * and remove can never disagree about what state they are acting on.
 */
async function resolve(input: Input) {
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
    select: {
      id: true,
      branding: { select: { config: true } },
      // Plan features are read separately from the resolved entitlement set so a
      // revoke can warn when it is about to deny something the PLAN grants.
      plan: { select: { features: { select: { feature: { select: { key: true } } } } } },
    },
  });
  if (!tenant) return fail(`Tenant not found: ${slug}`);

  return {
    ok: true as const,
    tenantId: tenant.id,
    slug,
    preset,
    current: {
      config: tenant.branding?.config,
      enabledFeatures: [...(await getEntitlements(tenant.id))],
    },
    planFeatures: new Set(tenant.plan.features.map((pf) => pf.feature.key)),
  };
}

/** Look up the Feature rows for a set of keys. Writing an override needs one
 *  (tenant_feature_overrides.featureId is an FK), so callers split found from
 *  missing and degrade loudly rather than crashing on a half-synced catalog. */
async function featureRowsFor(keys: readonly string[]) {
  const rows = await prisma.feature.findMany({
    where: { key: { in: [...keys] } },
    select: { id: true, key: true },
  });
  const found = new Set(rows.map((r) => r.key));
  return { rows, missing: keys.filter((k) => !found.has(k)) };
}

/** Resolve + compute what applying would change. */
async function planApply(input: Input) {
  const r = await resolve(input);
  if (!r.ok) return r;

  const application = applyTenantPreset(r.current, r.preset);
  const { rows, missing } = await featureRowsFor(application.featuresToGrant);

  return { ...r, application, featureRows: rows, missingFeatures: missing };
}

/** Resolve + compute what removing would change. */
async function planRemove(input: Input) {
  const r = await resolve(input);
  if (!r.ok) return r;

  const removal = removeTenantPreset(r.current, r.preset);
  const { rows } = await featureRowsFor(removal.featuresToRevoke);

  return {
    ...r,
    removal,
    featureRows: rows,
    // Features the PLAN grants: revoking these writes a deny override that
    // outlives the preset, so the operator is told before, not after.
    planGranted: removal.featuresToRevoke.filter((k) => r.planFeatures.has(k)),
  };
}

/** Read-only: what applying this preset would change. Nothing is written. */
export async function previewTenantPresetAction(
  input: Input,
): Promise<{ ok: true; preview: PresetPreview } | { error: string }> {
  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const p = await planApply(input);
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
 * Persist the preset: Branding.config, plus one enabled
 * override per grantable feature. Safe to run twice — the applier is idempotent
 * and the override writes are upserts.
 */
export async function applyTenantPresetAction(
  input: Input,
): Promise<{ ok: true; changed: number; missingFeatures: string[] } | { error: string }> {
  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const p = await planApply(input);
  if (!p.ok) return { error: p.error };

  const { tenantId, slug, application, featureRows, missingFeatures } = p;

  await prisma.$transaction([
    // themeId is deliberately absent from both branches: a preset never changes
    // how a store looks, so an existing tenant keeps its theme and a new Branding
    // row takes the schema default.
    prisma.branding.upsert({
      where: { tenantId },
      update: { config: application.config as Prisma.InputJsonValue },
      create: { tenantId, config: application.config as Prisma.InputJsonValue },
    }),
    ...featureRows.map((f) =>
      prisma.tenantFeatureOverride.upsert({
        where: { tenantId_featureId: { tenantId, featureId: f.id } },
        update: { enabled: true, expiresAt: null },
        create: { tenantId, featureId: f.id, enabled: true },
      }),
    ),
  ]);

  revalidateAfterPresetWrite(tenantId, slug);

  return { ok: true, changed: application.changes.length, missingFeatures };
}

/** Both write paths touch branding + entitlements, so both bust the same set. */
function revalidateAfterPresetWrite(tenantId: string, slug: string) {
  revalidatePath("/admin");
  revalidatePath(`/admin/tenants/${slug}`);
  revalidatePath(`/admin/tenants/${slug}/features`);
  revalidatePath(`/admin/tenants/${slug}/branding`);
  revalidateTenant(tenantId, slug); // storefront re-reads branding + entitlements
}

// ── Removing ─────────────────────────────────────────────────────────────────

export type PresetRemovalPreview = {
  presetName: string;
  changes: PresetChange[];
  /** Entitlements that will be denied. */
  revoking: string[];
  /** The subset of `revoking` the tenant's PLAN grants. Revoking one writes a
   *  deny override that survives the preset, so the store loses a feature it
   *  pays for until an operator re-enables it by hand. Shown as a warning. */
  planGranted: string[];
};

/** Read-only: what switching this preset off would change. Nothing is written. */
export async function previewRemoveTenantPresetAction(
  input: Input,
): Promise<{ ok: true; preview: PresetRemovalPreview } | { error: string }> {
  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const p = await planRemove(input);
  if (!p.ok) return { error: p.error };

  return {
    ok: true,
    preview: {
      presetName: p.preset.name,
      changes: p.removal.changes,
      revoking: [...p.removal.featuresToRevoke],
      planGranted: [...p.planGranted],
    },
  };
}

/**
 * Persist the removal: the reverted Branding.config, plus one DISABLED override
 * per revoked feature. The theme is deliberately not written — removal leaves
 * the tenant's look alone (see removeTenantPreset).
 *
 * Overrides are upserted to `enabled: false` rather than deleted, because a
 * delete would fall back to the plan and silently re-grant the feature. An
 * explicit deny wins over the plan in getEntitlements, which is the whole point.
 *
 * Safe to run twice — the remover is idempotent and the override writes are
 * upserts.
 */
export async function removeTenantPresetAction(
  input: Input,
): Promise<{ ok: true; changed: number; revoked: number } | { error: string }> {
  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  const p = await planRemove(input);
  if (!p.ok) return { error: p.error };

  const { tenantId, slug, removal, featureRows } = p;

  await prisma.$transaction([
    // Update-only: with no preset applied there is nothing to revert, and
    // creating a Branding row here would write a config the tenant never had.
    ...(removal.changes.some((c) => c.kind === "config")
      ? [
          prisma.branding.update({
            where: { tenantId },
            data: { config: removal.config as Prisma.InputJsonValue },
          }),
        ]
      : []),
    ...featureRows.map((f) =>
      prisma.tenantFeatureOverride.upsert({
        where: { tenantId_featureId: { tenantId, featureId: f.id } },
        update: { enabled: false, expiresAt: null },
        create: { tenantId, featureId: f.id, enabled: false },
      }),
    ),
  ]);

  revalidateAfterPresetWrite(tenantId, slug);

  return { ok: true, changed: removal.changes.length, revoked: featureRows.length };
}

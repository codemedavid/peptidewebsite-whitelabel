// Operator-editable plan→feature CEILING — which functionalities each package
// (Starter / Business / Automated) includes. Edited in the Super Admin
// (/admin/plans, "Package contents" editor) and persisted as the
// "plan_features_config" PlatformSetting row (or .demo-data/platform-settings.json
// in demo mode). The hardcoded PLAN_FEATURES in lib/features/catalog.ts are the
// fallback/default; plan keys stay fixed (they're identity — DB Plan rows).
//
// This is the source the entitlement sync (catalog-sync.syncPlanCatalog) writes
// into plan_features, and the demo-mode resolver (getDemoEntitlements) reads — so
// an operator edit here flows to every tenant on that plan (their per-tenant
// TenantFeatureOverride grants/revokes still win).
//
// Client-safe: no fs/prisma imports — types and pure helpers only.

import { ALL_FEATURES, PLAN_FEATURES, type FeatureKey } from "@/lib/features/catalog";
import { canonicalPlanKey } from "@/lib/admin/plan-options";

export const PLAN_FEATURES_CONFIG_KEY = "plan_features_config";

/** Canonical plan keys, in tier order — exactly the keys stored/edited. */
export const CONFIG_PLAN_KEYS = ["starter", "pro", "enterprise"] as const;
export type ConfigPlanKey = (typeof CONFIG_PLAN_KEYS)[number];

/** planKey → the feature keys in that package's ceiling. */
export type PlanFeatureConfig = { plans: Record<ConfigPlanKey, FeatureKey[]> };

/** Every valid catalog feature key — the allow-list for stored/untrusted input. */
const VALID_FEATURE_KEYS = new Set<string>(ALL_FEATURES);
/** Catalog declaration order — stable, deterministic ordering for stored keys. */
const FEATURE_ORDER = ALL_FEATURES as FeatureKey[];

/** The hardcoded PLAN_FEATURES, lifted into the editable shape. */
export function defaultPlanFeatureConfig(): PlanFeatureConfig {
  return {
    plans: {
      starter: [...PLAN_FEATURES.starter],
      pro: [...PLAN_FEATURES.pro],
      enterprise: [...PLAN_FEATURES.enterprise],
    },
  };
}

/** Keep only valid catalog keys, deduped and in catalog order. */
function cleanKeys(raw: unknown): FeatureKey[] {
  if (!Array.isArray(raw)) return [];
  const chosen = new Set(raw.map((x) => String(x)).filter((x) => VALID_FEATURE_KEYS.has(x)));
  return FEATURE_ORDER.filter((key) => chosen.has(key));
}

/**
 * Sanitize an untrusted/stored value into a well-formed config (never throws).
 * Always returns exactly the 3 canonical plans; a plan absent from the input
 * falls back to its catalog default, so a partial edit never wipes a package.
 */
export function normalizePlanFeatureConfig(input: unknown): PlanFeatureConfig {
  const o = (input ?? {}) as Record<string, unknown>;
  const rawPlans = (o.plans ?? {}) as Record<string, unknown>;
  const def = defaultPlanFeatureConfig();
  return {
    plans: {
      starter: "starter" in rawPlans ? cleanKeys(rawPlans.starter) : def.plans.starter,
      pro: "pro" in rawPlans ? cleanKeys(rawPlans.pro) : def.plans.pro,
      enterprise: "enterprise" in rawPlans ? cleanKeys(rawPlans.enterprise) : def.plans.enterprise,
    },
  };
}

/**
 * Effective ceiling Set for any plan key (incl. legacy aliases like "growth"),
 * resolved from the config with the catalog default as the fallback.
 */
export function resolvePlanCeiling(config: PlanFeatureConfig, planKey: string): Set<FeatureKey> {
  const key = canonicalPlanKey(planKey); // starter | pro | enterprise
  const list = config.plans[key] ?? defaultPlanFeatureConfig().plans[key];
  return new Set(list);
}

/**
 * The 3 canonical plans → feature-key arrays — the exact shape syncPlanCatalog
 * consumes, so a saved config reconciles straight into plan_features.
 */
export function resolvePlanFeatureSets(config: PlanFeatureConfig): Record<ConfigPlanKey, FeatureKey[]> {
  const normalized = normalizePlanFeatureConfig(config);
  return normalized.plans;
}

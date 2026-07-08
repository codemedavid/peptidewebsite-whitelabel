// Tracks which catalog functionalities are "New" so a freshly-added feature is
// surfaced to the Super Admin (to assign it to packages) and, once the operator
// keeps its flag, to store owners in their storefront admin as a "New" tag.
//
// Persisted as the "feature_registry" PlatformSetting (or the demo file):
//   - known:   every feature key recorded at the last reconcile — the baseline
//              used to DETECT additions (a catalog key not in `known` is new).
//   - newKeys: keys currently flagged "New" (the Super Admin dismisses these).
//
// A fresh install (empty `known`) treats the current catalog as the baseline —
// nothing is "new" until a real addition appears after the baseline is recorded.
//
// Client-safe: no fs/prisma imports — types and pure helpers only.

import { ALL_FEATURES, type FeatureKey } from "@/lib/features/catalog";

export const FEATURE_REGISTRY_KEY = "feature_registry";

export type FeatureRegistry = {
  known: FeatureKey[];
  newKeys: FeatureKey[];
};

const VALID_FEATURE_KEYS = new Set<string>(ALL_FEATURES);
const FEATURE_ORDER = ALL_FEATURES as FeatureKey[];

/** Keep only valid catalog keys, deduped and in catalog order. */
function cleanKeys(raw: unknown): FeatureKey[] {
  if (!Array.isArray(raw)) return [];
  const chosen = new Set(raw.map((x) => String(x)).filter((x) => VALID_FEATURE_KEYS.has(x)));
  return FEATURE_ORDER.filter((key) => chosen.has(key));
}

/** Sanitize an untrusted/stored value into a well-formed registry (never throws). */
export function normalizeFeatureRegistry(input: unknown): FeatureRegistry {
  const o = (input ?? {}) as Record<string, unknown>;
  return { known: cleanKeys(o.known), newKeys: cleanKeys(o.newKeys) };
}

/** True once a baseline has been recorded (distinguishes a fresh install). */
export function isRegistryInitialized(registry: FeatureRegistry): boolean {
  return registry.known.length > 0;
}

/**
 * Features to surface as "New" to the Super Admin: the persisted flags plus any
 * catalog key not yet in the recorded baseline (auto-detected additions). Only
 * detects once a baseline exists, so a fresh install isn't all-new.
 */
export function effectiveNewFeatures(registry: FeatureRegistry): Set<FeatureKey> {
  const set = new Set<FeatureKey>(registry.newKeys);
  if (isRegistryInitialized(registry)) {
    const known = new Set(registry.known);
    for (const key of FEATURE_ORDER) if (!known.has(key)) set.add(key);
  }
  return set;
}

/**
 * Record the current catalog as the new baseline and persist which keys stay
 * flagged "New". `keepNew` defaults to the current effective-new set (auto-carry
 * detected additions); pass an explicit list to honour operator dismissals.
 */
export function reconcileRegistry(
  registry: FeatureRegistry,
  keepNew?: Iterable<string>,
): FeatureRegistry {
  const keep = keepNew
    ? new Set([...keepNew].map(String).filter((x) => VALID_FEATURE_KEYS.has(x)))
    : effectiveNewFeatures(registry);
  return {
    known: [...FEATURE_ORDER],
    newKeys: FEATURE_ORDER.filter((key) => keep.has(key)),
  };
}

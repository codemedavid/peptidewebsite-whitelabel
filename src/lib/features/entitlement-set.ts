// Pure entitlement resolution: plan features ∪ enabled overrides − revocations,
// ignoring expired overrides. Split out of entitlements.ts so it can be tested
// without Next, and so it accepts the shape unstable_cache hands back on a HIT —
// where every Date has been serialized to an ISO string.

import type { FeatureKey } from "./catalog";

export type EntitlementRow = {
  plan: { features: { feature: { key: string } }[] };
  featureOverrides: {
    enabled: boolean;
    /** Date on a cache miss, ISO string on a cache hit, null when it never expires. */
    expiresAt: Date | string | null;
    feature: { key: string };
  }[];
} | null;

export function resolveEntitlementSet(tenant: EntitlementRow, now: number): Set<FeatureKey> {
  if (!tenant) return new Set();
  const set = new Set<FeatureKey>(tenant.plan.features.map((pf) => pf.feature.key as FeatureKey));
  for (const o of tenant.featureOverrides) {
    const expired = o.expiresAt ? new Date(o.expiresAt).getTime() < now : false;
    if (expired) continue;
    const key = o.feature.key as FeatureKey;
    if (o.enabled) set.add(key);
    else set.delete(key);
  }
  return set;
}

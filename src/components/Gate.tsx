import type { ReactNode } from "react";
import { getTenantId } from "@/lib/tenant/headers";
import { hasFeature } from "@/lib/features/entitlements";
import type { FeatureKey } from "@/lib/features/catalog";

/**
 * UI-layer feature gate (defense-in-depth layer 1).
 * Renders children only if the current tenant is entitled to `feature`,
 * otherwise renders `fallback` (e.g. an upsell). Server enforcement still
 * happens via requireFeature() — never trust the UI alone.
 */
export async function Gate({
  feature,
  children,
  fallback = null,
}: {
  feature: FeatureKey;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const tenantId = await getTenantId();
  return (await hasFeature(tenantId, feature)) ? <>{children}</> : <>{fallback}</>;
}

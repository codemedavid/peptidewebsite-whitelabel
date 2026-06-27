// The one entry point order code calls to emit a PostHog event for a tenant.
//
// It is deliberately TOTAL and SILENT: it gates on the tenant's entitlement and a
// live, enabled integration, runs only outside demo mode, and swallows every
// error. Analytics must NEVER slow or break checkout — callers fire it inside
// next/server `after()`, so this runs after the customer already has their
// response. If the tenant isn't entitled or hasn't connected PostHog, it no-ops.

import { isDemoMode } from "@/lib/demo/fixtures";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { getEnabledPostHogTarget } from "@/lib/integrations/store";
import { postHogCapture } from "@/lib/integrations/posthog";
import type { CapturePayload } from "@/lib/analytics/events";

/**
 * Send one event to the tenant's PostHog project, if and only if the tenant is
 * entitled (ANALYTICS_POSTHOG) and has an enabled, decryptable integration.
 * Never throws.
 */
export async function capturePostHogEvent(
  tenantId: string,
  payload: CapturePayload,
  timestamp?: string,
): Promise<void> {
  try {
    if (isDemoMode()) return; // demo tenants have no DB / no PostHog
    if (!(await hasFeature(tenantId, FEATURES.ANALYTICS_POSTHOG))) return;
    const target = await getEnabledPostHogTarget(tenantId);
    if (!target) return;
    await postHogCapture(target, payload, timestamp);
  } catch {
    /* analytics is best-effort — a failed capture must never surface to checkout */
  }
}

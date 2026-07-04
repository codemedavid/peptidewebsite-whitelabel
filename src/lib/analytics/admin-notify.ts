// The store-owner "you received an order" alert. Emitted on every genuinely-new
// order so the tenant's PostHog Messaging workflow emails the ADMIN (not the
// buyer) from the PostHog default sender.
//
// Like capture.ts this is deliberately TOTAL and SILENT — checkout calls it
// inside next/server `after()`, after the buyer already has their response, so a
// missing entitlement, an unset recipient, or any error must never surface. It
// composes THREE gates: the Automated-package entitlement (NOTIFY_ADMIN_ORDER),
// the store owner's own toggle+email (resolveAdminNotifyEmail), and — inside
// capturePostHogEvent — a connected, entitled PostHog. All three must hold.

import { isDemoMode } from "@/lib/demo/fixtures";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { capturePostHogEvent } from "@/lib/analytics/capture";
import { buildAdminOrderPayload, resolveAdminNotifyEmail, type EmailBrand } from "@/lib/analytics/events";
import type { Order } from "@/storefront/types";

/**
 * Email the store owner that an order came in, if and only if the tenant is
 * entitled (NOTIFY_ADMIN_ORDER) and the owner has enabled the alert with a valid
 * recipient in `branding.config.orderNotifications`. Never throws.
 *
 * @param config the tenant's `branding.config` blob (already loaded by checkout).
 */
export async function sendAdminOrderNotification(
  tenantId: string,
  order: Order,
  brand: EmailBrand | undefined,
  config: Record<string, unknown>,
): Promise<void> {
  try {
    if (isDemoMode()) return; // demo tenants have no DB / no PostHog
    if (!(await hasFeature(tenantId, FEATURES.NOTIFY_ADMIN_ORDER))) return;
    const adminEmail = resolveAdminNotifyEmail(config);
    if (!adminEmail) return; // toggle off or no valid recipient
    await capturePostHogEvent(tenantId, buildAdminOrderPayload(order, brand, adminEmail), order.date);
  } catch {
    /* best-effort — an alert failure must never surface to checkout */
  }
}

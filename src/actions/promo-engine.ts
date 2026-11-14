"use server";

// Store-admin writes for the promo engine: the Sale Campaign and the
// free-shipping threshold (the voucher ladder's per-code "Show in cart" flag
// rides savePromoCodesAction). Both live in branding.config, are gated on the
// "promo" staff permission (the same module as Promo Codes, where they are
// edited) AND on their operator grant — the storefront forces each off
// without its grant, so a write without it would be dead config.

import { Prisma } from "@prisma/client";
import { getTenantSlug } from "@/lib/tenant/headers";
import { isDemoMode, getDemoBranding, saveDemoBranding } from "@/lib/demo/fixtures";
import { prisma } from "@/lib/db/prisma";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { requireStaffPermission } from "@/lib/auth/staff-guard";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES, type FeatureKey } from "@/lib/features/catalog";
import { normalizeSaleCampaign, saleCampaignError } from "@/lib/storefront/sale-campaign";
import { normalizeFreeShippingThreshold } from "@/lib/storefront/free-shipping";

export type PromoEngineActionResult = { ok: true } | { error: string };

const NO_ACCESS = "You don't have permission to do that.";
const NOT_ENABLED = "This isn't enabled for your store yet. Ask your platform admin to turn it on.";

async function readConfig(tenantId: string): Promise<Record<string, unknown>> {
  if (isDemoMode()) return (getDemoBranding(tenantId).config ?? {}) as Record<string, unknown>;
  const branding = await prisma.branding.findUnique({ where: { tenantId }, select: { config: true } });
  return (branding?.config ?? {}) as Record<string, unknown>;
}

/** Read-modify-write one key of branding.config, behind permission + grant. */
async function saveConfigKey(
  feature: FeatureKey,
  key: string,
  value: unknown,
): Promise<PromoEngineActionResult> {
  const ctx = await requireStaffPermission("promo");
  if (!ctx) return { error: NO_ACCESS };
  const { tenantId } = ctx;
  if (!isDemoMode() && !(await hasFeature(tenantId, feature))) return { error: NOT_ENABLED };

  const slug = await getTenantSlug();
  const config = { ...(await readConfig(tenantId)), [key]: value };
  if (isDemoMode()) {
    saveDemoBranding(tenantId, { config });
  } else {
    await prisma.branding.upsert({
      where: { tenantId },
      update: { config: config as Prisma.InputJsonValue },
      create: { tenantId, config: config as Prisma.InputJsonValue },
    });
  }
  revalidateTenant(tenantId, slug);
  return { ok: true };
}

/** Save the Sale Campaign. Refuses an "on" campaign with missing or
 *  out-of-order dates instead of saving one that silently never runs. */
export async function saveSaleCampaignAction(input: unknown): Promise<PromoEngineActionResult> {
  const err = saleCampaignError(input);
  if (err) return { error: err };
  return saveConfigKey(FEATURES.STORE_SALE_CAMPAIGN, "saleCampaign", normalizeSaleCampaign(input));
}

/** Save the store-wide free-shipping threshold. */
export async function saveFreeShippingThresholdAction(input: unknown): Promise<PromoEngineActionResult> {
  const o = (input ?? {}) as Record<string, unknown>;
  if (o.enabled === true && !(Number(o.minSubtotal) > 0)) {
    return { error: "Set the minimum order amount for free shipping." };
  }
  return saveConfigKey(
    FEATURES.STORE_FREE_SHIPPING_THRESHOLD,
    "freeShippingThreshold",
    normalizeFreeShippingThreshold(input),
  );
}

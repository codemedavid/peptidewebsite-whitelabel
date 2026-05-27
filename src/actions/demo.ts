"use server";

import { revalidatePath } from "next/cache";
import { isDemoMode, createDemoTenant, saveDemoBranding, saveDemoOrderFormat, saveDemoFeatures, type DemoBranding, type DemoFeatureMap } from "@/lib/demo/fixtures";
import {
  normalizeOrderNumberFormat,
  validatePrefix,
  type OrderNumberFormat,
} from "@/lib/orders/order-number-format";

export type CreateTenantState = { error?: string; createdSlug?: string };

/** Build an OrderNumberFormat from wizard form fields, validating the prefix. */
function orderFormatFromForm(formData: FormData, name: string): OrderNumberFormat | { error: string } {
  const raw = {
    prefix: String(formData.get("orderPrefix") ?? "").trim().toUpperCase(),
    separator: String(formData.get("orderSeparator") ?? "-"),
    scheme: String(formData.get("orderScheme") ?? "sequential"),
    digits: Number(formData.get("orderDigits") ?? 4),
  };
  const prefixError = validatePrefix(raw.prefix);
  if (prefixError) return { error: prefixError };
  return normalizeOrderNumberFormat(raw, name);
}

/**
 * Demo-mode tenant creation (no DB). Backs the platform admin onboarding wizard.
 * In production this is replaced by actions/onboarding.ts#createTenant (Prisma).
 */
export async function createTenantDemoAction(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  if (!isDemoMode()) return { error: "Not in demo mode — use the database-backed flow." };

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const plan = String(formData.get("plan") ?? "starter");
  const themeId = String(formData.get("themeId") ?? "clinical-white");

  if (name.length < 2) return { error: "Name must be at least 2 characters." };

  const orderNumberFormat = orderFormatFromForm(formData, name);
  if ("error" in orderNumberFormat) return { error: orderNumberFormat.error };

  const result = createDemoTenant({ name, slug, plan, themeId, orderNumberFormat });
  if ("error" in result) return { error: result.error };

  revalidatePath("/admin");
  return { createdSlug: slug };
}

/** Persist a tenant's order-number format in demo mode (settings area). */
export async function saveOrderFormatDemoAction(
  slug: string,
  format: OrderNumberFormat,
): Promise<{ ok: true } | { error: string }> {
  if (!isDemoMode()) return { error: "Not in demo mode — use the database-backed flow." };
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };

  const prefixError = validatePrefix(format.prefix.toUpperCase());
  if (prefixError) return { error: prefixError };

  saveDemoOrderFormat(slug, normalizeOrderNumberFormat(format, slug));
  revalidatePath("/admin");
  return { ok: true };
}

/** Persist a tenant's branding overrides (theme, role colors, fonts) in demo mode. */
export async function saveBrandingDemoAction(
  slug: string,
  branding: DemoBranding,
): Promise<{ ok: true } | { error: string }> {
  if (!isDemoMode()) return { error: "Not in demo mode — use the database-backed flow." };
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };

  saveDemoBranding(slug, branding);
  revalidatePath("/admin");
  revalidatePath("/", "layout"); // storefronts re-read branding
  return { ok: true };
}

/** Persist a tenant's feature toggle overrides in demo mode. */
export async function saveFeaturesDemoAction(
  slug: string,
  map: DemoFeatureMap,
): Promise<{ ok: true } | { error: string }> {
  if (!isDemoMode()) return { error: "Not in demo mode — use the database-backed flow." };
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { error: "Invalid tenant slug." };

  saveDemoFeatures(slug, map);
  revalidatePath("/admin");
  revalidatePath("/", "layout"); // storefronts re-read entitlements (nav + route guards)
  return { ok: true };
}

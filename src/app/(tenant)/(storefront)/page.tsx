import { getTenantId } from "@/lib/tenant/headers";
import { getTenantContext } from "@/lib/tenant/context";
import { brandPaletteFromBranding } from "@/lib/theme/resolve-css-vars";
import { normalizeOrderNumberFormat } from "@/lib/orders/order-number-format";
import { StorefrontApp } from "@/storefront/StorefrontApp";
import { BRAND } from "@/storefront/data";
import type { Brand } from "@/storefront/types";

// Dynamic-by-default because we read the tenant from the request host
// (middleware sets x-tenant-host). The hot data calls (tenant context, branding,
// entitlements) are wrapped in `unstable_cache` so per-host renders re-use the
// same DB result for 5 min and are busted by tag on tenant mutations.

export default async function HomePage() {
  const tenantId = await getTenantId();
  const { tenant, branding, settings } = await getTenantContext(tenantId);

  // Compose the storefront Brand from three layers, low→high precedence:
  //   1. BRAND            — the design's static defaults (copy, toggles, etc.)
  //   2. theme palette    — colors + fonts derived from the chosen theme preset
  //                         / role colors, so the storefront home matches the
  //                         theme even for new tenants (config is empty until the
  //                         operator opens the Storefront tab).
  //   3. config           — the full Brand blob saved by the "Storefront" tab;
  //                         the editor keeps its palette synced to the theme, but
  //                         operators can still override individual fields here.
  const config = (branding?.config ?? {}) as Partial<Brand>;
  const themePalette = brandPaletteFromBranding(branding);
  const brand: Brand = {
    ...BRAND,
    ...themePalette,
    ...config,
    name: config.name || settings?.storeName || tenant.name || BRAND.name,
    logoUrl: config.logoUrl || ((branding?.logoUrl as string | null) ?? "") || BRAND.logoUrl,
    orderNumberFormat: normalizeOrderNumberFormat(
      (tenant as Record<string, unknown>).orderNumberFormat,
      tenant.name,
    ),
  };

  return <StorefrontApp brand={brand} />;
}

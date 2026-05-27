import { getTenantId } from "@/lib/tenant/headers";
import { getTenantContext } from "@/lib/tenant/context";
import { brandPaletteFromBranding } from "@/lib/theme/resolve-css-vars";
import { StorefrontApp } from "@/storefront/StorefrontApp";
import { BRAND } from "@/storefront/data";
import type { Brand } from "@/storefront/types";

export const dynamic = "force-dynamic"; // tenant-specific; resolved per request

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
  };

  return <StorefrontApp brand={brand} />;
}

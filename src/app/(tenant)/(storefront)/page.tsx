import { getTenantId, getTenantSlug } from "@/lib/tenant/headers";
import { getTenantContext } from "@/lib/tenant/context";
import { withTenant } from "@/lib/db/tenant-client";
import { isDemoMode, getDemoProducts, getDemoStoreProducts } from "@/lib/demo/fixtures";
import { brandPaletteFromBranding } from "@/lib/theme/resolve-css-vars";
import { normalizeOrderNumberFormat } from "@/lib/orders/order-number-format";
import { dbProductToStorefront, type DbProductRow } from "@/lib/storefront/product-mapping";
import { StorefrontApp } from "@/storefront/StorefrontApp";
import { BRAND } from "@/storefront/data";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import type { Brand, Product } from "@/storefront/types";

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

  // The reseller portal is a platform-operator entitlement, toggled per tenant in
  // admin → Features (FEATURES.STORE_RESELLER_PORTAL). It only goes live once the
  // store owner ALSO sets an access code, so the effective #merchant visibility is
  // (entitled AND a code exists). Deriving it here means nav/footer/visibility all
  // gate on the operator's toggle with no dead gate — and it overrides whatever
  // stale `showPageMerchant` may sit in config.
  const resellerEntitled = await hasFeature(tenantId, FEATURES.STORE_RESELLER_PORTAL);
  const resellerCode =
    typeof config.resellerAccessCode === "string" ? config.resellerAccessCode.trim() : "";
  brand.showPageMerchant = resellerEntitled && resellerCode !== "";

  // The reseller access code is validated server-side (verifyResellerCodeAction);
  // never ship it to the browser, even though the rest of `config` is public.
  delete (brand as Record<string, unknown>).resellerAccessCode;

  // Products are the source of truth in the DB. Load the tenant's catalog
  // server-side (demo: file-backed store, seeded from the builtin fixtures) and
  // hand it to the storefront — both the public catalog and the #admin manager
  // render from this set, and the admin's writes persist back through
  // actions/products.ts. The brand's currency symbol drives display formatting.
  let products: Product[] = [];
  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const saved = getDemoStoreProducts(slug);
    products = saved
      ? saved
      : getDemoProducts(tenantId).map((dp) =>
          dbProductToStorefront(dp as unknown as DbProductRow, brand.currency || "₱"),
        );
  } else {
    const rows = await withTenant(tenantId, (db) =>
      db.product.findMany({
        where: { status: { not: "archived" } },
        orderBy: { createdAt: "asc" },
      }),
    );
    products = rows.map((r) => dbProductToStorefront(r as DbProductRow, brand.currency || "₱"));
  }

  return <StorefrontApp brand={brand} products={products} tenantKey={tenantId} />;
}

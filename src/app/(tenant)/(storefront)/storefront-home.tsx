import { getTenantId, getTenantSlug } from "@/lib/tenant/headers";
import { StorefrontApp } from "@/storefront/StorefrontApp";
import { isResellerUnlocked } from "@/lib/auth/reseller-session";
import { isTrialPaused } from "@/lib/trial/trial-state";
import { loadStorefrontBrand } from "@/lib/storefront/storefront-brand";

// Not a route itself: this is the storefront home, rendered by BOTH "/" (page.tsx)
// and the /p/<slug> share-link route, so a shared product link lands on the real
// store rather than a second page that can drift from it.
//
// Dynamic-by-default because we read the tenant from the request host
// (middleware sets x-tenant-host). The hot data calls (tenant context, branding,
// entitlements) are wrapped in `unstable_cache` so per-host renders re-use the
// same DB result for 5 min and are busted by tag on tenant mutations.

export async function StorefrontHome({
  initialProduct,
}: {
  /** Link key (slug or id) of a product to open the quick-view on, supplied ONLY
   *  by the /p/<slug> share-link route; undefined on the plain "/" render.
   *
   *  Rendering the real home (rather than a second, bespoke product page) is
   *  what keeps a shared link on the tenant's own design, with their header,
   *  cart and every layout variant intact — the legacy /products/[slug] page is
   *  exactly what happens when a product URL grows its own markup. */
  initialProduct?: string | null;
}) {
  const tenantId = await getTenantId();
  const { brand, products } = await loadStorefrontBrand({
    tenantId,
    slug: (await getTenantSlug()) ?? tenantId,
    isResellerUnlocked: (version) => isResellerUnlocked(tenantId, version),
  });

  // A paused (expired-trial) store renders the StorePaused card, not the catalog,
  // so don't serialize the full product list into that page's payload.
  const catalogProducts = isTrialPaused(brand.trial) ? [] : products;

  return (
    <StorefrontApp
      brand={brand}
      products={catalogProducts}
      tenantKey={tenantId}
      initialProduct={initialProduct}
    />
  );
}

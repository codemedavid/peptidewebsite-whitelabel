import type { Product } from "@/storefront/types";

// ── Reseller pricing entitlement gate ─────────────────────────────────────────
// The Reseller portal (FEATURES.STORE_RESELLER_PORTAL) is an operator-grantable
// feature. Historically it only gated the #merchant page + the store-admin
// manager view — but the CART applies a product's wholesale `reseller` tier
// automatically at qty ≥ minQty (checkout.ts unitPrice/isResellerQty), purely
// data-driven. So a tenant whose products carried reseller legs (e.g. imported
// from another store, or mis-entered) sold at wholesale with the feature OFF.
//
// The fix is server-side and catalog-shaped: when the tenant is NOT entitled,
// strip the reseller legs off every product before the catalog reaches ANY
// pricing surface — the storefront render (page.tsx) and the server-
// authoritative re-price at order placement (orders.ts). With no `reseller`
// data present, every downstream helper already degrades to retail: no badge,
// no struck price, no wholesale unit price. The DB rows keep their data, so
// re-granting the feature restores wholesale pricing untouched.

/**
 * The catalog a tenant's pricing surfaces may see: unchanged when the Reseller
 * portal feature is granted, otherwise every product with its `reseller` tier
 * removed (immutably — the input products are never mutated).
 */
export function stripResellerPricing(products: Product[], entitled: boolean): Product[] {
  if (entitled) return products;
  return products.map((p) => {
    if (!p.reseller) return p;
    const { reseller: _reseller, ...rest } = p;
    return rest;
  });
}

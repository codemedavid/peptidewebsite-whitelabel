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
 * The catalog a tenant's pricing surfaces may see. Two independent gates, one
 * per config shape:
 *
 *  - `entitled` is the PARENT (storefront.reseller). Without it the legacy
 *    `reseller` tier is removed — the original fix described above.
 *  - `wholesaleEntitled` is the CHILD (storefront.reseller.wholesale). Without
 *    it the `wholesale` MOQ config is removed. A separate flag because a tenant
 *    can hold the parent — running the #merchant page — without being granted
 *    MOQ pricing on the regular storefront.
 *
 * The wholesale flag defaults to FALSE deliberately: it fails closed, so a call
 * site that forgets it sells at retail rather than applying wholesale prices the
 * operator never granted. Immutable — the inputs are never mutated, and the DB
 * rows keep their data, so re-granting either feature restores it untouched.
 */
export function stripResellerPricing(
  products: Product[],
  entitled: boolean,
  wholesaleEntitled = false,
): Product[] {
  if (entitled && wholesaleEntitled) return products;
  return products.map((p) => {
    const dropLegacy = !entitled && p.reseller != null;
    const dropWholesale = !wholesaleEntitled && p.wholesale != null;
    if (!dropLegacy && !dropWholesale) return p;
    const next = { ...p };
    if (dropLegacy) delete next.reseller;
    if (dropWholesale) delete next.wholesale;
    return next;
  });
}

/**
 * The save-side counterpart of the strip: because the stripped catalog also
 * seeds the store-admin product editor, an UNENTITLED owner's save would write
 * a zeroed `reseller` leg over the DB's dormant wholesale data — breaking the
 * "re-granting restores prices untouched" guarantee above. Given the metadata
 * the save is about to write and the row's EXISTING metadata, this keeps the
 * existing reseller leg verbatim (or omits the key when there is none) unless
 * the tenant is entitled to edit it. Immutable — neither input is mutated.
 */
export function preserveResellerMetadata(
  incoming: Record<string, unknown>,
  existingMetadata: unknown,
  entitled: boolean,
  wholesaleEntitled = false,
): Record<string, unknown> {
  if (entitled && wholesaleEntitled) return incoming;
  const existingOf = (key: string): unknown =>
    existingMetadata && typeof existingMetadata === "object"
      ? (existingMetadata as Record<string, unknown>)[key]
      : undefined;

  const next = { ...incoming };
  // `wholesale` is preserved on its own flag, for the same reason and with the
  // same fail-closed default as the strip: an owner who was never granted MOQ
  // pricing must not be able to blank the DB's dormant config just by saving.
  for (const [key, allowed] of [
    ["reseller", entitled],
    ["wholesale", wholesaleEntitled],
  ] as const) {
    if (allowed) continue;
    const existing = existingOf(key);
    if (existing != null) next[key] = existing;
    else delete next[key];
  }
  return next;
}

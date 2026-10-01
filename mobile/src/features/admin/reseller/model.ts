import { RESELLER_MIN_QTY, type CatalogProduct } from "@/features/admin/catalog/model";

/**
 * The Reseller Portal's shapes and pure rules (src/actions/storefront-admin.ts
 * getResellerSettingsAction, src/lib/storefront/wholesale.ts,
 * src/lib/storefront/reseller-page-copy.ts — defaults copied verbatim). The server hashes the password,
 * checks its length and bumps the code version — nothing here decides that.
 */

export type ResellerSettings = {
  /** The Reseller parent entitlement — operator-controlled, shown read-only. */
  available: boolean;
  /** The reseller PAGE child. */
  pageAvailable: boolean;
  /** The wholesale-pricing child (MOQ fields in the product editor). */
  wholesaleAvailable: boolean;
  /** Whether a password is stored. The password itself never leaves the server. */
  hasCode: boolean;
  gateTitle: string;
  gateSub: string;
};

export const DEFAULT_RESELLER_GATE_TITLE = "Reseller Access";
export const DEFAULT_RESELLER_GATE_SUB = "Enter the reseller password to access wholesale pricing.";

/** The website's own client check (saveResellerSettingsAction repeats it). */
export const MIN_PASSWORD_LENGTH = 4;

export type Wholesale = { moq: number; price: number };

/** resolveWholesale: the current MOQ block wins; a legacy reseller leg still prices. */
export function resolveWholesale(p: CatalogProduct): Wholesale | null {
  const w = p.wholesale;
  if (w && w.enabled && w.moq > 0 && w.price > 0) return { moq: w.moq, price: w.price };
  const r = p.reseller;
  if (!r) return null;
  const price = r.completeSet || r.vialsOnly || 0;
  if (price <= 0) return null;
  const moq = typeof r.minQty === "number" && r.minQty > 0 ? r.minQty : RESELLER_MIN_QTY;
  return { moq, price };
}

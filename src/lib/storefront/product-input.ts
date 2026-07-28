// Input hardening for the store-admin product editor — the coercion layer that
// turns an untrusted client payload into a clean storefront `Product` before it
// reaches `productToDbWrite`.
//
// Lives here (not in the `"use server"` action file) because a "use server"
// module may only export async functions, which makes a pure normalizer
// impossible to unit-test in place. Keeping it pure means the save pipeline
// `normalizeProductInput → productToDbWrite` can be asserted end to end without
// a DB or a session (see scripts/test-product-add-gates.ts).

import { toProductClass } from "@/lib/storefront/product-class";
import type { Product } from "@/storefront/types";

/** Coerce to a string and cap its length. */
export function str(v: unknown, max: number): string {
  if (typeof v === "string") return v.slice(0, max);
  if (v == null) return "";
  return String(v).slice(0, max);
}

/** Coerce to a finite number, or 0. */
export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Coerce an untrusted client object into a clean storefront Product. */
export function normalizeProductInput(input: unknown): Product {
  const o = (input ?? {}) as Record<string, unknown>;
  const inclusionsRaw = Array.isArray(o.inclusions) ? o.inclusions : [];
  const inclusions = inclusionsRaw.slice(0, 100).map((it) => {
    const x = (it ?? {}) as Record<string, unknown>;
    return { name: str(x.name, 200), qty: Math.max(1, Math.round(num(x.qty)) || 1) };
  });
  const variationsRaw = Array.isArray(o.variations) ? o.variations : [];
  const variations = variationsRaw
    .slice(0, 100)
    .map((it) => {
      const x = (it ?? {}) as Record<string, unknown>;
      const base = { name: str(x.name, 80).trim(), price: Math.max(0, num(x.price)) };
      // Preserve a per-variation stock ONLY when the seller actually entered one
      // (a number, or a non-blank numeric field). A blank/absent value means
      // "untracked → fall back to the base stock", so no `stock` key is added.
      const raw = x.stock;
      const tracked =
        typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "");
      return tracked ? { ...base, stock: Math.max(0, Math.round(num(raw))) } : base;
    })
    .filter((v) => v.name);
  return {
    id: str(o.id, 64),
    name: str(o.name, 200).trim(),
    description: str(o.description, 5000).trim(),
    price: Math.max(0, num(o.price)),
    // The display symbol the storefront shows; capped short (it's "₱", "USD", …).
    currency: str(o.currency, 8) || "₱",
    purity: str(o.purity, 32),
    category: str(o.category, 64),
    featured: o.featured === true,
    // Hosted URLs are short; allow a large cap so demo data URLs survive too.
    image: typeof o.image === "string" && o.image ? o.image.slice(0, 12_000_000) : null,
    stock: Math.max(0, Math.round(num(o.stock))),
    available: o.available !== false,
    discountPrice: Math.max(0, num(o.discountPrice)),
    discountEnabled: o.discountEnabled === true,
    // "Group Buy product": tagged "gb" so the storefront lists it under the group
    // buy (priced by gbPrice) rather than on-hand. Only "gb" + a positive gbPrice
    // persist (see product-mapping.productToDbWrite); anything else is on-hand.
    productType: o.productType === "gb" ? "gb" : undefined,
    gbPrice: o.productType === "gb" && num(o.gbPrice) > 0 ? num(o.gbPrice) : undefined,
    // "Not available": still listed in the catalog, but not orderable. Set by the
    // Group Buy Pricing tab and edited nowhere else — which is exactly why it has
    // to round-trip here. Dropping the key made productToDbWrite persist
    // `undefined`, compactMetadata then removed it, and ANY later save through the
    // ordinary product editor silently put the item back on sale. Same class of
    // regression as productClass above; covered by test-product-add-gates.
    purchasable: o.purchasable !== false,
    // Same round-trip contract for "message for price" on-hand items.
    priceOnRequest: o.priceOnRequest === true,
    // The editor's "Order ratio class" tag. Narrowed to a real ProductClass, so
    // an unknown value becomes undefined and Order Ratio Control falls back to
    // its name heuristic — never passed through raw. Dropping this key silently
    // wiped the class of every already-classified product on each admin save.
    productClass: toProductClass(o.productClass),
    isSet: o.isSet === true,
    inclusions,
    molecularWeight: str(o.molecularWeight, 64),
    cas: str(o.cas, 64),
    storage: str(o.storage, 200),
    sequence: str(o.sequence, 1000),
    sizes: str(o.sizes, 200),
    variations,
    reseller: ((): Product["reseller"] => {
      const r = (o.reseller ?? {}) as Record<string, unknown>;
      const vialsOnly = Math.max(0, num(r.vialsOnly));
      const completeSet = Math.max(0, num(r.completeSet));
      const minQty = Math.max(0, Math.round(num(r.minQty)));
      return vialsOnly > 0 || completeSet > 0
        ? { vialsOnly, completeSet, ...(minQty > 0 ? { minQty } : {}) }
        : undefined;
    })(),
  };
}

// Mapping layer between the persisted DB `Product` row and the storefront's
// client-side `Product` shape. The DB has a few first-class columns
// (name/priceCents/currency/stock/status/slug/sku/images) and a `metadata` JSON
// blob; everything the storefront needs that has no dedicated column lives in
// `metadata`. Keeping the translation in one pure module means the page loader,
// the server actions, and the demo persistence all round-trip identically.
//
// Pure (no `server-only`, no Prisma, no React) so it can be imported from a
// server component, a "use server" action, or a test without pulling in either
// runtime.

import type { Product } from "@/storefront/types";
import { toProductClass, type ProductClass } from "./product-class";
import { normalizeHostedImageUrl } from "./product-image";

/** The subset of the Prisma `Product` row this layer reads. */
export type DbProductRow = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  slug: string | null;
  images: unknown; // Json — string[]
  stock: number;
  status: string; // active | draft | archived
  active: boolean;
  metadata: unknown; // Json — ProductMetadata
  /** Row creation time, for the "New Arrivals" sort. A Date from Prisma, but an
   *  ISO string once a cache layer has serialized the row. Optional so every
   *  existing caller that builds a row by hand still type-checks. */
  createdAt?: Date | string | null;
};

/** Storefront-only fields parked in `Product.metadata`. */
export type ProductMetadata = {
  purity?: string;
  category?: string;
  /** The admin-managed sort group this product belongs to (a `group` entry in
   *  branding.config.sortCategories). Not the filter-chip `category`. */
  sortCategory?: string;
  featured?: boolean;
  discountPrice?: number;
  discountEnabled?: boolean;
  isSet?: boolean;
  inclusions?: { name: string; qty: number }[];
  molecularWeight?: string;
  cas?: string;
  storage?: string;
  sequence?: string;
  sizes?: string;
  /** Per-product variations (dosage/size options + their price). Only present
   *  when at least one named variation exists — see `cleanVariations`. `stock`
   *  is present only when the option is tracked independently; absent = falls
   *  back to the base `stock` column (see lib/storefront/inventory.ts).
   *  `gbPrice` is likewise present only when the option has its own group-buy
   *  price; absent = no group price for that option (it sells at its own
   *  `price`, NOT at the product-level `gbPrice`). */
  /** `image` is the option's own hosted photo, present only when the seller
   *  uploaded one. Persisted only as a valid http(s) URL — see cleanVariations. */
  variations?: {
    name: string;
    price: number;
    stock?: number;
    gbPrice?: number;
    image?: string;
  }[];
  /** Order Ratio Control classification (peptide / bacWater / other) set by the
   *  storefront admin. Absent → the ratio engine's name heuristic decides. */
  productClass?: ProductClass;
  /** The display symbol the storefront renders (e.g. "₱") — distinct from the
   *  ISO `currency` column used by Intl on the product detail page. */
  currencySymbol?: string;
  /** Preserved so the product detail page's COA link keeps working. */
  coaUrl?: string;
  /** Wholesale / reseller pricing tier (min. order applies). Only present when at
   *  least one price leg is set — see `cleanReseller` so an empty `{}` never
   *  persists. `minQty` is the per-product wholesale threshold. */
  reseller?: { vialsOnly?: number; completeSet?: number; minQty?: number };
  /** Wholesale (MOQ) pricing set per product in Product Management. `moq` is the
   *  minimum COMBINED quantity — every variation of this product counts toward
   *  the same number — and `price` is the unit price the whole quantity pays once
   *  it is reached. Only present when BOTH are set; see `cleanWholesale`, which
   *  refuses to persist an incomplete rule. `enabled: false` is persisted so the
   *  owner's numbers survive toggling the feature off. */
  wholesale?: { enabled: boolean; moq: number; price: number };
  /** Product Management module. `productType` is persisted only as "gb" (absent =
   *  on-hand, the historical default); `gbPrice` is the per-unit group-buy price
   *  (only with a "gb" type and > 0); `purchasable` is persisted only as `false`
   *  (absent = orderable). All three are feature-gated at render time —
   *  see (storefront)/page.tsx. */
  productType?: "gb";
  gbPrice?: number;
  purchasable?: false;
  /** On-hand item with no fixed price — see Product.priceOnRequest. Persisted
   *  only as `true` (absent = a normal priced product). */
  priceOnRequest?: true;
  /** Any checkout containing this product gets the configured shipping fee
   *  waived. Persisted only as `true` (absent = normal shipping). */
  freeShipping?: true;
  /** Manufactured per order, so never stock-gated — see Product.madeToOrder.
   *  Persisted only as `true` (absent = an ordinary stocked product). */
  madeToOrder?: true;
};

/** The DB write payload (no id/tenantId/sku/slug — the action owns those). */
export type ProductDbWrite = {
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  stock: number;
  status: string;
  active: boolean;
  images: string[];
  metadata: ProductMetadata;
};

// ── Currency ────────────────────────────────────────────────────────────────
// The storefront edits prices in major units with a display symbol ("₱1500"),
// but the DB stores integer cents + an ISO code (so the detail page's
// Intl.NumberFormat and any future payment integration work). Map the common
// symbols; pass through anything that already looks like an ISO code.

const SYMBOL_TO_ISO: Record<string, string> = {
  "₱": "PHP",
  $: "USD",
  US$: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₩": "KRW",
  "₹": "INR",
  RM: "MYR",
  "฿": "THB",
  "₫": "VND",
  Rp: "IDR",
  S$: "SGD",
  A$: "AUD",
  C$: "CAD",
  R$: "BRL",
};

/** Best-effort ISO 4217 code for a storefront currency symbol/code. */
export function currencySymbolToIso(symbol: string | undefined | null): string {
  const raw = (symbol ?? "").trim();
  if (!raw) return "USD";
  if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase(); // already ISO
  return SYMBOL_TO_ISO[raw] ?? "USD";
}

// ── Slug / SKU ────────────────────────────────────────────────────────────────

/** URL-safe slug from a product name. Falls back to "product" when empty. */
export function slugify(input: string): string {
  const s = (input ?? "")
    .normalize("NFKD") // decompose accents so the alnum filter below drops them
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "") // strip accents (combining marks)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "product";
}

/** Return `base`, or `base-2`, `base-3`, … until it isn't in `taken`. */
export function uniqueize(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Pathological fallback — keep it deterministic-ish without Date/random.
  return `${base}-${taken.size + 1}`;
}

// ── DB → storefront ───────────────────────────────────────────────────────────

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Map a DB row into the storefront `Product` the client renders. `displaySymbol`
 * is the brand's currency symbol — used when the row didn't capture one, so the
 * catalog always shows the tenant's configured symbol rather than an ISO code.
 */
export function dbProductToStorefront(row: DbProductRow, displaySymbol: string): Product {
  const meta = (row.metadata ?? {}) as ProductMetadata;
  const images = asStringArray(row.images);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    price: (row.priceCents ?? 0) / 100,
    currency: meta.currencySymbol || displaySymbol || row.currency,
    purity: meta.purity ?? "",
    category: meta.category ?? "",
    // The admin-managed SORT group (distinct from `category`, the filter chip).
    // Absent = unassigned, which is a normal state, not an error.
    sortCategory: meta.sortCategory || undefined,
    featured: !!meta.featured,
    // Surfaced as an ISO string so the "New Arrivals" sort has real data to rank
    // by. Guarded because a cached row hands this back as a string already — see
    // the unstable_cache Date→string trap that crashed getSubscriptionMeta.
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : typeof row.createdAt === "string"
          ? row.createdAt
          : undefined,
    image: images[0] ?? null,
    stock: row.stock ?? 0,
    available: row.status !== "draft" && row.status !== "archived",
    discountPrice: typeof meta.discountPrice === "number" ? meta.discountPrice : 0,
    discountEnabled: !!meta.discountEnabled,
    isSet: !!meta.isSet,
    inclusions: Array.isArray(meta.inclusions) ? meta.inclusions : [],
    molecularWeight: meta.molecularWeight ?? "",
    cas: meta.cas ?? "",
    storage: meta.storage ?? "",
    sequence: meta.sequence ?? "",
    sizes: meta.sizes ?? "",
    variations: cleanVariations(meta.variations, meta.productType === "gb") ?? [],
    productClass: toProductClass(meta.productClass),
    reseller: cleanReseller(meta.reseller),
    wholesale: cleanWholesale(meta.wholesale),
    productType: meta.productType === "gb" ? "gb" : "onhand",
    gbPrice: typeof meta.gbPrice === "number" && meta.gbPrice > 0 ? meta.gbPrice : 0,
    purchasable: meta.purchasable !== false,
    priceOnRequest: meta.priceOnRequest === true,
    freeShipping: meta.freeShipping === true,
    madeToOrder: meta.madeToOrder === true,
  };
}

/**
 * Normalize a reseller tier to numbers, dropping empty/zero legs. Returns
 * `undefined` when neither leg has a positive value so `compactMetadata`
 * (which keeps empty objects) never persists a bare `{}` or a stale leg.
 */
function cleanReseller(
  r: { vialsOnly?: number; completeSet?: number; minQty?: number } | undefined,
): { vialsOnly?: number; completeSet?: number; minQty?: number } | undefined {
  if (!r) return undefined;
  const vialsOnly = Number(r.vialsOnly) || 0;
  const completeSet = Number(r.completeSet) || 0;
  const minQty = Math.max(0, Math.round(Number(r.minQty) || 0));
  if (!vialsOnly && !completeSet) return undefined;
  return {
    ...(vialsOnly ? { vialsOnly } : {}),
    ...(completeSet ? { completeSet } : {}),
    // Only persist a minimum the owner actually set (>0); else the storefront
    // falls back to the global RESELLER_MIN_QTY default.
    ...(minQty > 0 ? { minQty } : {}),
  };
}

/**
 * Normalize a wholesale config, or return undefined so `compactMetadata` never
 * persists a partial one.
 *
 * A rule needs BOTH a positive MOQ and a positive unit price; either missing and
 * there is nothing to enforce, so the key is dropped rather than stored as a
 * half-rule that some future reader might act on. The MOQ is whole units.
 *
 * `enabled: false` IS persisted (with its numbers) so that toggling wholesale
 * off, saving, and toggling it back on returns the owner's MOQ and price rather
 * than two blank boxes.
 */
function cleanWholesale(
  w: { enabled?: boolean; moq?: number; price?: number } | undefined,
): { enabled: boolean; moq: number; price: number } | undefined {
  if (!w) return undefined;
  const moq = Math.max(0, Math.round(Number(w.moq) || 0));
  const price = Number(w.price) || 0;
  if (moq <= 0 || price <= 0) return undefined;
  return { enabled: w.enabled === true, moq, price };
}

/**
 * Normalize a variations list: trim names, coerce prices to non-negative
 * numbers, and drop rows without a name. Returns `undefined` when nothing
 * survives so `compactMetadata` never persists an empty `[]`.
 *
 * `keepGbPrice` is the product's group-buy tag: only a "gb" product may carry
 * per-option group prices, so an on-hand product never stores (or reads back) a
 * price no storefront surface would honour.
 */
function cleanVariations(
  v:
    | { name?: string; price?: number; stock?: number; gbPrice?: number; image?: string }[]
    | undefined,
  keepGbPrice = false,
): { name: string; price: number; stock?: number; gbPrice?: number; image?: string }[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((x) => {
      const name = String(x?.name ?? "").trim();
      const price = Math.max(0, Number(x?.price) || 0);
      // Track stock ONLY when a number was actually set. Absent means "fall
      // back to the base column" — injecting a 0 here would silently mark
      // every legacy variation sold out, so the key must stay off.
      const hasStock = typeof x?.stock === "number" && Number.isFinite(x.stock);
      // Same opt-in rule for the group price: only a POSITIVE number persists.
      // Absent means "no group price for this option", which makeVariationEntry
      // reads as "sell at the option's own price" — never as "reuse the
      // product's gbPrice", which would undercharge every larger size.
      const gb = Number(x?.gbPrice);
      const hasGb = keepGbPrice && Number.isFinite(gb) && gb > 0;
      // The option's own photo. Normalized through the same http(s)-only rule as
      // the brand default image, because this string is tenant-editable and ends
      // up in an <img src>; anything else (a data: URL, a bare path, a cleared
      // field) is dropped rather than stored as an unusable value.
      const image = normalizeHostedImageUrl(x?.image);
      return {
        name,
        price,
        ...(hasStock ? { stock: Math.max(0, Math.round(x!.stock as number)) } : {}),
        ...(hasGb ? { gbPrice: gb } : {}),
        ...(image ? { image } : {}),
      };
    })
    .filter((x) => x.name);
  return out.length ? out : undefined;
}

// ── storefront → DB ─────────────────────────────────────────────────────────

/** Drop undefined / empty-string keys so `metadata` stays tidy in Postgres. */
function compactMetadata(meta: ProductMetadata): ProductMetadata {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as ProductMetadata;
}

/**
 * Build the DB write payload from a (already-normalized) storefront product.
 * `currencyIso` is stored on the column; `displaySymbol` is parked in metadata
 * so the exact symbol the owner typed survives the round-trip.
 */
export function productToDbWrite(
  p: Product,
  currencyIso: string,
  displaySymbol: string,
): ProductDbWrite {
  const available = p.available !== false;
  const discountEnabled = !!p.discountEnabled;
  return {
    name: p.name.trim(),
    description: p.description?.trim() ? p.description.trim() : null,
    priceCents: Math.max(0, Math.round((Number(p.price) || 0) * 100)),
    currency: currencyIso,
    stock: Math.max(0, Math.round(Number(p.stock) || 0)),
    status: available ? "active" : "draft",
    active: available,
    images: p.image ? [p.image] : [],
    metadata: compactMetadata({
      purity: p.purity || undefined,
      category: p.category || undefined,
      sortCategory: p.sortCategory || undefined,
      featured: !!p.featured,
      discountEnabled,
      discountPrice: discountEnabled ? Number(p.discountPrice) || 0 : undefined,
      isSet: !!p.isSet,
      inclusions: p.isSet && Array.isArray(p.inclusions) ? p.inclusions : undefined,
      molecularWeight: p.molecularWeight || undefined,
      cas: p.cas || undefined,
      storage: p.storage || undefined,
      sequence: p.sequence || undefined,
      sizes: p.sizes || undefined,
      variations: cleanVariations(p.variations, p.productType === "gb"),
      productClass: toProductClass(p.productClass),
      currencySymbol: displaySymbol || undefined,
      reseller: cleanReseller(p.reseller),
      wholesale: cleanWholesale(p.wholesale),
      productType: p.productType === "gb" ? "gb" : undefined,
      gbPrice:
        p.productType === "gb" && Number(p.gbPrice) > 0 ? Number(p.gbPrice) : undefined,
      // Only the restrictive value persists; compactMetadata keeps `false`.
      purchasable: p.purchasable === false ? false : undefined,
      priceOnRequest: p.priceOnRequest ? true : undefined,
      freeShipping: p.freeShipping ? true : undefined,
      madeToOrder: p.madeToOrder ? true : undefined,
    }),
  };
}

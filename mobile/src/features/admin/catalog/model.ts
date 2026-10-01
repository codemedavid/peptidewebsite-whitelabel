import type { AdminBrand } from "@/features/admin/bridge";

/**
 * The catalog's shapes and rules, as the website admin sees them.
 *
 * The app can't import from the website's src/, so the handful of PURE rules
 * the website admin applies client-side are re-derived here, each one naming
 * its source. The server re-normalizes every save, so a drift here can only
 * ever mis-show a field — never store something the website wouldn't.
 */

// ── shapes (src/storefront/types.ts) ─────────────────────────────────────────

export type Category = { id: string; label: string };

export type Variation = { name: string; price: number; stock?: number; gbPrice?: number; image?: string; extraImages?: string[] };

/** A product exactly as listProductsAction / saveProductAction return it. */
export type CatalogProduct = {
  id: string;
  slug?: string | null;
  name: string;
  description: string;
  price: number;
  currency: string;
  purity?: string;
  category: string;
  sortCategory?: string;
  featured: boolean;
  image: string | null;
  /** Further photos after `image` — edited on the website, carried through here. */
  extraImages?: string[];
  stock?: number;
  available?: boolean;
  discountPrice?: number | null;
  discountEnabled?: boolean;
  isSet?: boolean;
  inclusions?: { name: string; qty: number }[];
  molecularWeight?: string;
  cas?: string;
  storage?: string;
  sequence?: string;
  sizes?: string;
  variations?: Variation[];
  reseller?: { vialsOnly?: number; completeSet?: number; minQty?: number };
  wholesale?: { enabled: boolean; moq: number; price: number };
  productType?: "gb" | "onhand";
  gbPrice?: number;
  purchasable?: boolean;
  priceOnRequest?: boolean;
  freeShipping?: boolean;
  madeToOrder?: boolean;
  productClass?: ProductClass;
};

export type ProductClass = "peptide" | "bacWater" | "other";

export type SortCategoryKind = "featured" | "name" | "price-asc" | "price-desc" | "best-sellers" | "newest" | "group";

export type SortCategory = { id: string; label: string; kind: SortCategoryKind; enabled: boolean };

// ── categories (src/lib/storefront/categories.ts, src/storefront/data.ts) ────

/** The synthetic storefront filter tab — a filter, never an assignable category. */
export const ALL_CATEGORY_ID = "all";
export const ALL_CATEGORY: Category = { id: ALL_CATEGORY_ID, label: "All Products" };
const UNCATEGORIZED: Category = { id: "uncategorized", label: "Uncategorized" };

/** What the website shows until the owner saves categories once (SEED_CATEGORIES). */
const SEED_CATEGORIES: Category[] = [
  ALL_CATEGORY,
  { id: "peptides", label: "Peptides" },
  { id: "weight", label: "Weight Management" },
  { id: "beauty", label: "Beauty & Anti-Aging" },
  { id: "wellness", label: "Wellness & Vitality" },
  { id: "glp1", label: "GLP-1 Agonists" },
  { id: "insulin", label: "Insulin Pens" },
];

function isCategory(v: unknown): v is Category {
  return !!v && typeof v === "object" && typeof (v as Category).id === "string" && typeof (v as Category).label === "string";
}

/** brand.categories ?? SEED_CATEGORIES — the website store's seed rule. */
export function brandCategories(brand: AdminBrand): Category[] {
  return Array.isArray(brand.categories) ? brand.categories.filter(isCategory) : SEED_CATEGORIES;
}

/** The categories a product can be ASSIGNED to (resolveSelectableCategories). */
export function selectableCategories(categories: readonly Category[]): Category[] {
  const real = categories.filter((c) => !!c.id && c.id !== ALL_CATEGORY_ID);
  return real.length > 0 ? real : [UNCATEGORIZED];
}

// ── sort categories (src/lib/storefront/sort-categories.ts) ──────────────────

const KINDS: readonly SortCategoryKind[] = ["featured", "name", "price-asc", "price-desc", "best-sellers", "newest", "group"];

const DEFAULT_SORT: readonly SortCategory[] = [
  { id: "featured", label: "Sort: Featured", kind: "featured", enabled: true },
  { id: "name", label: "Sort: Name", kind: "name", enabled: true },
  { id: "price-asc", label: "Price: Low to High", kind: "price-asc", enabled: true },
  { id: "price-desc", label: "Price: High to Low", kind: "price-desc", enabled: true },
];

const SIMPLE_SORT: readonly SortCategory[] = [
  { id: "featured", label: "Sort: Featured", kind: "featured", enabled: true },
  { id: "name", label: "Sort by Name", kind: "name", enabled: true },
  { id: "price-asc", label: "Sort by Price", kind: "price-asc", enabled: true },
  { id: "best", label: "Sort by Best Sellers", kind: "best-sellers", enabled: true },
];

const clone = (list: readonly SortCategory[]) => list.map((c) => ({ ...c }));

/** Drop malformed rows, keep the first of a duplicate id, never return empty. */
export function normalizeSortCategories(raw: unknown): SortCategory[] {
  if (!Array.isArray(raw)) return clone(DEFAULT_SORT);
  const seen = new Set<string>();
  const out: SortCategory[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Partial<SortCategory>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (!id || seen.has(id) || !KINDS.includes(r.kind as SortCategoryKind)) continue;
    seen.add(id);
    const label = typeof r.label === "string" ? r.label.trim() : "";
    out.push({ id, label: label || id, kind: r.kind as SortCategoryKind, enabled: r.enabled !== false });
  }
  return out.length > 0 ? out : clone(DEFAULT_SORT);
}

/** Never saved → seeded from the legacy catalogSortStyle (the website store's rule). */
export function brandSortCategories(brand: AdminBrand): SortCategory[] {
  const seed = brand.catalogSortStyle === "simple" ? SIMPLE_SORT : DEFAULT_SORT;
  return normalizeSortCategories(brand.sortCategories ?? clone(seed));
}

/** Groups a product can be filed under: enabled groups only (built-ins are behaviours). */
export function assignableSortCategories(list: readonly SortCategory[]): SortCategory[] {
  return list.filter((c) => c.enabled && c.kind === "group");
}

export const BUILT_IN_KINDS: { kind: Exclude<SortCategoryKind, "group">; label: string }[] = [
  { kind: "featured", label: "Featured" },
  { kind: "name", label: "Name (A–Z)" },
  { kind: "price-asc", label: "Price: Low to High" },
  { kind: "price-desc", label: "Price: High to Low" },
  { kind: "best-sellers", label: "Best Sellers" },
  { kind: "newest", label: "New Arrivals" },
];

export const sortKindLabel = (kind: SortCategoryKind): string =>
  BUILT_IN_KINDS.find((k) => k.kind === kind)?.label ?? "Product group";

/** Same id recipe as the website: a random suffix so two quick adds can't collide. */
export const newRowId = (prefix: string): string => `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

// ── product order (src/lib/storefront/product-order.ts) ──────────────────────

/**
 * Move `id` by `delta` places (negative = up), clamped to the list ends — the
 * website's moveProduct. The list the app sends is saved as
 * branding.config.productOrder, the same arrangement Admin → Products edits.
 */
export function moveProduct(order: readonly string[], id: string, delta: number): string[] {
  const from = order.indexOf(id);
  if (from < 0) return [...order];
  const to = Math.max(0, Math.min(order.length - 1, from + delta));
  const next = order.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}

// ── entitlement gates (src/storefront/visibility.ts) ─────────────────────────
// Re-derived from the same brand flags, failing closed exactly as the website does.

/** isGroupBuyPricingVisible — the Group Buy module; undefined = OFF. */
export const groupBuyVisible = (brand: AdminBrand): boolean =>
  (brand.groupBuyCaps as { enabled?: unknown } | undefined)?.enabled === true;

/** isWholesalePricingVisible — the MOQ child entitlement; undefined = OFF. */
export const wholesaleVisible = (brand: AdminBrand): boolean => brand.wholesalePricing === true;

/** isResellerPricingVisible — only an explicit `false` hides it. */
export const resellerVisible = (brand: AdminBrand): boolean => brand.resellerPricingEditable !== false;

/** The "Made to order" checkbox renders only when the operator granted it. */
export const madeToOrderVisible = (brand: AdminBrand): boolean => brand.madeToOrderEntitled === true;

/** The storefront's default reseller minimum (src/lib/storefront/wholesale.ts). */
export const RESELLER_MIN_QTY = 10;

/** brand.currency || "₱" — what every website admin screen passes as the display symbol. */
export const brandSymbol = (brand: AdminBrand): string =>
  typeof brand.currency === "string" && brand.currency ? brand.currency : "₱";

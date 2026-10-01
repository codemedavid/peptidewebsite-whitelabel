import type { ShopCatalog, ShopProduct } from "@shop-contract";

/**
 * Catalog view rules for the in-app shop. Pure (no React Native), so
 * `npm run test:mobile-shop-core` runs it from the repo root.
 *
 * Every price here is one the SERVER computed (ShopProduct / ShopVariation);
 * this file only picks which one to show — it never derives a price.
 */

/** Hard cap on one line's quantity (the server's MAX_QTY). */
export const MAX_LINE_QTY = 999;
/** At or below this many units a product reads "Only N left". */
export const LOW_STOCK_AT = 5;

/** One buyable choice: the base option, or a named variation. */
export type ShopOption = {
  /** Stable key for the picker ("" = the base option). */
  key: string;
  label: string;
  /** Variation NAME sent to the server; undefined for the base option. */
  variation?: string;
  price: number;
  compareAtPrice: number | null;
  stock: number | null;
  image: string | null;
  soldOut: boolean;
};

export const BASE_KEY = "";

export function optionsFor(p: ShopProduct): ShopOption[] {
  const base: ShopOption = {
    key: BASE_KEY,
    label: p.variations.length > 0 ? "Standard" : p.name,
    price: p.price,
    compareAtPrice: p.compareAtPrice,
    stock: p.stock,
    image: p.image,
    soldOut: p.stock !== null && p.stock <= 0,
  };
  const variations: ShopOption[] = p.variations.map((v) => ({
    key: `v:${v.name}`,
    label: v.name,
    variation: v.name,
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    stock: v.stock,
    image: v.image,
    soldOut: v.stock !== null && v.stock <= 0,
  }));
  return p.baseSelectable || variations.length === 0 ? [base, ...variations] : variations;
}

/** The option a product page opens on: the first one in stock, else the first. */
export function defaultOption(p: ShopProduct): ShopOption | null {
  const all = optionsFor(p);
  return all.find((o) => !o.soldOut) ?? all[0] ?? null;
}

export function findOption(p: ShopProduct, variation: string | undefined): ShopOption | null {
  return optionsFor(p).find((o) => o.variation === variation) ?? null;
}

/** Largest quantity one cart line may hold for this option. */
export function maxQtyFor(option: Pick<ShopOption, "stock">): number {
  if (option.stock === null) return MAX_LINE_QTY;
  return Math.max(0, Math.min(MAX_LINE_QTY, Math.floor(option.stock)));
}

export type StockState = { kind: "out" | "low" | "in" | "untracked"; label: string };

export function stockState(stock: number | null): StockState {
  if (stock === null) return { kind: "untracked", label: "Made to order" };
  if (stock <= 0) return { kind: "out", label: "Sold out" };
  if (stock <= LOW_STOCK_AT) return { kind: "low", label: `Only ${stock} left` };
  return { kind: "in", label: "In stock" };
}

/** True when a struck-through "was" price should show. */
export function isMarkedDown(price: number, compareAtPrice: number | null): compareAtPrice is number {
  return compareAtPrice !== null && compareAtPrice > price;
}

/** What a product card shows: the lowest price among its options ("From" when they differ). */
export function cardPrice(p: ShopProduct): { price: number; compareAtPrice: number | null; from: boolean } {
  const options = optionsFor(p);
  if (options.length <= 1) {
    const o = options[0];
    return { price: o?.price ?? p.price, compareAtPrice: o?.compareAtPrice ?? p.compareAtPrice, from: false };
  }
  const cheapest = options.reduce((a, b) => (b.price < a.price ? b : a));
  const differ = options.some((o) => o.price !== cheapest.price);
  return { price: cheapest.price, compareAtPrice: cheapest.compareAtPrice, from: differ };
}

/** Gallery images, de-duplicated; the chosen option's own photo first. */
export function galleryFor(p: ShopProduct, option?: ShopOption | null): string[] {
  const ordered = [option?.image ?? null, p.image, ...p.extraImages];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const src of ordered) {
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  return out;
}

/** Everything a product is sold out on (no option left to buy). */
export function isSoldOut(p: ShopProduct): boolean {
  return optionsFor(p).every((o) => o.soldOut);
}

/** How many products the community Chats "From the shop" row shows. */
export const RAIL_LIMIT = 12;

/** The Chats product row: what a member can buy right now, in the owner's order. */
export function railProducts(products: ShopProduct[], limit = RAIL_LIMIT): ShopProduct[] {
  return products.filter((p) => p.purchasable && !isSoldOut(p)).slice(0, limit);
}

/** "All" chip plus only the categories that actually hold a product. */
export function categoryChips(catalog: Pick<ShopCatalog, "categories" | "products">): { key: string; label: string }[] {
  const used = new Set(catalog.products.map((p) => p.category));
  return [{ key: "all", label: "All" }, ...catalog.categories.filter((c) => used.has(c.id)).map((c) => ({ key: c.id, label: c.label }))];
}

/** Search by name/description words + category chip. Order is the owner's. */
export function filterProducts(products: ShopProduct[], query: string, category: string): ShopProduct[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return products.filter((p) => {
    if (category !== "all" && p.category !== category) return false;
    if (words.length === 0) return true;
    const hay = `${p.name} ${p.variations.map((v) => v.name).join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ── images ───────────────────────────────────────────────────────────────────

const IMAGEKIT = /^https:\/\/ik\.imagekit\.io\//i;
const HAS_TRANSFORM = /[?&]tr=/;

/**
 * Size an ImageKit URL to its box (same rule as src/lib/media/image-url.ts):
 * only https ImageKit URLs without a transform are rewritten; everything else
 * (data:, foreign hosts) passes through untouched. String rules, not `URL` —
 * React Native's URL has no hostname/searchParams.
 */
export function sizedImage(src: string | null | undefined, width: number): string | null {
  if (!src) return null;
  if (!IMAGEKIT.test(src)) return src;
  const hashAt = src.indexOf("#");
  const bare = hashAt === -1 ? src : src.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : src.slice(hashAt);
  if (HAS_TRANSFORM.test(bare)) return src;
  const sep = bare.includes("?") ? "&" : "?";
  return `${bare}${sep}tr=w-${Math.round(width)},q-75,f-auto${hash}`;
}

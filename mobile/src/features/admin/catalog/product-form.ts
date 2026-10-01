import { RESELLER_MIN_QTY, type CatalogProduct, type ProductClass, type Variation } from "./model";

/**
 * The product editor's form state and the exact payload saveProductAction
 * expects — a line-for-line port of AdminAddProduct.tsx's state seeding and
 * `save()` (src/storefront/admin/). Numbers stay strings while editing so a
 * field can be cleared; `toSavePayload` coerces them the way the website does.
 *
 * The payload is the WHOLE product: a key left out reads as "cleared" on the
 * server, so fields this form has no control for (purchasable, priceOnRequest,
 * sizes, per-option group prices) are carried through from the loaded product.
 */

export type InclusionDraft = { name: string; qty: string };

export type VariationDraft = {
  name: string;
  price: string;
  stock: string;
  gbPrice: string;
  image: string;
  /** Photos beyond the main one, in gallery order. */
  extraImages?: string[];
};

export type ProductDraft = {
  name: string;
  description: string;
  category: string;
  sortCategory: string;
  price: string;
  purity: string;
  molecularWeight: string;
  cas: string;
  storage: string;
  sequence: string;
  productClass: "" | ProductClass;
  isSet: boolean;
  inclusions: InclusionDraft[];
  variations: VariationDraft[];
  stock: string;
  featured: boolean;
  available: boolean;
  freeShipping: boolean;
  madeToOrder: boolean;
  discountOn: boolean;
  discount: string;
  isGroupBuy: boolean;
  gbPrice: string;
  resellerVials: string;
  resellerSet: string;
  resellerMin: string;
  wholesaleOn: boolean;
  wholesaleMoq: string;
  wholesalePrice: string;
  image: string;
  /** The product's photos beyond the main one, in gallery order. */
  extraImages: string[];
};

const s = (n: number | null | undefined): string => (typeof n === "number" && Number.isFinite(n) ? String(n) : "");
/** Number(v) || 0 — the website's coercion for every numeric field. */
export const toNum = (v: string): number => Number(v) || 0;

export const PRODUCT_CLASSES: { value: "" | ProductClass; label: string }[] = [
  { value: "", label: "Auto (detect by name)" },
  { value: "peptide", label: "Peptide" },
  { value: "bacWater", label: "Bacteriostatic water" },
  { value: "other", label: "Other (accessory)" },
];

/** Seed the form from a product (or blank for a new one) — the website's useState defaults. */
export function draftFromProduct(p: CatalogProduct | null, firstCategoryId: string): ProductDraft {
  return {
    name: p?.name ?? "",
    description: p?.description ?? "",
    category: p?.category || firstCategoryId,
    sortCategory: p?.sortCategory ?? "",
    price: s(p?.price ?? 0),
    // Scientific details are not editable in the app; existing values round-trip.
    purity: p?.purity?.replace("%", "") || "",
    molecularWeight: p?.molecularWeight ?? "",
    cas: p?.cas ?? "",
    storage: p?.storage ?? "",
    sequence: p?.sequence ?? "",
    productClass: p?.productClass ?? "",
    isSet: p?.isSet === true,
    inclusions: (p?.inclusions ?? []).map((i) => ({ name: i.name, qty: String(i.qty) })),
    variations: (p?.variations ?? []).map((v) => ({
      name: v.name,
      price: s(v.price),
      stock: s(v.stock),
      gbPrice: s(v.gbPrice),
      image: v.image ?? "",
      ...(v.extraImages?.length ? { extraImages: v.extraImages } : {}),
    })),
    stock: s(p?.stock ?? 0),
    featured: p?.featured === true,
    available: p?.available !== false,
    freeShipping: p?.freeShipping === true,
    // Seeded from the product even when the owner isn't entitled, so an edit
    // saves the flag back unchanged instead of silently clearing it.
    madeToOrder: p?.madeToOrder === true,
    discountOn: p?.discountEnabled === true,
    discount: s(p?.discountPrice ?? 0),
    isGroupBuy: p?.productType === "gb",
    gbPrice: s(p?.gbPrice ?? 0),
    resellerVials: s(p?.reseller?.vialsOnly ?? 0),
    resellerSet: s(p?.reseller?.completeSet ?? 0),
    resellerMin: s(p?.reseller?.minQty ?? RESELLER_MIN_QTY),
    // Never auto-enabled: a product with no rule starts OFF.
    wholesaleOn: p?.wholesale?.enabled === true,
    wholesaleMoq: s(p?.wholesale?.moq),
    wholesalePrice: s(p?.wholesale?.price),
    image: p?.image ?? "",
    extraImages: p?.extraImages ?? [],
  };
}

/**
 * Extras allowed per product or variation — src/lib/storefront/product-photos.ts
 * MAX_PHOTOS_PER_ITEM (10) minus the main photo. The server re-caps anyway.
 */
export const MAX_EXTRA_PHOTOS = 9;

/**
 * Promote an extra photo to main; the old main moves into the extras in its
 * place (AdminAddProduct's onMakeMain). A local data: preview is never kept.
 */
export function makeMainPhoto(main: string, extras: readonly string[], url: string): { image: string; extraImages: string[] } {
  const keepMain = main && !main.startsWith("data:") ? [main] : [];
  return { image: url, extraImages: [...keepMain, ...extras.filter((u) => u !== url)] };
}

/** Named options with no positive price — they'd sell for free (unpricedVariationNames). */
export function unpricedVariationNames(items: readonly VariationDraft[]): string[] {
  return items
    .filter((it) => it.name.trim() !== "")
    .filter((it) => {
      const price = it.price.trim();
      if (price === "") return true;
      const n = Number(price);
      return !Number.isFinite(n) || n <= 0;
    })
    .map((it) => it.name.trim());
}

/** An enabled wholesale rule needs BOTH a positive MOQ and price, or save is blocked. */
export function wholesaleError(d: ProductDraft): string {
  if (!d.wholesaleOn) return "";
  if (toNum(d.wholesaleMoq) <= 0) return "Set a minimum order quantity above 0 to turn wholesale pricing on.";
  if (toNum(d.wholesalePrice) <= 0) return "Set a wholesale price above 0 to turn wholesale pricing on.";
  return "";
}

/** A wholesale price at or above the cheapest retail price saves, but never applies. */
export function wholesaleWarning(d: ProductDraft, fmt: (n: number) => string): string {
  if (!d.wholesaleOn || wholesaleError(d)) return "";
  const variationPrices = d.variations.map((v) => toNum(v.price)).filter((n) => n > 0);
  const lowest = variationPrices.length ? Math.min(...variationPrices) : toNum(d.price);
  if (lowest <= 0 || toNum(d.wholesalePrice) < lowest) return "";
  return variationPrices.length
    ? `This is not below the ${fmt(lowest)} cheapest option price, so it will never apply to that option.`
    : `This is not below the ${fmt(lowest)} retail price, so it will never apply.`;
}

/** Why Save is unavailable, in the order a seller would fix it. Empty = can save. */
export function saveBlockers(d: ProductDraft): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push("Add a product name.");
  if (!d.description.trim()) out.push("Add a description.");
  if (!d.category) out.push("Choose a category.");
  if (!(Number(d.price) >= 0)) out.push("Enter a valid base price.");
  const unpriced = unpricedVariationNames(d.variations);
  if (unpriced.length) out.push(`Set a price for ${unpriced.join(", ")} — an option without a price would be sold for free.`);
  const w = wholesaleError(d);
  if (w) out.push(w);
  return out;
}

/** Build the saveProductAction payload — the website's `save()` object, key for key. */
export function toSavePayload(d: ProductDraft, initial: CatalogProduct | null, currency: string): CatalogProduct {
  const variations = d.variations
    .map((v): Variation => {
      const base: Variation = { name: v.name.trim(), price: toNum(v.price) };
      // Blank stock = shares the base stock (no key); a number tracks its own.
      const withStock = v.stock.trim() !== "" ? { ...base, stock: Math.max(0, Math.floor(toNum(v.stock))) } : base;
      // The option's group price rides along only when positive — the server's
      // rule. The website editor has no control for it (Group Buys → Pricing
      // sets it) and its payload drops it; we carry it so an edit here can't
      // wipe a price set there.
      const gb = toNum(v.gbPrice);
      const withGb = gb > 0 ? { ...withStock, gbPrice: gb } : withStock;
      const image = v.image.trim();
      const withImage = image ? { ...withGb, image } : withGb;
      // The server rebuilds each variation from the payload, so the extras
      // must ride along or they'd be erased.
      return v.extraImages?.length ? { ...withImage, extraImages: v.extraImages } : withImage;
    })
    .filter((v) => v.name);

  return {
    // A temporary id on create, as on the website: the server treats an id it
    // can't find as a create and returns the real one.
    id: initial?.id || `p${Date.now()}`,
    name: d.name.trim(),
    description: d.description.trim(),
    category: d.category,
    ...(d.sortCategory ? { sortCategory: d.sortCategory } : {}),
    price: toNum(d.price),
    currency,
    purity: d.purity ? `${d.purity}%` : "",
    molecularWeight: d.molecularWeight,
    cas: d.cas,
    storage: d.storage,
    sequence: d.sequence,
    // Not editable on the website form, but the server rebuilds metadata from
    // the payload — omitting it would erase a legacy "sizes" label.
    ...(initial?.sizes ? { sizes: initial.sizes } : {}),
    ...(d.productClass ? { productClass: d.productClass } : {}),
    isSet: d.isSet,
    inclusions: d.inclusions.map((i) => ({ name: i.name, qty: Number(i.qty) || 1 })),
    variations,
    stock: toNum(d.stock),
    featured: d.featured,
    available: d.available,
    freeShipping: d.freeShipping,
    madeToOrder: d.madeToOrder,
    discountPrice: d.discountOn ? toNum(d.discount) : 0,
    discountEnabled: d.discountOn,
    productType: d.isGroupBuy ? "gb" : "onhand",
    gbPrice: d.isGroupBuy ? toNum(d.gbPrice) : 0,
    // Carried through untouched — set in Group Buys → Pricing, never here.
    purchasable: initial?.purchasable !== false,
    priceOnRequest: initial?.priceOnRequest === true,
    reseller: { vialsOnly: toNum(d.resellerVials), completeSet: toNum(d.resellerSet), minQty: toNum(d.resellerMin) },
    // Sent whole so the numbers round-trip while the toggle is off.
    wholesale: { enabled: d.wholesaleOn, moq: toNum(d.wholesaleMoq), price: toNum(d.wholesalePrice) },
    image: d.image || null,
    extraImages: d.extraImages,
  };
}

/**
 * Photos added while there's no main photo: the first becomes main, so a
 * product never has photos yet shows none on its card.
 */
export function withMainPhoto(main: string, extras: string[]): { image: string; extraImages: string[] } {
  if (main || !extras.length) return { image: main, extraImages: extras };
  const [first, ...rest] = extras;
  return { image: first, extraImages: rest };
}

// ── variation presets (src/storefront/admin/variation-presets.ts) ────────────

export const VARIATION_PRESETS = ["Vials only", "Complete set"] as const;

const norm = (name: string) => name.trim().toLowerCase();

export const blankVariation = (name = ""): VariationDraft => ({ name, price: "", stock: "", gbPrice: "", image: "" });

/** Add a preset once: names a blank row if there is one, else appends. */
export function applyVariationPreset(items: readonly VariationDraft[], preset: string): VariationDraft[] {
  if (items.some((it) => norm(it.name) === norm(preset))) return [...items];
  const blank = items.findIndex((it) => norm(it.name) === "");
  if (blank !== -1) return items.map((it, i) => (i === blank ? { ...it, name: preset } : it));
  return [...items, blankVariation(preset)];
}

/**
 * Spread a batch of uploaded photos across the options: by FILENAME first
 * ("silk-barbie.jpg" → "Silk Barbie"), then filling rows that still have no
 * photo, in order. Never overwrites a photo the seller already placed.
 */
export function assignVariationImages(
  items: readonly VariationDraft[],
  uploads: readonly { fileName: string; url: string }[],
): VariationDraft[] {
  const key = (v: string) => v.replace(/\.[a-z0-9]+$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const next = items.map((it) => ({ ...it }));
  const claimed = new Set<number>();
  const leftovers: string[] = [];
  for (const upload of uploads) {
    const wanted = key(upload.fileName);
    const at = next.findIndex((it, i) => !claimed.has(i) && it.name.trim() !== "" && key(it.name) === wanted);
    if (at === -1) {
      leftovers.push(upload.url);
      continue;
    }
    next[at] = { ...next[at], image: upload.url };
    claimed.add(at);
  }
  for (const url of leftovers) {
    const at = next.findIndex((it, i) => !claimed.has(i) && it.name.trim() !== "" && !it.image.trim());
    if (at === -1) break;
    next[at] = { ...next[at], image: url };
    claimed.add(at);
  }
  return next;
}

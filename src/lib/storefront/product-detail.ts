// Pure view model for the storefront product "quick view" detail modal.
//
// The product card is deliberately compact — a 2-line clamped description plus
// the buy controls — so a customer who wants the full description or the spec
// sheet (molecular weight, CAS, sequence, storage, sizes) the seller filled in
// had nowhere to read it. Clicking a card now opens a modal built from this
// model. Kept pure (no DB, no React) and shared so the modal and its tests read
// the exact same "what does the detail show" rules the card already uses for
// image resolution and options. Covered by scripts/test-product-detail.ts.

import type { Product } from "@/storefront/types";
import { resolveProductImage } from "./product-image";
import {
  buildProductOptions,
  shouldShowOptionPicker,
  type ProductOption,
} from "./variations";

/** One labelled line of the modal's spec sheet, e.g. "CAS Number → 2023788-19-2". */
export type ProductSpecRow = { label: string; value: string };

/** The technical fields a peptide seller may fill in, in the order the modal
 *  lists them. Only the ones with a real value are shown — a blank "CAS: —"
 *  row reads as missing data, not "not applicable". */
const SPEC_FIELDS: { key: keyof Product; label: string }[] = [
  { key: "molecularWeight", label: "Molecular Weight" },
  { key: "cas", label: "CAS Number" },
  { key: "sequence", label: "Sequence" },
  { key: "storage", label: "Storage" },
  { key: "sizes", label: "Sizes" },
];

/**
 * The present-only spec rows for a product, in canonical field order.
 *
 * A field the seller left blank (or whitespace-only) is dropped rather than
 * shown as an empty row, and each value is trimmed so stray padding never leaks
 * into the modal.
 */
export function productSpecRows(product: Product): ProductSpecRow[] {
  return SPEC_FIELDS.flatMap(({ key, label }) => {
    const raw = product[key];
    const value = typeof raw === "string" ? raw.trim() : "";
    return value ? [{ label, value }] : [];
  });
}

/** Everything the quick-view modal renders, resolved once from the product. */
export type ProductDetail = {
  id: string;
  name: string;
  /** Full, un-clamped description — the card's whole reason to be clickable. */
  description: string;
  image: string | null;
  currency: string;
  basePrice: number;
  /** Options a customer picks between (reuses the card's buildProductOptions so
   *  the modal and card never disagree on price/variation). Empty = single price. */
  options: ProductOption[];
  showOptions: boolean;
  purity: string | null;
  /** On hand but no fixed price — the modal hides the price and blocks buying. */
  priceOnRequest: boolean;
  /** Clamped to ≥ 0 so the stepper/CTA never see a negative stock. */
  stock: number;
  outOfStock: boolean;
  specs: ProductSpecRow[];
};

/**
 * Build the detail view model. `defaultImage` is the brand's fallback photo
 * (brand.defaultProductImage) shown when the product has none of its own —
 * resolved through the same resolveProductImage the card uses.
 */
export function buildProductDetail(
  product: Product,
  defaultImage?: string | null,
): ProductDetail {
  const stock = Math.max(0, product.stock || 0);
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    image: resolveProductImage(product.image, defaultImage),
    currency: product.currency,
    basePrice: product.price,
    options: buildProductOptions(product),
    showOptions: shouldShowOptionPicker(product),
    purity: product.purity ?? null,
    priceOnRequest: product.priceOnRequest === true,
    stock,
    outOfStock: stock <= 0,
    specs: productSpecRows(product),
  };
}

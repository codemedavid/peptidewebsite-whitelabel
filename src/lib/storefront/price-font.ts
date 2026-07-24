// Price font — the typeface prices render in.
//
// Prices used to inherit the heading/display font (.font-display →
// --brand-heading-font), so on the default theme they showed as serif numerals.
// They now have their own token, --brand-price-font, which defaults to the body
// (sans) font for every tenant and can be pinned per tenant via Brand.priceFont.
//
// applyBrandStyle (store.tsx) only WRITES the var when priceFont is explicitly
// set; when unset it removes the var so the CSS default
// (--brand-price-font: var(--brand-body-font)) applies. This mirrors buttonFont.

import type { Brand } from "@/storefront/types";

/** The effective price family: an explicit priceFont, else the body font, else
 *  a safe "Inter" fallback (matches the CSS body-font default). */
export function resolvePriceFont(brand: Pick<Brand, "priceFont" | "bodyFont">): string {
  const priceFont = (brand.priceFont ?? "").trim();
  if (priceFont) return priceFont;
  const bodyFont = (brand.bodyFont ?? "").trim();
  return bodyFont || "Inter";
}

/** The value to write to --brand-price-font, or null when nothing should be
 *  written (unset/blank) so the CSS body-font default keeps applying. */
export function priceFontVar(brand: Pick<Brand, "priceFont">): string | null {
  const priceFont = (brand.priceFont ?? "").trim();
  return priceFont ? `"${priceFont}", system-ui, sans-serif` : null;
}

// The slides behind the product card's swipeable image gallery.
//
// WHY (mstomato, 2026-08-28): variations are not always doses. That tenant sells
// vial cases, caps and spacers in colorways — "Silk Barbie", "Trans. Ocean",
// "Roseberry" — up to 81 per product. A name-only option pill tells a customer
// nothing about what they are buying, so a seller can now attach a photo to each
// variation and the card turns those photos into a gallery: swipe to a photo and
// that variation is selected; tap a pill and the gallery scrolls to its photo.
//
// Pure (no React, no DB) and shared, so the card and the detail modal build the
// same slides from the same rules — the same reason buildProductOptions lives in
// ./variations. Covered by scripts/test-variation-gallery.ts.

import { buildProductOptions, type Variation } from "./variations";
import { normalizeHostedImageUrl, resolveProductImage } from "./product-image";

/** One image in the card's gallery. */
export type GallerySlide = {
  /** A hosted http(s) URL, ready for imageUrl()/imageSrcSet(). */
  src: string;
  /**
   * Which option this slide shows, as an index into `buildProductOptions()` —
   * NOT into `product.variations`. The two differ by one whenever a distinct
   * base price makes buildProductOptions prepend "Standard", and the card feeds
   * this straight to setOptIdx, so using the raw variation index would sell the
   * customer the colorway next to the one they swiped to.
   *
   * `null` on the base product photo, which names no option.
   */
  optionIndex: number | null;
  /** Alt text / dot label: the option's name, or the product's on the base slide. */
  label: string;
};

/** Just the fields the gallery reads — keeps this module off the full `Product`
 *  type, exactly as `OptionSource` does in ./variations. */
type GallerySource = {
  name: string;
  image?: string | null;
  price: number;
  variations?: Variation[];
};

/**
 * Build the ordered slide list for a product.
 *
 * The base photo (the product's own, else the brand default) leads and selects
 * nothing, so a card mounting on slide 0 does not silently pick an option and
 * reveal a price the customer never asked for — the rule that
 * scripts/test-variation-price-reveal.ts guards.
 *
 * Then one slide per variation that actually HAS a usable photo. Variations
 * without one are skipped rather than given a blank slide, and skipping them
 * does not renumber the ones after: each slide keeps the option index it really
 * belongs to. A product whose variations carry no photos therefore yields at
 * most one slide, and the card renders as it always has — no track, no dots.
 *
 * Only http(s) URLs survive. These come from tenant-editable JSON and land in an
 * <img src>, so they get the same normalization as the brand default photo.
 */
export function buildProductGallery(
  product: GallerySource,
  defaultImage?: string | null,
): GallerySlide[] {
  const base = resolveProductImage(product.image, defaultImage);

  const variationSlides = buildProductOptions(product).flatMap((option, index) => {
    const src = normalizeHostedImageUrl(option.variation?.image);
    return src ? [{ src, optionIndex: index, label: option.name }] : [];
  });

  return [
    ...(base ? [{ src: base, optionIndex: null, label: product.name }] : []),
    ...variationSlides,
  ];
}

/**
 * Is there anything to swipe between?
 *
 * One slide is just the product photo the card has always shown, so the gallery
 * chrome — the scroll track, the dots, the arrows, the IntersectionObserver —
 * is only worth mounting from two slides up. This is the switch that keeps every
 * tenant without per-variation photos on exactly the markup they have today.
 */
export function hasGallery(slides: readonly GallerySlide[]): boolean {
  return slides.length > 1;
}

/**
 * Customer testimonials pure core.
 *
 * A store's reviews (branding.config.reviews) are written in the storefront
 * #admin → Reviews manager and persisted server-side through saveReviewsAction.
 * They used to live ONLY in the editing browser's localStorage, so an owner's
 * real testimonials never left that device and every customer saw the generic
 * SEED_REVIEWS samples instead — the same cross-device bug already fixed for
 * COA, FAQ, protocols, promo codes and payment methods. This module is the
 * single sanitizer the save action runs at the trust boundary.
 *
 * It also owns the two things the owner controls beyond image + text:
 *
 *   • DESCRIPTION TYPOGRAPHY — each testimonial may override the font family,
 *     size, weight, italic, transform, tracking and color of its description,
 *     layered over a tenant-wide default (Brand.reviewDescStyle). Both reuse the
 *     hero's HeroFieldStyle + heroFieldCss so there is one text-style shape in
 *     the codebase, not two. The font is validated against FONT_REGISTRY and the
 *     color must be a hex literal, so a hostile branding.config can never push
 *     arbitrary CSS into a style attribute.
 *
 *   • PRODUCT LINKS — a testimonial can name SEVERAL products (productIds), and
 *     each named product renders it under its description in the quick-view
 *     detail modal. The pre-existing single `productId` is kept in sync as the
 *     first entry so rows written before multi-connect keep working with no
 *     migration, and any legacy reader still resolves a value.
 *
 * Pure module (no DB, no Next runtime, no browser).
 * Covered by scripts/test-review-content.ts.
 */

import type { CSSProperties } from "react";

import type { Brand, Review } from "@/storefront/types";
import { safeHttpUrl } from "@/lib/storefront/hero-links";
import {
  FONT_REGISTRY,
  FONT_WEIGHTS,
  heroFieldCss,
  type FontWeight,
  type HeroFieldStyle,
  type TextTransform,
} from "@/lib/theme/tokens";

/** Hard caps so a malformed/hostile blob can never bloat branding.config. */
export const MAX_REVIEWS = 200;
export const MAX_REVIEW_TEXT = 600;
export const MAX_REVIEW_PRODUCTS = 20;

/** Readable bounds for an owner-chosen description size, in px. */
export const MIN_REVIEW_FONT_SIZE = 10;
export const MAX_REVIEW_FONT_SIZE = 72;

const TRANSFORMS = new Set<string>(["none", "uppercase", "lowercase", "capitalize"]);
const WEIGHTS = new Set<number>(FONT_WEIGHTS);
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Coerce an untrusted text-style blob into a closed HeroFieldStyle, or
 * undefined when nothing survives.
 *
 * Every attribute is validated against a closed set rather than passed through:
 * these values land in a React `style` object, so an unchecked string is a CSS
 * injection. A font must be a registered family (an unregistered one would also
 * never be loaded, so it could only render as a fallback anyway), and a color
 * must be a hex literal.
 */
export function normalizeReviewDescStyle(input: unknown): HeroFieldStyle | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const o = input as Record<string, unknown>;
  const style: HeroFieldStyle = {};

  const font = String(o.font ?? "").trim();
  if (font && FONT_REGISTRY[font]) style.font = font;

  if (typeof o.size === "number" && Number.isFinite(o.size)) {
    style.size = Math.round(clamp(o.size, MIN_REVIEW_FONT_SIZE, MAX_REVIEW_FONT_SIZE));
  }

  if (typeof o.weight === "number" && WEIGHTS.has(o.weight)) style.weight = o.weight as FontWeight;

  if (typeof o.italic === "boolean") style.italic = o.italic;

  const transform = String(o.transform ?? "").trim();
  if (TRANSFORMS.has(transform)) style.transform = transform as TextTransform;

  if (typeof o.letterSpacing === "number" && Number.isFinite(o.letterSpacing)) {
    style.letterSpacing = clamp(o.letterSpacing, -0.1, 1);
  }

  const color = String(o.color ?? "").trim();
  if (HEX_COLOR.test(color)) style.color = color;

  // An all-empty style is noise — drop it so `descStyle` means "styled".
  return Object.keys(style).length > 0 ? style : undefined;
}

/** Untrusted id list → trimmed, de-duplicated, capped product ids. */
function normalizeProductIds(input: unknown, legacy: string): string[] {
  const list = Array.isArray(input) ? input : [];
  const out: string[] = [];
  const seen = new Set<string>();
  // The legacy single link goes first so a row written before multi-connect
  // keeps its original product at the head of the list.
  [legacy, ...list].forEach((raw) => {
    if (typeof raw !== "string") return;
    const id = raw.trim().slice(0, 60);
    if (!id || seen.has(id) || out.length >= MAX_REVIEW_PRODUCTS) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

/**
 * Coerce untrusted review config into a closed, safe Review[]. Never throws:
 * non-array input and garbage entries collapse away, rows with no text AND no
 * image are dropped (the editor's own save rule — an all-blank row is not
 * content), counts and lengths are capped, ids are made stable so the editor
 * and the storefront agree on identity, and the image is kept http(s)-only so a
 * `javascript:`/`data:` URL can never reach an <img src>.
 */
export function normalizeReviews(input: unknown): Review[] {
  if (!Array.isArray(input)) return [];
  const out: Review[] = [];
  input.slice(0, MAX_REVIEWS).forEach((r, i) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) return;
    const o = r as Record<string, unknown>;

    const text = (v: unknown) => String(v ?? "").trim().slice(0, MAX_REVIEW_TEXT);
    const headline = text(o.headline);
    const title = text(o.title);
    const subtitle = text(o.subtitle);
    const badge = text(o.badge);
    const image = safeHttpUrl(o.image as string | undefined | null);

    // Nothing to show — not a testimonial. Matches the editor's canSave.
    if (!title && !subtitle && !image) return;

    const productIds = normalizeProductIds(o.productIds, String(o.productId ?? ""));
    const descStyle = normalizeReviewDescStyle(o.descStyle);

    out.push({
      id: String(o.id ?? "").trim().slice(0, 60) || `rv-${i}`,
      headline,
      title,
      subtitle,
      badge,
      image,
      // Mirror the first link onto the legacy field so any older reader (and
      // the "for {product}" chip on the reviews page) still resolves a product.
      ...(productIds.length > 0 ? { productId: productIds[0], productIds } : {}),
      ...(descStyle ? { descStyle } : {}),
    });
  });
  return out;
}

/**
 * Every product a testimonial is connected to, de-duplicated.
 *
 * Reads BOTH shapes — the multi-connect `productIds` and the pre-existing single
 * `productId` — so a store whose reviews were written before multi-connect keeps
 * showing them under the right product without a data migration.
 */
export function reviewProductIds(review: Pick<Review, "productId" | "productIds">): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const id = raw.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  push(review.productId);
  (review.productIds ?? []).forEach(push);
  return out;
}

/**
 * The testimonials that belong under one product's description, in the owner's
 * list order. A blank/unknown id yields nothing — never the whole list, which
 * would silently show every store testimonial under a single product.
 */
export function reviewsForProduct(reviews: readonly Review[], productId: string): Review[] {
  const id = (productId ?? "").trim();
  if (!id) return [];
  return reviews.filter((r) => reviewProductIds(r).includes(id));
}

/** The effective description style: the tenant default with the per-review
 *  override merged ON TOP, attribute by attribute. A review that sets only a
 *  weight still inherits the tenant's font. */
export function resolveReviewDescStyle(
  review: Pick<Review, "descStyle">,
  brand: Pick<Brand, "reviewDescStyle">,
): CSSProperties {
  const merged: HeroFieldStyle = { ...(brand.reviewDescStyle ?? {}), ...(review.descStyle ?? {}) };
  return heroFieldCss(Object.keys(merged).length > 0 ? merged : undefined);
}

/**
 * Every font family the reviews surface can render, so the tenant layout can
 * request them alongside the rest of the brand's fonts. A family that is
 * configured but never loaded renders as a silent fallback — the same trap the
 * hero per-field fonts and the price font already guard against.
 */
export function reviewFontFamilies(
  reviews: readonly Review[],
  brand: Pick<Brand, "reviewDescStyle">,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (font?: string) => {
    const f = (font ?? "").trim();
    if (!f || seen.has(f)) return;
    seen.add(f);
    out.push(f);
  };
  push(brand.reviewDescStyle?.font);
  reviews.forEach((r) => push(r.descStyle?.font));
  return out;
}

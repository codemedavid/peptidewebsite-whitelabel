/**
 * Customer-review viewer pure core (click a testimonial → enlarge it).
 *
 * Every review surface used to paint the testimonial into a small fixed box
 * with nothing clickable: the Reviews page cropped it into a 4/5
 * `object-fit: cover` tile, the product quick-view rendered it at 56x56px, and
 * the store-admin manager thumb did the same. That is fine for a portrait shot
 * and useless for what owners actually upload — SCREENSHOTS of customer chats,
 * where the content IS the text inside the picture. Cropped and shrunk, it
 * cannot be read at all, which is what the pepstack-davao owner reported.
 *
 * This module owns the two decisions the surfaces share:
 *
 *   • WHAT THE DIALOG SHOWS — the whole testimonial, not just the picture, so
 *     the enlarged view can't drift from the card it was opened from. The
 *     description keeps the owner's typography through the existing
 *     resolveReviewDescStyle, and product links come from reviewProductIds, so
 *     there is one merge rule and one legacy-link reader in the codebase.
 *
 *   • HOW BIG THE IMAGE IS FETCHED — a lightbox that reuses the card's
 *     downsized ImageKit URL is not a zoom: those pixels were already thrown
 *     away at the edge, so the browser can only upscale a blurry copy. The
 *     viewer asks for its own, larger transform, and asks for a bigger one
 *     again when the customer toggles to actual size.
 *
 * Pure module (no DB, no Next runtime, no browser).
 * Covered by scripts/test-review-viewer.ts.
 */

import type { CSSProperties } from "react";

import { imageUrl } from "@/lib/media/image-url";
import { resolveReviewDescStyle, reviewProductIds } from "@/lib/storefront/reviews";
import type { Brand, Review } from "@/storefront/types";

/**
 * How the enlarged image is laid out.
 *
 *   "fit"    — the whole screenshot, letterboxed into the viewport. The default:
 *              it is the first thing the customer wanted, the uncropped image.
 *   "actual" — the fetched image at its own size, with the stage scrolling. On a
 *              phone this is the only way a tall chat screenshot becomes legible;
 *              `object-fit: contain` alone just shrinks it to fit again.
 */
export type ReviewZoom = "fit" | "actual";

/** Wide enough that a phone screenshot's text is legible letterboxed on a
 *  desktop viewport — and far past the 4/5 card tile it replaces. */
export const REVIEW_VIEWER_FIT_WIDTH = 1200;

/** The actual-size fetch. Bigger than the fit fetch on purpose: zooming has to
 *  add pixels, not stretch the ones already on screen. */
export const REVIEW_VIEWER_ZOOM_WIDTH = 2400;

/** Above the storefront's default (75). Screenshots are flat colour with fine
 *  text, which is exactly what a photo-tuned quality setting smears first. */
export const REVIEW_VIEWER_QUALITY = 90;

/** Fallback dialog label for a testimonial with no text at all. */
const FALLBACK_LABEL = "Customer review";

const text = (v: string | undefined | null) => (v ?? "").trim();

/** The model a review viewer dialog renders. */
export type ReviewViewerModel = {
  /** False for a text-only testimonial — the dialog then shows copy alone
   *  rather than an empty image frame. */
  hasImage: boolean;
  /** The stored URL, untransformed. Size it with reviewViewerSrc. */
  image: string;
  /** Accessible name for the dialog and alt text for the image. */
  alt: string;
  headline: string;
  title: string;
  subtitle: string;
  badge: string;
  /** Tenant default merged with the per-review override, so the enlarged copy
   *  renders in the same face as the card. */
  descStyle: CSSProperties;
  /** Every product this testimonial is connected to (legacy + multi-connect). */
  productIds: string[];
};

/**
 * Whether clicking this testimonial should open anything. An all-blank row has
 * nothing to enlarge, and an empty dialog is worse than no dialog — the surfaces
 * render a plain, inert tile instead.
 */
export function canOpenReviewViewer(
  review: Pick<Review, "image" | "headline" | "title" | "subtitle" | "badge">,
): boolean {
  return Boolean(
    text(review.image) ||
      text(review.title) ||
      text(review.subtitle) ||
      text(review.headline) ||
      text(review.badge),
  );
}

/**
 * The dialog's accessible name: the most specific text the owner wrote, falling
 * back until something is left. Never empty — an unlabelled modal is a dead end
 * for a screen-reader user.
 */
export function reviewViewerAlt(
  review: Pick<Review, "headline" | "title" | "badge">,
): string {
  return text(review.title) || text(review.headline) || text(review.badge) || FALLBACK_LABEL;
}

/** Build everything the viewer needs from a testimonial and its tenant brand. */
export function buildReviewViewer(
  review: Review,
  brand: Pick<Brand, "reviewDescStyle">,
): ReviewViewerModel {
  const image = text(review.image);
  return {
    hasImage: Boolean(image),
    image,
    alt: reviewViewerAlt(review),
    headline: text(review.headline),
    title: text(review.title),
    subtitle: text(review.subtitle),
    badge: text(review.badge),
    descStyle: resolveReviewDescStyle(review, brand),
    productIds: reviewProductIds(review),
  };
}

/**
 * The image URL for one zoom level. Non-ImageKit sources (foreign hosts, local
 * assets, admin `blob:` previews) pass through untouched — imageUrl already
 * guarantees that, and appending a transform to them would break the <img>.
 */
export function reviewViewerSrc(image: string, zoom: ReviewZoom): string {
  const src = text(image);
  if (!src) return "";
  return imageUrl(src, {
    width: zoom === "actual" ? REVIEW_VIEWER_ZOOM_WIDTH : REVIEW_VIEWER_FIT_WIDTH,
    quality: REVIEW_VIEWER_QUALITY,
  });
}

/** Toggle the zoom level. One control, two states — no zoom slider to mis-tap. */
export function nextReviewZoom(zoom: ReviewZoom): ReviewZoom {
  return zoom === "fit" ? "actual" : "fit";
}

/**
 * The zoom control's label, phrased as the ACTION it performs. A button reading
 * "Fit to screen" while the image is already fitted tells a screen-reader user
 * nothing about what pressing it does.
 */
export function reviewZoomLabel(zoom: ReviewZoom): string {
  return zoom === "fit" ? "Zoom in" : "Fit to screen";
}

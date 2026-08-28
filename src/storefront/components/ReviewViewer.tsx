"use client";

import { useEffect, useState } from "react";

import type { Brand, Review } from "../types";
import {
  buildReviewViewer,
  nextReviewZoom,
  reviewViewerSrc,
  reviewZoomLabel,
  type ReviewZoom,
} from "@/lib/storefront/review-viewer";

/**
 * Full-screen customer-testimonial viewer.
 *
 * The one place a review is shown large, shared by all three surfaces that used
 * to render it into a small fixed box: the Reviews page grid, the product
 * quick-view's 56px thumb, and the store-admin Reviews manager. Deliberately a
 * single component rather than a third hand-rolled lightbox — ProtocolsPage's
 * .protocols__viewer and the admin's .od-proof-viewer already prove how easily
 * three copies of "Escape, scroll lock, backdrop click" drift apart.
 *
 * What it adds over those two: a ZOOM toggle. Fitting a tall chat screenshot
 * into the viewport with `object-fit: contain` still leaves its text tiny on a
 * phone, so tapping the image (or the toolbar control) switches to actual size —
 * a bigger fetch from the edge, in a stage that scrolls so the image can be
 * panned. reviewViewerSrc owns both widths; see lib/storefront/review-viewer.
 */
export function ReviewViewer({
  review,
  brand,
  onClose,
}: {
  review: Review;
  brand: Pick<Brand, "reviewDescStyle">;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState<ReviewZoom>("fit");
  const model = buildReviewViewer(review, brand);

  // Escape closes, background scroll locks. Same modal contract as NoticeModal
  // and the product detail modal, so keyboard users get one consistent exit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const toggleZoom = () => setZoom((z) => nextReviewZoom(z));

  return (
    <div
      className="sf-review-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={model.alt}
      data-zoom={zoom}
      onClick={onClose}
    >
      <div className="sf-review-viewer__bar" onClick={(e) => e.stopPropagation()}>
        {model.hasImage && (
          <button
            type="button"
            className="sf-review-viewer__btn"
            onClick={toggleZoom}
            aria-label={reviewZoomLabel(zoom)}
            title={reviewZoomLabel(zoom)}
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
              <path d="M8 11h6" />
              {zoom === "fit" && <path d="M11 8v6" />}
            </svg>
          </button>
        )}
        <button
          type="button"
          className="sf-review-viewer__btn"
          onClick={onClose}
          aria-label="Close review"
          title="Close review"
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {model.hasImage && (
        <div className="sf-review-viewer__stage" onClick={(e) => e.stopPropagation()}>
          {/* Tapping the picture is the discoverable zoom — nobody hunts for a
              toolbar button on a phone. eslint-disable: storefront images are
              raw <img> sized through ImageKit, never next/image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="sf-review-viewer__img"
            src={reviewViewerSrc(model.image, zoom)}
            alt={model.alt}
            decoding="async"
            onClick={toggleZoom}
          />
        </div>
      )}

      {(model.headline || model.title || model.subtitle || model.badge) && (
        <figcaption
          className="sf-review-viewer__caption"
          onClick={(e) => e.stopPropagation()}
        >
          {model.headline && (
            <span className="sf-review-viewer__eyebrow">{model.headline}</span>
          )}
          {model.title && <strong className="sf-review-viewer__title">{model.title}</strong>}
          {model.subtitle && (
            <p className="sf-review-viewer__text" style={model.descStyle}>
              {model.subtitle}
            </p>
          )}
          {model.badge && <span className="sf-review-viewer__badge">{model.badge}</span>}
        </figcaption>
      )}
    </div>
  );
}

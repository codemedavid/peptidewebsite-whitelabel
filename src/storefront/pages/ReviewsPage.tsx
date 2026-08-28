"use client";

import { useState } from "react";

import type { Brand, Review } from "../types";
import { useStore } from "../store";
import { BackLink } from "../components/BackLink";
import { ReviewViewer } from "../components/ReviewViewer";
import { imageUrl, imageSrcSet } from "@/lib/media/image-url";
import { canOpenReviewViewer } from "@/lib/storefront/review-viewer";
import { resolveReviewDescStyle, reviewProductIds } from "@/lib/storefront/reviews";

/** Rendered width of one grid tile at the widest column. The full-size original
 *  belongs in the viewer, not in a 260px card. */
const CARD_IMAGE_WIDTH = 560;

export function ReviewsPage({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { reviews, products } = useStore();
  // The testimonial being shown large. Owners upload chat screenshots, so the
  // cropped 4/5 tile is never readable on its own — see ReviewViewer.
  const [viewing, setViewing] = useState<Review | null>(null);

  return (
    <section className="page" id="reviews">
      <div className="page__container">
        <BackLink onClick={onBack} label={brand.reviewsBackLabel || "Back"} />
        <div className="page__head">
          <h1 className="page__title">{brand.reviewsTitle || "Customer Reviews"}</h1>
        </div>
        <div className="reviews__grid">
          {reviews.map((r, i) => {
            // A testimonial can name several products — chip each one it is
            // connected to, so a customer can jump to any of them.
            const linkedProducts = reviewProductIds(r)
              .map((pid) => products.find((x) => x.id === pid))
              .filter((p): p is NonNullable<typeof p> => Boolean(p));
            const descStyle = resolveReviewDescStyle(r, brand);
            const zoomable = canOpenReviewViewer(r);
            const media = (
              <>
                {r.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl(r.image, { width: CARD_IMAGE_WIDTH })}
                    srcSet={imageSrcSet(r.image, [280, CARD_IMAGE_WIDTH, 840])}
                    sizes="(max-width: 640px) 90vw, 300px"
                    alt={r.title || "Customer review"}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <svg className="review-card__media-placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.81.01L6 21" />
                  </svg>
                )}
                <div className="review-card__title-overlay">{r.headline}</div>
              </>
            );
            return (
              <article key={r.id ?? i} className="review-card">
                {zoomable ? (
                  // A real <button>, not a div with onClick: the protocols
                  // gallery opens its lightbox the same way, and a div is
                  // invisible to the keyboard.
                  <button
                    type="button"
                    className="review-card__media review-card__zoom"
                    onClick={() => setViewing(r)}
                    aria-label={`View ${r.title || r.headline || "this review"} full size`}
                  >
                    {media}
                  </button>
                ) : (
                  <div className="review-card__media">{media}</div>
                )}
                <div className="review-card__body">
                  <h3 className="review-card__title">{r.title}</h3>
                  <p className="review-card__sub" style={descStyle}>
                    {r.subtitle}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    {r.badge && <span className="review-card__badge">{r.badge}</span>}
                    {linkedProducts.map((linked) => (
                      <a
                        key={linked.id}
                        href="#catalog"
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color: "var(--brand-main)",
                          textDecoration: "underline",
                          textDecorationColor: "color-mix(in srgb, var(--brand-main) 30%, transparent)",
                        }}
                      >
                        for {linked.name}
                      </a>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
          {reviews.length === 0 && (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "60px 20px", color: "var(--brand-text-muted)" }}>
              No reviews yet.
            </div>
          )}
        </div>
      </div>
      {viewing && (
        <ReviewViewer review={viewing} brand={brand} onClose={() => setViewing(null)} />
      )}
    </section>
  );
}

"use client";

import type { Brand } from "../types";
import { useStore } from "../store";
import { BackLink } from "../components/BackLink";

export function ReviewsPage({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { reviews, products } = useStore();

  return (
    <section className="page" id="reviews">
      <div className="page__container">
        <BackLink onClick={onBack} label={brand.reviewsBackLabel || "Back"} />
        <div className="page__head">
          <h1 className="page__title">{brand.reviewsTitle || "Customer Reviews"}</h1>
        </div>
        <div className="reviews__grid">
          {reviews.map((r, i) => {
            const linked = r.productId ? products.find((x) => x.id === r.productId) : null;
            return (
              <article key={i} className="review-card">
                <div className="review-card__media">
                  {r.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image} alt={r.title} />
                  ) : (
                    <svg className="review-card__media-placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.81.01L6 21" />
                    </svg>
                  )}
                  <div className="review-card__title-overlay">{r.headline}</div>
                </div>
                <div className="review-card__body">
                  <h3 className="review-card__title">{r.title}</h3>
                  <p className="review-card__sub">{r.subtitle}</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    {r.badge && <span className="review-card__badge">{r.badge}</span>}
                    {linked && (
                      <a
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
                    )}
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
    </section>
  );
}

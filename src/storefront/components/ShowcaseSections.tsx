// The SHOWCASE layout's below-the-hero sections. Presentational only: every one
// receives data the caller already derived from the tenant's own config and
// catalog, and renders NOTHING when that data is empty, so a brand-new store
// never shows a heading over a gap.
//
//   ShowcaseCircles  — round "shop by category" badges
//   ShowcasePromos   — the "Protocols hub" card + the "whole collection" card

import type { CSSProperties } from "react";
import type { CategoryTile } from "@/lib/storefront/boutique-home";
import { SHOWCASE_PROTOCOLS_ROUTE } from "@/lib/storefront/showcase-home";
import { imageUrl } from "@/lib/media/image-url";
import { ShowcaseArrow, ShowcaseIcon } from "./ShowcaseIcon";

/** Phones fit this many badges across without scrolling; more become a swipe row. */
const CIRCLES_FIT_ON_PHONE = 3;

export function ShowcaseCircles({
  tiles,
  onSelect,
}: {
  tiles: CategoryTile[];
  onSelect: (categoryId: string) => void;
}) {
  if (tiles.length === 0) return null;

  const scrolls = tiles.length > CIRCLES_FIT_ON_PHONE;

  return (
    <section className="sc-circles" aria-labelledby="sc-circles-heading">
      <div className="container">
        <div className="sc-circles__head">
          <h2 id="sc-circles-heading" className="sc-circles__title font-display">
            Shop by category
          </h2>
          {scrolls && (
            <span className="sc-circles__hint" aria-hidden="true">
              Swipe <ShowcaseArrow />
            </span>
          )}
        </div>
        <ul
          className="sc-circles__row"
          data-scroll={scrolls ? "" : undefined}
          style={{ "--sc-cats": tiles.length } as CSSProperties}
        >
          {tiles.map((tile) => (
            <li key={tile.id}>
              <button type="button" className="sc-circle" onClick={() => onSelect(tile.id)}>
                <span className="sc-circle__ring">
                  <span className="sc-circle__media">
                    {tile.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl(tile.image, { width: 320 })}
                        alt=""
                        width={320}
                        height={320}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="sc-circle__mono font-display" aria-hidden="true">
                        {tile.initial}
                      </span>
                    )}
                  </span>
                </span>
                <span className="sc-circle__label">{tile.label}</span>
                <span className="sc-circle__count">
                  {tile.count} {tile.count === 1 ? "item" : "items"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export type ShowcaseCollection = {
  title: string;
  productCount: number;
  categoryCount: number;
  image: string | null;
  cta: string;
};

export function ShowcasePromos({
  protocolsHub,
  collection,
  onRoute,
  onShopAll,
}: {
  /** False when the Protocols page is switched off — the card is then omitted. */
  protocolsHub: boolean;
  /** Null when the catalog is empty — there is no collection to promote. */
  collection: ShowcaseCollection | null;
  onRoute: (route: string) => void;
  onShopAll: () => void;
}) {
  if (!protocolsHub && !collection) return null;
  const single = !(protocolsHub && collection);

  return (
    <section className="sc-promos" aria-label="More from the store">
      <div className={`container sc-promos__grid${single ? " sc-promos__grid--single" : ""}`}>
        {protocolsHub && (
          <article className="sc-promo sc-promo--learn">
            {/* An oversized, near-transparent echo of the art: depth, not decoration
                that competes with the copy. */}
            <span className="sc-promo__watermark" aria-hidden="true">
              <ShowcaseIcon icon="education" size={240} />
            </span>
            <div className="sc-promo__copy">
              <p className="sc-promo__eyebrow">
                <ShowcaseIcon icon="education" size={14} />
                Guides
              </p>
              <h2 className="sc-promo__title font-display">Protocols hub</h2>
              <p className="sc-promo__body">
                Step-by-step guides for every peptide — read them before you order.
              </p>
              <button
                type="button"
                className="btn btn-primary sc-pill"
                onClick={() => onRoute(SHOWCASE_PROTOCOLS_ROUTE)}
              >
                <span className="sc-pill__label">View protocols</span>
                <ShowcaseArrow />
              </button>
            </div>
            <span className="sc-promo__art" aria-hidden="true">
              <ShowcaseIcon icon="education" size={88} />
            </span>
          </article>
        )}

        {collection && (
          <article className={`sc-promo sc-promo--shop${collection.image ? " sc-promo--has-photo" : ""}`}>
            <div className="sc-promo__copy">
              <p className="sc-promo__eyebrow">
                <ShowcaseIcon icon="spark" size={14} />
                Collection
              </p>
              <h2 className="sc-promo__title font-display">{collection.title}</h2>
              <p className="sc-promo__body">
                {collection.productCount} {collection.productCount === 1 ? "product" : "products"}
                {collection.categoryCount > 1 && ` across ${collection.categoryCount} categories`}.
              </p>
              <button type="button" className="btn btn-primary sc-pill" onClick={onShopAll}>
                <span className="sc-pill__label">{collection.cta}</span>
                <ShowcaseArrow />
              </button>
            </div>
            {collection.image && (
              <span className="sc-promo__photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(collection.image, { width: 480 })}
                  alt=""
                  width={480}
                  height={480}
                  loading="lazy"
                  decoding="async"
                />
              </span>
            )}
          </article>
        )}
      </div>
    </section>
  );
}

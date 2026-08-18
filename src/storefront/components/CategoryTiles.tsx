// "Shop by category" — the boutique layout's discovery row (reference:
// cherieandco.ph, where image tiles with live product counts, not a text nav,
// are how you enter the catalog).
//
// White-label: every tile is derived from the tenant's own categories and
// catalog (buildCategoryTiles), and the whole section is omitted when there is
// nothing to show. Colours and type come from --brand-* only.

import type { CategoryTile } from "@/lib/storefront/boutique-home";

export function CategoryTiles({
  tiles,
  eyebrow,
  title,
  onSelect,
}: {
  tiles: CategoryTile[];
  eyebrow: string;
  title: string;
  /** Filter the catalog below to this category and scroll to it. */
  onSelect: (categoryId: string) => void;
}) {
  // No categories, or none with stock behind them — the row disappears rather
  // than leaving an empty heading on the page.
  if (tiles.length === 0) return null;

  return (
    <section className="bq-tiles" aria-labelledby="bq-tiles-heading">
      <div className="container">
        <header className="bq-head">
          <p className="bq-head__eyebrow">{eyebrow}</p>
          <h2 id="bq-tiles-heading" className="bq-head__title font-display">
            {title}
          </h2>
        </header>

        <ul className="bq-tiles__grid">
          {tiles.map((tile) => (
            <li key={tile.id} className="bq-tile">
              <button
                type="button"
                className="bq-tile__btn"
                onClick={() => onSelect(tile.id)}
              >
                <span className="bq-tile__media">
                  {tile.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={tile.image}
                      alt=""
                      width={640}
                      height={640}
                      loading="lazy"
                      decoding="async"
                      className="bq-tile__img"
                    />
                  ) : (
                    <span className="bq-tile__mono font-display" aria-hidden="true">
                      {tile.initial}
                    </span>
                  )}
                </span>

                <span className="bq-tile__caption">
                  <span className="bq-tile__name font-display">{tile.label}</span>
                  <span className="bq-tile__count">
                    {tile.count} {tile.count === 1 ? "product" : "products"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

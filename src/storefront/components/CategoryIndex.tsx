// The EDITORIAL layout's discovery section: the tenant's categories set as a
// typographic index — one full-width line each, the name in display type with
// its live count opposite, hairline-ruled.
//
// This is the layout's signature, and the reason it isn't just "boutique with a
// sidebar": an index scales. A store with fifteen shelves, or one whose products
// aren't all photographed, reads as a considered contents page here where a tile
// grid would read as a sparse one.
//
// White-label: every row is derived from the tenant's own categories and catalog
// (buildCategoryIndex), and the whole section is omitted when there is nothing
// to show. Colours and type come from --brand-* only.

import type { IndexRow } from "@/lib/storefront/editorial-home";

export function CategoryIndex({
  rows,
  eyebrow,
  onSelect,
}: {
  rows: IndexRow[];
  eyebrow: string;
  /** Filter the catalog to this category and open the catalog screen. */
  onSelect: (categoryId: string) => void;
}) {
  // No categories, or none with stock behind them — the section disappears
  // rather than leaving an empty heading on the page.
  if (rows.length === 0) return null;

  return (
    <section className="ed-index" aria-labelledby="ed-index-heading">
      <div className="container">
        <h2 id="ed-index-heading" className="ed-eyebrow">
          {eyebrow}
        </h2>

        <ul className="ed-index__list">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="ed-index__row"
                onClick={() => onSelect(row.id)}
              >
                <span className="ed-index__label font-display">{row.label}</span>
                <span className="ed-index__count">
                  {row.count} {row.count === 1 ? "product" : "products"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

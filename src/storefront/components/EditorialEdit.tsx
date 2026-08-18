// The EDITORIAL layout's "edit" band — the inverted strip under the category
// index showing the products the owner flagged featured.
//
// Deliberately NOT a second catalog: no filters, no add-to-cart, no stock or
// status furniture. It is a look at a handful of things, and every card is a way
// into the catalog. That restraint is what lets the band sit between two
// discovery sections without competing with the grid on the next screen.
//
// White-label: the products, their photos and the store's own CTA label are the
// tenant's; the band disappears entirely when nothing is featured, so no store
// is given a selection this template chose. Colour and type come from --brand-*.

import type { Brand, Product } from "../types";
import { resolveProductImage } from "@/lib/storefront/product-image";

export function EditorialEdit({
  products,
  brand,
  eyebrow,
  onShopAll,
  onOpen,
}: {
  /** Already capped by buildEditRow — this component only draws. */
  products: Product[];
  brand: Brand;
  eyebrow: string;
  onShopAll: () => void;
  /** Open the catalog filtered to the clicked product's category. */
  onOpen: (product: Product) => void;
}) {
  if (products.length === 0) return null;

  return (
    <section className="ed-edit" aria-labelledby="ed-edit-heading">
      <div className="container">
        <header className="ed-edit__head">
          <h2 id="ed-edit-heading" className="ed-eyebrow ed-eyebrow--invert">
            {eyebrow}
          </h2>
          <button type="button" className="ed-edit__all" onClick={onShopAll}>
            {brand.ctaLabel || "View all"}
          </button>
        </header>

        <ul className="ed-edit__grid">
          {products.map((product) => {
            const image = resolveProductImage(product.image, brand.defaultProductImage);
            return (
              <li key={product.id}>
                <button
                  type="button"
                  className="ed-edit__card"
                  onClick={() => onOpen(product)}
                >
                  <span className="ed-edit__media">
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={image}
                        alt=""
                        width={640}
                        height={800}
                        loading="lazy"
                        decoding="async"
                        className="ed-edit__img"
                      />
                    ) : (
                      <span className="ed-edit__mono font-display" aria-hidden="true">
                        {product.name?.[0]?.toUpperCase() || "·"}
                      </span>
                    )}
                  </span>

                  <span className="ed-edit__name font-display">{product.name}</span>
                  <span className="ed-edit__price">
                    {product.currency}
                    {product.price?.toLocaleString()}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

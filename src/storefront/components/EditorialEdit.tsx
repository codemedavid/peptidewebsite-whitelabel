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
import { EDIT_COLUMNS_DEFAULT, type EditColumns } from "@/lib/storefront/editorial-home";
import { imageUrl } from "@/lib/media/image-url";
import { resolveBaseSaleView } from "@/lib/storefront/sale";
import { resolveProductImage } from "@/lib/storefront/product-image";

export function EditorialEdit({
  products,
  brand,
  eyebrow,
  onShopAll,
  onOpen,
  columns = EDIT_COLUMNS_DEFAULT,
}: {
  /** Already capped by buildEditRow — this component only draws. */
  products: Product[];
  brand: Brand;
  eyebrow: string;
  onShopAll: () => void;
  /** Open the catalog filtered to the clicked product's category. */
  onOpen: (product: Product) => void;
  /** How many cards sit on a row — the operator's choice, already normalized.
   *  Passed to CSS as a variable rather than a class so the sheet keeps the one
   *  grid rule, and so the small-screen override stays a plain media query. */
  columns?: EditColumns;
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

        <ul
          className="ed-edit__grid"
          style={{ "--ed-edit-cols": columns } as React.CSSProperties}
        >
          {products.map((product) => {
            const image = resolveProductImage(product.image, brand.defaultProductImage);
            // The band has no option picker, so it asks for the base-price view:
            // a marked-down product is quoted at the price the cart will charge,
            // with the list price struck beside it, instead of advertising a
            // saving the shopper only discovers at checkout.
            const sale = resolveBaseSaleView(product);
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
                        src={imageUrl(image, { width: 640 })}
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
                    {sale.price?.toLocaleString()}
                    {sale.compareAt !== null && (
                      <s className="ed-edit__compare">
                        <span className="sf-sr-only">Was </span>
                        {product.currency}
                        {sale.compareAt.toLocaleString()}
                      </s>
                    )}
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

"use client";

import { useMemo, useState } from "react";
import type { Brand, Product } from "../types";
import { cardDesignAttrs, type CardDesign } from "../cardDesign";

/**
 * The storefront product card. Also rendered by the admin Card Studio for its
 * live previews (with a sample `rating`), so the gallery shows exactly what
 * ships. `design` comes from brand.cardDesign — absent, the card renders the
 * classic markup with no [data-cd] attributes and is visually unchanged.
 */
export function ProductCard({
  product,
  onAdd,
  design,
  rating,
}: {
  product: Product;
  onAdd: (qty: number, variation?: { name: string; price: number }) => void;
  design?: CardDesign;
  /** Sample rating shown by Card Studio previews. The public catalog passes
   *  nothing — products carry no rating data, so none is invented. */
  rating?: { value: number; count: number };
}) {
  const [qty, setQty] = useState(1);
  // Per-product variations (e.g. 5mg / 10mg), each with its own price. When the
  // product has them, the customer picks one; the chosen option drives the price
  // shown and is what gets added to the cart. No variations → unchanged behavior.
  const variations = Array.isArray(product.variations) ? product.variations : [];
  const hasVariations = variations.length > 0;
  const [variantIdx, setVariantIdx] = useState(0);
  const selectedVariation = hasVariations
    ? variations[Math.min(variantIdx, variations.length - 1)]
    : null;
  const displayPrice = selectedVariation ? selectedVariation.price : product.price;
  const cd = design ? cardDesignAttrs(design) : null;
  // Stock-aware buying: the stepper can't exceed what's left, and a product
  // with nothing left renders a disabled "Out of Stock" CTA. The cart and the
  // server enforce the same cap — this is the first, visible line of defense.
  const stock = Math.max(0, product.stock || 0);
  const outOfStock = stock <= 0;
  // "Price on request": on hand but no fixed price. Show a label instead of a
  // price and block add-to-cart — the customer messages the store to order.
  const poa = product.priceOnRequest === true;
  // Wholesale / reseller prices are deliberately NOT shown on the public catalog
  // — they live only on the gated reseller page (#merchant). The cart still
  // auto-applies the bulk price at the per-product minimum (see checkout.ts), so
  // resellers get wholesale at checkout without it being advertised here.
  return (
    <article className="product-card card" style={cd?.style} {...(cd?.data ?? {})}>
      {outOfStock ? (
        <span className="product-card__badge badge badge-soft">Out of stock</span>
      ) : poa ? (
        <span className="product-card__badge badge badge-soft">On hand</span>
      ) : (
        product.featured && (
          <span className="product-card__badge badge badge-solid">Featured</span>
        )
      )}

      <div className="product-card__media">
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image} alt={product.name} />
        ) : (
          <svg className="product-card__media-placeholder" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M32 4 6 16v32l26 12 26-12V16L32 4z" />
            <path d="M6 16l26 12 26-12" />
            <path d="M32 28v32" />
          </svg>
        )}
      </div>

      <div className="product-card__body">
        <h3 className="product-card__name font-display">{product.name}</h3>
        {rating && (
          <div
            className="product-card__rating"
            aria-label={`Rated ${rating.value} out of 5 from ${rating.count} reviews`}
          >
            <span
              className="product-card__stars"
              style={{ "--rate": rating.value / 5 } as React.CSSProperties}
              aria-hidden
            >
              ★★★★★
            </span>
            <span className="product-card__rating-value">{rating.value.toFixed(1)}</span>
            <span className="product-card__rating-count">({rating.count})</span>
          </div>
        )}
        <p className="product-card__desc">{product.description}</p>
        {product.purity && (
          <span className="badge badge-soft">{product.purity} Purity</span>
        )}
        {hasVariations && !poa && (
          <div
            className="product-card__variations"
            role="group"
            aria-label={`Options for ${product.name}`}
            style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}
          >
            {variations.map((v, i) => {
              const active = i === variantIdx;
              return (
                <button
                  key={`${v.name}-${i}`}
                  type="button"
                  className="badge"
                  aria-pressed={active}
                  onClick={() => setVariantIdx(i)}
                  style={{
                    cursor: "pointer",
                    border: active
                      ? "1px solid var(--brand-main, #111)"
                      : "1px solid var(--hairline, rgba(0,0,0,.14))",
                    background: active ? "var(--brand-main, #111)" : "transparent",
                    color: active ? "var(--brand-button-text, #fff)" : "inherit",
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {v.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <hr className="hairline" />

      <div className="product-card__foot">
        <div className="product-card__price font-display">
          {poa ? (
            <span className="product-card__price-poa">Message for price</span>
          ) : (
            <>
              {product.currency}
              {displayPrice.toLocaleString()}
            </>
          )}
        </div>
        {poa ? (
          <div className="product-card__buy">
            <button className="btn btn-primary product-card__cta" disabled>
              Message to order
            </button>
          </div>
        ) : (
          <div className="product-card__buy">
            <div className="sf-qty product-card__qty">
              <button
                type="button"
                aria-label={`Remove one ${product.name}`}
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
              >
                −
              </button>
              <span aria-live="polite">{qty}</span>
              <button
                type="button"
                aria-label={`Add one ${product.name}`}
                onClick={() => setQty((q) => Math.min(stock || 1, q + 1))}
                disabled={outOfStock || qty >= stock}
              >
                +
              </button>
            </div>
            <button
              className="btn btn-primary product-card__cta"
              disabled={outOfStock}
              onClick={() => {
                onAdd(qty, selectedVariation ?? undefined);
                setQty(1);
              }}
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
              </svg>
              {outOfStock ? "Out of Stock" : "Add to Cart"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export function Catalog({
  products,
  category,
  onAddToCart,
  brand,
}: {
  products: Product[];
  category: string;
  onAddToCart: (p: Product, qty?: number, variation?: { name: string; price: number }) => void;
  brand: Brand;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");

  const filtered = useMemo(() => {
    let list = products;
    if (category && category !== "all") {
      list = list.filter((p) => p.category === category);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q),
      );
    }
    list = [...list].sort((a, b) => {
      if (sort === "price-asc") return a.price - b.price;
      if (sort === "price-desc") return b.price - a.price;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [products, category, query, sort]);

  return (
    <section className="catalog section" id="catalog">
      <div className="container">
        <div className="catalog__header">
          <div>
            <div className="eyebrow">{brand.catalogEyebrow || "Catalog"}</div>
            <h2 className="catalog__title font-display">
              {brand.catalogTitle || "Our Collection"}
            </h2>
          </div>

          <div className="catalog__controls">
            {brand.catalogShowSearch !== false && (
              <label className="input-wrap" aria-label="Search">
                <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search products…"
                  type="search"
                />
              </label>
            )}

            {brand.catalogShowSort !== false && (
              <label className="input-wrap catalog__sort">
                <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="7" y1="12" x2="20" y2="12" />
                  <line x1="10" y1="18" x2="20" y2="18" />
                </svg>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="name">Sort: Name</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                </select>
              </label>
            )}
          </div>
        </div>

        {brand.catalogShowCount !== false && (
          <div className="catalog__count eyebrow">
            {filtered.length} {filtered.length === 1 ? "Product" : "Products"}
          </div>
        )}

        <div className="catalog__grid" data-cd-grid={brand.cardDesign?.layout || undefined}>
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              design={brand.cardDesign}
              onAdd={(qty, variation) => onAddToCart(p, qty, variation)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="catalog__empty">
              <p className="font-display" style={{ fontSize: 28, margin: 0 }}>
                No matches.
              </p>
              <p style={{ color: "var(--brand-text-muted)" }}>
                Try a different search or category.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

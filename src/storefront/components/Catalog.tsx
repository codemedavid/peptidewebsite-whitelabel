"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Brand, Product } from "../types";
import { cardDesignAttrs, type CardDesign } from "../cardDesign";
import { isOnHandBlocked } from "@/lib/storefront/group-buy";
import { resolveProductImage } from "@/lib/storefront/product-image";
import {
  buildProductOptions,
  resolveSelectedPrice,
  shouldShowOptionPicker,
} from "@/lib/storefront/variations";
import { isOptionOutOfStock, productOutOfStock } from "@/lib/storefront/inventory";
import { buildProductCta } from "@/lib/storefront/product-cta";
import { isStoreClosed } from "@/lib/storefront/store-status";
import { buildProductDetail } from "@/lib/storefront/product-detail";
import {
  normalizeSortCategories,
  orderCatalogByCategories,
  pinFeatured,
  seedSortCategories,
  sortByCategory,
  sortCategoryOptions,
} from "@/lib/storefront/sort-categories";
import { normalizeOnHandOrder, orderOnHandProducts } from "@/lib/storefront/on-hand-order";

/**
 * The storefront product card. Also rendered by the admin Card Studio for its
 * live previews (with a sample `rating`), so the gallery shows exactly what
 * ships. `design` comes from brand.cardDesign — absent, the card renders the
 * classic markup with no [data-cd] attributes and is visually unchanged.
 */
export function ProductCard({
  product,
  onAdd,
  onOpenDetail,
  design,
  rating,
  gbBlocked,
  storeClosed,
  defaultImage,
}: {
  product: Product;
  onAdd: (qty: number, variation?: { name: string; price: number }) => void;
  /** Open the full-detail quick-view modal for this product. Optional so the
   *  admin Card Studio preview (which renders this card outside the catalog)
   *  keeps working — there, the card's image/name are simply not clickable. */
  onOpenDetail?: () => void;
  design?: CardDesign;
  /** Sample rating shown by Card Studio previews. The public catalog passes
   *  nothing — products carry no rating data, so none is invented. */
  rating?: { value: number; count: number };
  /** True when a group buy is live and this on-hand (non-group-buy) product is
   *  blocked from the cart by the owner's on-hand setting. Shows but disables
   *  buying — the store.addToCart gate and the server both re-check it. */
  gbBlocked?: boolean;
  /** True when the owner has closed the whole shop (Admin → Store Status). The
   *  card still renders in full — image, name, price — but the buy controls read
   *  "Closed" and are inert. Outranks every per-product state. */
  storeClosed?: boolean;
  /** Brand-level fallback photo (brand.defaultProductImage) shown when the
   *  product has no image of its own. Prop (not useStore) because the platform
   *  admin's CardDesignPicker renders this card outside the StoreProvider. */
  defaultImage?: string | null;
}) {
  const [qty, setQty] = useState(1);
  // Per-product variations (e.g. 5mg / 10mg), each with its own price. When a
  // product has them, the customer picks an option; the chosen one drives the
  // price shown and what's added to the cart. The product's own base price stays
  // available as a default "Standard" option (so a single variation still gives a
  // real choice) — skipped when the seller left the base price at 0, or when a
  // named variation already carries the base price (it IS the standard). No
  // variations → unchanged single-price behavior.
  const options = buildProductOptions(product);
  // Start with NOTHING selected (-1). A variation product then shows only its
  // option names and no price until the customer clicks a pill — the price on
  // screen always names the option they chose. A single-price product has no
  // options, so this index never matters and its price shows immediately.
  const [optIdx, setOptIdx] = useState(-1);
  const selectedOpt =
    optIdx >= 0 && optIdx < options.length ? options[optIdx] : null;
  // Any variation the seller priced earns a picker. Keying off the option count
  // instead used to hide a lone variation on a product with no base price — the
  // customer paid that price without ever seeing which option it was.
  const showSelector = shouldShowOptionPicker(product);
  // null = the product has options but none is picked yet → no price, and buying
  // is blocked until the customer chooses. A single-price product is never null.
  const displayPrice = resolveSelectedPrice(product, optIdx);
  const cd = design ? cardDesignAttrs(design) : null;
  // Product photo, or the brand's default product image, or the SVG placeholder.
  const image = resolveProductImage(product.image, defaultImage);
  // What the buy controls say and whether they work — one shared rule (the
  // modal calls the same helper), so the card can never again invite a choice
  // ("Select an option") on a product whose every option is sold out. It also
  // carries the stock the stepper caps against: the SELECTED option's units,
  // falling back to the base column for a single-price product.
  const cta = buildProductCta(product, optIdx, { gbBlocked, storeClosed });
  const { stock } = cta;
  const productOut = productOutOfStock(product);
  // "Price on request": on hand but no fixed price. Show a label instead of a
  // price and block add-to-cart — the customer messages the store to order.
  const poa = product.priceOnRequest === true;
  // Wholesale / reseller prices are deliberately NOT shown on the public catalog
  // — they live only on the gated reseller page (#merchant). The cart still
  // auto-applies the bulk price at the per-product minimum (see checkout.ts), so
  // resellers get wholesale at checkout without it being advertised here.
  return (
    <article className="product-card card" style={cd?.style} {...(cd?.data ?? {})}>
      {productOut ? (
        <span className="product-card__badge badge badge-soft">Out of stock</span>
      ) : poa ? (
        <span className="product-card__badge badge badge-soft">On hand</span>
      ) : gbBlocked ? (
        <span className="product-card__badge badge badge-soft">On hand</span>
      ) : (
        product.featured && (
          <span className="product-card__badge badge badge-solid">Featured</span>
        )
      )}

      {/* The media + name open the full-detail modal. Rendered as a real
          <button> (not an onClick div) so keyboard and screen-reader users get
          the same "view details" affordance; falls back to a plain div in the
          Card Studio preview where onOpenDetail is absent. */}
      {onOpenDetail ? (
        <button
          type="button"
          className="product-card__media product-card__media--interactive"
          onClick={onOpenDetail}
          aria-label={`View details for ${product.name}`}
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={product.name} />
          ) : (
            <svg className="product-card__media-placeholder" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M32 4 6 16v32l26 12 26-12V16L32 4z" />
              <path d="M6 16l26 12 26-12" />
              <path d="M32 28v32" />
            </svg>
          )}
          <span className="product-card__view-hint" aria-hidden>
            View details
          </span>
        </button>
      ) : (
        <div className="product-card__media">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={product.name} />
          ) : (
            <svg className="product-card__media-placeholder" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M32 4 6 16v32l26 12 26-12V16L32 4z" />
              <path d="M6 16l26 12 26-12" />
              <path d="M32 28v32" />
            </svg>
          )}
        </div>
      )}

      <div className="product-card__body">
        {onOpenDetail ? (
          <h3 className="product-card__name font-display">
            <button
              type="button"
              className="product-card__name-btn"
              onClick={() => onOpenDetail()}
            >
              {product.name}
            </button>
          </h3>
        ) : (
          <h3 className="product-card__name font-display">{product.name}</h3>
        )}
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
        {showSelector && !poa && (
          <div
            className="product-card__variations"
            role="group"
            aria-label={`Options for ${product.name}`}
            style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}
          >
            {options.map((o, i) => {
              const active = i === optIdx;
              const soldOut = isOptionOutOfStock(product, o);
              return (
                <button
                  key={`${o.name}-${i}`}
                  type="button"
                  className="badge"
                  aria-pressed={active}
                  onClick={() => setOptIdx(i)}
                  title={soldOut ? `${o.name} is out of stock` : undefined}
                  style={{
                    cursor: "pointer",
                    border: active
                      ? "1px solid var(--brand-main)"
                      : "1px solid var(--brand-border)",
                    background: active ? "var(--brand-main)" : "transparent",
                    color: active ? "var(--brand-button-text)" : "inherit",
                    fontWeight: active ? 600 : 500,
                    opacity: soldOut ? 0.5 : 1,
                    textDecoration: soldOut ? "line-through" : "none",
                  }}
                >
                  {o.name}
                  {soldOut ? " · out" : ""}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <hr className="hairline" />

      <div className="product-card__foot">
        <div className="product-card__price font-display">
          {cta.priceLabel !== null ? (
            <span className="product-card__price-poa">{cta.priceLabel}</span>
          ) : (
            <>
              {product.currency}
              {displayPrice?.toLocaleString()}
            </>
          )}
        </div>
        {poa ? (
          <div className="product-card__buy">
            <button className="btn btn-primary product-card__cta" disabled>
              {cta.ctaLabel}
            </button>
          </div>
        ) : gbBlocked ? (
          <div className="product-card__buy">
            <button
              className="btn btn-primary product-card__cta"
              disabled
              title="On-hand products are paused while a group buy is open."
            >
              {cta.ctaLabel}
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
                disabled={stock <= 0 || qty >= stock}
              >
                +
              </button>
            </div>
            <button
              className="btn btn-primary product-card__cta"
              disabled={cta.disabled}
              onClick={() => {
                if (cta.disabled) return;
                onAdd(qty, selectedOpt?.variation ?? undefined);
                setQty(1);
              }}
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
              </svg>
              {cta.ctaLabel}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Full-detail quick-view modal, opened by clicking a product card. Shows the
 * whole (un-clamped) description plus the spec sheet the card has no room for,
 * and carries a working option picker + qty stepper + Add to Cart so the
 * customer can buy without closing it. View model comes from buildProductDetail
 * so the modal and the card never disagree on price, image or options.
 */
function ProductDetailModal({
  product,
  onClose,
  onAddToCart,
  defaultImage,
  gbBlocked,
  storeClosed,
}: {
  product: Product;
  onClose: () => void;
  onAddToCart: (
    p: Product,
    qty?: number,
    variation?: { name: string; price: number },
  ) => void;
  defaultImage?: string | null;
  gbBlocked?: boolean;
  /** The owner closed the whole shop — see ProductCard's note. Passed through so
   *  the modal and the card it opened from can't disagree. */
  storeClosed?: boolean;
}) {
  const detail = buildProductDetail(product, defaultImage);
  const [qty, setQty] = useState(1);
  // Nothing picked yet (-1): a product with options shows no price until the
  // customer clicks one, same as the catalog card it opened from.
  const [optIdx, setOptIdx] = useState(-1);
  const closeRef = useRef<HTMLButtonElement>(null);

  const selectedIdx =
    optIdx >= 0 && optIdx < detail.options.length ? optIdx : -1;
  const selectedOpt = selectedIdx >= 0 ? detail.options[selectedIdx] : null;
  // null = has options but none picked → show a prompt, not a price, and block
  // buying until a pick. resolveSelectedPrice reuses the card's option list.
  const displayPrice = resolveSelectedPrice(product, optIdx);
  // Same shared rule the card runs, so the modal it opened from can't disagree
  // about the label, the disabled state, or the stepper's cap.
  const cta = buildProductCta(product, optIdx, { gbBlocked, storeClosed });
  const selectedStock = cta.stock;
  const canBuy = !cta.disabled;

  // Esc closes, body scroll locks, focus moves into the dialog — same modal
  // contract as NoticeModal so keyboard + screen-reader users are covered.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="sf-detail-overlay" role="presentation" onClick={onClose}>
      <div
        className="sf-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sf-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          className="sf-detail__close"
          aria-label="Close product details"
          onClick={onClose}
        >
          ×
        </button>

        <div className="sf-detail__grid">
          <div className="sf-detail__media">
            {detail.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={detail.image} alt={detail.name} />
            ) : (
              <svg className="product-card__media-placeholder" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M32 4 6 16v32l26 12 26-12V16L32 4z" />
                <path d="M6 16l26 12 26-12" />
                <path d="M32 28v32" />
              </svg>
            )}
          </div>

          <div className="sf-detail__info">
            <h2 id="sf-detail-title" className="sf-detail__name font-display">
              {detail.name}
            </h2>
            {detail.purity && (
              <span className="badge badge-soft">{detail.purity} Purity</span>
            )}

            <div className="sf-detail__price font-display">
              {cta.priceLabel !== null ? (
                <span className="product-card__price-poa">{cta.priceLabel}</span>
              ) : (
                <>
                  {detail.currency}
                  {displayPrice?.toLocaleString()}
                </>
              )}
            </div>

            {detail.description && (
              <p className="sf-detail__desc">{detail.description}</p>
            )}

            {detail.showOptions && !detail.priceOnRequest && (
              <div
                className="product-card__variations"
                role="group"
                aria-label={`Options for ${detail.name}`}
                style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}
              >
                {detail.options.map((o, i) => {
                  const active = i === optIdx;
                  const soldOut = (detail.optionStock[i] ?? 0) <= 0;
                  return (
                    <button
                      key={`${o.name}-${i}`}
                      type="button"
                      className="badge"
                      aria-pressed={active}
                      onClick={() => setOptIdx(i)}
                      title={soldOut ? `${o.name} is out of stock` : undefined}
                      style={{
                        cursor: "pointer",
                        border: active
                          ? "1px solid var(--brand-main)"
                          : "1px solid var(--brand-border)",
                        background: active ? "var(--brand-main)" : "transparent",
                        color: active ? "var(--brand-button-text)" : "inherit",
                        fontWeight: active ? 600 : 500,
                        opacity: soldOut ? 0.5 : 1,
                        textDecoration: soldOut ? "line-through" : "none",
                      }}
                    >
                      {o.name}
                      {soldOut ? " · out" : ""}
                    </button>
                  );
                })}
              </div>
            )}

            {detail.specs.length > 0 && (
              <dl className="sf-detail__specs">
                {detail.specs.map((row) => (
                  <div key={row.label} className="sf-detail__spec">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="sf-detail__buy">
              {canBuy && (
                <div className="sf-qty product-card__qty">
                  <button
                    type="button"
                    aria-label={`Remove one ${detail.name}`}
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    disabled={qty <= 1}
                  >
                    −
                  </button>
                  <span aria-live="polite">{qty}</span>
                  <button
                    type="button"
                    aria-label={`Add one ${detail.name}`}
                    onClick={() => setQty((q) => Math.min(selectedStock || 1, q + 1))}
                    disabled={qty >= selectedStock}
                  >
                    +
                  </button>
                </div>
              )}
              <button
                type="button"
                className="btn btn-primary product-card__cta"
                disabled={!canBuy}
                onClick={() => {
                  if (!canBuy) return;
                  onAddToCart(product, qty, selectedOpt?.variation ?? undefined);
                  onClose();
                }}
              >
                {cta.ctaLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Catalog({
  products,
  category,
  onAddToCart,
  brand,
  query: queryProp,
  onQueryChange,
}: {
  products: Product[];
  category: string;
  onAddToCart: (p: Product, qty?: number, variation?: { name: string; price: number }) => void;
  brand: Brand;
  /** Optional CONTROLLED search term. Omitted (every classic tenant) the
   *  catalog owns its own search box exactly as before; supplied, the term is
   *  lifted to the caller so a search field elsewhere on the page — the
   *  boutique layout's header bar — filters this same grid. */
  query?: string;
  onQueryChange?: (q: string) => void;
}) {
  // The owner shut the whole shop (Admin → Store Status). The catalog still
  // renders in full — that is the point of "closed" rather than "hidden" — but
  // every card's buy control goes inert. store.addToCart and the server's order
  // placement re-check the same rule, so this is presentation, not the gate.
  const storeClosed = isStoreClosed(brand.storeStatus);
  // Uncontrolled by default; the internal state is simply unused (and never
  // read) once a caller supplies `query`.
  const [ownQuery, setOwnQuery] = useState("");
  const controlled = queryProp !== undefined;
  const query = controlled ? queryProp : ownQuery;
  const setQuery = controlled ? (onQueryChange ?? (() => {})) : setOwnQuery;
  // "" = no explicit pick yet → the catalog shows the owner's configured order
  // (products blocked by sort category, featured pinned above everything).
  const [sort, setSort] = useState("");
  // The product whose full-detail quick-view modal is open (null = closed).
  const [selected, setSelected] = useState<Product | null>(null);

  // The sort menu is the owner's own list now (Admin → Product Sort Categories),
  // not a hardcoded three. A tenant who has never opened that screen is seeded
  // from their legacy catalogSortStyle, so their dropdown is unchanged. Best
  // sellers still rank by the server-computed units-sold map; the sorters stay
  // pure and are covered by npm run test:sort-categories.
  const sortCategories = useMemo(
    () => normalizeSortCategories(brand.sortCategories ?? seedSortCategories(brand.catalogSortStyle)),
    [brand.sortCategories, brand.catalogSortStyle],
  );
  const sortOptions = sortCategoryOptions(sortCategories);

  // The resting state is the FIRST row of the owner's menu — "Sort: Featured"
  // by default, but whatever they drag to the top after reordering, renaming or
  // deleting it. There is deliberately no unnamed placeholder option any more:
  // every row the shopper sees is a row the owner controls.
  const effectiveSort = sort || sortOptions[0]?.value || "";

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
    // No explicit pick → the owner's configured order: one block per sort
    // category, in admin order, unassigned products last. An explicit pick runs
    // that entry (a group floats its members; a built-in sorts everything).
    const sorted = effectiveSort
      ? sortByCategory(list, effectiveSort, sortCategories, { bestSellerCounts: brand.bestSellerCounts })
      : orderCatalogByCategories(list, sortCategories);

    // Featured products pin to the very top — but only on the default view and
    // on group picks. Pinning under an explicit "Price: Low to High" would put a
    // pricier featured item above a cheaper one and just read as a broken sort.
    // A group pick still floats featured products above its members. The
    // "featured" kind pins inside sortByCategory itself, so it is excluded here
    // to keep exactly one owner of that rule.
    const picked = sortCategories.find((c) => c.id === effectiveSort);
    const pinnable = !effectiveSort || picked?.kind === "group";
    const ranked = pinnable ? pinFeatured(sorted) : sorted;

    // On a "per-vial-first" store the packaging tier outranks everything above:
    // single per-vial listings lead, multi-vial kits sit underneath, and the
    // order computed above holds within each tier (orderOnHandProducts is
    // stable). Every other store is a pass-through.
    return orderOnHandProducts(ranked, normalizeOnHandOrder(brand.onHandOrder));
  }, [products, category, query, effectiveSort, sortCategories, brand.bestSellerCounts, brand.onHandOrder]);

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
                <select value={effectiveSort} onChange={(e) => setSort(e.target.value)}>
                  {/* Every option comes from the owner's list — including the
                      Featured row, which used to be hardcoded here and was the
                      one entry they could not rename, reorder or remove. */}
                  {sortOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
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
              defaultImage={brand.defaultProductImage}
              gbBlocked={isOnHandBlocked(p.id, brand.groupBuyGate)}
              storeClosed={storeClosed}
              onAdd={(qty, variation) => onAddToCart(p, qty, variation)}
              onOpenDetail={() => setSelected(p)}
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

      {selected && (
        <ProductDetailModal
          product={selected}
          onClose={() => setSelected(null)}
          onAddToCart={onAddToCart}
          defaultImage={brand.defaultProductImage}
          gbBlocked={isOnHandBlocked(selected.id, brand.groupBuyGate)}
          storeClosed={storeClosed}
        />
      )}
    </section>
  );
}

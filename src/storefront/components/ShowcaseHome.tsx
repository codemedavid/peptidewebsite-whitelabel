"use client";

// SHOWCASE home — the merchandised storefront layout: split hero, round
// category badges, a buyable featured shelf, promo cards and a trust strip
// (the promise bar above the header is chrome, rendered by StorefrontApp).
// Opt-in per tenant via brand.homeLayout === "showcase"; owner-selectable, no
// operator grant (see resolveHomeLayout).
//
// It is a TEMPLATE, so it composes existing pieces rather than introducing
// content of its own:
//
//   hero          → <ShowcaseHero>: the owner's hero copy + their own photos
//   discovery     → <ShowcaseCircles> derived from the tenant's own catalog
//   the shelf     → the catalog's own <ProductCard>s — same card design, stock,
//                   variation, store-closed and group-buy rules as the grid —
//                   plus its <ProductDetailModal> for the quick view
//   promos        → the Protocols hub (when that page is on) + their whole collection
//   assurances    → the owner's typed lines (shared with boutique/editorial)
//   the catalog   → <Catalog>, unchanged, on its own screen
//
// Every one of those sections disappears when its data is empty. All colour,
// type and spacing comes from --brand-* / the showcase.css scope.

import { useMemo, useState } from "react";
import type { Brand, Product } from "../types";
import { Catalog, ProductCard, ProductDetailModal } from "./Catalog";
import { Categories } from "./Categories";
import { GroupBuyBanner } from "./GroupBuyBanner";
import { ShowcaseHero } from "./ShowcaseHero";
import { ShowcaseArrow } from "./ShowcaseIcon";
import {
  ShowcaseCircles,
  ShowcasePromos,
  type ShowcaseCollection,
} from "./ShowcaseSections";
import { isPageVisible } from "../visibility";
import { buildCategoryTiles, normalizeAssurances } from "@/lib/storefront/boutique-home";
import {
  buildShowcaseFeatured,
  hasProtocolsHub,
  heroShowcaseImage,
  collectionImage,
  showcaseSections,
  type ShowcaseView,
} from "@/lib/storefront/showcase-home";
import { isOnHandBlocked } from "@/lib/storefront/group-buy";
import { isStoreClosed } from "@/lib/storefront/store-status";
import { findProductByLinkKey, productHash } from "@/lib/storefront/product-link";

type AddToCart = (p: Product, qty?: number, variation?: { name: string; price: number }) => void;

export function ShowcaseHome({
  view,
  onShopAll,
  onRoute,
  brand,
  products,
  category,
  query,
  onQueryChange,
  openProductSlug,
  onCategoryChange,
  onAddToCart,
  onHeroPrimary,
  onHeroSecondary,
  onHeroMedia,
  gbScope,
  onGbScope,
}: {
  /** "home" = the merchandised page (capped shelf, no full grid);
   *  "catalog" = the grid the shopper chose their way into. */
  view: ShowcaseView;
  onShopAll: () => void;
  /** Navigate to a storefront route through the shared hash router. */
  onRoute: (route: string) => void;
  brand: Brand;
  /** Already filtered to what a shopper may see (the caller drops unavailable
   *  products and applies any group-buy scoping), so badge counts and the shelf
   *  always match the grid. */
  products: Product[];
  category: string;
  query: string;
  onQueryChange: (q: string) => void;
  /** Product link key from a shared /p/<slug> link — honoured on BOTH screens:
   *  the grid opens it on the catalog, the shelf's quick view opens it here. */
  openProductSlug?: string | null;
  onCategoryChange: (id: string) => void;
  onAddToCart: AddToCart;
  onHeroPrimary: () => void;
  onHeroSecondary: () => void;
  onHeroMedia?: () => void;
  gbScope: boolean;
  onGbScope: (on: boolean) => void;
}) {
  const tiles = useMemo(
    () =>
      buildCategoryTiles(products, brand.categories, brand.defaultProductImage, {
        categoryImages: true,
      }),
    [products, brand.categories, brand.defaultProductImage],
  );
  const assurances = useMemo(
    () => normalizeAssurances(brand.boutique?.assurances),
    [brand.boutique?.assurances],
  );
  const shelf = useMemo(() => buildShowcaseFeatured(products), [products]);
  const heroImage = heroShowcaseImage(brand.heroMedia?.url);
  const protocolsHub = useMemo(
    () => hasProtocolsHub((route) => isPageVisible(brand, route)),
    [brand],
  );

  const collection: ShowcaseCollection | null =
    products.length === 0
      ? null
      : {
          title: brand.catalogTitle || "The full collection",
          productCount: products.length,
          categoryCount: tiles.length,
          image: collectionImage(products),
          cta: brand.ctaLabel || "Shop now",
        };

  // A badge is a way INTO the catalog: it picks the shelf, then hands over to
  // the catalog screen.
  const selectCategory = (id: string) => {
    onCategoryChange(id);
    onShopAll();
  };

  const sections = showcaseSections(view);
  const shows = (section: string) => sections.includes(section as never);

  return (
    <div className="sc">
      {shows("hero") && brand.showHero !== false && (
        <ShowcaseHero
          brand={brand}
          image={heroImage}
          assurances={assurances}
          onPrimary={onHeroPrimary}
          onSecondary={onHeroSecondary}
          onMedia={onHeroMedia}
        />
      )}

      {shows("circles") && brand.showCategories !== false && (
        <ShowcaseCircles tiles={tiles} onSelect={selectCategory} />
      )}

      {shows("featured") && brand.showCatalog !== false && (
        <ShowcaseShelf
          brand={brand}
          products={shelf.products}
          allProducts={products}
          curated={shelf.curated}
          openProductSlug={openProductSlug}
          onAddToCart={onAddToCart}
          onShopAll={onShopAll}
        />
      )}

      {shows("promos") && (
        <ShowcasePromos
          protocolsHub={protocolsHub}
          collection={brand.showCatalog !== false ? collection : null}
          onRoute={onRoute}
          onShopAll={onShopAll}
        />
      )}

      {shows("chips") && brand.showCategories !== false && (
        <Categories
          categories={brand.categories ?? []}
          active={category}
          onChange={onCategoryChange}
        />
      )}

      {shows("catalog") && brand.groupBuyBanner && (
        <GroupBuyBanner banner={brand.groupBuyBanner} scopeOn={gbScope} onToggle={onGbScope} />
      )}

      {shows("catalog") && brand.showCatalog !== false && (
        <Catalog
          products={products}
          category={category}
          query={query}
          onQueryChange={onQueryChange}
          openProductSlug={openProductSlug}
          onAddToCart={onAddToCart}
          brand={brand}
        />
      )}

    </div>
  );
}

/** The home's buyable shelf. Real catalog cards, so buying here obeys exactly
 *  the rules the grid does; the quick view is the catalog's own modal. */
function ShowcaseShelf({
  brand,
  products,
  allProducts,
  curated,
  openProductSlug,
  onAddToCart,
  onShopAll,
}: {
  brand: Brand;
  products: Product[];
  /** The whole visible catalog — a shared link may name a product that is not
   *  on the shelf, and the quick view should still open it. */
  allProducts: Product[];
  curated: boolean;
  openProductSlug?: string | null;
  onAddToCart: AddToCart;
  onShopAll: () => void;
}) {
  // Seeded on the first render (not in an effect) for the same reason the
  // catalog does it: a pasted product link should paint with its quick view
  // already open, not flash the bare page first.
  const [selected, setSelected] = useState<Product | null>(() =>
    openProductSlug ? findProductByLinkKey(allProducts, openProductSlug) : null,
  );
  const storeClosed = isStoreClosed(brand.storeStatus);

  if (products.length === 0) return null;

  // Same address-bar contract as the catalog: the open product's own link is in
  // the URL (shareable, survives Back), written with replaceState so the SPA
  // router does not treat it as a navigation.
  const open = (product: Product) => {
    setSelected(product);
    window.history.replaceState(null, "", productHash(product));
  };
  const close = () => {
    setSelected(null);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  const heading = curated ? "Featured products" : brand.catalogTitle || "Shop the collection";

  return (
    <section className="sc-shelf" aria-labelledby="sc-shelf-heading">
      <div className="container">
        <header className="sc-shelf__head">
          <h2 id="sc-shelf-heading" className="sc-shelf__title font-display">
            {heading}
          </h2>
          <button type="button" className="sc-shelf__all" onClick={onShopAll}>
            View all
            <ShowcaseArrow />
          </button>
        </header>

        <div className="catalog__grid sc-shelf__grid" data-cd-grid={brand.cardDesign?.layout || undefined}>
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              design={brand.cardDesign}
              defaultImage={brand.defaultProductImage}
              gbBlocked={isOnHandBlocked(product.id, brand.groupBuyGate)}
              storeClosed={storeClosed}
              storeName={brand.name}
              onAdd={(qty, variation) => onAddToCart(product, qty, variation)}
              onOpenDetail={() => open(product)}
            />
          ))}
        </div>
      </div>

      {selected && (
        <ProductDetailModal
          product={selected}
          onClose={close}
          onAddToCart={onAddToCart}
          defaultImage={brand.defaultProductImage}
          gbBlocked={isOnHandBlocked(selected.id, brand.groupBuyGate)}
          storeClosed={storeClosed}
          brand={brand}
        />
      )}
    </section>
  );
}

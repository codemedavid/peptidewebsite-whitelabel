"use client";

// EDITORIAL home — the left-rail, type-led storefront layout (reference design:
// "SKN Storefront"). Opt-in per tenant via brand.homeLayout === "editorial";
// owner-selectable, no operator grant (see resolveHomeLayout).
//
// It is a TEMPLATE, so it composes existing pieces rather than introducing
// content of its own:
//
//   hero        → <Hero> (brand.heroMedia image mode, or the written hero)
//   discovery   → <CategoryIndex>, derived from the tenant's own catalog
//   the edit    → <EditorialEdit>, the owner's own featured products
//   assurances  → the owner's typed lines (shared with the boutique layout,
//                 so switching layout never loses them). Empty by default.
//   contact     → the tenant's active contact channels
//   the catalog → <Catalog>, unchanged, with its card design + sort rules
//
// Every one of those sections disappears when its data is empty, so a brand-new
// store with one product and no settings still renders a coherent page. All
// colour, type and spacing comes from --brand-* / the editorial.css scope.
//
// The chrome (the rail itself) is <EditorialRail>, rendered by StorefrontApp in
// place of <Header> — it has to sit outside this component because it persists
// across every route, not just the home and catalog screens.

import { useMemo } from "react";
import type { Brand, Product } from "../types";
import { Hero } from "./Hero";
import { Catalog } from "./Catalog";
import { Categories } from "./Categories";
import { CategoryIndex } from "./CategoryIndex";
import { EditorialEdit } from "./EditorialEdit";
import { GroupBuyBanner } from "./GroupBuyBanner";
import {
  buildCategoryIndex,
  buildEditRow,
  editorialSections,
  type EditorialView,
} from "@/lib/storefront/editorial-home";
import { normalizeAssurances } from "@/lib/storefront/boutique-home";
import { activeChannels, channelUrl, CHANNEL_LABELS } from "../checkout";

export function EditorialHome({
  view,
  onShopAll,
  brand,
  products,
  category,
  query,
  onQueryChange,
  onCategoryChange,
  onAddToCart,
  onHeroPrimary,
  onHeroSecondary,
  onHeroMedia,
  gbScope,
  onGbScope,
}: {
  /** "home" = discovery only (no product grid — see editorialSections);
   *  "catalog" = the grid the shopper chose their way into. */
  view: EditorialView;
  onShopAll: () => void;
  brand: Brand;
  /** Already filtered to what a shopper may see (the caller drops unavailable
   *  products and applies any group-buy scoping), so the index counts below
   *  always match the grid. */
  products: Product[];
  category: string;
  query: string;
  onQueryChange: (q: string) => void;
  onCategoryChange: (id: string) => void;
  onAddToCart: (p: Product, qty?: number, variation?: { name: string; price: number }) => void;
  onHeroPrimary: () => void;
  onHeroSecondary: () => void;
  onHeroMedia?: () => void;
  gbScope: boolean;
  onGbScope: (on: boolean) => void;
}) {
  const rows = useMemo(
    () => buildCategoryIndex(products, brand.categories),
    [products, brand.categories],
  );
  const edit = useMemo(() => buildEditRow(products), [products]);
  const assurances = useMemo(
    () => normalizeAssurances(brand.boutique?.assurances),
    [brand.boutique?.assurances],
  );
  const channels = useMemo(() => activeChannels(brand), [brand]);

  // An index row is a way INTO the catalog: it picks the shelf, then hands over
  // to the catalog screen. The home itself lists no products.
  const selectCategory = (id: string) => {
    onCategoryChange(id);
    onShopAll();
  };

  const sections = editorialSections(view);
  const shows = (section: string) => sections.includes(section as never);

  return (
    <div className="ed">
      {shows("hero") && brand.showHero !== false && (
        <Hero
          brand={brand}
          onPrimary={onHeroPrimary}
          onSecondary={onHeroSecondary}
          onMedia={onHeroMedia}
        />
      )}

      {shows("index") && brand.showCategories !== false && (
        <CategoryIndex rows={rows} eyebrow="Shop by category" onSelect={selectCategory} />
      )}

      {shows("edit") && brand.showCatalog !== false && (
        <EditorialEdit
          products={edit}
          brand={brand}
          eyebrow="Featured"
          onShopAll={onShopAll}
          // A featured card opens the shelf it belongs to rather than a product
          // page: this layout's product detail IS the catalog's quick view, so
          // filtering to its category is the shortest honest route to it.
          onOpen={(product) => selectCategory(product.category)}
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
          onAddToCart={onAddToCart}
          brand={brand}
        />
      )}

      {shows("assurances") && assurances.length > 0 && (
        <section className="ed-notes" aria-label="What we promise">
          <div className="container">
            <ul className="ed-notes__row">
              {assurances.map((item) => (
                <li key={item.id} className="ed-notes__item">
                  <span className="ed-notes__label">{item.label}</span>
                  {item.note && <p className="ed-notes__note">{item.note}</p>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {shows("contact") && channels.length > 0 && (
        <section className="ed-contact" aria-label="Contact us">
          <div className="container ed-contact__inner">
            <p className="ed-eyebrow">Get in touch</p>
            <ul className="ed-contact__links">
              {channels.map((channel) => (
                <li key={channel.type}>
                  <a
                    className="ed-contact__link"
                    href={channelUrl(channel, "")}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="ed-contact__channel">{CHANNEL_LABELS[channel.type]}</span>
                    <span className="ed-contact__dest font-display">
                      {channel.destination.trim()}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

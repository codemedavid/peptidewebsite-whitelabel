"use client";

// BOUTIQUE home — the imagery-led, category-first storefront layout
// (reference: cherieandco.ph). Opt-in per tenant via brand.homeLayout ===
// "boutique"; owner-selectable, no operator grant (see resolveHomeLayout).
//
// It is a TEMPLATE, so it composes existing pieces rather than introducing
// content of its own:
//
//   hero banner   → <Hero> (brand.heroMedia image mode, or the written hero)
//   discovery     → <CategoryTiles> derived from the tenant's own catalog
//   the catalog   → <Catalog>, unchanged, with its card design + sort rules
//   assurances    → the owner's own typed lines (empty by default)
//   contact       → the tenant's active contact channels
//
// Every one of those sections disappears when its data is empty, so a brand-new
// store with one product and no settings still renders a coherent page. All
// colour, type and spacing comes from --brand-* / the boutique.css scope.

import { useMemo } from "react";
import type { Brand, Product } from "../types";
import { Hero } from "./Hero";
import { Catalog } from "./Catalog";
import { CategoryTiles } from "./CategoryTiles";
import { Categories } from "./Categories";
import { GroupBuyBanner } from "./GroupBuyBanner";
import {
  boutiqueSections,
  buildCategoryTiles,
  normalizeAssurances,
  type BoutiqueView,
} from "@/lib/storefront/boutique-home";
import { activeChannels, channelUrl, CHANNEL_LABELS } from "../checkout";

export function BoutiqueHome({
  view,
  onShopAll,
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
  /** "home" = discovery only (no product grid — see boutiqueSections);
   *  "catalog" = the grid the shopper chose their way into. */
  view: BoutiqueView;
  onShopAll: () => void;
  brand: Brand;
  /** Already filtered to what a shopper may see (the caller drops unavailable
   *  products and applies any group-buy scoping), so the tile counts below
   *  always match the grid. */
  products: Product[];
  category: string;
  query: string;
  onQueryChange: (q: string) => void;
  /** Product link key from a shared /p/<slug> link, forwarded to the grid
   *  below so this layout honours share links exactly like the classic home. */
  openProductSlug?: string | null;
  onCategoryChange: (id: string) => void;
  onAddToCart: (p: Product, qty?: number, variation?: { name: string; price: number }) => void;
  onHeroPrimary: () => void;
  onHeroSecondary: () => void;
  onHeroMedia?: () => void;
  gbScope: boolean;
  onGbScope: (on: boolean) => void;
}) {
  const tiles = useMemo(
    () => buildCategoryTiles(products, brand.categories, brand.defaultProductImage),
    [products, brand.categories, brand.defaultProductImage],
  );
  const assurances = useMemo(
    () => normalizeAssurances(brand.boutique?.assurances),
    [brand.boutique?.assurances],
  );
  const channels = useMemo(() => activeChannels(brand), [brand]);

  // A tile is a way INTO the catalog: it picks the shelf, then hands over to the
  // catalog screen. The home itself lists no products.
  const selectCategory = (id: string) => {
    onCategoryChange(id);
    onShopAll();
  };

  const sections = boutiqueSections(view);
  const shows = (section: string) => sections.includes(section as never);

  return (
    <div className="bq">
      {shows("hero") && brand.showHero !== false && (
        <Hero
          brand={brand}
          onPrimary={onHeroPrimary}
          onSecondary={onHeroSecondary}
          onMedia={onHeroMedia}
        />
      )}

      {shows("tiles") && brand.showCategories !== false && (
        <CategoryTiles
          tiles={tiles}
          eyebrow="Browse"
          title="Shop by category"
          onSelect={selectCategory}
        />
      )}

      {/* One way through to the whole grid, for the shopper who does not want to
          start from a shelf. Uses the owner's own CTA label. */}
      {shows("shopAll") && brand.showCatalog !== false && (
        <section className="bq-shopall">
          <div className="container bq-shopall__inner">
            <button type="button" className="btn btn-primary bq-shopall__btn" onClick={onShopAll}>
              {brand.ctaLabel || "Shop all products"}
            </button>
          </div>
        </section>
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

      {shows("assurances") && assurances.length > 0 && (
        <section className="bq-assure" aria-label="What we promise">
          <div className="container">
            <ul className="bq-assure__row">
              {assurances.map((item) => (
                <li key={item.id} className="bq-assure__item">
                  <span className="bq-assure__label font-display">{item.label}</span>
                  {item.note && <span className="bq-assure__note">{item.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {shows("contact") && channels.length > 0 && (
        <section className="bq-contact" aria-label="Contact us">
          <div className="container bq-contact__inner">
            <p className="bq-contact__lead font-display">Questions before you order?</p>
            <ul className="bq-contact__links">
              {channels.map((channel) => (
                <li key={channel.type}>
                  <a
                    className="bq-contact__link"
                    href={channelUrl(channel, "")}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="bq-contact__channel">{CHANNEL_LABELS[channel.type]}</span>
                    <span className="bq-contact__dest">{channel.destination.trim()}</span>
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

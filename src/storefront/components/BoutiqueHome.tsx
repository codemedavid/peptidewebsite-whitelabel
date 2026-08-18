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
import { GroupBuyBanner } from "./GroupBuyBanner";
import { buildCategoryTiles, normalizeAssurances } from "@/lib/storefront/boutique-home";
import { activeChannels, channelUrl, CHANNEL_LABELS } from "../checkout";

export function BoutiqueHome({
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
  brand: Brand;
  /** Already filtered to what a shopper may see (the caller drops unavailable
   *  products and applies any group-buy scoping), so the tile counts below
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
  const tiles = useMemo(
    () => buildCategoryTiles(products, brand.categories, brand.defaultProductImage),
    [products, brand.categories, brand.defaultProductImage],
  );
  const assurances = useMemo(
    () => normalizeAssurances(brand.boutique?.assurances),
    [brand.boutique?.assurances],
  );
  const channels = useMemo(() => activeChannels(brand), [brand]);

  // Picking a tile filters the grid below and takes the shopper straight to it —
  // the tiles are a way INTO the catalog, not a separate destination.
  const selectCategory = (id: string) => {
    onCategoryChange(id);
    document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="bq">
      {brand.showHero !== false && (
        <Hero
          brand={brand}
          onPrimary={onHeroPrimary}
          onSecondary={onHeroSecondary}
          onMedia={onHeroMedia}
        />
      )}

      {brand.showCategories !== false && (
        <CategoryTiles
          tiles={tiles}
          eyebrow={brand.catalogEyebrow || "Browse"}
          title="Shop by category"
          onSelect={selectCategory}
        />
      )}

      {brand.groupBuyBanner && (
        <GroupBuyBanner banner={brand.groupBuyBanner} scopeOn={gbScope} onToggle={onGbScope} />
      )}

      {brand.showCatalog !== false && (
        <Catalog
          products={products}
          category={category}
          query={query}
          onQueryChange={onQueryChange}
          onAddToCart={onAddToCart}
          brand={brand}
        />
      )}

      {assurances.length > 0 && (
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

      {channels.length > 0 && (
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

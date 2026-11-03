"use client";

// INTL & LOCAL home — the owner's sections in the owner's order — and its
// catalog SCREEN (#catalog). Like boutique / editorial / showcase the home
// carries no product grid: the market cards and menus lead into the catalog,
// which is the store's own unchanged <Catalog> (same cards, stock, variation,
// store-closed and group-buy rules), so this template adds no buying logic.

import type { IntlLocalConfig } from "@/lib/storefront/intl-local/config";
import type { Brand, Product } from "../../types";
import { Catalog } from "../Catalog";
import { Categories } from "../Categories";
import { GroupBuyBanner } from "../GroupBuyBanner";
import { useStore } from "../../store";
import { INTL_CURRENCY, type Market } from "@/lib/storefront/markets";
import { marketLink } from "@/lib/storefront/intl-local/links";
import { IlLinkAnchor } from "./il-nav";
import {
  IlBandSection,
  IlHeroSection,
  IlLearnSection,
  IlMarketsSection,
  IlNewsletterSection,
  type SubscribeResult,
} from "./IntlLocalSections";

type Subscribe = (email: string, honeypot: string) => Promise<SubscribeResult>;

/** The home sections, in config order. Shared with the admin live preview. */
export function IlHomeSections({ config, onSubscribe }: { config: IntlLocalConfig; onSubscribe: Subscribe }) {
  return (
    <>
      {config.order.map((key) => {
        switch (key) {
          case "hero":
            return <IlHeroSection key={key} hero={config.hero} />;
          case "markets":
            return <IlMarketsSection key={key} markets={config.markets} />;
          case "learn":
            return <IlLearnSection key={key} learn={config.learn} />;
          case "community":
            return <IlBandSection key={key} band={config.community} anchor="il-community" />;
          case "newsletter":
            return <IlNewsletterSection key={key} newsletter={config.newsletter} onSubscribe={onSubscribe} />;
          default: {
            const id = key.startsWith("custom:") ? key.slice(7) : "";
            const band = config.customSections.find((s) => s.id === id);
            return band ? <IlBandSection key={key} band={band} anchor={`il-custom-${id}`} /> : null;
          }
        }
      })}
    </>
  );
}

type AddToCart = (p: Product, qty?: number, variation?: { name: string; price: number }) => void;

/** The card that advertises `market` (its button opens that market's shop). */
function marketCardFor(config: IntlLocalConfig, market: Market) {
  return config.markets.cards.find((c) => c.button.link.type === "market" && (c.button.link.market ?? "local") === market);
}

/** The top of a market's shop page: which shop this is, its currency, and the
 *  way to the other one. Copy comes from that market's card on the home. */
function MarketBar({ config, market }: { config: IntlLocalConfig; market: Market }) {
  const card = marketCardFor(config, market);
  const other: Market = market === "local" ? "international" : "local";
  const otherCard = marketCardFor(config, other);
  const title = card ? [card.title, card.currency].filter(Boolean).join(" · ") : market === "local" ? "Local shop" : "International shop";
  return (
    <header className="il-marketbar" aria-label="Shop">
      <div>
        {card?.eyebrow && <p className="il-eyebrow il-eyebrow--sm">{card.eyebrow}</p>}
        <h1 className="il-marketbar__title">{title}</h1>
        {card?.description && <p className="il-marketbar__desc">{card.description}</p>}
        {market === "international" && (
          <p className="il-marketbar__note">Prices in {INTL_CURRENCY.code}. This shop has its own cart and checkout.</p>
        )}
      </div>
      <IlLinkAnchor link={marketLink(other)} className="il-marketbar__switch">
        {otherCard ? `Switch to ${[otherCard.title, otherCard.currency].filter(Boolean).join(" · ")}` : other === "local" ? "Switch to the local shop" : "Switch to the international shop"}
        <span aria-hidden="true"> →</span>
      </IlLinkAnchor>
    </header>
  );
}

export function IntlLocalHome({
  view,
  brand,
  config,
  market = null,
  products,
  category,
  query,
  onQueryChange,
  onCategoryChange,
  onAddToCart,
  openProductSlug,
  gbScope,
  onGbScope,
  onSubscribe,
}: {
  view: "home" | "catalog";
  brand: Brand;
  config: IntlLocalConfig;
  /** Dual-currency stores: which market's shop this is (null = one market). */
  market?: Market | null;
  products: Product[];
  category: string;
  query: string;
  onQueryChange: (q: string) => void;
  onCategoryChange: (id: string) => void;
  onAddToCart: AddToCart;
  openProductSlug?: string | null;
  gbScope: boolean;
  onGbScope: (on: boolean) => void;
  onSubscribe: Subscribe;
}) {
  const { categories } = useStore();
  if (view === "home") {
    return (
      <main className="il-main il-main--home il-wrap">
        <IlHomeSections config={config} onSubscribe={onSubscribe} />
      </main>
    );
  }
  // Prices on the International shop are USD views of each product; the
  // catalog formats money with the brand's symbol, so hand it the market's.
  const shopBrand = market === "international" ? { ...brand, currency: INTL_CURRENCY.symbol } : brand;
  return (
    <main className="il-main il-wrap il-catalog">
      {market && <MarketBar config={config} market={market} />}
      {brand.showCategories !== false && <Categories categories={categories} active={category} onChange={onCategoryChange} />}
      {brand.groupBuyBanner && <GroupBuyBanner banner={brand.groupBuyBanner} scopeOn={gbScope} onToggle={onGbScope} />}
      {brand.showCatalog !== false && (
        <Catalog
          products={products}
          category={category}
          onAddToCart={onAddToCart}
          brand={shopBrand}
          openProductSlug={openProductSlug}
          query={query}
          onQueryChange={onQueryChange}
        />
      )}
    </main>
  );
}

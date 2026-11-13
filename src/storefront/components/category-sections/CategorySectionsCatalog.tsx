"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { Brand, Category, Product } from "../../types";
import { ProductCard, ProductDetailModal } from "../Catalog";
import { useProductDetail } from "../useProductDetail";
import { CategoryNav } from "./CategoryNav";
import {
  buildCategorySections,
  filterSections,
  withFeaturedSection,
} from "@/lib/storefront/category-sections";
import { isOnHandBlocked } from "@/lib/storefront/group-buy";
import { isStoreClosed } from "@/lib/storefront/store-status";
import { roundKitProgress } from "@/lib/storefront/gb-moq-kits";
import "./category-sections.css";

interface CategorySectionsCatalogProps {
  products: Product[];
  categories: Category[];
  brand: Brand;
  onAddToCart: (p: Product, qty?: number, variation?: { name: string; price: number }) => void;
  /** Shared /p/<slug> or #p/<slug> link to open in the quick-view. */
  openProductSlug?: string | null;
  /** brand.showCategories — false keeps the sections but drops the tab bar. */
  showNav: boolean;
}

/**
 * The category-sections catalog (FEATURES.STORE_CATEGORY_SECTIONS): every
 * category as its own section — heading + the usual product grid — in the
 * owner's Categories order, products in each category's own arranged order,
 * under a sticky tab bar that follows the scroll. Same product cards, quick
 * view, cart and search as the classic catalog; only the arrangement differs.
 * The sort dropdown is deliberately absent: the owner's arrangement IS the order.
 * Featured products also lead in their own "Featured" section (withFeaturedSection).
 */
export function CategorySectionsCatalog({
  products,
  categories,
  brand,
  onAddToCart,
  openProductSlug,
  showNav,
}: CategorySectionsCatalogProps) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const sectionEls = useRef(new Map<string, HTMLElement>());
  const { selected, openDetail, closeDetail } = useProductDetail(products, openProductSlug);
  const storeClosed = isStoreClosed(brand.storeStatus);

  const allSections = useMemo(
    () => withFeaturedSection(buildCategorySections(products, categories, brand.categoryProductOrder)),
    [products, categories, brand.categoryProductOrder],
  );
  const sections = useMemo(() => filterSections(allSections, query), [allSections, query]);
  const navSections = useMemo(() => sections.map((s) => ({ id: s.id, label: s.label })), [sections]);
  // Featured repeats products shown in their categories — count each once.
  const total = new Set(sections.flatMap((s) => s.products.map((p) => p.id))).size;

  return (
    <section className="catalog section catsec" id="catalog">
      <div className="container">
        <div className="catalog__header">
          <div>
            <div className="eyebrow">{brand.catalogEyebrow || "Catalog"}</div>
            <h2 className="catalog__title font-display">{brand.catalogTitle || "Our Collection"}</h2>
          </div>
          {brand.catalogShowSearch !== false && (
            <div className="catalog__controls">
              <label className="input-wrap" aria-label="Search">
                <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products…" type="search" />
              </label>
            </div>
          )}
        </div>
        {brand.catalogShowCount !== false && (
          <div className="catalog__count eyebrow">
            {total} {total === 1 ? "Product" : "Products"}
          </div>
        )}
      </div>

      {showNav && <CategoryNav sections={navSections} sectionEls={sectionEls} />}

      <div className="container catsec__body">
        {sections.map((s, i) => {
          const headingId = `${uid}-h${i}`;
          return (
            <section
              key={s.id}
              className="catsec__section"
              aria-labelledby={headingId}
              data-catsec-id={s.id}
              ref={(el) => {
                if (el) sectionEls.current.set(s.id, el);
                else sectionEls.current.delete(s.id);
              }}
            >
              <h3 id={headingId} className="catsec__title font-display" tabIndex={-1} data-catsec-heading>
                {s.label}
                <span className="catsec__count">{s.products.length}</span>
              </h3>
              <div className="catalog__grid" data-cd-grid={brand.cardDesign?.layout || undefined}>
                {s.products.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    design={brand.cardDesign}
                    defaultImage={brand.defaultProductImage}
                    gbBlocked={isOnHandBlocked(p.id, brand.groupBuyGate)}
                    storeClosed={storeClosed}
                    storeName={brand.name}
                    preselectOption={brand.variationPreselect}
                    kit={roundKitProgress(p, brand.groupBuyBanner)}
                    onAdd={(qty, variation) => onAddToCart(p, qty, variation)}
                    onOpenDetail={() => openDetail(p)}
                  />
                ))}
              </div>
            </section>
          );
        })}
        {sections.length === 0 && (
          <div className="catalog__empty">
            <p className="font-display" style={{ fontSize: 28, margin: 0 }}>No matches.</p>
            <p style={{ color: "var(--brand-text-muted)" }}>
              {query.trim() ? "Try a different search." : "No products yet."}
            </p>
          </div>
        )}
      </div>

      {selected && (
        <ProductDetailModal
          product={selected}
          onClose={closeDetail}
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

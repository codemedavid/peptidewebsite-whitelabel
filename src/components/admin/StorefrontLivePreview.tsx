"use client";

// Faithful, in-admin preview of the live storefront. Unlike the approximate
// hero mock, this renders the *real* storefront components from the current
// (unsaved) Brand, so every Sections/Pages show-hide toggle takes effect here
// before the operator presses "Save branding". A small tab strip lets them
// jump between the home view and each sub-page; hidden pages drop out of the
// strip exactly as they drop out of the live site's nav/footer.

import { useState } from "react";
import "@/storefront/storefront.css";
import { StoreProvider } from "@/storefront/store";
import type { Brand } from "@/storefront/types";
import { SEED_CATEGORIES, SEED_PRODUCTS } from "@/storefront/data";
import { Header } from "@/storefront/components/Header";
import { Hero } from "@/storefront/components/Hero";
import { Categories } from "@/storefront/components/Categories";
import { Catalog } from "@/storefront/components/Catalog";
import { Footer } from "@/storefront/components/Footer";
import { TrackOrderPage } from "@/storefront/pages/TrackOrderPage";
import { FAQPage } from "@/storefront/pages/FAQPage";
import { COAPage } from "@/storefront/pages/COAPage";
import { ProtocolsPage } from "@/storefront/pages/ProtocolsPage";
import { ReviewsPage } from "@/storefront/pages/ReviewsPage";
import { isPageVisible } from "@/storefront/visibility";

// Mirror store.tsx's applyBrandStyle, but scoped to the preview's .sf-root so
// edits re-theme the preview live without touching the admin's own tokens.
function brandVars(b: Brand): React.CSSProperties {
  return {
    "--brand-main": b.main,
    "--brand-accent": b.accent,
    "--brand-button": b.button,
    "--brand-button-2": b.button2,
    "--brand-button-text": b.buttonText,
    "--brand-background": b.background,
    "--brand-surface": b.surface,
    "--brand-text": b.text,
    "--brand-heading-font": `"${b.headingFont}", Georgia, serif`,
    "--brand-body-font": `"${b.bodyFont}", system-ui, sans-serif`,
  } as React.CSSProperties;
}

const TABS: { id: string; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "track", label: "Track Order" },
  { id: "faq", label: "FAQ" },
  { id: "coa", label: "Lab Reports" },
  { id: "protocols", label: "Protocols" },
  { id: "reviews", label: "Reviews" },
];

export function StorefrontLivePreview({ brand }: { brand: Brand }) {
  const [page, setPage] = useState("home");
  const [category, setCategory] = useState("all");

  // A toggled-off page falls back to home — same rule the live storefront uses.
  const activePage = isPageVisible(brand, page) ? page : "home";
  const goHome = () => setPage("home");

  // Home is always available; sub-page tabs follow their visibility toggle.
  const tabs = TABS.filter((t) => t.id === "home" || isPageVisible(brand, t.id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setPage(t.id)}
            aria-pressed={activePage === t.id}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              activePage === t.id
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-h-[640px] overflow-y-auto overflow-x-hidden rounded-[var(--radius)] border border-border">
        <StoreProvider brand={brand}>
          <div className="sf-root" style={brandVars(brand)}>
            {brand.showHeader !== false && (
              <Header brand={brand} cartCount={0} onShopClick={goHome} />
            )}

            {activePage === "track" && <TrackOrderPage brand={brand} onBack={goHome} />}
            {activePage === "faq" && <FAQPage brand={brand} onBack={goHome} />}
            {activePage === "coa" && <COAPage brand={brand} onBack={goHome} />}
            {activePage === "protocols" && <ProtocolsPage brand={brand} onBack={goHome} />}
            {activePage === "reviews" && <ReviewsPage brand={brand} onBack={goHome} />}

            {activePage === "home" && (
              <>
                {brand.showHero !== false && (
                  <Hero brand={brand} onPrimary={goHome} onSecondary={goHome} />
                )}
                {brand.showCategories !== false && (
                  <Categories categories={SEED_CATEGORIES} active={category} onChange={setCategory} />
                )}
                {brand.showCatalog !== false && (
                  <Catalog products={SEED_PRODUCTS} category={category} onAddToCart={() => {}} brand={brand} />
                )}
              </>
            )}

            {brand.showFooter !== false && <Footer brand={brand} />}
          </div>
        </StoreProvider>
      </div>
    </div>
  );
}

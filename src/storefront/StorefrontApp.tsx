"use client";

// Root of the white-label storefront. Hash-routed single-page app (mirrors the
// design prototype): header + footer persist across the home/sub-pages, while
// #admin renders the password-gated store admin with its own chrome.

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { StoreProvider, useStore } from "./store";
import type { Brand, Product } from "./types";
import { BRAND } from "./data";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { Categories } from "./components/Categories";
import { Catalog } from "./components/Catalog";
import { Footer } from "./components/Footer";
import { CartCheckout } from "./components/CartCheckout";
import { ADMIN_AUTH_KEY } from "./admin/authKey";
import { isPageVisible } from "./visibility";
import { hasStorefrontAdminSessionAction } from "@/actions/storefront-admin";

// Spinner shown while any lazy page chunk is downloading for the first time.
function PageSpinner() {
  return (
    <div className="sf-page-spinner">
      <div className="sf-page-spinner__ring" />
    </div>
  );
}

// The home/catalog view is what (nearly) every visitor sees, so only its
// chrome is bundled eagerly above. The secondary sub-pages and the entire
// password-gated admin tree are code-split: they download on demand the first
// time their hash route is hit, keeping the public first-load JS small.
const TrackOrderPage = dynamic(() => import("./pages/TrackOrderPage").then((m) => m.TrackOrderPage), { ssr: false, loading: PageSpinner });
const FAQPage = dynamic(() => import("./pages/FAQPage").then((m) => m.FAQPage), { ssr: false, loading: PageSpinner });
const COAPage = dynamic(() => import("./pages/COAPage").then((m) => m.COAPage), { ssr: false, loading: PageSpinner });
const ProtocolsPage = dynamic(() => import("./pages/ProtocolsPage").then((m) => m.ProtocolsPage), { ssr: false, loading: PageSpinner });
const ReviewsPage = dynamic(() => import("./pages/ReviewsPage").then((m) => m.ReviewsPage), { ssr: false, loading: PageSpinner });
const AdminLogin = dynamic(() => import("./admin/AdminLogin").then((m) => m.AdminLogin), { ssr: false, loading: PageSpinner });
const AdminPage = dynamic(() => import("./admin/AdminPage").then((m) => m.AdminPage), { ssr: false, loading: PageSpinner });

const ROUTES = ["track", "faq", "coa", "protocols", "reviews", "catalog", "admin"];

function pageFromHash(): string {
  if (typeof window === "undefined") return "home";
  const h = (window.location.hash || "").replace(/^#/, "");
  return ROUTES.includes(h) ? h : "home";
}

function Shell() {
  const { brand, products, categories, cart, addToCart } = useStore();
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState("home");
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  // Drives the top progress bar — fires immediately on any hash navigation so
  // users get instant visual feedback even before the JS chunk loads.
  const [navKey, setNavKey] = useState(0);

  // A toggled-off sub-page should behave as if it isn't there: treat its hash
  // as "home" so direct visits land on the storefront instead of a blank shell.
  const activePage = page === "admin" || isPageVisible(brand, page) ? page : "home";

  // Resolve initial route + auth after mount (avoids SSR hash mismatch).
  useEffect(() => {
    setPage(pageFromHash());

    // The admin gate is a REAL server session, not just the sessionStorage flag.
    // We optimistically trust the flag for instant UI, then confirm against the
    // server: if there's no valid sf_admin_session cookie, force re-login (and
    // clear the stale flag) so the user can't sit in the admin issuing saves
    // that would be silently rejected.
    const verifyAdmin = () => {
      let optimistic = false;
      try {
        optimistic = sessionStorage.getItem(ADMIN_AUTH_KEY) === "1";
      } catch {
        /* ignore */
      }
      setAdminAuthed(optimistic);
      void hasStorefrontAdminSessionAction()
        .then((ok) => {
          setAdminAuthed(ok);
          try {
            if (ok) sessionStorage.setItem(ADMIN_AUTH_KEY, "1");
            else sessionStorage.removeItem(ADMIN_AUTH_KEY);
          } catch {
            /* ignore */
          }
        })
        .catch(() => {});
    };
    if (pageFromHash() === "admin") verifyAdmin();

    const onHash = () => {
      const next = pageFromHash();
      setNavKey((k) => k + 1); // triggers a fresh progress bar animation
      setPage(next);
      if (next === "admin") verifyAdmin();
      if (next !== "catalog") window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const goHome = () => {
    window.location.hash = "";
    setPage("home");
  };
  const logoutAdmin = () => {
    try {
      sessionStorage.removeItem(ADMIN_AUTH_KEY);
    } catch {
      /* ignore */
    }
    setAdminAuthed(false);
    goHome();
  };
  const scrollToCatalog = () => {
    document.querySelector("#catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Admin — password-gated, no site chrome (branding editor still available).
  if (activePage === "admin") {
    return (
      <>
        {navKey > 0 && <div key={navKey} className="sf-nav-progress" />}
        {adminAuthed ? (
          <AdminPage brand={brand} onLogout={logoutAdmin} onExitToSite={goHome} />
        ) : (
          <AdminLogin brand={brand} onSuccess={() => setAdminAuthed(true)} />
        )}
      </>
    );
  }

  return (
    <>
      {navKey > 0 && <div key={navKey} className="sf-nav-progress" />}
      {brand.showHeader !== false && (
        <Header
          brand={brand}
          cartCount={cart.length}
          onCartClick={() => setCartOpen(true)}
          onShopClick={() => {
            if (page !== "home") goHome();
            setTimeout(scrollToCatalog, 50);
          }}
        />
      )}

      {activePage === "track" && <TrackOrderPage brand={brand} onBack={goHome} />}
      {activePage === "faq" && <FAQPage brand={brand} onBack={goHome} />}
      {activePage === "coa" && <COAPage brand={brand} onBack={goHome} />}
      {activePage === "protocols" && <ProtocolsPage brand={brand} onBack={goHome} />}
      {activePage === "reviews" && <ReviewsPage brand={brand} onBack={goHome} />}

      {(activePage === "home" || activePage === "catalog") && (
        <>
          {brand.showHero !== false && <Hero brand={brand} onPrimary={scrollToCatalog} onSecondary={() => {}} />}
          {brand.showCategories !== false && (
            <Categories categories={categories} active={category} onChange={setCategory} />
          )}
          {brand.showCatalog !== false && (
            <Catalog
              // Public catalog hides products the owner marked unavailable; the
              // store admin (separate route below) still sees the full set.
              products={products.filter((p) => p.available !== false)}
              category={category}
              onAddToCart={addToCart}
              brand={brand}
            />
          )}
        </>
      )}

      {brand.showFooter !== false && <Footer brand={brand} />}

      {cart.length > 0 && brand.headerShowCart !== false && (
        <button className="cart-fab" aria-label={`Cart (${cart.length})`} onClick={() => setCartOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={22} height={22}>
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
          </svg>
          <span className="count">{cart.length}</span>
        </button>
      )}

      <CartCheckout open={cartOpen} onClose={() => setCartOpen(false)} />
    </>
  );
}

export function StorefrontApp({
  brand = BRAND,
  products,
  tenantKey,
}: {
  brand?: Brand;
  products?: Product[];
  /** Per-tenant id/slug used to namespace this storefront's localStorage. */
  tenantKey?: string;
}) {
  return (
    <div className="sf-root">
      <StoreProvider brand={brand} products={products} tenantKey={tenantKey}>
        <Shell />
      </StoreProvider>
    </div>
  );
}

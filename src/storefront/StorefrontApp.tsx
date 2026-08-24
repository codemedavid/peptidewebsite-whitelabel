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
import { AnnouncementBanner } from "./components/AnnouncementBanner";
import { NoticeModal } from "./components/NoticeModal";
import { StorePaused } from "./components/StorePaused";
import { StoreClosedNotice } from "./components/StoreClosedNotice";
// The fallback every code-split route below renders while its chunk downloads.
// The store's OWN loading screen, not a generic ring: it draws the tenant's mark
// and colors from CSS vars the storefront layout paints on its root, so a hash
// navigation looks like the boot splash it follows.
import { BrandPageLoader } from "./components/BrandPageLoader";
import { isTrialPaused } from "@/lib/trial/trial-state";
import { Hero } from "./components/Hero";
import { Categories } from "./components/Categories";
import { Catalog } from "./components/Catalog";
import { GroupBuyBanner } from "./components/GroupBuyBanner";
import { scopedCatalog } from "@/lib/storefront/group-buy-banner";
import { buildCategoryTiles } from "@/lib/storefront/boutique-home";
import { isBoutiqueLayout, isEditorialLayout } from "@/lib/storefront/home-layout";
import { Footer } from "./components/Footer";
import { CartCheckout } from "./components/CartCheckout";
import { isPageVisible } from "./visibility";
import { resolveHeroCtaLink, type HeroCtaTarget } from "@/lib/storefront/hero-links";
import { resolveHeroMedia, resolveHeroMediaLink } from "@/lib/storefront/hero-media";
import {
  hasStorefrontAdminSessionAction,
  signOutStorefrontAdminAction,
} from "@/actions/storefront-admin";

// The home/catalog view is what (nearly) every visitor sees, so only its
// chrome is bundled eagerly above. The secondary sub-pages and the entire
// password-gated admin tree are code-split: they download on demand the first
// time their hash route is hit, keeping the public first-load JS small.
const TrackOrderPage = dynamic(() => import("./pages/TrackOrderPage").then((m) => m.TrackOrderPage), { ssr: false, loading: BrandPageLoader });
const OrderConfirmedPage = dynamic(() => import("./pages/OrderConfirmedPage").then((m) => m.OrderConfirmedPage), { ssr: false, loading: BrandPageLoader });
const FAQPage = dynamic(() => import("./pages/FAQPage").then((m) => m.FAQPage), { ssr: false, loading: BrandPageLoader });
const COAPage = dynamic(() => import("./pages/COAPage").then((m) => m.COAPage), { ssr: false, loading: BrandPageLoader });
const ProtocolsPage = dynamic(() => import("./pages/ProtocolsPage").then((m) => m.ProtocolsPage), { ssr: false, loading: BrandPageLoader });
const ReconstitutionPage = dynamic(() => import("./pages/ReconstitutionPage").then((m) => m.ReconstitutionPage), { ssr: false, loading: BrandPageLoader });
const ReviewsPage = dynamic(() => import("./pages/ReviewsPage").then((m) => m.ReviewsPage), { ssr: false, loading: BrandPageLoader });
const MerchantPage = dynamic(() => import("./pages/MerchantPage").then((m) => m.MerchantPage), { ssr: false, loading: BrandPageLoader });
const GroupBuyPage = dynamic(() => import("./pages/GroupBuyPage").then((m) => m.GroupBuyPage), { ssr: false, loading: BrandPageLoader });
// Opt-in "two ways to order" home (brand.homeLayout === "two-ways"). Code-split so
// the classic-home tenants never download it.
const TwoWaysHome = dynamic(() => import("./components/TwoWaysHome").then((m) => m.TwoWaysHome), { ssr: false, loading: BrandPageLoader });
// Opt-in imagery-led "boutique" home (brand.homeLayout === "boutique"). Same
// treatment: code-split so the classic-home tenants never download it.
const BoutiqueHome = dynamic(() => import("./components/BoutiqueHome").then((m) => m.BoutiqueHome), { ssr: false, loading: BrandPageLoader });
// Opt-in left-rail "editorial" home (brand.homeLayout === "editorial"). Same
// treatment again — classic tenants never download it.
const EditorialHome = dynamic(() => import("./components/EditorialHome").then((m) => m.EditorialHome), { ssr: false, loading: BrandPageLoader });
// The rail is this layout's CHROME: it persists across every route, so unlike
// the home above it is not code-split — a spinner where the nav should be is
// worse than the few KB it costs the tenants who chose it.
const EditorialRail = dynamic(() => import("./components/EditorialRail").then((m) => m.EditorialRail), { ssr: false });
const AdminLogin = dynamic(() => import("./admin/AdminLogin").then((m) => m.AdminLogin), { ssr: false, loading: BrandPageLoader });
const AdminPage = dynamic(() => import("./admin/AdminPage").then((m) => m.AdminPage), { ssr: false, loading: BrandPageLoader });

const ROUTES = ["track", "faq", "coa", "protocols", "calculator", "reviews", "merchant", "groupbuy", "catalog", "admin", "order-confirmed"];

function pageFromHash(): string {
  if (typeof window === "undefined") return "home";
  const h = (window.location.hash || "").replace(/^#/, "");
  return ROUTES.includes(h) ? h : "home";
}

function Shell() {
  const { brand, products, categories, cart, addToCart } = useStore();
  const [category, setCategory] = useState("all");
  // "Explore GB #N" scope toggle — default OFF so the normal view is the full
  // catalog; opting in narrows it to the live round's products (presentation only).
  const [gbScope, setGbScope] = useState(false);
  // Catalog search term. Owned here (rather than inside <Catalog>) only for the
  // boutique layout, whose header bar searches the same grid; every other layout
  // leaves <Catalog> uncontrolled and this stays an unused "".
  const [query, setQuery] = useState("");
  const [page, setPage] = useState("home");
  // "checking" while the server session is being verified, so entering #admin
  // from inside the SPA doesn't flash the login form at an already-signed-in
  // owner. There is no cached client-side hint to short-circuit this — see
  // verifyAdmin below.
  const [adminAuth, setAdminAuth] = useState<"checking" | "in" | "out">("out");
  const [cartOpen, setCartOpen] = useState(false);
  // Drives the top progress bar — fires immediately on any hash navigation so
  // users get instant visual feedback even before the JS chunk loads.
  const [navKey, setNavKey] = useState(0);

  // A toggled-off sub-page should behave as if it isn't there: treat its hash
  // as "home" so direct visits land on the storefront instead of a blank shell.
  const activePage = page === "admin" || isPageVisible(brand, page) ? page : "home";

  // Exactly what the catalog grid renders — the boutique tiles are built from
  // this same list so a tile's count can never disagree with the shelf it opens.
  const visibleProducts = scopedCatalog(
    products.filter((p) => p.available !== false),
    brand.groupBuyBanner ?? null,
    gbScope,
  );

  // Resolve initial route + auth after mount (avoids SSR hash mismatch).
  useEffect(() => {
    setPage(pageFromHash());

    // The admin gate is a REAL server session — always ask the server, never a
    // cached client-side hint. Store-admin sessions are killed on every document
    // load (middleware → lib/auth/admin-session-reset.ts), so the sessionStorage
    // flag this used to trust optimistically would be wrong on exactly the case
    // it existed for: it survives a refresh, the session doesn't. Trusting it
    // could only flash the admin UI for a session the server had already ended.
    const verifyAdmin = () => {
      setAdminAuth("checking");
      void hasStorefrontAdminSessionAction()
        .then((ok) => setAdminAuth(ok ? "in" : "out"))
        .catch(() => setAdminAuth("out"));
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

  // If the active category is removed by the owner (live, or between loads),
  // fall back to "All Products" so the catalog never dead-ends on a now-gone
  // filter id with no chip highlighted.
  useEffect(() => {
    if (category !== "all" && !categories.some((c) => c.id === category)) {
      setCategory("all");
    }
  }, [categories, category]);

  const goHome = () => {
    window.location.hash = "";
    setPage("home");
  };
  const logoutAdmin = () => {
    // Drop the UI immediately, then kill the server cookie. Without the action
    // call an explicit "Log out" only cleared client state and left a valid
    // sf_admin_session behind for anyone returning to #admin.
    setAdminAuth("out");
    void signOutStorefrontAdminAction().catch(() => {});
    goHome();
  };
  const boutique = isBoutiqueLayout(brand.homeLayout);
  const editorial = isEditorialLayout(brand.homeLayout);
  // Both owner-selectable layouts end the home at discovery, so "go to the
  // catalog" is a ROUTE on either of them rather than a scroll down the home.
  const catalogIsOwnScreen = boutique || editorial;
  const scrollToCatalog = () => {
    document.querySelector("#catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Navigate a banner slide's page link through the same hash router the hero
  // CTAs use (catalog scrolls on home; home clears the hash; else set the route).
  const goToRoute = (route: string) => {
    if (route === "home") return goHome();
    if (route === "catalog") {
      // On the boutique layout the catalog is its own SCREEN, not a section of
      // the home — the home stops at category discovery. Every other layout
      // keeps the historical behaviour: go home and scroll to the grid.
      if (catalogIsOwnScreen) {
        window.location.hash = "catalog";
        return;
      }
      if (page !== "home") goHome();
      setTimeout(scrollToCatalog, 50);
      return;
    }
    window.location.hash = route;
  };

  // Resolve a hero CTA (primary = 1, secondary = 2) into its click handler from
  // the owner-configured link target. Custom URLs open in a new tab; page links
  // route through the hash router (the catalog link scrolls to the catalog on
  // home). Defaults mirror the store-admin editor: primary → catalog, secondary
  // → reviews, so legacy tenants keep a sensible primary "shop" action.
  // Turn a resolved link target into the click handler that performs it. Shared
  // by the hero CTA buttons and the image-hero banner so both obey identical
  // navigation rules.
  const targetHandler = (target: HeroCtaTarget): (() => void) => {
    switch (target.kind) {
      case "external":
        return () => window.open(target.url, "_blank", "noopener,noreferrer");
      case "catalog":
        return () => {
          if (page !== "home") goHome();
          setTimeout(scrollToCatalog, 50);
        };
      case "home":
        return goHome;
      case "route":
        return () => {
          window.location.hash = target.route;
        };
      case "none":
      default:
        return () => {};
    }
  };

  const heroCtaHandler = (n: 1 | 2): (() => void) =>
    targetHandler(
      resolveHeroCtaLink(
        n === 1
          ? { type: brand.heroCta1LinkType, page: brand.heroCta1LinkPage, url: brand.heroCta1LinkUrl }
          : { type: brand.heroCta2LinkType, page: brand.heroCta2LinkPage, url: brand.heroCta2LinkUrl },
        n,
      ),
    );

  // Whole-banner click in image mode. An owner who picked "not clickable" (or a
  // custom link whose URL was stripped) resolves to `none` — we pass undefined
  // so <Hero> renders a plain, non-interactive banner rather than a dead link.
  const heroMediaHandler = ((): (() => void) | undefined => {
    const media = resolveHeroMedia(brand);
    if (media.mode !== "image") return undefined;
    const target = resolveHeroMediaLink(media);
    return target.kind === "none" ? undefined : targetHandler(target);
  })();

  // Admin — password-gated, no site chrome (branding editor still available).
  if (activePage === "admin") {
    return (
      <>
        {navKey > 0 && <div key={navKey} className="sf-nav-progress" />}
        {adminAuth === "checking" ? (
          <BrandPageLoader />
        ) : adminAuth === "in" ? (
          <AdminPage brand={brand} onLogout={logoutAdmin} onExitToSite={goHome} />
        ) : (
          <AdminLogin brand={brand} onSuccess={() => setAdminAuth("in")} />
        )}
      </>
    );
  }

  // Trial expiry (trial system): a paused store's ENTIRE public surface is the
  // branded pause card — nav, catalog and checkout all disappear. Server-
  // authoritative twin: placeStorefrontOrderAction re-checks the same rule.
  // #admin (above) stays reachable so the owner can upgrade or downgrade.
  if (isTrialPaused(brand.trial)) {
    return <StorePaused brand={brand} />;
  }

  return (
    <>
      {navKey > 0 && <div key={navKey} className="sf-nav-progress" />}
      {brand.showHeader !== false && editorial && (
        <EditorialRail
          brand={brand}
          cartCount={cart.length}
          onCartClick={() => setCartOpen(true)}
          onHome={goHome}
          query={query}
          onQuery={(q) => {
            setQuery(q);
            if (activePage !== "catalog") goToRoute("catalog");
          }}
        />
      )}

      {brand.showHeader !== false && !editorial && (
        <Header
          brand={brand}
          cartCount={cart.length}
          onCartClick={() => setCartOpen(true)}
          onShopClick={() => goToRoute("catalog")}
          discovery={
            boutique
              ? {
                  tiles: buildCategoryTiles(visibleProducts, categories, brand.defaultProductImage),
                  query,
                  // Searching or picking a category takes the shopper to the
                  // grid — on this layout that is the catalog SCREEN.
                  onQuery: (q) => {
                    setQuery(q);
                    if (activePage !== "catalog") goToRoute("catalog");
                  },
                  onCategory: (id) => {
                    setCategory(id);
                    goToRoute("catalog");
                  },
                }
              : undefined
          }
        />
      )}

      <AnnouncementBanner brand={brand} onRoute={goToRoute} />

      {/* Owner's shop switch. Sits inside the shared chrome so a shopper who
          deep-links to #groupbuy or #catalog is told the shop is shut too — not
          only whoever lands on the home page. Renders nothing when open. */}
      <StoreClosedNotice brand={brand} />

      {/* Per-tenant notice/disclaimer — pops on every visit when the operator has
          granted it AND the owner enabled it (gate lives in the modal). */}
      <NoticeModal brand={brand} />

      {activePage === "track" && <TrackOrderPage brand={brand} onBack={goHome} />}
      {activePage === "order-confirmed" && <OrderConfirmedPage brand={brand} onBack={goHome} />}
      {activePage === "faq" && <FAQPage brand={brand} onBack={goHome} />}
      {activePage === "coa" && <COAPage brand={brand} onBack={goHome} />}
      {activePage === "protocols" && <ProtocolsPage brand={brand} onBack={goHome} />}
      {activePage === "calculator" && <ReconstitutionPage brand={brand} onBack={goHome} />}
      {activePage === "reviews" && <ReviewsPage brand={brand} onBack={goHome} />}
      {activePage === "merchant" && <MerchantPage brand={brand} onBack={goHome} />}
      {/* A store that HID the group-buy way doesn't serve the page, even by
          direct #groupbuy link — the way state, not the banner, is the gate
          (the banner has to stay so the round's pre-orders keep off the
          ships-now shelf). */}
      {activePage === "groupbuy" && brand.twoWaysMode?.groupBuy !== "hidden" && (
        <GroupBuyPage brand={brand} onBack={goHome} onCheckout={() => setCartOpen(true)} />
      )}

      {/* Opt-in "two ways to order" home — a single scroll (hero + on-hand list +
          live group-buy card), driven by the same brand vars. Replaces the classic
          hero → categories → catalog composition below for tenants that enable it. */}
      {/* Opt-in imagery-led "boutique" home — hero banner → shop-by-category tiles
          → catalog → the owner's assurance strip → contact. Owner-selectable, no
          operator grant: it only re-composes config the tenant already has. */}
      {(activePage === "home" || activePage === "catalog") && boutique && (
        <BoutiqueHome
          view={activePage === "catalog" ? "catalog" : "home"}
          onShopAll={() => goToRoute("catalog")}
          brand={brand}
          products={visibleProducts}
          category={category}
          query={query}
          onQueryChange={setQuery}
          onCategoryChange={setCategory}
          onAddToCart={addToCart}
          onHeroPrimary={heroCtaHandler(1)}
          onHeroSecondary={heroCtaHandler(2)}
          onHeroMedia={heroMediaHandler}
          gbScope={gbScope}
          onGbScope={setGbScope}
        />
      )}

      {(activePage === "home" || activePage === "catalog") && editorial && (
        <EditorialHome
          view={activePage === "catalog" ? "catalog" : "home"}
          onShopAll={() => goToRoute("catalog")}
          brand={brand}
          products={visibleProducts}
          category={category}
          query={query}
          onQueryChange={setQuery}
          onCategoryChange={setCategory}
          onAddToCart={addToCart}
          onHeroPrimary={heroCtaHandler(1)}
          onHeroSecondary={heroCtaHandler(2)}
          onHeroMedia={heroMediaHandler}
          gbScope={gbScope}
          onGbScope={setGbScope}
        />
      )}

      {(activePage === "home" || activePage === "catalog") && !catalogIsOwnScreen && brand.homeLayout === "two-ways" && (
        <TwoWaysHome
          brand={brand}
          onCheckout={() => setCartOpen(true)}
          onOpenGroupBuy={() => goToRoute("groupbuy")}
        />
      )}

      {(activePage === "home" || activePage === "catalog") && !catalogIsOwnScreen && brand.homeLayout !== "two-ways" && (
        <>
          {brand.showHero !== false && (
            <Hero
              brand={brand}
              onPrimary={heroCtaHandler(1)}
              onSecondary={heroCtaHandler(2)}
              onMedia={heroMediaHandler}
            />
          )}
          {brand.showCategories !== false && (
            <Categories categories={categories} active={category} onChange={setCategory} />
          )}
          {brand.groupBuyBanner && (
            <GroupBuyBanner
              banner={brand.groupBuyBanner}
              scopeOn={gbScope}
              onToggle={setGbScope}
            />
          )}
          {brand.showCatalog !== false && (
            <Catalog
              // Public catalog hides products the owner marked unavailable; the
              // store admin (separate route below) still sees the full set. The
              // "Explore GB #N" toggle further narrows the view to the live
              // round's products — presentation only; the on-hand gate (in the
              // card + server) still owns what's actually buyable.
              products={visibleProducts}
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
    <div
      className="sf-root"
      data-sf-frame={brand?.siteBorder ? "on" : undefined}
      // Scopes boutique.css. Every rule in that sheet is written under
      // .sf-root[data-sf-home="boutique"], which both outranks the base
      // storefront.css selectors (so source order can't silently undo it — the
      // hazard that broke the flush image hero) and keeps it entirely off
      // classic / two-ways tenants.
      data-sf-home={
        isBoutiqueLayout(brand?.homeLayout)
          ? "boutique"
          : isEditorialLayout(brand?.homeLayout)
            ? "editorial"
            : undefined
      }
    >
      <StoreProvider brand={brand} products={products} tenantKey={tenantKey}>
        <Shell />
      </StoreProvider>
    </div>
  );
}

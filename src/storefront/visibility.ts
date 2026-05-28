import type { Brand } from "./types";

// Maps a sub-page route (the part after "#") to its Brand visibility toggle.
// A page is visible unless its toggle is explicitly false (default-on).
const PAGE_TOGGLE: Record<string, (b: Brand) => boolean> = {
  track: (b) => b.showPageTrack !== false,
  faq: (b) => b.showPageFAQ !== false,
  coa: (b) => b.showPageCOA !== false,
  protocols: (b) => b.showPageProtocols !== false,
  reviews: (b) => b.showPageReviews !== false,
};

// Each store-admin sub-view that exists to manage a storefront page. When the
// storefront page is toggled off in the super admin, its manager is hidden
// too so operators don't curate content that nobody can see.
const ADMIN_VIEW_TOGGLE: Record<string, (b: Brand) => boolean> = {
  faq: (b) => b.showPageFAQ !== false,
  lab: (b) => b.showPageCOA !== false,
  proto: (b) => b.showPageProtocols !== false,
  reviews: (b) => b.showPageReviews !== false,
};

// Is the given route ("track", "faq", …) currently shown on the site?
// Routes without a toggle (home, catalog, admin) are always visible.
export function isPageVisible(brand: Brand, route: string): boolean {
  const check = PAGE_TOGGLE[route];
  return check ? check(brand) : true;
}

// Should a nav/footer link be hidden? True only when the link points at the
// hash of a toggled-off page (e.g. "#faq" while the FAQ page is hidden).
export function isLinkHidden(brand: Brand, href?: string): boolean {
  const route = (href || "").replace(/^#/, "");
  return route in PAGE_TOGGLE && !isPageVisible(brand, route);
}

// Is the given store-admin view ("faq", "lab", "proto", "reviews") available?
// Unmapped views (orders, products, categories, shipping, promo, pay) are
// always available — they aren't tied to a toggled storefront page.
export function isAdminViewVisible(brand: Brand, view: string): boolean {
  const check = ADMIN_VIEW_TOGGLE[view];
  return check ? check(brand) : true;
}

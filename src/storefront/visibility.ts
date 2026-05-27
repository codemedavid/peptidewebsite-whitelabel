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

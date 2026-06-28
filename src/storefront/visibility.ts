import type { Brand } from "./types";

// Maps a sub-page route (the part after "#") to its Brand visibility toggle.
// A page is visible unless its toggle is explicitly false (default-on).
const PAGE_TOGGLE: Record<string, (b: Brand) => boolean> = {
  track: (b) => b.showPageTrack !== false,
  faq: (b) => b.showPageFAQ !== false,
  coa: (b) => b.showPageCOA !== false,
  protocols: (b) => b.showPageProtocols !== false,
  calculator: (b) => b.showPageCalculator !== false,
  reviews: (b) => b.showPageReviews !== false,
  // Default OFF — the wholesale page only exists for tenants that opt in.
  merchant: (b) => b.showPageMerchant === true,
};

// Each store-admin sub-view that exists to manage a storefront page. When the
// storefront page is toggled off in the super admin, its manager is hidden
// too so operators don't curate content that nobody can see.
const ADMIN_VIEW_TOGGLE: Record<string, (b: Brand) => boolean> = {
  faq: (b) => b.showPageFAQ !== false,
  lab: (b) => b.showPageCOA !== false,
  proto: (b) => b.showPageProtocols !== false,
  reviews: (b) => b.showPageReviews !== false,
  // Not tied to a storefront page — a direct super-admin switch. On for every
  // package by default; flips off per tenant from the branding editor.
  analytics: (b) => b.showAdminAnalytics !== false,
  // Reseller Portal manager. Server-derived from the platform Features toggle
  // (FEATURES.STORE_RESELLER_PORTAL). In every plan ceiling, so default ON —
  // unlike the #merchant page, which additionally needs an access code.
  reseller: (b) => b.showAdminReseller !== false,
  // Card Studio ("design" view). Server-derived: platform Features toggle AND
  // the branding-editor switch. Default ON.
  design: (b) => b.showAdminCardStudio !== false,
  // Group Buy Rules. Server-derived from the platform Features toggle
  // (FEATURES.GB_RULES). Default OFF — entitlement-only, no branding switch.
  groupbuy: (b) => b.showAdminGroupBuy === true,
  // Smart Checkout (cart & checkout rules). Server-derived from the platform
  // Features toggle (FEATURES.STORE_SMART_CHECKOUT). Default OFF —
  // operator-grantable, outside every plan ceiling.
  checkout: (b) => b.showAdminCheckout === true,
  // Access Code manager. Server-derived from the platform Features toggle
  // (FEATURES.STORE_ACCESS_CODE). Default OFF — operator-grantable. When off the
  // manager is hidden entirely (none), matching the gate being unavailable.
  "access-code": (b) => b.showAdminAccessCode === true,
  // Group Buy MANAGEMENT (the "Group Buys" manager view). Server-derived from
  // the groupbuy.module entitlement via brand.groupBuyCaps. Default OFF.
  groupbuys: (b) => b.groupBuyCaps?.enabled === true,
  // Staff Accounts manager (+ its staff-form editor sub-view). Server-derived
  // from the platform Features toggle (FEATURES.STORE_STAFF_ACCOUNTS) into
  // brand.showAdminStaff. ON for Business/Automated, operator-grantable on
  // Starter. Both view ids are gated so a #staff-form deep-link can't bypass the
  // hidden menu (AdminPage's activeView guard runs isAdminViewVisible). The view
  // is additionally owner-only (the staff quick-action is owner-gated and the
  // server actions enforce requireStoreOwner).
  staff: (b) => b.showAdminStaff === true,
  "staff-form": (b) => b.showAdminStaff === true,
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

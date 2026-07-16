import type { Brand } from "./types";
import { FEATURES, type FeatureKey } from "@/lib/features/catalog";

// Store-admin module id → the catalog feature key that unlocks it. Mirrors
// ADMIN_VIEW_TOGGLE (which module each entitlement gates) and is the reverse
// lookup the "New functionality" tag uses: a module is flagged New when its
// feature key is in the operator-controlled registry. Only modules with a
// gating feature appear here (always-on modules like orders/products never tag).
export const MODULE_FEATURE: Record<string, FeatureKey> = {
  analytics: FEATURES.STORE_SALES_ANALYTICS,
  reseller: FEATURES.STORE_RESELLER_PORTAL,
  design: FEATURES.STORE_CARD_STUDIO,
  groupbuy: FEATURES.GB_RULES,
  checkout: FEATURES.STORE_SMART_CHECKOUT,
  "access-code": FEATURES.STORE_ACCESS_CODE,
  groupbuys: FEATURES.GB_MODULE,
  staff: FEATURES.STORE_STAFF_ACCOUNTS,
  notify: FEATURES.NOTIFY_ADMIN_ORDER,
  reviews: FEATURES.STORE_REVIEWS,
};

// Store-admin module ids whose gating feature is currently flagged "New". The
// storefront admin renders a "New" tag next to each. Visibility is enforced
// separately (AdminPage filters by isAdminViewVisible), so this can be permissive.
export function newModulesFor(newFeatureKeys: ReadonlySet<string>): string[] {
  return Object.entries(MODULE_FEATURE)
    .filter(([, key]) => newFeatureKeys.has(key))
    .map(([moduleId]) => moduleId);
}

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

  // Order-alert email view — owner-only, gated on FEATURES.NOTIFY_ADMIN_ORDER
  // (projected to showAdminOrderNotify in page.tsx). Default OFF.
  notify: (b) => b.showAdminOrderNotify === true,

  // Notice Modal editor — owner-only, gated on the super-admin per-tenant grant
  // (branding.config.noticeModal.operatorEnabled, projected to showAdminNotice in
  // page.tsx). Default OFF — hidden until the operator turns the feature on.
  notice: (b) => b.showAdminNotice === true,
};

// The Reviews page is a two-layer gate: the platform entitlement
// (FEATURES.STORE_REVIEWS — operator-grantable, default OFF) AND the store
// owner's "Reviews page" branding toggle must both be on. The storefront render
// resolves this into brand.showPageReviews, from which the nav, the page and the
// store-admin Reviews manager (ADMIN_VIEW_TOGGLE.reviews) all derive. The owner
// toggle is default-on, so it only hides Reviews when explicitly set to false.
export function resolveShowReviews(entitled: boolean, ownerToggle: boolean | undefined): boolean {
  return entitled && ownerToggle !== false;
}

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

// ── Business-exclusive lock (trial system) ───────────────────────────────────
// Unlike ADMIN_VIEW_TOGGLE (which HIDES a module), these modules stay VISIBLE
// but render locked — gold BUSINESS badge, "tap to upgrade" — and clicking
// opens the Upgrade page instead of the feature. Module id → is the tenant
// entitled? Undefined flags count as entitled so legacy brand blobs (rendered
// before page.tsx projected the fields) never lock anything by accident.
export const BUSINESS_EXCLUSIVE_MODULES: Record<string, (b: Brand) => boolean> = {
  fee: (b) => b.adminFeeEntitled !== false,
  tracknote: (b) => b.trackNoteEntitled !== false,
};

// Is this store-admin module locked behind the Business upgrade?
//   - during an ACTIVE trial every exclusive is locked (the trial plan is
//     technically entitled — the lock is the upsell, per the trial brief);
//   - after the trial (or for any paid/legacy tenant) entitlement decides —
//     the Starter downgrade revokes these features, paid Business keeps them.
// Expired trials defer to entitlement: the whole admin sits behind the
// "Choose how to continue" screen then, so tile locks are moot.
export function isAdminModuleLocked(brand: Brand, moduleId: string): boolean {
  const entitled = BUSINESS_EXCLUSIVE_MODULES[moduleId];
  if (!entitled) return false;
  if (brand.trial?.onTrial && !brand.trial.expired) return true;
  return !entitled(brand);
}

// All currently locked module ids — the AdminPage quick-action grid and the
// view guard both derive from this so a deep link can't open a locked editor.
export function lockedAdminModules(brand: Brand): string[] {
  return Object.keys(BUSINESS_EXCLUSIVE_MODULES).filter((id) => isAdminModuleLocked(brand, id));
}

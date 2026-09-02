import type { Brand } from "./types";
import { normalizeTwoWaysMode } from "@/lib/storefront/two-ways-mode";
import { FEATURES, type FeatureKey } from "@/lib/features/catalog";
import { businessExclusiveLocked } from "@/lib/trial/trial-state";

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
  lab: FEATURES.STORE_COA,
  proto: FEATURES.STORE_PROTOCOLS,
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
  // The Group Buy page. Visibility is the OWNER's call (the group-buy way
  // state), not an accident of whether a round happens to be running:
  //
  //   hidden  → gone, even mid-round. A store that removed the way doesn't serve
  //             the page at all, and a direct #groupbuy link falls back to home.
  //   a round is live → shown, as it always has been.
  //   no round, but gb-tagged listings → shown VIEW-ONLY, so the owner can keep
  //             the group buy up as a catalog/pricing reference between rounds
  //             (buildGroupBuyPageView's view-only regime). Without this the
  //             whole group-buy catalogue became unreachable the moment a round
  //             closed — and on a two-ways store those products are on no other
  //             shelf, so they vanished from the site entirely.
  //   nothing to show → hidden, so a nav link never lands on an empty page.
  //
  // groupBuyListingCount is server-resolved (page.tsx) and is 0 for any tenant
  // without the Group Buy module, which keeps this widening off every non-GB
  // store. Note it counts the TAG, while a live round is scoped by the round —
  // the same two-regime membership buildGroupBuyPageView applies.
  groupbuy: (b) =>
    normalizeTwoWaysMode(b.twoWaysMode).groupBuy !== "hidden" &&
    (!!b.groupBuyBanner || (b.groupBuyListingCount ?? 0) > 0),
  // The on-hand shelf IS the catalog, so hiding that way must also drop its nav
  // link — otherwise a group-buy-only store still advertises "Products" and
  // lands the shopper on an empty page. Only an explicit "hidden" does this:
  // normalizeTwoWaysMode returns both ways OPEN for absent/junk config, so a
  // tenant that never touched the setting is untouched, and "closed" (paused,
  // still shown) deliberately keeps the link.
  catalog: (b) => normalizeTwoWaysMode(b.twoWaysMode).onHand !== "hidden",
};

// Each store-admin sub-view that exists to manage a storefront page. When the
// storefront page is toggled off in the super admin, its manager is hidden
// too so operators don't curate content that nobody can see.
const ADMIN_VIEW_TOGGLE: Record<string, (b: Brand) => boolean> = {
  faq: (b) => b.showPageFAQ !== false,
  // Lab Results (COA) + Protocols managers. Server-derived: page.tsx projects
  // resolveEntitledPage(entitlement, ownerToggle) onto showPageCOA /
  // showPageProtocols, so revoking the platform grant hides the manager as well
  // as the storefront page. Both were ungated before the COA/Protocols features
  // existed — the owner toggle alone decided, on every plan.
  lab: (b) => b.showPageCOA !== false,
  proto: (b) => b.showPageProtocols !== false,
  reviews: (b) => b.showPageReviews !== false,
  // Not tied to a storefront page — a direct super-admin switch. On for every
  // package by default; flips off per tenant from the branding editor.
  analytics: (b) => b.showAdminAnalytics !== false,
  // Reseller Portal manager. Server-derived from the Reseller PARENT
  // (FEATURES.STORE_RESELLER_PORTAL) — deliberately the parent and not the page
  // child, unlike everything customer-facing.
  //
  // This screen sells nothing: it shows the owner which parts of the feature
  // their operator has switched on and lets them set the password. Gating it on
  // the page child meant a tenant granted only the parent — which is what
  // "turn on Reseller" looks like from the operator's Features list — got a
  // store with no reseller page, no reseller settings, and no product pricing
  // fields, with nothing anywhere saying why. The feature read as broken. Now
  // the manager appears with the parent and tells them exactly which child is
  // still off. The PRICE fields stay gated (see isResellerPricingVisible).
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
  // A single round's dedicated dashboard. Gated on the same entitlement as the
  // manager it opens from, so a #groupbuy-detail deep-link can't bypass the
  // hidden menu (AdminPage's activeView guard runs isAdminViewVisible).
  "groupbuy-detail": (b) => b.groupBuyCaps?.enabled === true,
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

// The two-layer page gate shared by Reviews, Lab Reports (COA) and Protocols:
// the platform entitlement (operator-grantable, default OFF) AND the store
// owner's branding toggle for the page must both be on. The storefront render
// resolves this into the matching brand.showPage* field, from which the nav, the
// page and the store-admin manager (ADMIN_VIEW_TOGGLE) all derive. The owner
// toggle is default-on, so it only hides a page when explicitly set to false —
// an entitled tenant that never touched the branding editor keeps the page.
export function resolveEntitledPage(entitled: boolean, ownerToggle: boolean | undefined): boolean {
  return entitled && ownerToggle !== false;
}

// Reviews page → brand.showPageReviews (FEATURES.STORE_REVIEWS).
export function resolveShowReviews(entitled: boolean, ownerToggle: boolean | undefined): boolean {
  return resolveEntitledPage(entitled, ownerToggle);
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

/**
 * Is the product editor's legacy "Reseller / Wholesale Pricing" card available?
 *
 * Gated on the reseller PAGE child (brand.resellerPricingEditable), which is the
 * surface that sells these two legacy tiers. It used to delegate to the manager
 * view's flag, but the manager now opens on the parent so the feature can
 * explain itself (see ADMIN_VIEW_TOGGLE.reseller above) — and these are price
 * fields, so they keep the stricter gate. Showing them to a tenant with no
 * selling surface is the exact bug that gate was added for: an owner fills in
 * wholesale prices that nothing will ever charge.
 *
 * Undefined counts as ON, matching the default-on `showAdminReseller` this used
 * to delegate to: a Brand assembled outside page.tsx (a demo fixture, a preview)
 * predates the flag and must keep rendering exactly as it does today. That is
 * safe because the gate here is only about EDITING — whether the prices are ever
 * charged is decided by stripResellerPricing on the server, which fails closed on
 * the real entitlements no matter what any Brand blob claims.
 *
 * Saved values are never touched — granting the child brings them back intact.
 */
export function isResellerPricingVisible(brand: Brand): boolean {
  return brand.resellerPricingEditable !== false;
}

/**
 * Whether the Product Management screen shows the Wholesale (MOQ) section.
 *
 * Gated on the wholesale-pricing CHILD, not the reseller page: a tenant granted
 * MOQ pricing on the regular storefront configures it here whether or not they
 * run a #merchant page, and a tenant with only the page never sees these fields.
 * Undefined counts as OFF — the feature is default-off and must fail closed, so
 * a legacy brand blob rendered before page.tsx projected the flag shows nothing.
 */
export function isWholesalePricingVisible(brand: Brand): boolean {
  return brand.wholesalePricing === true;
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
  // Same rule the server charge gate + storefront fee display use, so they can't drift.
  return businessExclusiveLocked(brand.trial, entitled(brand));
}

// All currently locked module ids — the AdminPage quick-action grid and the
// view guard both derive from this so a deep link can't open a locked editor.
export function lockedAdminModules(brand: Brand): string[] {
  return Object.keys(BUSINESS_EXCLUSIVE_MODULES).filter((id) => isAdminModuleLocked(brand, id));
}

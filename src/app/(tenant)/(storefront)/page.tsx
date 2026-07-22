import { getTenantId, getTenantSlug } from "@/lib/tenant/headers";
import { getTenantContext } from "@/lib/tenant/context";
import { withTenant } from "@/lib/db/tenant-client";
import { resolveAdminLoginMode } from "@/lib/storefront/admin-login-mode";
import { isDemoMode, getDemoProducts, getDemoStoreProducts, getDemoStoreOrders } from "@/lib/demo/fixtures";
import { orderCountsAsDemand, DEMAND_EXCLUDED_STATUS_LIST } from "@/lib/storefront/group-buy";
import { brandPaletteFromBranding } from "@/lib/theme/resolve-css-vars";
import { normalizeOrderNumberFormat } from "@/lib/orders/order-number-format";
import { dbProductToStorefront, type DbProductRow } from "@/lib/storefront/product-mapping";
import { StorefrontApp } from "@/storefront/StorefrontApp";
import { resolveShowReviews, resolveEntitledPage, newModulesFor } from "@/storefront/visibility";
import { getFeatureRegistry } from "@/lib/platform/feature-registry-server";
import { BRAND } from "@/storefront/data";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES, type FeatureKey } from "@/lib/features/catalog";
import { pickFeatureSpotlight } from "@/lib/features/feature-spotlight";
import { normalizeGroupBuySettings, buildGroupBuyGate } from "@/lib/storefront/group-buy";
import { buildGroupBuyBanner } from "@/lib/storefront/group-buy-banner";
import { normalizeNoticeModal } from "@/lib/storefront/notice-modal";
import { normalizeTrackNote } from "@/lib/storefront/track-note";
import { getTrialState } from "@/lib/trial/trial-info";
import { brandTrialFrom, businessExclusiveLocked, isTrialPaused } from "@/lib/trial/trial-state";
import { getSubscriptionState } from "@/lib/subscription/subscription-info";
import { brandSubscriptionFrom } from "@/lib/subscription/subscription-state";
import { resolveGroupBuyCaps, loadGroupBuys } from "@/lib/storefront/group-buy-server";
import { resolveHomeLayout } from "@/lib/storefront/two-ways-home";
import { stripResellerPricing } from "@/lib/storefront/reseller-gate";
import type { Brand, Product } from "@/storefront/types";

// Dynamic-by-default because we read the tenant from the request host
// (middleware sets x-tenant-host). The hot data calls (tenant context, branding,
// entitlements) are wrapped in `unstable_cache` so per-host renders re-use the
// same DB result for 5 min and are busted by tag on tenant mutations.

export default async function HomePage() {
  const tenantId = await getTenantId();
  const { tenant, branding, settings } = await getTenantContext(tenantId);

  // Compose the storefront Brand from three layers, low→high precedence:
  //   1. BRAND            — the design's static defaults (copy, toggles, etc.)
  //   2. theme palette    — colors + fonts derived from the chosen theme preset
  //                         / role colors, so the storefront home matches the
  //                         theme even for new tenants (config is empty until the
  //                         operator opens the Storefront tab).
  //   3. config           — the full Brand blob saved by the "Storefront" tab;
  //                         the editor keeps its palette synced to the theme, but
  //                         operators can still override individual fields here.
  const config = (branding?.config ?? {}) as Partial<Brand>;
  const themePalette = brandPaletteFromBranding(branding);
  const brand: Brand = {
    ...BRAND,
    ...themePalette,
    ...config,
    name: config.name || settings?.storeName || tenant.name || BRAND.name,
    logoUrl: config.logoUrl || ((branding?.logoUrl as string | null) ?? "") || BRAND.logoUrl,
    orderNumberFormat: normalizeOrderNumberFormat(
      (tenant as Record<string, unknown>).orderNumberFormat,
      tenant.name,
    ),
  };

  // The reseller portal is a platform-operator entitlement, toggled per tenant in
  // admin → Features (FEATURES.STORE_RESELLER_PORTAL). It only goes live once the
  // store owner ALSO sets an access code, so the effective #merchant visibility is
  // (entitled AND a code exists). Deriving it here means nav/footer/visibility all
  // gate on the operator's toggle with no dead gate — and it overrides whatever
  // stale `showPageMerchant` may sit in config.
  const resellerEntitled = await hasFeature(tenantId, FEATURES.STORE_RESELLER_PORTAL);
  const resellerCode =
    typeof config.resellerAccessCode === "string" ? config.resellerAccessCode.trim() : "";
  brand.showPageMerchant = resellerEntitled && resellerCode !== "";
  // The store-admin manager view gates on the entitlement alone — the owner
  // sets the access code from inside it, so it can't require one to appear.
  brand.showAdminReseller = resellerEntitled;

  // The reseller access code is validated server-side (verifyResellerCodeAction);
  // never ship it to the browser, even though the rest of `config` is public.
  delete (brand as Record<string, unknown>).resellerAccessCode;

  // Card Studio and Sales Analytics are gated the same way: the platform
  // entitlement (admin → Features) AND the branding-editor toggle must both be
  // on for the store-admin view to appear.
  const cardStudioEntitled = await hasFeature(tenantId, FEATURES.STORE_CARD_STUDIO);
  brand.showAdminCardStudio = cardStudioEntitled && config.showAdminCardStudio !== false;
  const salesAnalyticsEntitled = await hasFeature(tenantId, FEATURES.STORE_SALES_ANALYTICS);
  brand.showAdminAnalytics = salesAnalyticsEntitled && config.showAdminAnalytics !== false;
  // Group buy breakdown inside Sales Analytics: only when the module is on AND
  // the SA_SECTION_GROUP_BUYS slice is granted (default-on in every plan ceiling).
  brand.showAnalyticsGroupBuys =
    salesAnalyticsEntitled && (await hasFeature(tenantId, FEATURES.SA_SECTION_GROUP_BUYS));

  // Reconstitution calculator: gated on the platform entitlement (admin →
  // Features, FEATURES.STORE_CALCULATOR) AND the branding-editor toggle.
  // Revoking the feature hides the storefront page/nav AND the store-admin
  // toggle for it (the form keys off `calculatorEntitled`). Default-on: the
  // feature ships in every plan ceiling, so existing tenants keep it.
  const calculatorEntitled = await hasFeature(tenantId, FEATURES.STORE_CALCULATOR);
  brand.calculatorEntitled = calculatorEntitled;
  brand.showPageCalculator = calculatorEntitled && config.showPageCalculator !== false;

  // Reviews page: gated on the platform entitlement (admin → Features,
  // FEATURES.STORE_REVIEWS — operator-grantable, default OFF) AND the branding-
  // editor "Reviews page" toggle. Revoking the feature hides the storefront
  // page/nav AND the store-admin Reviews manager (both derive from
  // showPageReviews via visibility.ts) AND the store-admin toggle for it (the
  // form keys off `reviewsEntitled`).
  const reviewsEntitled = await hasFeature(tenantId, FEATURES.STORE_REVIEWS);
  brand.reviewsEntitled = reviewsEntitled;
  brand.showPageReviews = resolveShowReviews(reviewsEntitled, config.showPageReviews);

  // Lab Reports (COA) + Protocols pages: same two-layer gate as Reviews — the
  // platform entitlement (FEATURES.STORE_COA / STORE_PROTOCOLS, both operator-
  // grantable and default OFF) AND the branding-editor page toggle. Revoking the
  // feature hides the storefront page/nav, the store-admin manager (ADMIN_VIEW_
  // TOGGLE.lab / .proto both derive from these fields) and the branding toggle
  // itself (the form keys off coaEntitled / protocolsEntitled). Before these
  // features existed the owner toggle was the ONLY gate, so every tenant on every
  // plan got both managers; existing tenants are backfilled a grant.
  const coaEntitled = await hasFeature(tenantId, FEATURES.STORE_COA);
  brand.coaEntitled = coaEntitled;
  brand.showPageCOA = resolveEntitledPage(coaEntitled, config.showPageCOA);

  const protocolsEntitled = await hasFeature(tenantId, FEATURES.STORE_PROTOCOLS);
  brand.protocolsEntitled = protocolsEntitled;
  brand.showPageProtocols = resolveEntitledPage(protocolsEntitled, config.showPageProtocols);

  // Group Buy Rules engine: the store-admin view AND rule enforcement are gated
  // on the platform entitlement alone. Revoking the feature both hides the
  // editor and stops the saved rules from constraining the cart.
  const groupBuyEntitled = await hasFeature(tenantId, FEATURES.GB_RULES);
  brand.showAdminGroupBuy = groupBuyEntitled;
  if (!groupBuyEntitled) delete (brand as Record<string, unknown>).groupBuyRules;

  // Smart Checkout (cart & checkout rules): operator-grantable, default OFF for
  // every tenant. Revoking hides the store-admin view AND stops the saved rules
  // from constraining the cart — orders.ts re-applies the same gate at placement.
  const smartCheckoutEntitled = await hasFeature(tenantId, FEATURES.STORE_SMART_CHECKOUT);
  brand.showAdminCheckout = smartCheckoutEntitled;
  if (!smartCheckoutEntitled) delete (brand as Record<string, unknown>).checkoutRules;

  // Access Code gate: operator-grantable, default OFF for every tenant. When off
  // the store-admin Access Code manager is hidden (none) and the gate is not
  // enforced — the storefront layout re-checks this same entitlement before
  // walling the store, so revoking it also reopens a currently-gated store.
  brand.showAdminAccessCode = await hasFeature(tenantId, FEATURES.STORE_ACCESS_CODE);

  // Staff Accounts manager: Business/Automated plan feature (default ON there),
  // operator-grantable on Starter. When off the store-admin Staff Accounts view
  // is hidden (visibility.ts) and the staff server actions / staff sign-in are
  // blocked (storefront-staff.ts re-checks this same entitlement).
  const staffEntitled = await hasFeature(tenantId, FEATURES.STORE_STAFF_ACCOUNTS);
  brand.showAdminStaff = staffEntitled;

  // Order-alert email (Automated package): gates the owner-only "Order
  // Notifications" store-admin view. When off the view/tile hide and no alert
  // fires — sendAdminOrderNotification re-checks this same entitlement server-side.
  brand.showAdminOrderNotify = await hasFeature(tenantId, FEATURES.NOTIFY_ADMIN_ORDER);

  // Storefront Notice Modal: sanitize the stored config so a legacy/absent blob
  // is always safe, then derive the owner-editor visibility from the super-admin
  // grant (branding.config.noticeModal.operatorEnabled). The modal itself
  // additionally needs the owner's own `enabled` flag — both live in the
  // normalized blob and are re-checked client-side (isNoticeModalVisible). No
  // platform FEATURES entry: the grant is a per-tenant switch on the settings page.
  const noticeModal = normalizeNoticeModal(config.noticeModal);
  brand.noticeModal = noticeModal;
  brand.showAdminNotice = noticeModal.operatorEnabled;

  // Track-order delivery note: sanitize the stored config so a legacy/absent blob
  // is always safe. Business/Automated exclusive since the trial system
  // (FEATURES.STORE_TRACK_NOTE): unentitled tenants keep their saved copy but the
  // public card is forced off and the owner editor tile renders locked
  // (isAdminModuleLocked) — saveTrackNoteAction re-checks the same lock on write.
  const trackNoteEntitled = await hasFeature(tenantId, FEATURES.STORE_TRACK_NOTE);
  brand.trackNoteEntitled = trackNoteEntitled;
  const savedTrackNote = normalizeTrackNote(config.trackNote);
  brand.trackNote = trackNoteEntitled ? savedTrackNote : { ...savedTrackNote, enabled: false };

  // Trial system: project the JSON-safe trial window (or nothing) so the store
  // admin can render the countdown banner, lock the Business-exclusive tiles and
  // gate the expired state. Server-computed here — the client never does date math
  // against its own clock. Locks are re-checked server-side on every write.
  brand.trial = brandTrialFrom(await getTrialState(tenantId));

  // Subscription duration: project the JSON-safe paid window (or nothing) so the
  // store admin can render the countdown banner for a paying tenant. Mutually
  // exclusive with brand.trial by construction — computeSubscriptionState only
  // governs status != "trial" tenants, so a store never shows both banners.
  brand.subscription = brandSubscriptionFrom(await getSubscriptionState(tenantId));

  // The `#admin` login only asks for a USERNAME once the store actually has
  // per-user logins to disambiguate — i.e. Staff Accounts are enabled AND at
  // least one staff account exists. Until then the login is password-only (the
  // owner password), so a brand-new store is never asked for a phantom staff
  // username that doesn't exist yet. Count via withTenant() to match this file's
  // tenant-scoped access (the product load below) and stay correct if app_user
  // RLS is ever adopted ([[live-db-state]] runs as postgres/BYPASSRLS today). Only
  // read when the feature is on, and wrap it so an absent staff table or a stale
  // generated client (delegate undefined) resolves to "no staff" — the public
  // storefront render must never fail on this. Decision lives in the pure core
  // (test:admin-login-mode).
  let staffCount = 0;
  if (staffEntitled && !isDemoMode()) {
    try {
      staffCount = await withTenant(tenantId, (db) =>
        db.storefrontStaff.count({ where: { tenantId } }),
      );
    } catch {
      staffCount = 0;
    }
  }
  brand.staffLoginActive = resolveAdminLoginMode(staffEntitled, staffCount) === "unified";

  // Checkout admin fee: operator-revocable per tenant (admin → Features, default
  // ON) AND Business-exclusive under the trial system. brand.adminFeeEntitled is
  // the raw entitlement (drives the store-admin tile). The storefront FEE LINE is
  // dropped whenever the fee won't be charged — the SAME businessExclusiveLocked
  // rule orders.ts applies at placement — so what the customer is shown equals
  // what they're charged (during an active trial the fee is locked/uncharged even
  // though the tenant is technically entitled). Keeping display and charge on one
  // rule is what closes the "shown a fee we don't charge" gap.
  const adminFeeEntitled = await hasFeature(tenantId, FEATURES.STORE_ADMIN_FEE);
  brand.adminFeeEntitled = adminFeeEntitled;
  if (businessExclusiveLocked(brand.trial, adminFeeEntitled)) {
    delete (brand as Record<string, unknown>).adminFee;
  }

  // Group Buy MANAGEMENT module (the "Group Buys" manager, distinct from the
  // rules editor above): ship the resolved groupbuy.* capability set so the
  // admin view knows which buttons to draw, plus the operator-set form
  // defaults. The server actions re-check every capability on call.
  brand.groupBuyCaps = await resolveGroupBuyCaps(tenantId);
  brand.groupBuySettings = normalizeGroupBuySettings(config.groupBuySettings);

  // Storefront group-buy gate: while a run is live, the owner can choose whether
  // on-hand (non-group-buy) products stay buyable (branding.config.groupBuyAllowOnHand,
  // default on). Resolve the gate server-side so the cart can disable blocked
  // add-to-cart and placeStorefrontOrderAction can re-check it. Only the GB
  // module needs the extra group-buys read; it's operator-grant, default OFF.
  // "Two ways to order" home — the operator grant (Super Admin → Features → Group
  // Buy) is the toggle; the owner's config.homeLayout can still opt in or force
  // classic. Resolved server-side so StorefrontApp just branches on brand.homeLayout.
  const twoWaysHomeEntitled = await hasFeature(tenantId, FEATURES.GB_TWO_WAYS_HOME);
  brand.homeLayout = resolveHomeLayout(twoWaysHomeEntitled, config.homeLayout);

  brand.groupBuyAllowOnHand = config.groupBuyAllowOnHand !== false;
  if (brand.groupBuyCaps.enabled) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const groupBuys = await loadGroupBuys(tenantId, slug);
    brand.groupBuyGate = buildGroupBuyGate(
      groupBuys,
      brand.groupBuyCaps,
      brand.groupBuyAllowOnHand,
    );
    // Public banner + "Explore GB #N" scope filter for the live run. Purely
    // presentational — the on-hand gate above owns what can actually be bought.
    brand.groupBuyBanner = buildGroupBuyBanner(groupBuys, brand.groupBuyCaps) ?? undefined;
    // Slots filled = the round's demand orders (everything except cancelled /
    // refunded), which the pure banner builder can't load. Drives the Group Buy
    // page's "N of GOAL slots filled" progress bar (two-ways.slotProgress).
    const bannerId = brand.groupBuyBanner?.id;
    if (bannerId) {
      let filled = 0;
      try {
        if (isDemoMode()) {
          filled = getDemoStoreOrders(slug).filter(
            (o) => o.groupBuyId === bannerId && orderCountsAsDemand(o.status),
          ).length;
        } else {
          filled = await withTenant(tenantId, (db) =>
            db.storefrontOrder.count({
              where: {
                tenantId,
                groupBuyId: bannerId,
                // Same demand definition the demo path uses (orderCountsAsDemand)
                // — one shared list so the two never drift.
                status: { notIn: [...DEMAND_EXCLUDED_STATUS_LIST] },
              },
            }),
          );
        }
      } catch {
        filled = 0; // progress bar just shows 0 — never block the storefront on it
      }
      brand.groupBuyBanner = { ...brand.groupBuyBanner!, filled };
    }
  }

  // Products are the source of truth in the DB. Load the tenant's catalog
  // server-side (demo: file-backed store, seeded from the builtin fixtures) and
  // hand it to the storefront — both the public catalog and the #admin manager
  // render from this set, and the admin's writes persist back through
  // actions/products.ts. The brand's currency symbol drives display formatting.
  let products: Product[] = [];
  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const saved = getDemoStoreProducts(slug);
    products = saved
      ? saved
      : getDemoProducts(tenantId).map((dp) =>
          dbProductToStorefront(dp as unknown as DbProductRow, brand.currency || "₱"),
        );
  } else {
    const rows = await withTenant(tenantId, (db) =>
      db.product.findMany({
        where: { status: { not: "archived" } },
        orderBy: { createdAt: "asc" },
      }),
    );
    products = rows.map((r) => dbProductToStorefront(r as DbProductRow, brand.currency || "₱"));
  }

  // Reseller wholesale pricing is part of the SAME entitlement as the portal:
  // an unentitled tenant's catalog ships with no reseller legs at all, so the
  // cart can never flip a bulk line to a wholesale price / RESELLER badge on
  // stray product data (test:reseller-gate). orders.ts re-applies this strip at
  // placement so a tampered client can't restore it. DB rows keep their data —
  // re-granting the feature brings the prices back untouched.
  products = stripResellerPricing(products, resellerEntitled);

  // "New functionality" tags: the operator's kept flags (persisted registry
  // newKeys), mapped to this store's admin modules. Detected-but-unsaved additions
  // are intentionally excluded — store owners only see a tag the operator kept.
  const registry = await getFeatureRegistry();
  brand.newModules = newModulesFor(new Set(registry.newKeys));

  // New-feature spotlight (trial system): advertise the first operator-kept new
  // feature the store should upgrade for — every kept key during an active
  // trial, otherwise only keys the tenant is NOT entitled to. Entitlements are
  // resolved server-side so the strip can never tease a feature the store
  // already has (outside a trial).
  const trialActive = brand.trial?.onTrial === true && !brand.trial.expired;
  const spotlightEntitled = new Set<string>();
  // During an active trial pickFeatureSpotlight ignores entitlement (every kept
  // key qualifies), so skip resolving it — the loop is pure dead work then.
  if (!trialActive) {
    for (const key of registry.newKeys) {
      if (await hasFeature(tenantId, key as FeatureKey)) spotlightEntitled.add(key);
    }
  }
  brand.featureSpotlight = pickFeatureSpotlight(
    registry.newKeys,
    (key) => spotlightEntitled.has(key),
    trialActive,
  );

  // A paused (expired-trial) store renders the StorePaused card, not the catalog,
  // so don't serialize the full product list into that page's payload.
  const catalogProducts = isTrialPaused(brand.trial) ? [] : products;

  return <StorefrontApp brand={brand} products={catalogProducts} tenantKey={tenantId} />;
}

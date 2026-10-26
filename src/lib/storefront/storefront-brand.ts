import "server-only";

import { unstable_cache } from "next/cache";
import { getTenantContext } from "@/lib/tenant/context";
import { gbPaymentModeFor } from "@/lib/storefront/gb-payment-mode";
import { normalizeGroupBuyInvoice } from "@/lib/storefront/gb-invoice";
import { withTenant } from "@/lib/db/tenant-client";
import { isDemoMode, getDemoProducts, getDemoStoreProducts } from "@/lib/demo/fixtures";
import { brandPaletteFromBranding } from "@/lib/theme/resolve-css-vars";
import { normalizeOrderNumberFormat } from "@/lib/orders/order-number-format";
import { dbProductToStorefront, type DbProductRow } from "@/lib/storefront/product-mapping";
import { resolveShowReviews, resolveEntitledPage, newModulesFor } from "@/storefront/visibility";
import { getFeatureRegistry } from "@/lib/platform/feature-registry-server";
import { BRAND } from "@/storefront/data";
import { getEntitlements } from "@/lib/features/entitlements";
import { FEATURES, type FeatureKey } from "@/lib/features/catalog";
import { pickFeatureSpotlight } from "@/lib/features/feature-spotlight";
import { normalizeGroupBuySettings, buildGroupBuyGate } from "@/lib/storefront/group-buy";
import { buildGroupBuyBanner } from "@/lib/storefront/group-buy-banner";
import { normalizeHeroCountdown, resolveHeroCountdown } from "@/lib/storefront/hero-countdown";
import { isGroupBuyProduct } from "@/lib/storefront/two-ways";
import { normalizeNoticeModal } from "@/lib/storefront/notice-modal";
import { normalizeTrackNote } from "@/lib/storefront/track-note";
import { normalizeTimeline } from "@/lib/storefront/timeline";
import { normalizeReviews, normalizeReviewDescStyle } from "@/lib/storefront/reviews";
import { ARTICLE_LIMITS, articleFromRow, summarizeArticle } from "@/lib/storefront/articles";
import { normalizeAssessmentConfig } from "@/lib/storefront/assessment";
import { getTrialState } from "@/lib/trial/trial-info";
import { brandTrialFrom, businessExclusiveLocked, isTrialPaused } from "@/lib/trial/trial-state";
import { getSubscriptionState, getSubscriptionBilling } from "@/lib/subscription/subscription-info";
import { brandSubscriptionFrom } from "@/lib/subscription/subscription-state";
import { resolveGroupBuyCaps, loadGroupBuysForDisplay } from "@/lib/storefront/group-buy-server";
import {
  normalizeTwoWaysHero,
  normalizeTwoWaysOnHandStyle,
  resolveHomeLayout,
} from "@/lib/storefront/two-ways-home";
import {
  TWO_WAYS_MODE_DEFAULT,
  normalizeTwoWaysMode,
  resolveWays,
} from "@/lib/storefront/two-ways-mode";
import { normalizeOnHandOrder } from "@/lib/storefront/on-hand-order";
import { normalizeGroupBuyContent } from "@/lib/storefront/gb-content";
import { normalizeGroupBuyLiveBanner } from "@/lib/storefront/gb-live-banner";
import { normalizeDefaultProductImage } from "@/lib/storefront/product-image";
import { normalizeBoutiqueConfig } from "@/lib/storefront/boutique-home";
import { normalizeEditorialConfig } from "@/lib/storefront/editorial-home";
import { stripResellerPricing } from "@/lib/storefront/reseller-gate";
import { stripMadeToOrder } from "@/lib/storefront/made-to-order";
import { applyGroupBuyAccess } from "@/lib/storefront/gb-access.server";
import type { GroupBuyViewer } from "@/lib/storefront/gb-access";
import { getRoundDemand } from "@/lib/storefront/gb-round-demand";
import { resellerCapsFrom } from "@/lib/storefront/reseller-caps";
import {
  readResellerCredential,
  hasResellerCode,
  merchantPageVisible,
  resolveWholesaleAccess,
} from "@/lib/storefront/reseller-access";
import { readResellerPageCopy } from "@/lib/storefront/reseller-page-copy";
import { normalizeCatalogSortStyle } from "@/lib/storefront/catalog-sort";
import { getBestSellerCounts } from "@/lib/storefront/best-sellers";
import { normalizeStoreStatus } from "@/lib/storefront/store-status";
import { applyProductOrder, normalizeProductOrder } from "@/lib/storefront/product-order";
import type { Brand, Product } from "@/storefront/types";

/**
 * The storefront Brand + catalog for one tenant — the object the public store
 * AND the #admin store admin render from. Lifted out of StorefrontHome so the
 * Pepweb app (/api/mobile/v1/admin/*) resolves the admin menu, entitlements and
 * trial locks from the very same projection instead of re-deriving them.
 *
 * Nothing here reads the request: the tenant, its slug and the reseller-cookie
 * check are passed in, so a caller without a storefront host (the app API) can
 * build it too.
 */
export type StorefrontBrandOptions = {
  tenantId: string;
  /** Tenant slug (demo mode keys file-backed data by it). */
  slug: string;
  /** Does THIS request hold a verified reseller session at `version`? */
  isResellerUnlocked: (version: number) => Promise<boolean>;
  /** Who is viewing, for paid group-buy access (gb-access.server.ts). Required
   *  on purpose: a caller must say whether it serves a shopper or a store admin,
   *  so a new public surface can't ship a paid round's prices by omission.
   *  Called lazily — only when the governing round actually requires paid join. */
  groupBuyViewer: () => Promise<GroupBuyViewer>;
};

/**
 * The tenant's catalog rows, cached across requests. This read was the single
 * largest source of Supabase egress (every storefront view re-pulled every
 * product row). Display only: placement re-reads live stock inside its own
 * transaction (actions/orders.ts), so a stale row can never oversell. Every
 * product/stock writer already busts `tenant:<id>` via revalidateTenant.
 * Cached rows come back with createdAt as a string; dbProductToStorefront
 * accepts both.
 */
export const loadCatalogRows = (tenantId: string) =>
  unstable_cache(
    () =>
      withTenant(tenantId, (db) =>
        db.product.findMany({
          where: { status: { not: "archived" } },
          orderBy: { createdAt: "asc" },
        }),
      ),
    ["storefront-catalog-rows", tenantId],
    // 6h: every product/stock writer busts the tag; the timer only catches
    // direct-DB scripts that can't.
    { tags: [`tenant:${tenantId}`, `tenant:${tenantId}:products`], revalidate: 21600 },
  )();

/**
 * Published article SUMMARIES, cached per tenant. Bodies are read only on a
 * miss (the summary's read time and derived excerpt come from them) and never
 * leave this cache; article writers bust `tenant:<id>` via revalidateTenant.
 */
const loadArticleSummaries = (tenantId: string) =>
  unstable_cache(
    async () => {
      const rows = await withTenant(tenantId, (db) =>
        db.blogPost.findMany({
          where: { status: "published" },
          orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
          take: ARTICLE_LIMITS.listed,
        }),
      );
      return rows.map((row) => summarizeArticle(articleFromRow(row)));
    },
    ["storefront-article-summaries", tenantId],
    { tags: [`tenant:${tenantId}`], revalidate: 21600 },
  )();

export async function loadStorefrontBrand(
  opts: StorefrontBrandOptions,
): Promise<{ brand: Brand; products: Product[] }> {
  const { tenantId, slug } = opts;
  // Every independent read starts at once. Each one is a database round trip
  // on a cache miss, and awaiting them one after another made this function
  // the slowest part of both the storefront render and the app's admin API.
  // Entitlements resolve ONCE here; `has` replaces a dozen hasFeature calls,
  // which (outside a React render, e.g. the app API) each re-read the cache.
  const groupBuyCapsP = resolveGroupBuyCaps(tenantId);
  const groupBuysP = groupBuyCapsP.then((caps) => (caps.enabled ? loadGroupBuysForDisplay(tenantId, slug) : []));
  const productRowsP = isDemoMode() ? Promise.resolve(null) : loadCatalogRows(tenantId);
  // Awaited further down; a failure here must not surface as an unhandled
  // rejection if an earlier await throws first.
  // Published article summaries, read in parallel with the catalog. Bodies
  // stay out of the storefront payload — a post is fetched when it is opened.
  const articlesP = isDemoMode() ? Promise.resolve([]) : loadArticleSummaries(tenantId);
  groupBuysP.catch(() => undefined);
  productRowsP.catch(() => undefined);
  articlesP.catch(() => undefined);
  const [{ tenant, branding, settings }, entitlements, trialState, subscriptionState, subscriptionBilling, registry] =
    await Promise.all([
      getTenantContext(tenantId),
      getEntitlements(tenantId),
      getTrialState(tenantId),
      getSubscriptionState(tenantId),
      getSubscriptionBilling(tenantId),
      getFeatureRegistry(),
    ]);
  const has = (key: FeatureKey) => entitlements.has(key);

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
  const resellerCaps = resellerCapsFrom(entitlements);
  const resellerCred = readResellerCredential(config);
  // Parent AND page child AND an owner password — see merchantPageVisible for why
  // all three are required and how they fail separately.
  brand.showPageMerchant = merchantPageVisible(resellerCaps, hasResellerCode(resellerCred));
  // The manager view opens on the PARENT so an owner whose operator switched
  // "Reseller" on finds a screen that explains what is still missing, rather
  // than no screen at all. The price FIELDS it links to stay on the page child.
  brand.showAdminReseller = resellerCaps.enabled;
  brand.resellerPricingEditable = resellerCaps.resellerPage;
  // Wholesale (MOQ) pricing on the regular storefront — cards, product pages,
  // cart and checkout. Independent of the page above.
  brand.wholesalePricing = resellerCaps.wholesalePricing;

  // Does THIS request hold a verified reseller session for THIS tenant at the
  // CURRENT password version? Server-side and httpOnly — the browser cannot set
  // or read it — so it is safe to decide what the page is allowed to contain.
  // Read only when the tenant actually runs a gated portal, to keep the cookie
  // parse off every other store's render path.
  const resellerUnlocked =
    brand.showPageMerchant === true
      ? await opts.isResellerUnlocked(resellerCred.version)
      : false;
  brand.resellerUnlocked = resellerUnlocked;
  // Owner-editable gate copy (falls back to the shared defaults).
  const resellerCopy = readResellerPageCopy(config);
  brand.merchantGateTitle = resellerCopy.gateTitle;
  brand.merchantGateSub = resellerCopy.gateSub;

  // The reseller password is verified server-side (verifyResellerCodeAction);
  // never ship it — in EITHER shape — to the browser, even though the rest of
  // `config` is public. The hash matters as much as the legacy plaintext: it is
  // an offline-crackable credential, and these codes are short and human-chosen.
  delete (brand as Record<string, unknown>).resellerAccessCode;
  delete (brand as Record<string, unknown>).resellerAccessCodeHash;
  delete (brand as Record<string, unknown>).resellerCodeVersion;

  // Same for the store-admin credential. It now lives on the Tenant row, but
  // stores created before that migration may still carry a legacy plaintext
  // `adminPassword` (and its hash) inside branding.config — and the spread above
  // copies every config key onto `brand`, which is serialized to every visitor.
  // Stripping here keeps the leak closed until the backfill clears those rows.
  for (const key of ["adminPassword", "adminEmail", "adminPasswordHash"]) {
    delete (brand as Record<string, unknown>)[key];
  }

  // Per-tenant default product image — the fallback photo shown for products
  // without an image of their own. Normalized here (hosted http(s) URLs only)
  // so the raw config spread above can't put an unvetted value in <img src>.
  brand.defaultProductImage = normalizeDefaultProductImage(config.defaultProductImage);

  // Card Studio and Sales Analytics are gated the same way: the platform
  // entitlement (admin → Features) AND the branding-editor toggle must both be
  // on for the store-admin view to appear.
  const cardStudioEntitled = has(FEATURES.STORE_CARD_STUDIO);
  brand.showAdminCardStudio = cardStudioEntitled && config.showAdminCardStudio !== false;
  const salesAnalyticsEntitled = has(FEATURES.STORE_SALES_ANALYTICS);
  brand.showAdminAnalytics = salesAnalyticsEntitled && config.showAdminAnalytics !== false;
  // Group buy breakdown inside Sales Analytics: only when the module is on AND
  // the SA_SECTION_GROUP_BUYS slice is granted (default-on in every plan ceiling).
  brand.showAnalyticsGroupBuys =
    salesAnalyticsEntitled && has(FEATURES.SA_SECTION_GROUP_BUYS);

  // Reconstitution calculator: gated on the platform entitlement (admin →
  // Features, FEATURES.STORE_CALCULATOR) AND the branding-editor toggle.
  // Revoking the feature hides the storefront page/nav AND the store-admin
  // toggle for it (the form keys off `calculatorEntitled`). Default-on: the
  // feature ships in every plan ceiling, so existing tenants keep it.
  const calculatorEntitled = has(FEATURES.STORE_CALCULATOR);
  brand.calculatorEntitled = calculatorEntitled;
  brand.showPageCalculator = calculatorEntitled && config.showPageCalculator !== false;

  // Reviews page: gated on the platform entitlement (admin → Features,
  // FEATURES.STORE_REVIEWS — operator-grantable, default OFF) AND the branding-
  // editor "Reviews page" toggle. Revoking the feature hides the storefront
  // page/nav AND the store-admin Reviews manager (both derive from
  // showPageReviews via visibility.ts) AND the store-admin toggle for it (the
  // form keys off `reviewsEntitled`).
  const reviewsEntitled = has(FEATURES.STORE_REVIEWS);
  brand.reviewsEntitled = reviewsEntitled;
  brand.showPageReviews = resolveShowReviews(reviewsEntitled, config.showPageReviews);
  // The testimonials themselves are DB-backed (branding.config.reviews, written
  // by saveReviewsAction). They are sanitized on the way out as well as in, so a
  // row stored before the normalizer existed can't reach the page unchecked.
  brand.reviews = normalizeReviews(config.reviews);
  brand.reviewDescStyle = normalizeReviewDescStyle(config.reviewDescStyle);

  // Lab Reports (COA) + Protocols pages: same two-layer gate as Reviews — the
  // platform entitlement (FEATURES.STORE_COA / STORE_PROTOCOLS, both operator-
  // grantable and default OFF) AND the branding-editor page toggle. Revoking the
  // feature hides the storefront page/nav, the store-admin manager (ADMIN_VIEW_
  // TOGGLE.lab / .proto both derive from these fields) and the branding toggle
  // itself (the form keys off coaEntitled / protocolsEntitled). Before these
  // features existed the owner toggle was the ONLY gate, so every tenant on every
  // plan got both managers; existing tenants are backfilled a grant.
  const coaEntitled = has(FEATURES.STORE_COA);
  brand.coaEntitled = coaEntitled;
  brand.showPageCOA = resolveEntitledPage(coaEntitled, config.showPageCOA);

  const protocolsEntitled = has(FEATURES.STORE_PROTOCOLS);
  brand.protocolsEntitled = protocolsEntitled;
  brand.showPageProtocols = resolveEntitledPage(protocolsEntitled, config.showPageProtocols);

  // Articles page: the blog entitlement (FEATURES.SITE_BLOG) AND the owner's
  // toggle AND at least one published post, so the nav never links to an empty
  // page. A failed read degrades to "no articles" rather than failing the store.
  const articlesEntitled = has(FEATURES.SITE_BLOG);
  brand.articlesEntitled = articlesEntitled;
  brand.articles = articlesEntitled ? await articlesP.catch(() => []) : [];
  brand.showPageArticles =
    resolveEntitledPage(articlesEntitled, config.showPageArticles) && brand.articles.length > 0;

  // Assessment quiz: operator grant (FEATURES.STORE_ASSESSMENT, default OFF) AND
  // the owner's on/off inside the normalized config. The config always ships so
  // the store admin can edit it once granted.
  const assessmentEntitled = has(FEATURES.STORE_ASSESSMENT);
  const assessment = normalizeAssessmentConfig(config.assessment);
  brand.assessmentEntitled = assessmentEntitled;
  brand.assessment = assessment;
  brand.showPageAssessment = assessmentEntitled && assessment.enabled;

  // Group Buy Rules engine: the store-admin view AND rule enforcement are gated
  // on the platform entitlement alone. Revoking the feature both hides the
  // editor and stops the saved rules from constraining the cart.
  const groupBuyEntitled = has(FEATURES.GB_RULES);
  brand.showAdminGroupBuy = groupBuyEntitled;
  if (!groupBuyEntitled) delete (brand as Record<string, unknown>).groupBuyRules;

  // Smart Checkout (cart & checkout rules): operator-grantable, default OFF for
  // every tenant. Revoking hides the store-admin view AND stops the saved rules
  // from constraining the cart — orders.ts re-applies the same gate at placement.
  const smartCheckoutEntitled = has(FEATURES.STORE_SMART_CHECKOUT);
  brand.showAdminCheckout = smartCheckoutEntitled;
  if (!smartCheckoutEntitled) delete (brand as Record<string, unknown>).checkoutRules;

  // Access Code gate: operator-grantable, default OFF for every tenant. When off
  // the store-admin Access Code manager is hidden (none) and the gate is not
  // enforced — the storefront layout re-checks this same entitlement before
  // walling the store, so revoking it also reopens a currently-gated store.
  brand.showAdminAccessCode = has(FEATURES.STORE_ACCESS_CODE);

  // Staff Accounts manager: Business/Automated plan feature (default ON there),
  // operator-grantable on Starter. When off the store-admin Staff Accounts view
  // is hidden (visibility.ts) and the staff server actions / staff sign-in are
  // blocked (storefront-staff.ts re-checks this same entitlement).
  const staffEntitled = has(FEATURES.STORE_STAFF_ACCOUNTS);
  brand.showAdminStaff = staffEntitled;

  // Customer accounts: sign up / sign in / My Account on the storefront plus the
  // owner's Customers list. Every customer-accounts action re-checks this same
  // entitlement server-side, so this projection is presentation only.
  brand.customerAccountsEnabled =
    !isDemoMode() && has(FEATURES.STORE_CUSTOMER_ACCOUNTS);

  // Order-alert email (Automated package): gates the owner-only "Order
  // Notifications" store-admin view. When off the view/tile hide and no alert
  // fires — sendAdminOrderNotification re-checks this same entitlement server-side.
  brand.showAdminOrderNotify = has(FEATURES.NOTIFY_ADMIN_ORDER);

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
  const trackNoteEntitled = has(FEATURES.STORE_TRACK_NOTE);
  brand.trackNoteEntitled = trackNoteEntitled;
  const savedTrackNote = normalizeTrackNote(config.trackNote);
  brand.trackNote = trackNoteEntitled ? savedTrackNote : { ...savedTrackNote, enabled: false };

  // Timeline (operator grant, default OFF): an unentitled tenant keeps its saved
  // steps but the public timeline is forced off and the editor is hidden
  // (visibility.ts) — saveTimelineAction re-checks the same grant on write.
  const timelineEntitled = has(FEATURES.STORE_TIMELINE);
  brand.timelineEntitled = timelineEntitled;
  const savedTimeline = normalizeTimeline(config.timeline);
  brand.timeline = timelineEntitled ? savedTimeline : { ...savedTimeline, enabled: false };

  // Trial system: project the JSON-safe trial window (or nothing) so the store
  // admin can render the countdown banner, lock the Business-exclusive tiles and
  // gate the expired state. Server-computed here — the client never does date math
  // against its own clock. Locks are re-checked server-side on every write.
  brand.trial = brandTrialFrom(trialState);

  // Subscription duration: project the JSON-safe paid window (or nothing) so the
  // store admin can render the countdown banner for a paying tenant. Mutually
  // exclusive with brand.trial by construction — computeSubscriptionState only
  // governs status != "trial" tenants, so a store never shows both banners.
  // The Billing page also shows what the tenant owes for the term — the
  // operator-set "Monthly price due" (or the plan list price) plus the cycle,
  // resolved server-side alongside the window.
  brand.subscription = brandSubscriptionFrom(subscriptionState, subscriptionBilling);

  // NOTE: the storefront no longer counts staff here. The `#admin` login is a
  // single email + password form for everyone — owner and staff alike — so the
  // client needs no hint about which form to render, and the old
  // resolveAdminLoginMode / brand.staffLoginActive pair is gone.

  // Checkout admin fee: operator-revocable per tenant (admin → Features, default
  // ON) AND Business-exclusive under the trial system. brand.adminFeeEntitled is
  // the raw entitlement (drives the store-admin tile). The storefront FEE LINE is
  // dropped whenever the fee won't be charged — the SAME businessExclusiveLocked
  // rule orders.ts applies at placement — so what the customer is shown equals
  // what they're charged (during an active trial the fee is locked/uncharged even
  // though the tenant is technically entitled). Keeping display and charge on one
  // rule is what closes the "shown a fee we don't charge" gap.
  const adminFeeEntitled = has(FEATURES.STORE_ADMIN_FEE);
  brand.adminFeeEntitled = adminFeeEntitled;
  if (businessExclusiveLocked(brand.trial, adminFeeEntitled)) {
    delete (brand as Record<string, unknown>).adminFee;
  }

  // The two checkout extras, both operator-grant / default OFF. Unlike the admin
  // fee above, nothing is deleted from the brand when they're off: the QR PH tag
  // and the booking URL live INSIDE paymentMethods/couriers, which the store
  // admin reads and writes back wholesale — stripping them here would make the
  // owner's next save silently erase their own config. The flags gate DISPLAY;
  // placeStorefrontOrderAction re-checks the entitlement before charging.
  brand.qrphFeeEntitled = has(FEATURES.STORE_QRPH_FEE);
  brand.courierBookingEntitled = has(FEATURES.STORE_COURIER_BOOKING);

  // Group Buy MANAGEMENT module (the "Group Buys" manager, distinct from the
  // rules editor above): ship the resolved groupbuy.* capability set so the
  // admin view knows which buttons to draw, plus the operator-set form
  // defaults. The server actions re-check every capability on call.
  brand.groupBuyCaps = await groupBuyCapsP;
  brand.groupBuySettings = normalizeGroupBuySettings(config.groupBuySettings);

  // Storefront group-buy gate: while a run is live, the owner can choose whether
  // on-hand (non-group-buy) products stay buyable (branding.config.groupBuyAllowOnHand,
  // default on). Resolve the gate server-side so the cart can disable blocked
  // add-to-cart and placeStorefrontOrderAction can re-check it. Only the GB
  // module needs the extra group-buys read; it's operator-grant, default OFF.
  // "Two ways to order" home — the operator grant (Super Admin → Features → Group
  // Buy) is the toggle; the owner's config.homeLayout can still opt in or force
  // classic. Resolved server-side so StorefrontApp just branches on brand.homeLayout.
  // The "boutique" home needs no grant — resolveHomeLayout checks it first, so
  // an unentitled tenant that picked it still gets it (see two-ways-home.ts).
  const twoWaysHomeEntitled = has(FEATURES.GB_TWO_WAYS_HOME);
  brand.homeLayout = resolveHomeLayout(twoWaysHomeEntitled, config.homeLayout);

  // Boutique's own config (the owner-typed assurance strip). Normalized at this
  // trust boundary as well as at render, so a hand-edited branding.config can
  // never push unbounded copy into the layout.
  brand.boutique = normalizeBoutiqueConfig(config.boutique);
  brand.editorial = normalizeEditorialConfig(config.editorial);

  // On-hand shelf order — "per-vial-first" leads with the single per-vial
  // listings and drops the multi-vial kits underneath (K Glow). Unset keeps
  // today's catalog order for every other store; nothing is ever hidden.
  brand.onHandOrder = normalizeOnHandOrder(config.onHandOrder);
  // Two-ways hero — "store" keeps the store's own hero on the two-ways home.
  brand.twoWaysHero = normalizeTwoWaysHero(config.twoWaysHero);
  // "cards" swaps the compact on-hand rows for the catalog's photo cards.
  brand.twoWaysOnHandStyle = normalizeTwoWaysOnHandStyle(config.twoWaysOnHandStyle);

  // Owner-editable Group Buy copy ("How group buys work" + terms line) — always
  // resolved (not gated on the GB module) because the two-ways home renders the
  // explainer even between rounds; defaults reproduce the built-in copy.
  brand.groupBuyContent = normalizeGroupBuyContent(config.groupBuyContent);
  // The app's live strip settings (on/off + owner text); the shop catalog
  // renders them against the live round (lib/storefront/gb-live-banner).
  brand.groupBuyLiveBanner = normalizeGroupBuyLiveBanner(config.groupBuyLiveBanner);
  brand.heroCountdownConfig = normalizeHeroCountdown(config.heroCountdown);

  brand.groupBuyAllowOnHand = config.groupBuyAllowOnHand !== false;
  // Per-way management: a store may sell only one way (Dragon Peptides is
  // group-buy only). Resolved to EFFECTIVE states below, once we know whether a
  // round is live, so the client never re-derives the rule. Without the Group
  // Buy module there is no second way to sell through, so the setting is left
  // unenforced rather than walling the store — same call the server gate makes
  // (lib/storefront/on-hand-gate).
  const twoWaysMode = brand.groupBuyCaps.enabled
    ? normalizeTwoWaysMode(config.twoWaysMode)
    : TWO_WAYS_MODE_DEFAULT;
  brand.twoWaysMode = twoWaysMode;
  if (brand.groupBuyCaps.enabled) {
    const groupBuys = await groupBuysP;
    brand.gbPaymentMode = gbPaymentModeFor(config);
    if (brand.gbPaymentMode === "pay_later") {
      brand.gbPayLaterShippingFee = normalizeGroupBuyInvoice((config as Record<string, unknown>).groupBuyInvoice).shippingFee;
    }
    brand.groupBuyGate = buildGroupBuyGate(
      groupBuys,
      brand.groupBuyCaps,
      brand.groupBuyAllowOnHand,
    );
    // Public banner + "Explore GB #N" scope filter for the live run. Purely
    // presentational — the on-hand gate above owns what can actually be bought.
    brand.groupBuyBanner = buildGroupBuyBanner(groupBuys, brand.groupBuyCaps) ?? undefined;
    // Hero "closes in / opens in" timer — owner opt-in, target derived from
    // the rounds (lib/storefront/hero-countdown).
    brand.heroCountdown = resolveHeroCountdown(config.heroCountdown, groupBuys, brand.groupBuyCaps) ?? undefined;
    // Slots filled = the round's demand orders (everything except cancelled /
    // refunded), which the pure banner builder can't load. Drives the Group Buy
    // page's "N of GOAL slots filled" progress bar (two-ways.slotProgress).
    const bannerId = brand.groupBuyBanner?.id;
    if (bannerId) {
      // One cached read serves both numbers: the slot bar's order count, and
      // the per-product vial totals behind the kit progress (gb-round-demand).
      const { filled, kitVials } = await getRoundDemand(tenantId, bannerId, slug);
      brand.groupBuyBanner = { ...brand.groupBuyBanner!, filled, kitVials };
    }

    // EFFECTIVE per-way states: the owner's setting folded with the live-round
    // rule, resolved once here so the home, the cart, and the server checkout
    // all read the same answer.
    brand.twoWaysMode = resolveWays(twoWaysMode, {
      allowOnHand: brand.groupBuyAllowOnHand,
      roundLive: !!brand.groupBuyBanner,
    });
    // NOTE: a hidden group-buy way must NOT drop brand.groupBuyBanner. The
    // banner is what tells the home which products belong to the round, and
    // those are pre-orders priced at gbPrice — removing it would return them to
    // the ships-now shelf at their on-hand price with the wrong ship date. The
    // banner stays; the components read twoWaysMode to decide what to render.
  }

  // Products are the source of truth in the DB. Load the tenant's catalog
  // server-side (demo: file-backed store, seeded from the builtin fixtures) and
  // hand it to the storefront — both the public catalog and the #admin manager
  // render from this set, and the admin's writes persist back through
  // actions/products.ts. The brand's currency symbol drives display formatting.
  let products: Product[] = [];
  if (isDemoMode()) {
    const saved = getDemoStoreProducts(slug);
    products = saved
      ? saved
      : getDemoProducts(tenantId).map((dp) =>
          dbProductToStorefront(dp as unknown as DbProductRow, brand.currency || "₱"),
        );
  } else {
    const rows = (await productRowsP) ?? [];
    products = rows.map((r) => dbProductToStorefront(r as DbProductRow, brand.currency || "₱"));
  }
  // The owner's arrangement (Admin → Products ↑/↓). Every surface that lists
  // products in array order follows it; the catalog's default sort reads the
  // stamped `position`.
  products = applyProductOrder(products, normalizeProductOrder(config.productOrder));

  // Reseller wholesale pricing is part of the SAME entitlement as the portal:
  // an unentitled tenant's catalog ships with no reseller legs at all, so the
  // cart can never flip a bulk line to a wholesale price / RESELLER badge on
  // stray product data (test:reseller-gate). orders.ts re-applies this strip at
  // placement so a tampered client can't restore it. DB rows keep their data —
  // re-granting the feature brings the prices back untouched.
  //
  // The gated reseller page adds a SECOND reason to strip. Its prices are the
  // thing the password protects, so they must not be serialized into the page
  // for a visitor who has not presented it. `resolveWholesaleAccess` encodes the
  // split: a tenant selling wholesale on the regular storefront ships those
  // prices to everyone (they are public by design — any shopper who reaches the
  // MOQ pays them), while a page-only tenant ships them to nobody until the
  // server-verified cookie says this reseller unlocked the portal. Before this,
  // the whole wholesale price list was readable in View Source by any visitor,
  // because the only gate was a `sessionStorage` flag in the browser.
  // ONE decision, shared with the price refresh (products.ts) and with order
  // placement (orders.ts), so the price a customer browses is the price they are
  // charged. These used to be computed separately and disagreed.
  const wholesaleAccess = resolveWholesaleAccess(resellerCaps, resellerUnlocked);
  products = stripResellerPricing(
    products,
    wholesaleAccess.visible,
    wholesaleAccess.visible,
  );

  // Made-to-order: items manufactured per order sell with no inventory at all.
  // Stripped fail-closed for an unentitled tenant so a metadata key left behind
  // by a revoked grant can never keep a product off its own stock gate. The same
  // strip runs again in placeStorefrontOrderAction — this one only decides what
  // is DISPLAYED, and display and charge have to agree.
  const madeToOrderEntitled = has(FEATURES.STORE_MADE_TO_ORDER);
  brand.madeToOrderEntitled = madeToOrderEntitled;
  products = stripMadeToOrder(products, madeToOrderEntitled);

  // Paid group-buy access — LAST of the strips, so nothing after it can put a
  // round's products or prices back. A viewer locked out of the governing round
  // gets the catalog without that round (no gb listings, no gbPrice anywhere),
  // no banner, and the teaser instead. No-op without groupbuy.paid_access.
  // The banner is dropped ONLY together with the round's products (the same
  // access result), so nothing spills onto the on-hand shelf — the one
  // exception test:two-ways-home allows, between these markers.
  // gb-access:begin
  if (brand.groupBuyCaps.enabled) {
    const access = await applyGroupBuyAccess({
      tenantId,
      rounds: await groupBuysP,
      caps: brand.groupBuyCaps,
      viewer: opts.groupBuyViewer,
      products,
      currency: brand.currency || "₱",
    });
    products = access.products;
    if (access.teaser) {
      delete brand.groupBuyBanner;
      brand.groupBuyTeaser = access.teaser;
    }
  }
  // gb-access:end

  // How many group-buy listings exist at all, independent of any round. Between
  // rounds there is no round scope to read, so the productType "gb" tag is the
  // only membership signal — this count is what keeps the group buy page (and
  // its nav link) up as a view-only pricing reference once a round closes, and
  // what stops an empty page being advertised when there is nothing tagged.
  // Gated on the Group Buy module so no non-GB tenant ever grows the page.
  // Mirrors the availability filter the page itself applies.
  brand.groupBuyListingCount = brand.groupBuyCaps?.enabled
    ? products.filter((p) => p.available !== false && isGroupBuyProduct(p)).length
    : 0;

  // Catalog sort menu style — "simple" swaps the sort dropdown to the 3-option
  // Sort by Name / Sort by Price / Sort by Best Sellers menu (HP Glow), where
  // best sellers rank by real units sold. Counts are computed server-side from
  // the store's orders (cancelled/refunded excluded) and shipped on the brand;
  // a failed read degrades to no counts (best → name order) — the storefront
  // never blocks on analytics.
  brand.catalogSortStyle = normalizeCatalogSortStyle(config.catalogSortStyle);
  // The owner's shop switch. Normalized HERE, server-side, so a stale or
  // hand-edited client can't reopen a closed store by rewriting the config it
  // was handed — placeStorefrontOrderAction re-checks the same rule at the
  // boundary regardless. Absent/junk → open, so no live tenant moves.
  brand.storeStatus = normalizeStoreStatus(config.storeStatus);
  if (brand.catalogSortStyle === "simple") {
    // Cached + tag-busted in best-sellers.ts: this is a full scan of the
    // tenant's active orders reduced to a per-product tally, and it only ranks a
    // sort dropdown. It used to cost ~720ms on every render.
    brand.bestSellerCounts = await getBestSellerCounts(
      tenantId,
      isDemoMode() ? (slug) : undefined,
    );
  }

  // "New functionality" tags: the operator's kept flags (persisted registry
  // newKeys), mapped to this store's admin modules. Detected-but-unsaved additions
  // are intentionally excluded — store owners only see a tag the operator kept.
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
      if (has(key as FeatureKey)) spotlightEntitled.add(key);
    }
  }
  brand.featureSpotlight = pickFeatureSpotlight(
    registry.newKeys,
    (key) => spotlightEntitled.has(key),
    trialActive,
  );

  return { brand, products };
}

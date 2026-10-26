import "server-only";

import { runAsAppActor } from "@/lib/auth/app-actor-scope";
import * as storefrontAdmin from "@/actions/storefront-admin";
import * as products from "@/actions/products";
import * as groupBuys from "@/actions/group-buys";
import * as gbReview from "@/actions/gb-review";
import * as staff from "@/actions/storefront-staff";
import * as orders from "@/actions/orders";
import * as media from "@/actions/media";
import * as subscriptionPayments from "@/actions/subscription-payments";
import * as storefrontExport from "@/actions/storefront-export";
import * as upgrade from "@/actions/upgrade";
import * as storefrontGate from "@/actions/storefront-gate";
import * as customerAccounts from "@/actions/customer-accounts";
import type { MobileContext } from "./auth";
import { isAdminSubject } from "./sessions";

/**
 * The Pepweb app's bridge to the WEBSITE store-admin actions
 * (POST /api/mobile/v1/admin/call and /admin/upload/:fn).
 *
 * Only functions named here can be reached, and every one of them carries its
 * own store-admin guard (requireStaffPermission / requireStoreOwner /
 * requireStorefrontAdmin / requireGroupBuyAdmin) — the bridge adds identity,
 * never permission. Deliberately NOT here:
 *   - sign-in / sign-out / session probes (signInStoreAdminAction,
 *     signOutStorefrontAdminAction, hasStorefrontAdminSessionAction) — the app
 *     has its own session;
 *   - shopper-facing actions (placeStorefrontOrderAction, trackStorefrontOrderAction,
 *     uploadPaymentProofAction, getStorefrontProductsAction, verifyResellerCodeAction,
 *     resellerSignOutAction, verifyAccessCodeAction, logoutGateAction);
 *   - platform-operator actions (all of actions/branding.ts, saveGroupBuySettingsAction,
 *     confirm/rejectSubscriptionPaymentAction) — guarded by the operator session
 *     only, which an app user never holds, but they have no business here anyway.
 *
 * Adding an action = confirm it opens with a store-admin guard, then list it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAction = (...args: any[]) => Promise<unknown>;

/** JSON-argument actions. */
export const BRIDGED_ACTIONS: Readonly<Record<string, AnyAction>> = Object.freeze({
  // actions/storefront-admin.ts
  changeStorefrontAdminPasswordAction: storefrontAdmin.changeStorefrontAdminPasswordAction,
  savePaymentMethodsAction: storefrontAdmin.savePaymentMethodsAction,
  saveCategoriesAction: storefrontAdmin.saveCategoriesAction,
  saveSortCategoriesAction: storefrontAdmin.saveSortCategoriesAction,
  saveProductOrderAction: storefrontAdmin.saveProductOrderAction,
  saveStoreStatusAction: storefrontAdmin.saveStoreStatusAction,
  saveCurrencyAction: storefrontAdmin.saveCurrencyAction,
  saveCouriersAction: storefrontAdmin.saveCouriersAction,
  saveShippingLocationsAction: storefrontAdmin.saveShippingLocationsAction,
  savePromoCodesAction: storefrontAdmin.savePromoCodesAction,
  saveOrderNotificationsAction: storefrontAdmin.saveOrderNotificationsAction,
  saveNoticeModalAction: storefrontAdmin.saveNoticeModalAction,
  saveTrackNoteAction: storefrontAdmin.saveTrackNoteAction,
  saveTimelineAction: storefrontAdmin.saveTimelineAction,
  saveHeroContentAction: storefrontAdmin.saveHeroContentAction,
  saveBannerAction: storefrontAdmin.saveBannerAction,
  saveCheckoutRulesAction: storefrontAdmin.saveCheckoutRulesAction,
  saveGroupBuyRulesAction: storefrontAdmin.saveGroupBuyRulesAction,
  saveStoreAdminFeeAction: storefrontAdmin.saveStoreAdminFeeAction,
  getResellerSettingsAction: storefrontAdmin.getResellerSettingsAction,
  saveResellerSettingsAction: storefrontAdmin.saveResellerSettingsAction,
  saveCardDesignAction: storefrontAdmin.saveCardDesignAction,
  saveCardTemplatesAction: storefrontAdmin.saveCardTemplatesAction,
  saveFaqAction: storefrontAdmin.saveFaqAction,
  saveCoaReportsAction: storefrontAdmin.saveCoaReportsAction,
  saveReviewsAction: storefrontAdmin.saveReviewsAction,
  saveProtocolsAction: storefrontAdmin.saveProtocolsAction,

  // actions/products.ts
  listProductsAction: products.listProductsAction,
  saveProductAction: products.saveProductAction,
  deleteProductsAction: products.deleteProductsAction,

  // actions/group-buys.ts (store side — every one goes through requireGroupBuyAdmin)
  listGroupBuysAction: groupBuys.listGroupBuysAction,
  getGroupBuyDashboardAction: groupBuys.getGroupBuyDashboardAction,
  saveGroupBuyAction: groupBuys.saveGroupBuyAction,
  // Paid group-buy access (actions/gb-review.ts — requireStaffPermission("groupbuys")).
  saveGroupBuyPaidJoinAction: gbReview.saveGroupBuyPaidJoinAction,
  listGroupBuyJoinRequestsAction: gbReview.listGroupBuyJoinRequestsAction,
  reviewGroupBuyJoinRequestAction: gbReview.reviewGroupBuyJoinRequestAction,
  getGroupBuyJoinReceiptAction: gbReview.getGroupBuyJoinReceiptAction,
  addOrderedProductsToRoundAction: groupBuys.addOrderedProductsToRoundAction,
  saveGroupBuyAllowOnHandAction: groupBuys.saveGroupBuyAllowOnHandAction,
  saveTwoWaysModeAction: groupBuys.saveTwoWaysModeAction,
  saveGroupBuyContentAction: groupBuys.saveGroupBuyContentAction,
  saveGroupBuyLiveBannerAction: groupBuys.saveGroupBuyLiveBannerAction,
  saveHeroCountdownAction: groupBuys.saveHeroCountdownAction,
  saveGroupBuyInvoiceAction: groupBuys.saveGroupBuyInvoiceAction,
  sendGroupBuyInvoicesAction: groupBuys.sendGroupBuyInvoicesAction,
  duplicateGroupBuyAction: groupBuys.duplicateGroupBuyAction,
  setGroupBuyArchivedAction: groupBuys.setGroupBuyArchivedAction,
  getGroupBuySupplierReportAction: groupBuys.getGroupBuySupplierReportAction,
  saveGroupBuyProductPricingAction: groupBuys.saveGroupBuyProductPricingAction,

  // actions/storefront-staff.ts (session info + owner-only staff management)
  getStorefrontAdminSessionAction: staff.getStorefrontAdminSessionAction,
  listStaffAction: staff.listStaffAction,
  createStaffAction: staff.createStaffAction,
  updateStaffAction: staff.updateStaffAction,
  setStaffStatusAction: staff.setStaffStatusAction,
  deleteStaffAction: staff.deleteStaffAction,

  // actions/orders.ts (admin side)
  listStorefrontOrdersAction: orders.listStorefrontOrdersAction,
  updateStorefrontOrderAction: orders.updateStorefrontOrderAction,
  trashStorefrontOrdersAction: orders.trashStorefrontOrdersAction,
  restoreStorefrontOrdersAction: orders.restoreStorefrontOrdersAction,
  purgeStorefrontOrdersAction: orders.purgeStorefrontOrdersAction,
  bulkUpdateStorefrontOrderStatusAction: orders.bulkUpdateStorefrontOrderStatusAction,

  // actions/customer-accounts.ts (admin side — both open with requireStaffPermission("customers"))
  listStoreCustomersAction: customerAccounts.listStoreCustomersAction,
  setStoreCustomerStatusAction: customerAccounts.setStoreCustomerStatusAction,

  // actions/subscription-payments.ts (tenant side)
  submitSubscriptionPaymentAction: subscriptionPayments.submitSubscriptionPaymentAction,
  getBillingPaymentInfoAction: subscriptionPayments.getBillingPaymentInfoAction,
  listMySubscriptionPaymentsAction: subscriptionPayments.listMySubscriptionPaymentsAction,

  // actions/upgrade.ts (tenant side of upgrade requests)
  getUpgradeContextAction: upgrade.getUpgradeContextAction,
  downgradeToStarterAction: upgrade.downgradeToStarterAction,
  submitUpgradeRequestAction: upgrade.submitUpgradeRequestAction,

  // actions/storefront-gate.ts (owner's Access Code panel)
  getGateSettingsAction: storefrontGate.getGateSettingsAction,
  setGateSettingsAction: storefrontGate.setGateSettingsAction,
  rotateAccessCodeAction: storefrontGate.rotateAccessCodeAction,

  // actions/storefront-export.ts
  exportStoreDataAction: storefrontExport.exportStoreDataAction,
});

/** FormData actions (image uploads) — reached only through /admin/upload/:fn. */
export const FORM_ACTIONS: Readonly<Record<string, (form: FormData) => Promise<unknown>>> = Object.freeze({
  uploadProductImageAction: products.uploadProductImageAction,
  uploadStorefrontImageAction: media.uploadStorefrontImageAction,
});

export const MAX_BRIDGE_ARGS = 5;
/** JSON body cap for /admin/call — generous for a full product or FAQ save. */
export const MAX_CALL_BODY_BYTES = 2 * 1024 * 1024;

/** Own-property lookup, so `constructor`, `__proto__` etc. never resolve. */
export function lookupAction<T>(table: Readonly<Record<string, T>>, fn: unknown): T | null {
  if (typeof fn !== "string" || !Object.prototype.hasOwnProperty.call(table, fn)) return null;
  return table[fn] ?? null;
}

export type BridgeResult = { ok: true; data: unknown } | { ok: false; reason: "not_found" | "invalid_args" };

/** Run `run` as the authenticated app user (lib/auth/app-actor-scope.ts). */
export function asAppActor<T>(ctx: MobileContext, run: () => Promise<T>): Promise<T> {
  const subject = ctx.session.subject;
  // withMobile only admits owner/staff sessions; this re-asserts it in types.
  if (!isAdminSubject(subject)) throw new Error("app bridge: not a store-team session");
  return runAsAppActor({ tenantId: ctx.tenantId, slug: ctx.slug, subject }, run);
}

/** Look up an allowlisted JSON action and run it as the app user. Throws what the action throws. */
export async function runBridgedAction(ctx: MobileContext, fn: unknown, args: unknown): Promise<BridgeResult> {
  const action = lookupAction(BRIDGED_ACTIONS, fn);
  if (!action) return { ok: false, reason: "not_found" };
  const list = args === undefined ? [] : args;
  if (!Array.isArray(list) || list.length > MAX_BRIDGE_ARGS) return { ok: false, reason: "invalid_args" };
  return { ok: true, data: await asAppActor(ctx, () => action(...list)) };
}

/** Same, for a FormData upload action. */
export async function runBridgedUpload(ctx: MobileContext, fn: unknown, form: FormData): Promise<BridgeResult> {
  const action = lookupAction(FORM_ACTIONS, fn);
  if (!action) return { ok: false, reason: "not_found" };
  return { ok: true, data: await asAppActor(ctx, () => action(form)) };
}

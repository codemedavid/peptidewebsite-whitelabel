// Is this visitor walled out of the storefront right now?
//
// WHY this exists next to the layout's own gate checks: in the App Router a
// page renders ALONGSIDE its layout, so a layout that returns the gate instead
// of `children` still lets the page run and serialize its props. The storefront
// page's props are the whole catalog (prices included), so "members only" and
// "access code" walls drew correctly while View Source showed everything behind
// them. The page asks this and renders nothing for a blocked visitor; the
// layout keeps drawing the wall. Same two decisions, same order as the layout.

import { evaluateVisitorGate } from "@/lib/auth/gate-enforcement";
import { evaluateAccountGate } from "@/lib/auth/account-gate-enforcement";
import { getTenantContext } from "@/lib/tenant/context";
import { currentAppShopperScope } from "@/lib/auth/app-shopper-scope";

export async function isStorefrontBlocked(tenantId: string): Promise<boolean> {
  if ((await evaluateVisitorGate(tenantId)).status === "blocked") return true;
  const { branding } = await getTenantContext(tenantId);
  const config = (branding?.config ?? {}) as { accountGate?: unknown };
  return (await evaluateAccountGate(tenantId, config.accountGate)) === "blocked";
}

/** What a gated storefront action answers a walled-out caller. */
export const STOREFRONT_BLOCKED_MESSAGE =
  "This store is private. Refresh the page and enter the access code to continue.";

/**
 * The same wall, for the PUBLIC storefront server actions (catalog refresh,
 * quote, placement, order tracking, articles). A server action is a public
 * POST endpoint whose id ships in the client bundle, so walling only the
 * layout and page left a gated store's catalog, prices and checkout one
 * hand-rolled request away. Each such action asks this first.
 *
 * App shop requests are exempt here because they are gated BEFORE the action
 * runs: lib/mobile/shop.ts refuses signed-out callers on a private store and
 * admits signed-in customers, then enters the app-shopper scope. Re-checking
 * here would read browser cookies an app request never carries and lock every
 * app customer out of a gated store.
 */
export async function isStorefrontActionBlocked(tenantId: string): Promise<boolean> {
  if (currentAppShopperScope()) return false;
  return isStorefrontBlocked(tenantId);
}

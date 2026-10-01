import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * "Run this website CHECKOUT action as the Pepweb app shopper."
 *
 * The storefront checkout actions (placeStorefrontOrderAction,
 * quoteStorefrontOrderAction, uploadPaymentProofAction) find their tenant from
 * the request host and their shopper from the customer cookie. An app request
 * has neither: it arrives on the API host with a bearer token (or, for a
 * signed-out browse, a store code). Rather than fork the order engine into an
 * app copy (which would drift on every price, fee and stock rule), the shop
 * routes resolve the store and authenticate the customer against the database
 * FIRST (lib/mobile/shop.ts) and then run the unmodified action inside this
 * scope. The readers those actions go through — lib/tenant/headers.ts and
 * getSignedInCustomer() — consult the scope before the host / cookie.
 *
 * `customerId` is null for a signed-out quote. Only server code can enter a
 * scope (AsyncLocalStorage is per async call chain, never shared between
 * requests), and the only callers are the routes in
 * src/app/api/mobile/v1/shop/. Docs: docs/mobile-admin/SHOP.md.
 */

export type AppShopperScope = {
  tenantId: string;
  slug: string;
  customerId: string | null;
};

const storage = new AsyncLocalStorage<AppShopperScope>();

export function runAsAppShopper<T>(scope: AppShopperScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export function currentAppShopperScope(): AppShopperScope | null {
  return storage.getStore() ?? null;
}

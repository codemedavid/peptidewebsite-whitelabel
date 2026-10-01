import "server-only";

import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { getTenantGateState } from "@/lib/tenant/gate-state";
import { runAsAppShopper } from "@/lib/auth/app-shopper-scope";
import type { ApiErrorCode } from "./contract";
import { authenticateCustomer, storeAvailability, type CustomerContext } from "./auth";
import { normalizeStoreIdentifier } from "./store-identifier";
import { findStoreByHost, MOBILE_ROOT } from "./store-lookup";

/**
 * Which store an in-app shop request is for, and who is asking
 * (docs/mobile-admin/SHOP.md).
 *
 *   - A request WITH an Authorization header must be a live customer session;
 *     its store wins over anything in the query. An admin token is refused —
 *     the shop is for shoppers.
 *   - A signed-out request names the store (`?store=` / body `store`) the same
 *     way a store link does. A store that isn't live, or doesn't run the
 *     customer app (MOBILE_COMMUNITY), answers exactly like an unknown one, so
 *     the shop can't be used to probe a store's billing state.
 *   - A store behind an active access code is PRIVATE: signed-out callers get
 *     `forbidden`; signed-in customers are known accounts and pass.
 */

export type ShopStore = { tenantId: string; slug: string; customer: CustomerContext | null };

export type ShopResolution =
  | { ok: true; store: ShopStore }
  | { ok: false; code: ApiErrorCode; message: string };

const NOT_FOUND: ShopResolution = {
  ok: false,
  code: "not_found",
  message: "We couldn't find that store. Ask the seller for their app link.",
};

const BAD_STORE: ShopResolution = {
  ok: false,
  code: "invalid_input",
  message: "That doesn't look like a store link. Check it and try again.",
};

export const PRIVATE_STORE: ShopResolution = {
  ok: false,
  code: "forbidden",
  message: "This store is private. Sign in to shop.",
};

/** The same "is the visitor gate in force" test evaluateVisitorGate makes. */
async function isPrivateStore(tenantId: string): Promise<boolean> {
  const [gated, gate] = await Promise.all([
    hasFeature(tenantId, FEATURES.STORE_ACCESS_CODE),
    getTenantGateState(tenantId),
  ]);
  return gated && gate.enabled && gate.hasCode;
}

async function resolveGuestStore(storeParam: unknown): Promise<ShopResolution> {
  const host = normalizeStoreIdentifier(storeParam, MOBILE_ROOT);
  if (!host) return BAD_STORE;
  const store = await findStoreByHost(host);
  if (!store || store.status === "pending_setup") return NOT_FOUND;
  // Independent reads, one round trip instead of three; checked in the old order.
  const [unavailable, shopOpen, isPrivate] = await Promise.all([
    storeAvailability(store),
    hasFeature(store.id, FEATURES.MOBILE_COMMUNITY),
    isPrivateStore(store.id),
  ]);
  if (unavailable || !shopOpen) return NOT_FOUND;
  if (isPrivate) return PRIVATE_STORE;
  return { ok: true, store: { tenantId: store.id, slug: store.slug, customer: null } };
}

/** True when the request carries a bearer token (so auth is mandatory). */
export function hasAuthHeader(req: Request): boolean {
  return !!req.headers.get("authorization");
}

export async function resolveShopStore(req: Request, storeParam: unknown): Promise<ShopResolution> {
  if (!hasAuthHeader(req)) return resolveGuestStore(storeParam);
  const auth = await authenticateCustomer(req);
  if (!auth.ok) return { ok: false, ...auth.failure };
  const { tenantId, slug } = auth.ctx;
  return { ok: true, store: { tenantId, slug, customer: auth.ctx } };
}

/** Run a website checkout action as this shopper (lib/auth/app-shopper-scope.ts). */
export function asShopper<T>(store: ShopStore, fn: () => Promise<T>): Promise<T> {
  return runAsAppShopper(
    { tenantId: store.tenantId, slug: store.slug, customerId: store.customer?.customer.id ?? null },
    fn,
  );
}

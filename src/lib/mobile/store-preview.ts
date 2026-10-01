import "server-only";

import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { getTenantContext } from "@/lib/tenant/context";
import { appStorefrontOrigin } from "@/lib/mobile/storefront-origin";
import type { ApiErrorCode, StorePreview } from "./contract";
import { storeAvailability } from "./auth";
import { buildTheme } from "./branding";
import { normalizeStoreIdentifier } from "./store-identifier";
import { findStoreByHost, MOBILE_ROOT } from "./store-lookup";

/**
 * GET /stores/:store — what a store link opens, before anyone signs in.
 *
 * Public on purpose: it returns only what the store's own website already
 * shows a stranger (name, logo, colours). A store that isn't live — pending
 * setup, suspended, paused trial — answers exactly like an unknown one to a
 * customer, so the link can't be used to probe a store's billing state.
 */

type Result = { ok: true; data: StorePreview } | { ok: false; code: ApiErrorCode; message: string };

const NOT_FOUND: Result = {
  ok: false,
  code: "not_found",
  message: "We couldn't find that store. Ask the seller for their app link.",
};

export async function loadStorePreview(input: unknown): Promise<Result> {
  const host = normalizeStoreIdentifier(input, MOBILE_ROOT);
  if (!host) {
    return { ok: false, code: "invalid_input", message: "That doesn't look like a store link. Check it and try again." };
  }
  const store = await findStoreByHost(host);
  if (!store || store.status === "pending_setup") return NOT_FOUND;

  const [unavailable, tenant, customerSignIn] = await Promise.all([
    storeAvailability(store),
    getTenantContext(store.id),
    hasFeature(store.id, FEATURES.MOBILE_COMMUNITY),
  ]);
  if (unavailable) return NOT_FOUND;
  const theme = await buildTheme({ tenant });
  const websiteUrl = appStorefrontOrigin(store.slug) ?? `https://${store.slug}.${MOBILE_ROOT}`;
  return {
    ok: true,
    data: {
      slug: store.slug,
      name: theme.name,
      logoUrl: theme.logoUrl,
      address: `${store.slug}.${MOBILE_ROOT}`,
      websiteUrl,
      signUpUrl: `${websiteUrl}/#account`,
      customerSignIn,
      theme,
    },
  };
}

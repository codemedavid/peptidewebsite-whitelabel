import "server-only";

import { getTenantContext } from "@/lib/tenant/context";
import { appStorefrontOrigin } from "@/lib/mobile/storefront-origin";
import type { ApiErrorCode, StorePreview } from "./contract";
import { storeAvailability } from "./auth";
import { buildTheme } from "./branding";
import { normalizeStoreIdentifier } from "./store-identifier";
import { findStoreByHost, MOBILE_ROOT } from "./store-lookup";
import { customerAppOpen } from "@/lib/mobile/customer-app";
import { guestShoppingOpen } from "./guest-session";
import { publicContactChannels } from "@/lib/storefront/contact-methods";

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

  const [unavailable, tenant, customerSignIn, guestShopping] = await Promise.all([
    storeAvailability(store),
    getTenantContext(store.id),
    customerAppOpen(store.id),
    guestShoppingOpen(store.id),
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
      guestShopping,
      contactChannels: publicContactChannels((tenant.branding?.config as { contactChannels?: unknown } | null)?.contactChannels),
      theme,
    },
  };
}

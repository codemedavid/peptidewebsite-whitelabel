// A store's "get the app" link — the one address a seller shares so the app
// knows which store a customer belongs to.
//
//   https://<store>/app            the web page (download buttons + open in app)
//   pepwebadmin://store/<slug>     the deep link that page hands to the app
//
// The app only ever carries the store's public slug/host; the server resolves
// it again (normalizeStoreIdentifier + an exact host lookup) and the session
// it later issues is what binds the phone to the tenant.
//
// Pure (no DB, no env). Covered by npm run test:mobile-core.

/** Must match `scheme` in mobile/app.json. */
export const MOBILE_APP_SCHEME = "pepwebadmin";

/** The storefront route that serves the download / open-in-app page. */
export const APP_LINK_PATH = "/app";

/** The link a seller shares: their own website + /app. */
export function storeAppLink(websiteOrigin: string): string {
  return `${websiteOrigin.replace(/\/+$/, "")}${APP_LINK_PATH}`;
}

/** Opens the installed app straight onto this store. */
export function storeDeepLink(slug: string): string {
  return `${MOBILE_APP_SCHEME}://store/${encodeURIComponent(slug)}`;
}

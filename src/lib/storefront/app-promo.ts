/**
 * "Get our app" on the store's website — a small bar that tells visitors the
 * store has an app and links to its download page (<store>/app).
 *
 * The store team switches it on from the app (More → "Show the app on your
 * website"); it lives in branding.config.appPromo. It only ever shows when the
 * store's customer app is OPEN (App shopping or App community) — a store with
 * no app to offer never advertises one, whatever the saved switch says.
 *
 * Pure: no server imports, so the rules are unit-tested directly
 * (scripts/test-app-promo.ts).
 */

export type AppPromo = { enabled: boolean };

/** Staff need this module (Announcement Banner) to change it; the owner always may. */
export const APP_PROMO_STAFF_MODULE = "banner";

/** Off unless saved on. Anything unreadable is off. */
export function normalizeAppPromo(raw: unknown): AppPromo {
  return { enabled: !!raw && typeof raw === "object" && (raw as { enabled?: unknown }).enabled === true };
}

/** Pages where the bar would be noise: the download page itself and its sub-pages. */
const HIDDEN_ON = ["/app"];

/** Show the bar on this page? Saved on, the customer app open, and not on the download page. */
export function showAppPromo(promo: AppPromo, appOpen: boolean, pathname: string): boolean {
  if (!promo.enabled || !appOpen) return false;
  const path = pathname.split("?")[0] || "/";
  return !HIDDEN_ON.some((p) => path === p || path.startsWith(`${p}/`));
}

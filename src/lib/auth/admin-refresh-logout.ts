/**
 * "The store admin signs out when the admin page is refreshed" — and ONLY then.
 *
 * This used to live in middleware, which deleted `sf_admin_session` on every
 * top-level document load of the storefront. But the `#admin` hash never
 * reaches the server, so middleware could not tell "the owner refreshed the
 * dashboard" from "the owner opened the shop in another tab": both looked like
 * a GET for "/". Opening the shop anywhere — a second tab, the pop-up's "show on
 * store", a pasted link — silently ended the admin session, and the very next
 * save in the dashboard dropped the owner onto the storefront.
 *
 * The browser knows the difference: the Navigation Timing entry says whether
 * THIS document was loaded by a reload. So the decision moved to the client,
 * where the hash is readable too. StorefrontApp asks on mount and, for a reload
 * of `#admin`, ends the session through the sign-out action.
 *
 * Pure on purpose (scripts/test-admin-refresh-logout.ts).
 */

/** The navigation types the Navigation Timing API reports. */
export type NavigationType = "navigate" | "reload" | "back_forward" | "prerender";

export const ADMIN_PAGE_HASH = "#admin";

/** True only when the admin page itself was reloaded. */
export function isAdminPageReload(navigationType: NavigationType | null, hash: string | null | undefined): boolean {
  return navigationType === "reload" && hash === ADMIN_PAGE_HASH;
}

/** Legacy `performance.navigation.type` codes (Safari < 15 has no entry API). */
const LEGACY_NAVIGATION_TYPES: Record<number, NavigationType> = { 0: "navigate", 1: "reload", 2: "back_forward" };

type PerformanceLike = {
  getEntriesByType?: (type: string) => ReadonlyArray<object>;
  navigation?: { type?: unknown };
};

/** How the current document was loaded, or null when the browser can't say. */
export function readNavigationType(perf: PerformanceLike | undefined): NavigationType | null {
  if (!perf) return null;
  const entry = perf.getEntriesByType?.("navigation")?.[0] as { type?: unknown } | undefined;
  if (entry && typeof entry.type === "string") return entry.type as NavigationType;
  const legacy = perf.navigation?.type;
  return typeof legacy === "number" ? (LEGACY_NAVIGATION_TYPES[legacy] ?? null) : null;
}

import type { NextRequest, NextResponse } from "next/server";

/**
 * "The store admin logs out on every refresh."
 *
 * The `#admin` store admin is part of a hash-routed SPA, so there is no admin
 * page load to hook — a refresh is simply a top-level DOCUMENT load of the
 * storefront. Server Components can't delete cookies, so the kill happens in
 * middleware (mirroring lib/auth/gate-roll.ts, which writes the visitor-gate
 * cookie from the same place).
 *
 * Everything hinges on one predicate: is this request a browser navigation, or
 * is it the already-booted SPA talking to the server? Clearing on SPA traffic
 * would sign the owner out on their next save; not clearing on a navigation is
 * the bug we're removing.
 *
 * We key on Next's own RSC/Server-Action headers rather than `Sec-Fetch-Dest`.
 * Safari < 16.4 sends no Sec-Fetch-* headers at all, and reading "header
 * missing" as "document" would log those users out on every server action.
 * `RSC` and `Next-Action` are emitted by the framework on every client.
 *
 * The decision is pure and lives apart from the middleware plumbing so it can be
 * unit-tested — see scripts/test-admin-session-reset.ts.
 */

/** The store-admin session cookie (see lib/auth/storefront-admin.ts). */
export const STORE_ADMIN_COOKIE = "sf_admin_session";

/** The request headers that distinguish a navigation from SPA traffic. */
export type DocumentLoadSignals = {
  method: string;
  /** `Accept` — a browser navigation always asks for HTML. */
  accept: string | null;
  /** `RSC` — present on client-side App Router navigations. */
  rsc: string | null;
  /** `Next-Action` — present on Server Action POSTs. */
  nextAction: string | null;
  /** `Sec-Purpose` — `prefetch` when the browser is speculatively fetching. */
  secPurpose: string | null;
};

export type ClearDecisionInput = DocumentLoadSignals & {
  pathname: string;
  /** False for the platform admin host and the marketing apex. */
  isTenantStorefrontHost: boolean;
  /** False for anonymous shoppers — see the cacheability note below. */
  hasAdminSessionCookie: boolean;
};

/**
 * True only for a real top-level document load: a GET that asks for HTML and
 * carries none of the framework's SPA markers.
 *
 * Speculative prefetches are excluded — the browser may fetch a document the
 * user never visits, and burning the session there would log the owner out from
 * a link they merely hovered.
 */
export function isDocumentLoad(signals: DocumentLoadSignals): boolean {
  const { method, accept, rsc, nextAction, secPurpose } = signals;

  if (method.toUpperCase() !== "GET") return false;
  // Server Actions and RSC navigations are the SPA, not a refresh. Checked
  // before Accept so a permissive `*/*` alongside them can't be misread.
  if (nextAction) return false;
  if (rsc) return false;
  if (secPurpose && secPurpose.toLowerCase().includes("prefetch")) return false;

  // No Accept header at all means a script/monitor/curl, not a navigation.
  return (accept ?? "").toLowerCase().includes("text/html");
}

/**
 * Whether this response should delete the store-admin session cookie.
 *
 * Beyond "is it a navigation", two guards keep the blast radius tight:
 *   - API routes are skipped — they're never a page the owner refreshes.
 *   - We only clear when the cookie is actually present. Every public storefront
 *     view is a document load, so clearing unconditionally would attach a
 *     Set-Cookie to every anonymous shopper's response and make the storefront
 *     uncacheable.
 *
 * The tenant `/admin` login is a different surface on a different cookie
 * (`tenant_admin_session`, lib/auth/tenant-admin.ts) and is left alone.
 */
export function shouldClearStoreAdminSession(input: ClearDecisionInput): boolean {
  if (!input.isTenantStorefrontHost) return false;
  if (!input.hasAdminSessionCookie) return false;
  if (input.pathname === "/api" || input.pathname.startsWith("/api/")) return false;
  if (input.pathname === "/admin" || input.pathname.startsWith("/admin/")) return false;
  return isDocumentLoad(input);
}

/**
 * Middleware adapter: read the signals off the request and, when this is a
 * refresh, delete the store-admin cookie on the outgoing response. A no-op for
 * every other request, so the SPA's saves and navigations are untouched.
 */
export function clearStoreAdminSessionOnDocumentLoad(
  req: NextRequest,
  res: NextResponse,
  isTenantStorefrontHost: boolean,
): void {
  const decision = shouldClearStoreAdminSession({
    method: req.method,
    accept: req.headers.get("accept"),
    rsc: req.headers.get("rsc"),
    nextAction: req.headers.get("next-action"),
    secPurpose: req.headers.get("sec-purpose"),
    pathname: req.nextUrl.pathname,
    isTenantStorefrontHost,
    hasAdminSessionCookie: Boolean(req.cookies.get(STORE_ADMIN_COOKIE)?.value),
  });
  if (!decision) return;

  // Must match the path the cookie was issued on, or the browser keeps it.
  res.cookies.delete({ name: STORE_ADMIN_COOKIE, path: "/" });
}

import { NextRequest, NextResponse } from "next/server";
import { refreshSupabaseSession } from "@/lib/auth/middleware-session";
import { rollGateCookie } from "@/lib/auth/gate-roll";
import { clearStoreAdminSessionOnDocumentLoad } from "@/lib/auth/admin-session-reset";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(
  /:\d+$/,
  "",
);
// Explicit admin host override. Set this to the bare deployment host (e.g. a
// Vercel URL like "myapp.vercel.app") when you don't have an `admin.<root>`
// subdomain yet and want the Super Admin served at the root of that host.
const ADMIN_HOST = process.env.NEXT_PUBLIC_ADMIN_HOST?.replace(/:\d+$/, "");

/**
 * Edge middleware: host-based routing + Supabase token refresh — NO database
 * access here. Prisma can't run on the Edge runtime, so we just tag the request
 * with the raw host; the tenant is resolved server-side (Node, cached) via
 * getTenantId(). Supabase auth IS edge-safe (HTTP only), so we refresh the
 * session cookies here to keep logins alive across requests.
 *
 * Production note: mirror host→tenantId into Vercel Edge Config / KV and read
 * it here for sub-ms resolution + early rejection of unknown hosts.
 */
export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const rawHost = (req.headers.get("host") ?? "").toLowerCase();
  const host = rawHost.replace(/:\d+$/, "");

  // Canonicalize www → apex. Redirect www.anything to the bare hostname so both
  // variants always resolve and there's one canonical URL for SEO / cookies.
  if (host.startsWith("www.")) {
    const apex = rawHost.replace(/^www\./, "");
    const canonical = new URL(req.url);
    canonical.host = apex;
    return NextResponse.redirect(canonical, { status: 301 });
  }

  // Strip any client-supplied tenant headers before we set our own.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete("x-tenant-id");
  requestHeaders.delete("x-tenant-slug");
  requestHeaders.set("x-tenant-host", host);
  // Expose the request path so server layouts can branch (e.g. render the admin
  // login bare, outside the dashboard shell). Layouts don't otherwise see it.
  requestHeaders.set("x-pathname", url.pathname);

  // Platform admin app physically lives under /admin (it can't own the root
  // path "/" — the tenant storefront does, on tenant subdomains). We serve it at
  // the BARE root of the admin host by rewriting "/x" → "/admin/x" internally,
  // so the browser URL stays clean (app.jonina.store/tenants, not /admin/tenants).
  //   - app.<root>            → the production admin host (e.g. app.jonina.store)
  //   - admin.<root>          → legacy admin host (kept for back-compat)
  //   - localhost             → the dev convenience host (no tenant subdomain)
  //   - NEXT_PUBLIC_ADMIN_HOST → explicit override for a bare deployment host
  //   - *.vercel.app          → Vercel URLs can't host an `app.` subdomain, so
  //                             serve the admin at their root out of the box
  const isAdmin =
    host === `app.${ROOT}` ||
    host === `admin.${ROOT}` ||
    host === "localhost" ||
    (ADMIN_HOST !== undefined && host === ADMIN_HOST) ||
    host.endsWith(".vercel.app");

  // The marketing/sales site lives at the BARE apex (jonina.store). The apex
  // can't own "/" directly (route groups can't disambiguate it from the tenant
  // storefront's "/"), so the site physically lives under /marketing and we
  // rewrite the apex's bare paths into it — mirroring the /admin trick above.
  // Gated on `!isAdmin` so `localhost` / `app.<root>` / `*.vercel.app` (all admin
  // hosts) are never mistaken for the apex.
  const isApex = !isAdmin && host === ROOT;

  // Legacy product URL → the canonical share link, before anything renders.
  //
  // This has to happen HERE, not in the route. The (storefront) group has a
  // loading.tsx, so every page under it renders behind a Suspense boundary:
  // Next flushes a 200 shell and streams, and a redirect() thrown in the page
  // body afterwards can no longer set a status — the visitor gets 200 plus a
  // not-found body instead of a 308. Middleware runs before any of that.
  //
  // The page file stays as a backstop for anything this matcher misses.
  if (!isAdmin && !isApex) {
    const legacyProduct = /^\/products\/([^/]+)\/?$/.exec(url.pathname);
    if (legacyProduct) {
      const canonical = new URL(`/p/${legacyProduct[1]}`, req.url);
      canonical.search = url.search;
      return NextResponse.redirect(canonical, { status: 308 });
    }
  }
  const rebuild = () => {
    if (isAdmin) {
      const path = url.pathname;
      // Pass through API routes (e.g. /api/imagekit/auth used by the branding
      // editor) and any already-/admin-prefixed deep links — don't double-prefix.
      if (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api")) {
        return NextResponse.next({ request: { headers: requestHeaders } });
      }
      return NextResponse.rewrite(new URL(`/admin${path}`, req.url), {
        request: { headers: requestHeaders },
      });
    }
    if (isApex) {
      const path = url.pathname;
      // API routes (e.g. /api/onboarding/upload) and already-/marketing deep
      // links pass through untouched; everything else maps "/x" → "/marketing/x"
      // so "/" → "/marketing" and "/get-started" → "/marketing/get-started".
      if (path === "/marketing" || path.startsWith("/marketing/") || path.startsWith("/api")) {
        return NextResponse.next({ request: { headers: requestHeaders } });
      }
      return NextResponse.rewrite(
        new URL(`/marketing${path === "/" ? "" : path}${url.search}`, req.url),
        { request: { headers: requestHeaders } },
      );
    }
    // Tenant hosts: /admin is the password-only tenant login. The /admin URL
    // slot is already taken by the platform Super Admin under (platform), so we
    // rewrite to (tenant)/tenant-admin internally while keeping the public URL.
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      return NextResponse.rewrite(new URL("/tenant-admin", req.url), {
        request: { headers: requestHeaders },
      });
    }
    // Tenant hosts pass through; the tenant (storefront / dashboard) routes live
    // under the (tenant) group at root.
    return NextResponse.next({ request: { headers: requestHeaders } });
  };

  const res = await refreshSupabaseSession(req, requestHeaders, rebuild);

  // Rolling timeout for the visitor access-code gate: on tenant storefront hosts,
  // re-stamp a still-valid `tenant.sid` with a fresh 15-min expiry so active
  // visitors aren't bounced to the gate mid-session. Edge HMAC only — no DB, no
  // effect on admin/apex hosts or API routes, and a no-op when there's no valid
  // gate cookie. Done after the Supabase refresh so it lands on the final response.
  if (!isAdmin && !isApex && !url.pathname.startsWith("/api")) {
    await rollGateCookie(req, res);
  }

  // Store admin (`#admin`) signs out on every refresh: the storefront is a
  // hash-routed SPA, so a refresh is just a top-level document load of this
  // page — and that's the only moment we can catch, since Server Components
  // can't delete cookies. A no-op for the SPA's own server actions and RSC
  // fetches (so saves never sign you out) and for visitors with no admin
  // cookie (so anonymous storefront responses stay Set-Cookie-free).
  clearStoreAdminSessionOnDocumentLoad(req, res, !isAdmin && !isApex);

  return res;
}

export const config = {
  matcher: [
    "/((?!_next/|favicon.ico|robots.txt|sitemap.xml|api/inngest|api/webhooks).*)",
  ],
};

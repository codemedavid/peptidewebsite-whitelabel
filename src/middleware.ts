import { NextRequest, NextResponse } from "next/server";
import { refreshSupabaseSession } from "@/lib/auth/middleware-session";

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
  const host = (req.headers.get("host") ?? "")
    .replace(/:\d+$/, "")
    .toLowerCase();

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
  // so the browser URL stays clean (localhost:3100/tenants, not /admin/tenants).
  //   - admin.<root>          → the production admin host
  //   - localhost             → the dev convenience host (no tenant subdomain)
  //   - NEXT_PUBLIC_ADMIN_HOST → explicit override for a bare deployment host
  //   - *.vercel.app          → Vercel URLs can't host an `admin.` subdomain, so
  //                             serve the admin at their root out of the box
  const isAdmin =
    host === `admin.${ROOT}` ||
    host === "localhost" ||
    (ADMIN_HOST !== undefined && host === ADMIN_HOST) ||
    host.endsWith(".vercel.app");
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
    // Marketing site (apex / www) and tenant hosts pass through; the tenant
    // (storefront / dashboard) routes live under the (tenant) group at root.
    return NextResponse.next({ request: { headers: requestHeaders } });
  };

  return refreshSupabaseSession(req, requestHeaders, rebuild);
}

export const config = {
  matcher: [
    "/((?!_next/|favicon.ico|robots.txt|sitemap.xml|api/inngest|api/webhooks).*)",
  ],
};

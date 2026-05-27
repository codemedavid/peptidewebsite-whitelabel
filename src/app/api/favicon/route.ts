import { getTenantIdOrNull } from "@/lib/tenant/headers";
import { getTenantContext } from "@/lib/tenant/context";
import { resolveCssVars } from "@/lib/theme/resolve-css-vars";

export const dynamic = "force-dynamic";

/**
 * Per-tenant favicon: a monogram tile in the tenant's brand color.
 * Resolved from the request host (middleware sets x-tenant-host), so each
 * storefront shows its own tab icon. Returns SVG (crisp at any size).
 */
export async function GET() {
  let initial = "?";
  let bg = "hsl(201 96% 32%)";
  let fg = "hsl(0 0% 100%)";

  const tenantId = await getTenantIdOrNull();
  if (tenantId) {
    const { tenant, settings, branding } = await getTenantContext(tenantId);
    // A tenant-uploaded favicon overrides the generated monogram tile.
    if (branding?.faviconUrl) {
      return faviconResponse(branding.faviconUrl);
    }
    const name = settings?.storeName ?? tenant.name;
    initial = name.trim()[0]?.toUpperCase() ?? "?";
    const vars = resolveCssVars(branding) as Record<string, string>;
    if (vars["--brand"]) bg = `hsl(${vars["--brand"]})`;
    if (vars["--primary-foreground"]) fg = `hsl(${vars["--primary-foreground"]})`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="${bg}"/>
<text x="32" y="33" font-family="system-ui, sans-serif" font-size="38" font-weight="700" fill="${fg}" text-anchor="middle" dominant-baseline="central">${initial}</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=60, s-maxage=300",
    },
  });
}

/**
 * Serve a tenant-uploaded favicon. Real (http) URLs — e.g. ImageKit — are
 * redirected; demo data URLs are decoded and streamed inline (browsers won't
 * follow a redirect to a data: URL).
 */
function faviconResponse(faviconUrl: string): Response {
  const dataMatch = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(faviconUrl);
  if (dataMatch) {
    const [, contentType, isBase64, payload] = dataMatch;
    const body = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return new Response(body, {
      headers: {
        "Content-Type": contentType || "application/octet-stream",
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    });
  }
  return Response.redirect(faviconUrl, 307);
}

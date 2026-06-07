import type { MetadataRoute } from "next";
import { headers } from "next/headers";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(/:\d+$/, "");

// App-wide robots (not matched by middleware). On the apex marketing host we
// advertise the sitemap; tenant storefronts just get an allow-all.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = ((await headers()).get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  const isApex = host === ROOT;
  const scheme = /localhost|lvh\.me|127\.0\.0\.1/.test(ROOT) ? "http" : "https";
  return {
    rules: { userAgent: "*", allow: "/" },
    ...(isApex ? { sitemap: `${scheme}://${ROOT}/sitemap.xml` } : {}),
  };
}

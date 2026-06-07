import type { MetadataRoute } from "next";
import { headers } from "next/headers";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").replace(/:\d+$/, "");

// Only the apex marketing site has a meaningful sitemap; other hosts return none.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = ((await headers()).get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  if (host !== ROOT) return [];
  const scheme = /localhost|lvh\.me|127\.0\.0\.1/.test(ROOT) ? "http" : "https";
  const base = `${scheme}://${ROOT}`;
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/get-started`, changeFrequency: "monthly", priority: 0.8 },
  ];
}

import "server-only";

import { storefrontOrigin } from "@/lib/tenant/resolve";

/**
 * The storefront address the Pepweb app opens (Storefront screen, embedded
 * website admin, store links).
 *
 * In development the real one is `https://<slug>.lvh.me`, which a phone
 * resolves to ITSELF (lvh.me → 127.0.0.1) — so the app shows "couldn't reach
 * your store". `MOBILE_DEV_STOREFRONT_ORIGIN` points the app at a tunnel
 * instead, e.g. `cloudflared tunnel --url http://localhost:3100
 * --http-host-header vrjonina.lvh.me:3100`. The tunnel serves ONE store, so it
 * applies only to the slug named in `MOBILE_DEV_STOREFRONT_SLUG`. Never in
 * production.
 */
export function appStorefrontOrigin(slug: string | null | undefined): string | undefined {
  const override = devOverride(slug);
  return override ?? storefrontOrigin(slug);
}

function devOverride(slug: string | null | undefined): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  const origin = process.env.MOBILE_DEV_STOREFRONT_ORIGIN?.trim().replace(/\/+$/, "");
  const devSlug = process.env.MOBILE_DEV_STOREFRONT_SLUG?.trim().toLowerCase();
  if (!origin || !devSlug || (slug ?? "").trim().toLowerCase() !== devSlug) return undefined;
  return /^https?:\/\/[^/]+$/i.test(origin) ? origin : undefined;
}

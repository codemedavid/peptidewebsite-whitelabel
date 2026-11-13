// PURE store-address derivation for the public sign-up, shared by the wizard's
// live preview and the server action that actually assigns the subdomain, so
// the address a client is shown is the address they get.

import { slugify, uniqueize } from "@/lib/storefront/product-mapping";

// Labels a sign-up can never claim: the platform hosts + Next/runtime reserved
// segments. Mirrors RESERVED_SUBDOMAINS in lib/tenant/resolve.ts.
export const RESERVED_STORE_SLUGS: ReadonlySet<string> = new Set([
  "www", "admin", "app", "api", "marketing", "tenant", "static", "_next", "assets", "public",
]);

/** Derive a 2+ char base slug; "store" when the name slugifies to nothing usable. */
export function baseStoreSlug(name: string): string {
  const s = slugify(name);
  return s && s !== "product" && s.length >= 2 ? s : "store";
}

/** The slug the server would assign given the slugs already in use. */
export function pickStoreSlug(name: string, taken: Iterable<string>): string {
  const all = new Set<string>([...taken, ...RESERVED_STORE_SLUGS]);
  return uniqueize(baseStoreSlug(name), all);
}

/** The platform root domain without a dev port, e.g. "pepweb.store". */
export function storeRootDomain(raw: string | undefined = process.env.NEXT_PUBLIC_ROOT_DOMAIN): string {
  return (raw ?? "localhost:3000").replace(/:\d+$/, "");
}

// Per-product share links.
//
// The storefront is a hash-routed SPA served from one URL, so until now an
// owner who wanted to send ONE product to ONE customer had nothing to paste —
// only "here's my store, scroll down". This module owns the addressing scheme
// that fixes that, in three renderings of one key:
//
//   /p/<key>              the server route (src/app/(tenant)/(storefront)/p)
//   #p/<key>              the same target inside the SPA
//   https://host/p/<key>  what actually gets pasted into Messenger/Viber
//
// Why a REAL route and not just a hash: a URL fragment is never sent to the
// server, so a `#`-only link previews in chat as the generic store name with no
// photo. Only a server route can answer a crawler with the product's own image,
// name and price — which is the whole point of a link you send to a customer.
//
// Pure (no DB, no React, no `server-only`) so the client card, the SPA router
// and the server route all share one definition of "what addresses a product"
// and can never drift. Covered by scripts/test-product-link.ts.

/** The hash/path segment that namespaces a product link. */
const PRODUCT_SEGMENT = "p";

/**
 * The fields a link needs. Deliberately structural rather than the full
 * storefront `Product`, so the server route can pass a raw DB row and the
 * backfill script can pass a `{ id, slug }` projection.
 */
export type LinkableProduct = {
  id: string;
  slug?: string | null;
};

/**
 * The stable key a share link addresses this product by.
 *
 * The slug when there is one, the id otherwise. The fallback is not a nicety:
 * `Product.slug` is nullable and is only generated on the CREATE path, so every
 * bulk-imported or seeded catalog (the 88-product Dragon Peptides import, the
 * demo fixtures) has none. Without the fallback the feature would be silently
 * missing for those tenants — cards with a share button that builds `/p/`.
 *
 * Both keys stay resolvable forever (see findProductByLinkKey), so a link sent
 * before a backfill keeps working after it.
 */
export function productLinkKey(product: LinkableProduct): string {
  const slug = (product.slug ?? "").trim();
  return slug || (product.id ?? "").trim();
}

/** Path on the tenant's own host: `/p/<key>`. `/` when there is no key at all. */
export function productPath(product: LinkableProduct): string {
  const key = productLinkKey(product);
  if (!key) return "/";
  return `/${PRODUCT_SEGMENT}/${encodeURIComponent(key)}`;
}

/** In-SPA route for the same product: `#p/<key>`. */
export function productHash(product: LinkableProduct): string {
  const key = productLinkKey(product);
  if (!key) return "";
  return `#${PRODUCT_SEGMENT}/${encodeURIComponent(key)}`;
}

/**
 * The absolute URL an owner copies and sends.
 *
 * `origin` comes from `window.location.origin` on the client, which already
 * resolves custom domains, `slug.lvh.me:3100` in dev and `*.pepweb.store` in
 * production with no configuration — there is deliberately no ROOT_DOMAIN
 * lookup here. An empty origin (SSR, where there is no window) degrades to the
 * relative path rather than emitting "undefined/p/...".
 */
export function productShareUrl(
  origin: string | null | undefined,
  product: LinkableProduct,
): string {
  const path = productPath(product);
  const base = (origin ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}${path}` : path;
}

/**
 * Read the product key out of a hash, or null when the hash addresses anything
 * else.
 *
 * Namespacing under `p/` is what keeps this safe: the SPA router is an
 * exact-match list of flat routes (#catalog, #admin, …), and a parser that
 * treated any unknown hash as a product slug would swallow them all. Accepts a
 * hash with or without its leading "#" so callers can pass
 * `window.location.hash` or an already-stripped value.
 */
export function parseProductHash(hash: string | null | undefined): string | null {
  const raw = (hash ?? "").replace(/^#/, "");
  if (!raw) return null;
  const [segment, ...rest] = raw.split("/");
  if (segment !== PRODUCT_SEGMENT) return null;
  // Only the first segment is the key; "#p/a/b" is not a shape we mint, but
  // resolving it to "a" beats dead-ending a mangled paste.
  const key = rest[0] ?? "";
  if (!key) return null;
  try {
    return decodeURIComponent(key);
  } catch {
    // A truncated percent-escape (chat apps do mangle long URLs) — fall back to
    // the raw segment rather than throwing inside a router.
    return key;
  }
}

/**
 * Resolve a link key back to a product: slug first, then id.
 *
 * The order matters. The slug is the canonical shareable key, so a row whose id
 * happens to equal another row's slug must not shadow it. Checking id as well
 * is what lets a link minted before the slug backfill keep resolving after it.
 */
export function findProductByLinkKey<T extends LinkableProduct>(
  products: readonly T[],
  key: string | null | undefined,
): T | null {
  const wanted = (key ?? "").trim();
  if (!wanted) return null;
  return (
    products.find((p) => (p.slug ?? "").trim() === wanted) ??
    products.find((p) => p.id === wanted) ??
    null
  );
}

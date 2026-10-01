// What a store admin types into the mobile app's "Store address" field → the
// host the website itself would be reached on.
//
// Store-admin credentials are scoped to ONE store (the same email can own
// several), and on the web the store is implied by the address bar. The app has
// no address bar, so the admin names their store the way they already know it:
// "hpglow", "hpglow.pepweb.store", "https://hpglow.pepweb.store/#admin", or a
// custom domain. This turns any of those into a host that the existing
// resolveTenantByHost (slug subdomain OR Domain table) can resolve — so the app
// never needs, or is ever trusted with, a tenant id.
//
// Pure (no DB, no env): the root domain is passed in. Covered by
// npm run test:mobile-core.

/** Mirrors lib/tenant/resolve.ts — platform labels that are never a store. */
const RESERVED_LABELS = new Set(["www", "admin", "app"]);

const MAX_INPUT = 253;
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

function stripToHost(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  s = s.split(/[/?#]/)[0] ?? ""; // path, query, hash
  s = s.replace(/\.$/, "");
  return s.startsWith("www.") ? s.slice(4) : s;
}

/**
 * @returns the normalised host, or null when the input can never name a store.
 */
export function normalizeStoreIdentifier(input: unknown, rootDomain: string): string | null {
  if (typeof input !== "string") return null;
  if (input.length > MAX_INPUT) return null;
  const host = stripToHost(input);
  if (!host || !HOST_RE.test(host)) return null;

  const root = rootDomain.trim().toLowerCase();
  if (host === root) return null;

  // A bare label is a slug on the platform root.
  if (!host.includes(".")) {
    return RESERVED_LABELS.has(host) ? null : `${host}.${root}`;
  }

  if (host.endsWith(`.${root}`)) {
    const label = host.slice(0, -(root.length + 1));
    if (!label || label.includes(".") || RESERVED_LABELS.has(label)) return null;
  }
  return host;
}

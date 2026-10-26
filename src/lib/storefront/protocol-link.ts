// Per-protocol share links.
//
// The Protocols page is one hash route (#protocols) listing every guide as an
// accordion, so an owner answering "how do I take GHK-Cu?" in chat had nothing
// better to paste than the whole guide. This module owns the addressing scheme
// that gives each protocol its own link, in three renderings of one key:
//
//   /protocols/<key>              the server route (src/app/(tenant)/(storefront)/protocols)
//   #protocols/<key>              the same target inside the SPA
//   https://host/protocols/<key>  what actually gets pasted into Messenger/Viber
//
// Why a REAL route and not just a hash: a URL fragment is never sent to the
// server, so a `#`-only link previews in chat as the generic store name. Only a
// server route can answer a crawler with the protocol's own name and chart
// image — the same reason product links live at /p/<slug>
// (see product-link.ts).
//
// Protocols have no id: they are one JSON array in `branding.config`. The key is
// therefore a slug of the NAME, made unique across the list in source order. A
// rename moves the link; the route then lands on the guide itself rather than a
// dead end (see findProtocolIndexByLinkKey).
//
// Pure (no DB, no React, no `server-only`) so the client page, the SPA router
// and the server route share one definition. Covered by
// scripts/test-protocol-link.ts.

/** The hash/path segment that namespaces a protocol link. */
const PROTOCOL_SEGMENT = "protocols";

/** Long names (supplier guide titles) make unwieldy links; the cut keeps them pasteable. */
const MAX_SLUG_LENGTH = 80;

/** What an unnamed protocol slugs to, so it still gets an address. */
const FALLBACK_SLUG = "protocol";

/** The field a link needs — structural, so the server route can pass raw config JSON. */
export type LinkableProtocol = { name?: string | null };

/**
 * URL-safe slug of a protocol name: "GHK-Cu 50mg" → "ghk-cu-50mg".
 * Diacritics fold to ASCII; strength numbers survive, so "GHK-Cu 50mg" and
 * "GHK-Cu 100mg" stay distinct.
 */
export function protocolSlug(name: string | null | undefined): string {
  const slug = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, "");
  return slug || FALLBACK_SLUG;
}

/**
 * The link key of every protocol, index-aligned with `protocols`.
 *
 * Keys are assigned in SOURCE order (the owner's order, not the page's sort or
 * filter, which are presentation) so a key never changes because a visitor
 * picked "Z–A". Same-slug names get "-2", "-3"…; the loop also steps past a
 * protocol literally named "x 2", so no two rows can ever share a key.
 */
export function protocolLinkKeys(protocols: readonly LinkableProtocol[]): string[] {
  const used = new Set<string>();
  return protocols.map((p) => {
    const base = protocolSlug(p?.name);
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
    used.add(key);
    return key;
  });
}

/** Path on the tenant's own host: `/protocols/<key>`. */
export function protocolPath(key: string): string {
  return `/${PROTOCOL_SEGMENT}/${encodeURIComponent(key)}`;
}

/** In-SPA route for the same protocol: `#protocols/<key>`. */
export function protocolHash(key: string): string {
  return `#${PROTOCOL_SEGMENT}/${encodeURIComponent(key)}`;
}

/**
 * The absolute URL an owner copies and sends. `origin` comes from
 * `window.location.origin`, which already resolves custom domains and dev
 * hosts; an empty origin degrades to the relative path.
 */
export function protocolShareUrl(origin: string | null | undefined, key: string): string {
  const base = (origin ?? "").trim().replace(/\/+$/, "");
  const path = protocolPath(key);
  return base ? `${base}${path}` : path;
}

/**
 * Read the protocol key out of a hash, or null when the hash addresses anything
 * else. A bare "#protocols" is the guide itself, not a protocol, so it is null
 * too. Accepts the hash with or without its leading "#".
 */
export function parseProtocolHash(hash: string | null | undefined): string | null {
  const raw = (hash ?? "").replace(/^#/, "");
  const [segment, ...rest] = raw.split("/");
  if (segment !== PROTOCOL_SEGMENT) return null;
  const key = rest[0] ?? "";
  if (!key) return null;
  try {
    return decodeURIComponent(key);
  } catch {
    // A truncated percent-escape (chat apps mangle long URLs) — use it raw.
    return key;
  }
}

/**
 * Resolve a link key back to a protocol's index in `protocols`, or -1.
 *
 * Exact key first; then the key re-slugged, so a hand-typed or case-mangled
 * link ("/protocols/GHK-Cu-50mg") still finds its protocol. -1 means the
 * protocol was renamed or removed — callers show the whole guide, which beats
 * a dead end for the customer holding the old link.
 */
export function findProtocolIndexByLinkKey(
  protocols: readonly LinkableProtocol[],
  key: string | null | undefined,
): number {
  const wanted = (key ?? "").trim();
  if (!wanted) return -1;
  const keys = protocolLinkKeys(protocols);
  const exact = keys.indexOf(wanted);
  if (exact >= 0) return exact;
  return keys.indexOf(protocolSlug(wanted));
}

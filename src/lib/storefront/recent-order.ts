/**
 * The customer's most recent order number, remembered in a cookie.
 *
 * Why it exists: a store with no contact channel places orders on the site and
 * sends the customer to the Track page to follow them. Asking someone to
 * transcribe "HP-000482" off a confirmation screen is exactly the step they will
 * get wrong, so the browser remembers it and the tracker looks it up for them.
 *
 * Why a COOKIE and not localStorage: `myOrders` (localStorage, tenant-namespaced
 * in store.tsx) already keeps the richer list and remains the fallback. The
 * cookie is the small, explicit "most recent" pointer — it carries its own TTL
 * and is sent with the document request, so it stays available in contexts where
 * a storefront's localStorage is partitioned away from it.
 *
 * Why it is safe to be readable by page scripts: the value is ONLY an order
 * number, and looking an order up by number is already a public, PII-free
 * operation (trackStorefrontOrderAction returns status/journey/items and no
 * customer information). It is not a credential, so it is not httpOnly — the
 * client is the only thing that reads it.
 *
 * Every value is sanitized on the way IN and again on the way OUT: it is written
 * straight into a search input and passed to a lookup, and a cookie is
 * user-writable, so the module never trusts what it reads back.
 *
 * The pure half (build / read / sanitize) is DOM-free and tested directly; the
 * two thin wrappers at the bottom touch `document.cookie` and no-op everywhere
 * else. npm run test:channelless-checkout
 */

/** Cookie name. Each tenant is served from its own subdomain, so this is already
 *  scoped per store without a namespace of its own. */
export const RECENT_ORDER_COOKIE = "sf_last_order";

/** How long the browser remembers it. Long enough to outlive a slow fulfillment
 *  cycle, short enough that a shared device forgets. */
export const RECENT_ORDER_MAX_AGE_DAYS = 90;

const MAX_AGE_SECONDS = RECENT_ORDER_MAX_AGE_DAYS * 24 * 60 * 60;

/** Order numbers are server-assigned per tenant from an owner-set prefix
 *  ("TBS-1234", "HP-000482"). Anything outside this alphabet is not one. */
const ORDER_NUMBER = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * The value if it is plausibly an order number, else "". Deliberately strict and
 * all-or-nothing rather than stripping bad characters: a half-scrubbed value
 * would be looked up, miss, and tell the customer their order doesn't exist.
 */
export function sanitizeOrderNumber(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  return ORDER_NUMBER.test(trimmed) ? trimmed : "";
}

/**
 * The `document.cookie` assignment string for an order number, or "" when the
 * number is not one (so a caller can never accidentally write junk).
 */
export function buildRecentOrderCookie(orderNumber: string): string {
  const value = sanitizeOrderNumber(orderNumber);
  if (!value) return "";
  return `${RECENT_ORDER_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax`;
}

/** The assignment string that expires the cookie. */
export function buildForgetRecentOrderCookie(): string {
  return `${RECENT_ORDER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Pull the remembered order number out of a `document.cookie` string, or "".
 *
 * Split on ";" and compare the NAME exactly — a substring scan would match
 * `my_sf_last_order` and hand the tracker a value this feature never wrote.
 */
export function readRecentOrderCookie(cookieString: string): string {
  if (typeof cookieString !== "string" || !cookieString) return "";
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== RECENT_ORDER_COOKIE) continue;
    const raw = part.slice(eq + 1).trim();
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      // A malformed escape sequence — fall through to the sanitizer with the raw
      // text, which will reject it.
    }
    return sanitizeOrderNumber(decoded);
  }
  return "";
}

// ── DOM wrappers ─────────────────────────────────────────────────────────────
// Both no-op outside the browser and swallow the throw a cookie-blocking context
// raises, matching how every other storage access in the storefront behaves: the
// feature degrades to "the customer types the number", never to a crash.

/** Remember this order number for the next visit to the Track page. */
export function rememberRecentOrder(orderNumber: string): void {
  if (typeof document === "undefined") return;
  const cookie = buildRecentOrderCookie(orderNumber);
  if (!cookie) return;
  try {
    document.cookie = cookie;
  } catch {
    /* cookies blocked — myOrders still carries the list */
  }
}

/** The remembered order number, or "" when there is none / cookies are blocked. */
export function recallRecentOrder(): string {
  if (typeof document === "undefined") return "";
  try {
    return readRecentOrderCookie(document.cookie);
  } catch {
    return "";
  }
}

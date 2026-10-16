/**
 * A returning shopper's checkout details, remembered in a cookie.
 *
 * Why it exists: guests retyped name, phone and full address on every order.
 * After a successful order the checkout saves those fields (unless the shopper
 * unticks "Remember my details"), and the next checkout on the same device
 * prefills them.
 *
 * Why it is per-store: the cookie is HOST-ONLY (no Domain attribute) and every
 * tenant is served from its own subdomain, so hpglow.pepweb.store can never read
 * what k-glow.pepweb.store saved. Do not add a Domain attribute.
 *
 * Why it is readable by page scripts: only the client reads it (to fill the
 * form), and it holds exactly what the shopper typed into that form. It is never
 * trusted by the server — placeStorefrontOrderAction validates the order's own
 * customer block as always.
 *
 * Every value is sanitized on the way IN and again on the way OUT: a cookie is
 * user-writable, so the module never trusts what it reads back.
 *
 * The pure half is DOM-free and tested directly; the thin wrappers at the bottom
 * touch `document.cookie` and no-op everywhere else. npm run test:saved-details
 */

import type { CheckoutCustomer } from "@/storefront/checkout";

export const SAVED_DETAILS_COOKIE = "sf_details";

/** Long enough that a regular reorders without retyping; short enough that an
 *  abandoned shared device forgets. */
export const SAVED_DETAILS_MAX_AGE_DAYS = 180;

const MAX_AGE_SECONDS = SAVED_DETAILS_MAX_AGE_DAYS * 24 * 60 * 60;

/** Browsers cap a cookie at ~4096 bytes (name + value). Stay clear of it. */
const MAX_COOKIE_CHARS = 3800;

/** Per-field length caps — generous for real input, bounded for the cookie. */
const FIELD_MAX: Record<keyof CheckoutCustomer, number> = {
  name: 120,
  email: 160,
  phone: 40,
  address: 300,
  barangay: 120,
  city: 120,
  province: 120,
  postal: 20,
};

const FIELD_KEYS = Object.keys(FIELD_MAX) as (keyof CheckoutCustomer)[];

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function cleanField(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(CONTROL_CHARS, "").trim().slice(0, max);
}

/**
 * Only the known checkout fields, each a clean, capped string — or null when
 * nothing usable is left (so callers can treat "nothing saved" uniformly).
 */
export function sanitizeSavedDetails(raw: unknown): CheckoutCustomer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const out = Object.fromEntries(
    FIELD_KEYS.map((key) => [key, cleanField(source[key], FIELD_MAX[key])]),
  ) as CheckoutCustomer;
  return FIELD_KEYS.some((key) => out[key]) ? out : null;
}

/**
 * The `document.cookie` assignment string for these details, or "" when there
 * is nothing to save or the encoded value would not fit in a cookie.
 */
export function buildSavedDetailsCookie(
  customer: CheckoutCustomer,
  { secure = false }: { secure?: boolean } = {},
): string {
  const clean = sanitizeSavedDetails(customer);
  if (!clean) return "";
  const value = encodeURIComponent(JSON.stringify(clean));
  if (SAVED_DETAILS_COOKIE.length + 1 + value.length > MAX_COOKIE_CHARS) return "";
  return `${SAVED_DETAILS_COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** The assignment string that expires the cookie. */
export function buildForgetSavedDetailsCookie(): string {
  return `${SAVED_DETAILS_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * The saved details from a `document.cookie` string, or null. The NAME is
 * compared exactly — a substring scan would match `my_sf_details`.
 */
export function readSavedDetailsCookie(cookieString: string): CheckoutCustomer | null {
  if (typeof cookieString !== "string" || !cookieString) return null;
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SAVED_DETAILS_COOKIE) continue;
    try {
      return sanitizeSavedDetails(JSON.parse(decodeURIComponent(part.slice(eq + 1).trim())));
    } catch {
      return null; // malformed escape or JSON — treat as nothing saved
    }
  }
  return null;
}

/**
 * Fill only the EMPTY fields of `current` from `saved`, returning a new object.
 * Anything the shopper (or their signed-in account) already filled wins.
 */
export function mergeSavedDetails(
  current: CheckoutCustomer,
  saved: CheckoutCustomer | null,
): CheckoutCustomer {
  if (!saved) return current;
  return Object.fromEntries(
    FIELD_KEYS.map((key) => [key, current[key] || saved[key]]),
  ) as CheckoutCustomer;
}

// ── DOM wrappers ─────────────────────────────────────────────────────────────
// No-op outside the browser and swallow the throw a cookie-blocking context
// raises: the feature degrades to "the shopper types their details", never to a
// crash.

function writeCookie(cookie: string): void {
  if (typeof document === "undefined" || !cookie) return;
  try {
    document.cookie = cookie;
  } catch {
    /* cookies blocked — nothing is remembered, checkout still works */
  }
}

/** Remember these details for the next checkout on this device + store. */
export function rememberSavedDetails(customer: CheckoutCustomer): void {
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  writeCookie(buildSavedDetailsCookie(customer, { secure }));
}

/** The saved details, or null when none / cookies are blocked. */
export function recallSavedDetails(): CheckoutCustomer | null {
  if (typeof document === "undefined") return null;
  try {
    return readSavedDetailsCookie(document.cookie);
  } catch {
    return null;
  }
}

/** Erase the saved details from this device. */
export function forgetSavedDetails(): void {
  writeCookie(buildForgetSavedDetailsCookie());
}

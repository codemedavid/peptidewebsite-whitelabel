/**
 * Shared constants for the RESELLER portal session (the wholesale price list at
 * #merchant / /reseller). Dependency-free — no node:crypto, no next/*, no
 * "server-only" — so the pure codec, the cookie wrapper and any test can all
 * import it.
 *
 * Deliberately a SEPARATE cookie from the visitor access gate (`tenant.sid`):
 * the two gates protect different things (a whole store vs. wholesale pricing)
 * and must never be conflated. See reseller-token.ts for the second half of that
 * separation — the signature itself is domain-scoped, so even an attacker who
 * pastes a valid `tenant.sid` value into this cookie gets rejected.
 */

export const RESELLER_COOKIE_NAME = "sf.reseller";

/**
 * How long a session lasts from the unlock that minted it. This is a FIXED
 * lifetime, not a rolling one: nothing re-stamps the cookie on a successful
 * read, so a reseller is signed out 12 hours after unlocking however active they
 * were in between. (The visitor gate DOES roll — see gate-token.ts — because it
 * re-validates through an action that can set a cookie; this session is read
 * during render, where a write is not available.)
 */
export const RESELLER_TTL_SECONDS = 12 * 60 * 60; // 12 hours

/**
 * Absolute lifetime cap measured from first unlock (`iat`). A reseller session is
 * a pricing entitlement rather than an admin login, so it is deliberately longer
 * than the visitor gate's — a reseller building a bulk order across a workday
 * shouldn't be re-challenged mid-cart — but it is still bounded.
 *
 * While TTL stays below this cap the check can never be the thing that expires a
 * session; it is kept as the backstop that bounds any future rolling re-stamp,
 * so a session can never be extended indefinitely one refresh at a time.
 */
export const RESELLER_MAX_SESSION_SECONDS = 7 * 24 * 60 * 60; // 7 days

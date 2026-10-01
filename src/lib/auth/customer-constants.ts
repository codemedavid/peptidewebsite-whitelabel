/**
 * Shared constants for the storefront CUSTOMER session (a shopper signed in to
 * their own account on one tenant's store). Dependency-free, so the pure codec,
 * the cookie wrapper and the tests can all import it.
 *
 * A separate cookie from the visitor gate (`tenant.sid`), the reseller portal
 * (`sf.reseller`) and the store admin (`sf_admin_session`): each guards a
 * different thing, and customer-token.ts domain-scopes the signature so none of
 * them can be replayed as another.
 */

export const CUSTOMER_COOKIE_NAME = "sf.customer";

/** A shopper stays signed in for 30 days — a "remember me" by default. */
export const CUSTOMER_TTL_SECONDS = 30 * 24 * 60 * 60;

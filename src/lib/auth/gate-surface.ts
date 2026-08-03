/**
 * Which surface does the VISITOR ACCESS WALL show?
 *
 * The storefront is a hash-routed SPA, so `#admin` never reaches the server —
 * `cookies()`, `headers()` and the layout all see the same URL whether the
 * visitor wants the shop or the store-admin sign-in. That is why a store owner
 * used to be forced through the visitor access code before they could reach the
 * email + password form: the layout blocks, the SPA never mounts, and the login
 * lives inside the SPA.
 *
 * The wall therefore makes this one decision on the client, where the hash IS
 * readable. It changes NOTHING about the server gate: `evaluateVisitorGate` has
 * already said "blocked", the storefront HTML is still withheld, and the only
 * thing this can swap in is a login form that is itself protected by a scrypt
 * password check. It must never be imported by the server gate — a client-side
 * hash is not an authorization signal.
 *
 * Matching is EXACT, mirroring the SPA's own router (StorefrontApp.tsx
 * `pageFromHash`), so the wall can never offer the login for a hash the SPA
 * would route somewhere else.
 */

export type GateSurface = "wall" | "admin-login";

/** The one hash that reaches the store-admin sign-in. */
export const ADMIN_HASH = "#admin";

export function resolveGateSurface(hash: string | null | undefined): GateSurface {
  return hash === ADMIN_HASH ? "admin-login" : "wall";
}

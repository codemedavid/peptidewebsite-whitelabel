// The STORE OPEN/CLOSED switch — the owner's "we're shut right now" control.
//
// A store closes for ordinary reasons: a restock, a holiday, a supplier delay,
// a backlog the owner needs to clear before taking more orders. None of those
// are reasons to unpublish the site, so closing is deliberately NOT a takeover:
//
//   open   — today's storefront. Nothing changes.
//   closed — the catalog stays browsable. Products, images and prices all still
//            render, a notice card explains the situation by name, and every
//            buy control reads "Closed" and is inert. Nothing reaches the cart,
//            and an already-filled cart cannot check out.
//
// Keeping the catalog visible is the point: a shopper who arrives during a
// restock can still see what the store sells and decide to come back. Hiding
// the store would lose them.
//
// Distinct from the two neighbouring gates, which this one sits ABOVE:
//   - trial pause (lib/trial/trial-state) is the operator's billing lever and
//     DOES take the whole storefront over. Not owner-controlled.
//   - twoWaysMode (./two-ways-mode) closes ONE order path on a two-ways store.
//     This closes the shop outright, however many ways it sells.
//
// The stored value is untrusted JSON, so normalizeStoreStatus fails SAFE: any
// shape it doesn't recognise resolves to OPEN, which is exactly the storefront
// every existing tenant has today. Only a literal `false` closes a store —
// config that has round-tripped through JSON or a form post tends to arrive as
// strings, and `"false"` is truthy in JS, so a looser check would shut shops by
// accident.
//
// Pure + JSON-safe (no React, no DB) so the storefront cart and the server
// checkout share one contract — the same pattern as ./two-ways-mode and
// ./on-hand-gate. Covered by npm run test:store-status.

/** The owner's shop switch, persisted at branding.config.storeStatus. */
export type StoreStatus = {
  /** false = closed. Absent or junk normalizes to true — never close by typo. */
  open: boolean;
  /** Optional headline override. Empty → the auto "Hello — {brand} is currently
   *  closed" line built by buildStoreClosedNotice. */
  headline: string;
  /** The owner's note to shoppers ("Back Monday 9am"). Empty → the card renders
   *  the headline alone. */
  message: string;
};

/** An open store with no notice copy — today's storefront, and the fallback for
 *  anything the normalizer doesn't recognise. */
export const STORE_STATUS_DEFAULT: StoreStatus = { open: true, headline: "", message: "" };

// Length caps. Untrusted copy is clamped (not rejected) on save, so an owner who
// pastes an essay gets a truncated notice instead of a failed save. Both render
// as React text nodes — escaping is React's job, sanitizing is this module's.
export const MAX_STORE_CLOSED_HEADLINE = 160;
export const MAX_STORE_CLOSED_MESSAGE = 600;

/** Shopper-facing reason for an add or a checkout refused because the shop is
 *  shut. One string, so the cart toast and the server's rejection agree. */
export const STORE_CLOSED_BLOCK_MESSAGE =
  "This store is currently closed and isn't taking orders right now.";

/** Trim and clamp one untrusted copy field. A non-string reads as empty rather
 *  than as the literal "undefined" a template would produce. */
function clampText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Coerce the untrusted branding.config.storeStatus into a usable status.
 * Absent, junk, or partially-written config leaves the store OPEN, so a tenant
 * that has never touched the setting keeps exactly the storefront it has today.
 *
 * Always returns a NEW object; the input is never mutated (the storefront
 * renders from the same cached config object this is handed).
 */
export function normalizeStoreStatus(value: unknown): StoreStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...STORE_STATUS_DEFAULT };
  }
  const raw = value as Record<string, unknown>;
  return {
    // Only an explicit boolean false closes the shop — see the header note.
    open: raw.open !== false,
    headline: clampText(raw.headline, MAX_STORE_CLOSED_HEADLINE),
    message: clampText(raw.message, MAX_STORE_CLOSED_MESSAGE),
  };
}

/**
 * The single predicate every surface reads — the catalog CTAs, the cart, the
 * checkout button and the server's order placement. Takes raw config, so a
 * caller can pass branding.config.storeStatus straight through without
 * normalizing first.
 */
export function isStoreClosed(value: unknown): boolean {
  return normalizeStoreStatus(value).open === false;
}

/** The two lines the closed notice card renders. */
export type StoreClosedNotice = { headline: string; message: string };

/**
 * Build the shopper-facing copy for a closed store.
 *
 * The headline greets the shopper and names the business — a shopper who lands
 * on a closed page needs to know whose shop this is and that it is shut, not
 * just that something is disabled. An owner who wants different words sets
 * `headline` and it replaces the auto line wholesale.
 *
 * A brand with no name still gets a complete sentence rather than a dangling
 * separator: nameless tenants exist mid-onboarding.
 */
export function buildStoreClosedNotice(value: unknown, brandName: string): StoreClosedNotice {
  const status = normalizeStoreStatus(value);
  const name = typeof brandName === "string" ? brandName.trim() : "";
  const auto = name
    ? `Hello — ${name} is currently closed`
    : "Hello — this store is currently closed";
  return { headline: status.headline || auto, message: status.message };
}

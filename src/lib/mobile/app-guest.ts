/**
 * App guests — a shopper who typed a store code and tapped "Continue as guest".
 *
 * A guest is a REAL StorefrontCustomer row with a real app session, so the
 * whole customer app works unchanged: the shop, checkout, My orders and the
 * order-update pushes all key on the row's id. What makes it a guest:
 *
 *   - passwordHash is the APP_GUEST sentinel — not an scrypt hash, so
 *     verifyPassword can never match it and nobody can sign in to the row;
 *   - its email is a placeholder on the reserved `.invalid` TLD, unique per
 *     row (the (tenantId, email) index needs one) and never shown to anyone.
 *
 * Creating an account later UPGRADES the same row in place (register.ts), so
 * every order the guest placed stays theirs. Signing in to an existing account
 * instead moves the guest's orders onto it (guest-session.ts).
 *
 * Pure: no server imports, so the rules are unit-tested directly.
 */

/** Not an scrypt hash, and not the group-buy email guest's "guest" either. */
export const APP_GUEST_PASSWORD_HASH = "app-guest";

/** RFC 2606 reserved TLD: no mail can ever be delivered here. */
export const APP_GUEST_EMAIL_DOMAIN = "app-guest.invalid";

/** What the store team and the guest themselves see as the name. */
export const APP_GUEST_NAME = "Guest";

const TOKEN_RE = /^[a-z0-9]{8,64}$/;

/** The placeholder email for a new guest row; `token` is random hex. */
export function appGuestEmail(token: string): string {
  const clean = token.toLowerCase();
  if (!TOKEN_RE.test(clean)) throw new Error("appGuestEmail: token must be 8–64 [a-z0-9]");
  return `guest-${clean}@${APP_GUEST_EMAIL_DOMAIN}`;
}

export function isAppGuestHash(passwordHash: string | null | undefined): boolean {
  return passwordHash === APP_GUEST_PASSWORD_HASH;
}

export function isAppGuestEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${APP_GUEST_EMAIL_DOMAIN}`);
}

/** The email a person may see: a guest's placeholder is blanked. */
export function visibleCustomerEmail(email: string): string {
  return isAppGuestEmail(email) ? "" : email;
}

export type GuestShoppingInputs = {
  /** The store runs the customer app (App shopping or App community). */
  shopOpen: boolean;
  /** An access code walls the store. */
  isPrivate: boolean;
  /** The members-only sign-in wall is on (and enforceable). */
  membersOnly: boolean;
};

/**
 * May a shopper continue WITHOUT an account? Never on a store that walls
 * visitors (an access code, or members-only) — a guest session would walk
 * straight past the wall the owner put up.
 */
export function guestShoppingAllowed(i: GuestShoppingInputs): boolean {
  return i.shopOpen && !i.isPrivate && !i.membersOnly;
}

export const GUEST_COMMUNITY_LOCKED = "Create a free account to join the community.";
export const GUEST_NEEDS_ACCOUNT = "This store now asks shoppers to have an account. Create one to keep shopping.";
export const GUEST_GROUP_BUY_LOCKED = "Create a free account to join this group buy.";

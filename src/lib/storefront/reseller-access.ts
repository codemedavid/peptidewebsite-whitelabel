import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import type { ResellerCapabilities } from "./reseller-caps";

/**
 * The reseller portal's PASSWORD and its VISIBILITY rule. Pure — no cookies, no
 * database, no "server-only" — so both are unit-testable
 * (scripts/test-reseller-access.ts) and there is exactly one implementation of
 * each for the server action, the storefront render and the order re-price to
 * share.
 *
 * ── Where the password lives ────────────────────────────────────────────────
 * In `branding.config`, like the rest of the storefront's per-tenant settings:
 *
 *   resellerAccessCodeHash : "scrypt$<salt>$<hash>"  — the current shape
 *   resellerCodeVersion    : number                  — bumped on every change
 *   resellerAccessCode     : string                  — LEGACY plaintext
 *
 * The legacy plaintext field is what shipped originally, and live tenants still
 * carry it. It is still ACCEPTED at verify time so nobody is locked out of their
 * own store by this change, but it is never written again: the first admin save
 * replaces it with a hash and deletes it (see `nextCredential`). A tenant that
 * has both is authenticated against the hash only — otherwise clearing the
 * password would leave the old plaintext as a working back door.
 *
 * ── Why the version number ──────────────────────────────────────────────────
 * Sessions are stateless signed cookies (lib/auth/reseller-token.ts), so there
 * is no server-side session list to purge. Stamping the version the session was
 * minted at, and rejecting any cookie whose version no longer matches, is what
 * makes "change the password" actually revoke the resellers who had the old one.
 */

/** The credential fields as they sit in `branding.config`. */
export type ResellerCredential = {
  hash?: string;
  /** Legacy plaintext, accepted on read but never written. */
  legacy?: string;
  version: number;
};

/** Read the credential out of a raw `branding.config` blob. Never throws. */
export function readResellerCredential(config: unknown): ResellerCredential {
  const c = (config ?? {}) as Record<string, unknown>;
  const hash = typeof c.resellerAccessCodeHash === "string" ? c.resellerAccessCodeHash.trim() : "";
  const legacy = typeof c.resellerAccessCode === "string" ? c.resellerAccessCode.trim() : "";
  const rawVersion = c.resellerCodeVersion;
  const version =
    typeof rawVersion === "number" && Number.isFinite(rawVersion) && rawVersion >= 1
      ? Math.floor(rawVersion)
      : 1;
  return { ...(hash ? { hash } : {}), ...(legacy ? { legacy } : {}), version };
}

/** Has the owner set a reseller password at all (either shape)? */
export function hasResellerCode(cred: ResellerCredential): boolean {
  return !!(cred.hash || cred.legacy);
}

/**
 * Check a submitted password against the stored credential.
 *
 * The hash wins whenever present — see the back-door note above. The legacy
 * comparison stays case-INSENSITIVE because that is how the original action
 * behaved and live resellers have been given codes on that basis; the hashed
 * path normalizes case the same way at write time (`normalizeCode`) so an
 * upgraded tenant keeps the exact same set of working codes.
 */
export function verifyResellerCode(submitted: string, cred: ResellerCredential): boolean {
  const code = normalizeCode(submitted);
  if (!code) return false;
  if (cred.hash) return verifyPassword(code, cred.hash);
  if (cred.legacy) return code === normalizeCode(cred.legacy);
  return false;
}

/**
 * Codes are matched case-insensitively (see above), so they are lowercased
 * before hashing as well as before comparing — the hash must be taken over the
 * same normalized form the verify will present, or no code would ever match.
 */
export function normalizeCode(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * The config patch for setting or clearing the password. Returns the fields to
 * merge into `branding.config`, with the legacy plaintext explicitly set to
 * undefined so the caller's spread DELETES it rather than leaving a stale copy
 * next to the new hash.
 *
 * An empty `plain` CLEARS the password (the admin's "Remove password" action):
 * the hash is dropped, which locks the portal again, and the version still bumps
 * so any reseller currently holding a session loses it immediately.
 */
export function nextCredential(
  plain: string,
  cred: ResellerCredential,
): { resellerAccessCodeHash?: string; resellerAccessCode: undefined; resellerCodeVersion: number } {
  const code = normalizeCode(plain);
  return {
    ...(code ? { resellerAccessCodeHash: hashPassword(code) } : {}),
    // Always cleared: the legacy plaintext must never survive a save, or it
    // would keep working as a second password after the owner changed theirs.
    resellerAccessCode: undefined,
    resellerCodeVersion: cred.version + 1,
  };
}

/**
 * Is the gated `#merchant` page a route this storefront has at all?
 *
 * Three conditions, all required, and they fail in different places, which is
 * why they are collected here instead of being spelled out inline in the
 * storefront render:
 *
 *   caps.enabled     — the operator granted the Reseller PARENT.
 *   caps.resellerPage— the operator granted the reseller PAGE child.
 *   hasCode          — the STORE OWNER set a reseller password. Without one the
 *                      portal would be a public wholesale price list, so the
 *                      route stays absent rather than opening unguarded.
 *
 * The first two are not one check: `resellerCapsFrom` already ANDs the child
 * with the parent, but a tenant can hold the parent for wholesale pricing alone
 * and never have the page. Nova Lab held BOTH children with the parent OFF and
 * no password, so all three answers were no at once — the store simply had no
 * reseller page, and nothing on either admin screen said which switch was
 * missing. Keeping the rule in one named function is what lets the test suite
 * pin that shape (scripts/test-reseller-feature-tree.ts).
 */
export function merchantPageVisible(caps: ResellerCapabilities, hasCode: boolean): boolean {
  return caps.enabled && caps.resellerPage && hasCode;
}

/**
 * ── The visibility rule ─────────────────────────────────────────────────────
 * Whether THIS request may see wholesale pricing at all, and therefore whether
 * the catalog it renders from is allowed to carry `wholesale` / `reseller` legs.
 *
 * The two children of the Reseller feature expose wholesale prices in
 * deliberately different ways, and conflating them is what leaked prices before:
 *
 *   wholesalePricing — MOQ pricing on the REGULAR storefront. These prices are
 *     public BY DESIGN: any shopper who adds enough units pays them, so the
 *     cards, cart and product pages must show them to everyone.
 *
 *   resellerPage — the gated wholesale price list. These prices are the whole
 *     point of the password, so they must NOT ship to a browser that has not
 *     presented it. Previously the catalog was serialized into the page for
 *     every visitor and the gate was a client-side `sessionStorage` flag, which
 *     meant the wholesale price list was readable in View Source by anyone.
 *
 * So: public when the tenant sells wholesale on the regular store, otherwise
 * only to an unlocked reseller. `unlocked` is the server-verified cookie
 * (lib/auth/reseller-session.ts), never a client claim.
 */
export function wholesaleVisibleTo(caps: ResellerCapabilities, unlocked: boolean): boolean {
  if (!caps.enabled) return false;
  if (caps.wholesalePricing) return true;
  return caps.resellerPage && unlocked;
}

/** The whole wholesale decision for one request. */
export type WholesaleAccess = {
  /** May this request see AND be charged wholesale prices? Feeds both arguments
   *  of stripResellerPricing and the enable flag of orderWholesaleScope. */
  visible: boolean;
  /** Does the gated page's minimum-order rule govern this order? */
  moqEnforced: boolean;
};

/**
 * The single wholesale decision, shared by the storefront render (page.tsx),
 * the public price refresh (products.ts) and order placement (orders.ts).
 *
 * It exists because those three used to decide separately and disagreed. The
 * render honoured the verified reseller session; placement read only the bare
 * `wholesalePricing` cap. On a page-only tenant that meant an unlocked reseller
 * browsed at ₱7/unit and was charged ₱10/unit — the browse-price = charge-price
 * invariant broken by two call sites answering one question differently. One
 * function, three callers, no way to drift.
 *
 * `visible` drives BOTH arguments of stripResellerPricing. They are not two
 * independent gates: `wholesaleVisibleTo` already returns false unless the
 * parent switch is on, so ANDing the parent again is a no-op, and a request
 * that may not see the modern `wholesale` leg must not see the legacy
 * `reseller` leg either — otherwise the legacy tier prices an order the page
 * quoted at retail, which is the same bug pointing the other way.
 *
 * `moqEnforced` is deliberately NARROWER than `visible`. The minimum-order rule
 * belongs to the gated page, which advertises "1,000 units @ ₱7" — ordering one
 * unit through it is a mistake worth naming. Where wholesale pricing is PUBLIC
 * the MOQ is just a tier any shopper can reach, so a small order is an ordinary
 * retail purchase. Enforcing it on everyone holding a reseller cookie made every
 * wholesale-configured product unbuyable in small quantities, for 12 hours, for
 * anyone who had ever opened the portal.
 */
export function resolveWholesaleAccess(
  caps: ResellerCapabilities,
  unlocked: boolean,
): WholesaleAccess {
  const visible = wholesaleVisibleTo(caps, unlocked);
  return {
    visible,
    moqEnforced: visible && !caps.wholesalePricing && caps.resellerPage && unlocked,
  };
}

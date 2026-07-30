import { verifyPassword } from "./password-hash";
import { normalizeLoginEmail } from "./login-email";

/**
 * Pure decision core for the store-admin login (email + password). No
 * "server-only", no DB, no cookies — the caller (actions/storefront-staff.ts)
 * loads the owner credential + the tenant's staff rows and passes them in, then
 * acts on the result (mint an owner/staff session cookie, or show an error).
 *
 * EVERY sign-in to `<slug>.<root>/#admin` requires BOTH an email and a password.
 * There is no password-only path, no reserved "owner" username, and no built-in
 * default password: a tenant whose credential was never set cannot be signed
 * into at all. That is the `unconfigured` result — it fails CLOSED.
 *
 * Rules:
 *   - The OWNER is matched first, by email, so a staff row can never shadow the
 *     owner even if someone creates one carrying the owner's address.
 *   - Otherwise we look up a staff member by email and verify their scrypt hash.
 *   - A suspended staff member is reported distinctly so the caller can say
 *     "account suspended" rather than a generic "wrong password". This is
 *     decided BEFORE the password check — a suspended account is closed whether
 *     or not the password was right.
 *   - Emails are compared normalized (trimmed + lowercased) so casing never
 *     locks out a real owner. Passwords are trimmed, matching how staff hashes
 *     are produced at creation (lib/storefront/staff-input.ts) — keep in sync.
 *
 * The caller must NOT surface `unconfigured` to the browser as a distinct
 * message: it would tell an attacker which stores have no credential set. Map
 * it to the same generic error as `invalid`, and log it server-side instead.
 */

export type StoreAdminLoginResult =
  | { kind: "owner" }
  | { kind: "staff"; id: string }
  | { kind: "invalid" }
  | { kind: "suspended" }
  | { kind: "unconfigured" };

export type OwnerCredential = {
  email: string;
  /** scrypt$<salt-hex>$<hash-hex> — never a plaintext password. */
  passwordHash: string;
};

export type StaffCredential = {
  id: string;
  email: string;
  passwordHash: string;
  status: string;
};

const ACTIVE_STATUS = "active";

// Re-exported so existing importers (and the login tests) keep one entry point.
// The definition lives in the dependency-free leaf module because the operator's
// credential form is a Client Component and must not pull node:crypto in.
export { normalizeLoginEmail };

/**
 * An owner credential is only usable when BOTH halves are present. A row with a
 * blank email or a blank hash is treated as absent rather than as a credential
 * that might accidentally match empty input.
 */
function usableOwner(owner: OwnerCredential | null): OwnerCredential | null {
  if (!owner) return null;
  if (!normalizeLoginEmail(owner.email)) return null;
  if (typeof owner.passwordHash !== "string" || !owner.passwordHash.trim()) return null;
  return owner;
}

export function resolveStoreAdminLogin(
  email: string,
  password: string,
  owner: OwnerCredential | null,
  staff: ReadonlyArray<StaffCredential>,
): StoreAdminLoginResult {
  const e = normalizeLoginEmail(email);
  const pw = (password ?? "").trim();

  // Both fields are mandatory — neither alone opens anything.
  if (!e || !pw) return { kind: "invalid" };

  const ownerCred = usableOwner(owner);

  // Nothing to check against: the super admin has not set this tenant's admin
  // email + password yet. Fail closed rather than falling back to a default.
  if (!ownerCred && staff.length === 0) return { kind: "unconfigured" };

  // Owner is matched first — a staff row carrying the same address can't impersonate it.
  if (ownerCred && e === normalizeLoginEmail(ownerCred.email)) {
    return verifyPassword(pw, ownerCred.passwordHash) ? { kind: "owner" } : { kind: "invalid" };
  }

  const match = staff.find((s) => normalizeLoginEmail(s.email) === e);
  if (!match) return { kind: "invalid" };
  if (match.status !== ACTIVE_STATUS) return { kind: "suspended" };
  return verifyPassword(pw, match.passwordHash)
    ? { kind: "staff", id: match.id }
    : { kind: "invalid" };
}

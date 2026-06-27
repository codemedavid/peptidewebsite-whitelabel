import { verifyPassword } from "./password-hash";

/**
 * Pure decision core for the UNIFIED store-admin login (username + password). No
 * "server-only", no DB, no cookies — the caller (actions/storefront-staff.ts)
 * loads the owner credential + the tenant's staff rows and passes them in, then
 * acts on the result (mint an owner/staff session cookie, or show an error).
 *
 * Rules:
 *   - The OWNER has a reserved username (default "owner", configurable). It is
 *     matched first and case-insensitively, so a staff row can never shadow it.
 *   - Otherwise we look up an active staff member by username (case-insensitive)
 *     and verify their scrypt password hash.
 *   - A suspended staff member is reported distinctly so the UI can say "account
 *     suspended" rather than a generic "wrong password".
 *   - Usernames and passwords are trimmed (mirrors the existing owner login,
 *     which trims). Staff passwords are therefore hashed from the trimmed value
 *     at creation too — keep the two in sync.
 */

export type StoreAdminLoginResult =
  | { kind: "owner" }
  | { kind: "staff"; id: string }
  | { kind: "invalid" }
  | { kind: "suspended" };

export type OwnerCredential = { username: string; password: string };
export type StaffCredential = {
  id: string;
  username: string;
  passwordHash: string;
  status: string;
};

const ACTIVE_STATUS = "active";

function norm(value: string): string {
  return (value ?? "").trim().toLowerCase();
}

export function resolveStoreAdminLogin(
  username: string,
  password: string,
  owner: OwnerCredential,
  staff: ReadonlyArray<StaffCredential>,
): StoreAdminLoginResult {
  const u = norm(username);
  if (!u) return { kind: "invalid" };

  const pw = (password ?? "").trim();

  // Owner is reserved and checked first — a staff row can't impersonate it.
  if (u === norm(owner.username)) {
    return pw === (owner.password ?? "").trim() ? { kind: "owner" } : { kind: "invalid" };
  }

  const match = staff.find((s) => norm(s.username) === u);
  if (!match) return { kind: "invalid" };
  if (match.status !== ACTIVE_STATUS) return { kind: "suspended" };
  return verifyPassword(pw, match.passwordHash) ? { kind: "staff", id: match.id } : { kind: "invalid" };
}

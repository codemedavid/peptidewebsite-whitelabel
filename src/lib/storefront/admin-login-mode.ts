/**
 * Pure decision core for the storefront `#admin` login form. No "server-only", no
 * DB, no cookies — the caller (the tenant storefront page) loads the Staff
 * Accounts entitlement + a staff-row count and passes them in; the storefront
 * login (AdminLogin.tsx) uses the result to decide which form to render.
 *
 * The rule fixes the "phantom username" confusion on a brand-new store: until the
 * owner has BOTH enabled Staff Accounts AND created at least one staff member,
 * there are no per-user usernames, so the admin login asks for the owner password
 * only — never a username that doesn't exist yet. Once staff exist, the unified
 * username + password form returns so each staffer signs in as themselves.
 *
 * Security note: this only selects a UI form. Both login paths still verify
 * credentials server-side (owner password / staff scrypt hash) before minting the
 * signed session cookie — the store is never left unprotected.
 */

export type AdminLoginMode = "unified" | "password-only";

export function resolveAdminLoginMode(
  staffFeatureOn: boolean,
  staffCount: number,
): AdminLoginMode {
  // A non-finite or negative count means "we couldn't determine any staff" —
  // fall back to the safer, simpler password-only form rather than crashing.
  const hasStaff = Number.isFinite(staffCount) && staffCount >= 1;
  return staffFeatureOn && hasStaff ? "unified" : "password-only";
}

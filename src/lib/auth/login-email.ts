/**
 * Email normalization for the store-admin sign-in, kept in its own leaf module
 * with NO dependencies.
 *
 * It lives apart from store-admin-login.ts on purpose: that module imports
 * password-hash.ts, which imports node:crypto. The operator's tenant-settings
 * form is a Client Component and needs this helper (via store-admin-credential.ts)
 * to validate what it is about to save — importing it from store-admin-login
 * would drag scrypt and node:crypto into the browser bundle.
 *
 * Both the login check and the credential form normalize the same way, so a
 * capitalized or space-padded address can never lock a real owner out.
 */

/** Trim + lowercase an email for comparison. Non-strings collapse to "". */
export function normalizeLoginEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

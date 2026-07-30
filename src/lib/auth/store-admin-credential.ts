import { isValidEmail } from "@/lib/analytics/events";
import { normalizeLoginEmail } from "./login-email";

/**
 * Pure validator for SETTING a store's `#admin` credential — the counterpart to
 * store-admin-login.ts, which decides whether a submitted credential opens the
 * door. The super admin owns this credential and edits it in the tenant
 * settings console (components/admin/TenantSettingsView.tsx); the server action
 * behind that form (actions/branding.ts → saveAdminPasswordAction) is the
 * authority and runs this same check, so the UI and the server can never
 * disagree about what counts as a valid credential.
 *
 * The rule that matters: a tenant must never be left HALF configured. Since
 * login now requires an email AND a password and fails closed, saving an email
 * without ever setting a password would lock the store owner out of their own
 * admin with no way back in. So a blank password is only allowed when a
 * password is already stored — in which case it means "keep the current one",
 * which is what lets the operator correct a typo'd email on its own.
 *
 * Passwords are returned trimmed, matching how login trims the submitted
 * password before verifying it (store-admin-login.ts) — keep the two in sync.
 */

/** Shortest password the operator may set. Login itself imposes no minimum. */
export const STORE_ADMIN_PASSWORD_MIN = 6;

export type StoreAdminCredentialInput = {
  email: string;
  /** Blank means "leave the stored password alone" — never "clear it". */
  password: string;
  /** Whether this tenant already has a password hash on file. */
  hasExistingPassword: boolean;
};

export type StoreAdminCredentialCheck =
  | {
      ok: true;
      /** Normalized (trimmed + lowercased), ready to store. */
      email: string;
      /** Plaintext to hash, or null to keep the stored hash unchanged. */
      password: string | null;
    }
  | { ok: false; error: string };

export function validateStoreAdminCredentialInput(
  input: StoreAdminCredentialInput,
): StoreAdminCredentialCheck {
  const email = normalizeLoginEmail(input.email);
  const password = (input.password ?? "").trim();

  if (!email) {
    return { ok: false, error: "Enter the store owner's sign-in email." };
  }
  if (!isValidEmail(email)) {
    return { ok: false, error: "That doesn't look like a valid email address." };
  }

  if (!password) {
    // Fail closed: no stored password and none typed means nobody could sign in.
    if (!input.hasExistingPassword) {
      return {
        ok: false,
        error: "Set a password too — without one, nobody can sign in to this store's admin.",
      };
    }
    return { ok: true, email, password: null };
  }

  if (password.length < STORE_ADMIN_PASSWORD_MIN) {
    return {
      ok: false,
      error: `Use at least ${STORE_ADMIN_PASSWORD_MIN} characters, or leave blank to keep the current password.`,
    };
  }

  return { ok: true, email, password };
}

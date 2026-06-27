import { z } from "zod";
import { sanitizePermissions } from "../../storefront/admin/staff-permissions";

/**
 * Pure validation + normalization for the Staff Accounts forms. No "server-only",
 * no DB — the server action (actions/storefront-staff.ts) calls these to coerce
 * untrusted client input before touching the database, and the test gate exercises
 * them directly. Reserved-username and uniqueness checks that need the owner
 * credential / DB live in the action; everything field-shaped lives here.
 *
 * Emails + usernames are lowercased and trimmed so logins are case-insensitive and
 * the `@@unique([tenantId, username])` constraint matches what the login resolves.
 */

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const PASSWORD_MIN = 6;

export type StaffStatus = "active" | "suspended";

export type StaffBaseValue = {
  fullName: string;
  email: string;
  username: string;
  status: StaffStatus;
  permissions: string[];
};
export type StaffCreateValue = StaffBaseValue & { password: string };
export type StaffUpdateValue = StaffBaseValue & { password?: string };

export type StaffParse<T> = { ok: true; value: T } | { ok: false; error: string };

const baseSchema = z.object({
  fullName: z.string().min(1, "Full name is required.").max(120, "Full name is too long."),
  email: z.string().email("Enter a valid email address.").max(200, "Email is too long."),
  username: z
    .string()
    .regex(
      USERNAME_RE,
      "Username must be 3–32 characters: lowercase letters, numbers, dot, dash or underscore.",
    ),
  status: z.enum(["active", "suspended"]),
  permissions: z.array(z.string()),
});

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Normalize + validate the fields shared by create and update. */
function parseBase(input: unknown): StaffParse<StaffBaseValue> {
  const o = (input ?? {}) as Record<string, unknown>;
  const candidate = {
    fullName: String(o.fullName ?? "").trim(),
    email: String(o.email ?? "").trim().toLowerCase(),
    username: String(o.username ?? "").trim().toLowerCase(),
    status: o.status === undefined ? "active" : o.status,
    permissions: sanitizePermissions(o.permissions),
  };
  const parsed = baseSchema.safeParse(candidate);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  return { ok: true, value: parsed.data };
}

function validatePassword(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (password !== confirm) return "Passwords do not match.";
  return null;
}

/** Validate a new-staff payload — password is required and must be confirmed. */
export function parseStaffCreate(input: unknown): StaffParse<StaffCreateValue> {
  const base = parseBase(input);
  if (!base.ok) return base;
  const o = (input ?? {}) as Record<string, unknown>;
  const password = String(o.password ?? "").trim();
  const confirm = String(o.confirmPassword ?? "").trim();
  const pwError = validatePassword(password, confirm);
  if (pwError) return fail(pwError);
  return { ok: true, value: { ...base.value, password } };
}

/** Validate an edit-staff payload — a blank password means "keep the existing one". */
export function parseStaffUpdate(input: unknown): StaffParse<StaffUpdateValue> {
  const base = parseBase(input);
  if (!base.ok) return base;
  const o = (input ?? {}) as Record<string, unknown>;
  const password = String(o.password ?? "").trim();
  if (!password) return { ok: true, value: base.value };
  const confirm = String(o.confirmPassword ?? "").trim();
  const pwError = validatePassword(password, confirm);
  if (pwError) return fail(pwError);
  return { ok: true, value: { ...base.value, password } };
}

/**
 * Is this username reserved for the owner? The literal "owner" is always reserved,
 * as is the store's configured owner username — a staff row must never be able to
 * shadow the owner login (case-insensitive).
 */
export function isReservedUsername(username: string, ownerUsername: string): boolean {
  const u = (username ?? "").trim().toLowerCase();
  if (!u) return false;
  if (u === "owner") return true;
  return u === (ownerUsername ?? "").trim().toLowerCase();
}

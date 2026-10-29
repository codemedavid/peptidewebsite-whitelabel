/**
 * Pure core for storefront customer accounts: input parsing and the one rule
 * that decides whether a session cookie still belongs to a live account.
 * Client-safe (no node:crypto, no DB) — the server actions in
 * actions/customer-accounts.ts and the account page both import it.
 * Gate: npm run test:customer-accounts.
 */

export const CUSTOMER_PASSWORD_MIN = 8;
/** scrypt is deliberately slow; an unbounded input is a cheap CPU DoS. */
export const CUSTOMER_PASSWORD_MAX = 200;
const NAME_MAX = 80;
const PHONE_MAX = 40;
const EMAIL_MAX = 254;

// Pragmatic, not RFC 5322: one @, no spaces, a dot in the domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

export function normalizeCustomerEmail(v: unknown): string {
  return str(v).trim().toLowerCase().slice(0, EMAIL_MAX);
}

function checkNewPassword(pw: string): string | null {
  if (pw.length < CUSTOMER_PASSWORD_MIN) return `Password must be at least ${CUSTOMER_PASSWORD_MIN} characters.`;
  if (pw.length > CUSTOMER_PASSWORD_MAX) return "Password is too long.";
  return null;
}

export type CustomerSignUp = { name: string; email: string; phone: string; password: string };

export function parseCustomerSignUp(input: unknown): Parsed<CustomerSignUp> {
  const o = obj(input);
  const name = str(o.name).trim().slice(0, NAME_MAX);
  const email = normalizeCustomerEmail(o.email);
  const phone = str(o.phone).trim().slice(0, PHONE_MAX);
  // Passwords are kept byte-for-byte; trimming would silently change them.
  const password = str(o.password);
  if (!name) return { ok: false, error: "Please enter your name." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Please enter a valid email address." };
  const pwError = checkNewPassword(password);
  if (pwError) return { ok: false, error: pwError };
  return { ok: true, value: { name, email, phone, password } };
}

export type CustomerSignIn = { email: string; password: string };

/** No length policy here: sign-in never hints at what a password should be. */
export function parseCustomerSignIn(input: unknown): Parsed<CustomerSignIn> {
  const o = obj(input);
  const email = normalizeCustomerEmail(o.email);
  const password = str(o.password);
  if (!email || !password || password.length > CUSTOMER_PASSWORD_MAX) {
    return { ok: false, error: "Enter your email and password." };
  }
  return { ok: true, value: { email, password } };
}

export type CustomerProfile = { name: string; phone: string };

export function parseCustomerProfile(input: unknown): Parsed<CustomerProfile> {
  const o = obj(input);
  const name = str(o.name).trim().slice(0, NAME_MAX);
  const phone = str(o.phone).trim().slice(0, PHONE_MAX);
  if (!name) return { ok: false, error: "Please enter your name." };
  return { ok: true, value: { name, phone } };
}

/** The store owner editing a customer from the admin Customers list. Unlike
 *  the shopper's own profile form, the email is editable here. */
export function parseAdminCustomerEdit(input: unknown): Parsed<CustomerProfile & { email: string }> {
  const o = obj(input);
  const name = str(o.name).trim().slice(0, NAME_MAX);
  const email = normalizeCustomerEmail(o.email);
  const phone = str(o.phone).trim().slice(0, PHONE_MAX);
  if (!name) return { ok: false, error: "Please enter a name." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Please enter a valid email address." };
  return { ok: true, value: { name, email, phone } };
}

export function parseCustomerPasswordChange(input: unknown): Parsed<{ current: string; next: string }> {
  const o = obj(input);
  const current = str(o.current);
  const next = str(o.next);
  if (!current || current.length > CUSTOMER_PASSWORD_MAX) return { ok: false, error: "Enter your current password." };
  const pwError = checkNewPassword(next);
  if (pwError) return { ok: false, error: pwError };
  return { ok: true, value: { current, next } };
}

/** Owner-issued temp passwords: lowercase + digits with the look-alikes
 *  (0/o, 1/l/i) dropped, so the owner can read one out in a chat. */
export const TEMP_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const TEMP_PASSWORD_LENGTH = 10;

/** A fresh temp password (Web Crypto, so it runs anywhere this module does).
 *  Rejection sampling keeps every character equally likely. */
export function generateTempPassword(): string {
  const n = TEMP_PASSWORD_ALPHABET.length;
  const limit = 256 - (256 % n);
  const out: string[] = [];
  while (out.length < TEMP_PASSWORD_LENGTH) {
    for (const byte of globalThis.crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && out.length < TEMP_PASSWORD_LENGTH) out.push(TEMP_PASSWORD_ALPHABET[byte % n]);
    }
  }
  return out.join("");
}

export type CustomerSessionClaim ={ tenantId: string; customerId: string; sessionVersion: number };
export type CustomerSessionRow = { id: string; tenantId: string; status: string; sessionVersion: number };

/**
 * THE session rule: a verified token counts only for the store it was minted
 * on, for a row that still exists, is active, and has not rotated its session
 * version since. Returns the customer id, or null.
 */
export function resolveCustomerSession(
  claim: CustomerSessionClaim | null,
  row: CustomerSessionRow | null,
  requestTenantId: string,
): string | null {
  if (!claim || !row) return null;
  if (claim.tenantId !== requestTenantId || row.tenantId !== requestTenantId) return null;
  if (claim.customerId !== row.id) return null;
  if (row.status !== "active") return null;
  if (claim.sessionVersion !== row.sessionVersion) return null;
  return row.id;
}

import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withTenant } from "@/lib/db/tenant-client";
import { normalizeLoginEmail } from "@/lib/auth/login-email";
import { hashPassword } from "@/lib/auth/password-hash";
import { claimGuestCustomer, GUEST_PASSWORD_HASH } from "@/lib/storefront/guest-customer";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { rateLimit } from "@/lib/security/rate-limit";
import { normalizeHost } from "@/lib/tenant/cache-tags";
import { parseCustomerSignUp } from "@/lib/storefront/customer-account";
import type { ApiErrorCode, LoginResponse } from "./contract";
import { storeAvailability } from "./auth";
import { parseSignUpDetails } from "./sign-up-details";
import { openSession } from "./login";
import { normalizeStoreIdentifier } from "./store-identifier";
import { findStoreByHost, MOBILE_ROOT } from "./store-lookup";

/**
 * POST /auth/register — a shopper creates their customer account in the app.
 *
 * The same StorefrontCustomer row the website's sign-up makes (same parser,
 * same per-store unique email), so the account also works on the store's
 * website. Unlike sign-in, sign-up always names its store: accounts are per
 * store, and a new shopper has no login yet for the server to find it from.
 *
 * Gate: the store must hold MOBILE_COMMUNITY — the feature that lets customers
 * into the app at all — so an account made here can always sign in here.
 * An email already used on the store by a customer, the owner or a staff
 * member gets one answer, so sign-up never singles out a team login.
 * Beyond the website's form, the app asks for first + last name, a mobile
 * number and age (required) and gender (optional) — see sign-up-details.ts.
 * Success signs the shopper straight in (the login response shape); the app
 * then uploads the optional profile photo with the new session.
 */

const ONE_HOUR = 60 * 60 * 1000;
const MAX_SIGNUPS_PER_HOUR = 5;
const EMAIL_TAKEN = "An account with this email already exists on this store. Sign in instead.";

type Failure = { ok: false; code: ApiErrorCode; message: string };
type Success = { ok: true; data: LoginResponse };

const failure = (code: ApiErrorCode, message: string): Failure => ({ ok: false, code, message });

/**
 * Is this email already a login on the store — a customer's (any casing: older
 * rows may predate normalization), the owner's or a staff member's?
 */
export async function isEmailTaken(tenantId: string, email: string): Promise<boolean> {
  const e = { equals: normalizeLoginEmail(email), mode: "insensitive" as const };
  const [owner, staff, customer] = await Promise.all([
    prisma.tenant.count({ where: { id: tenantId, storeAdminEmail: e } }),
    prisma.storefrontStaff.count({ where: { tenantId, email: e } }).catch(() => 0),
    // A guest row (email-only group-buy join) is claimed by sign-up, not "taken".
    prisma.storefrontCustomer.count({ where: { tenantId, email: e, passwordHash: { not: GUEST_PASSWORD_HASH } } }),
  ]);
  return owner + staff + customer > 0;
}

export async function mobileRegister(
  body: Record<string, unknown>,
  ip: string,
  deviceLabel: string | null,
): Promise<Success | Failure> {
  const host = normalizeStoreIdentifier(body.store, MOBILE_ROOT);
  if (!host) return failure("invalid_input", "Enter the store you shop at.");

  const details = parseSignUpDetails(body);
  if (!details.ok) return failure("invalid_input", details.error);
  const { name, phone, age, gender } = details.value;
  // The website parser owns email + password rules; name/phone come from above.
  const parsed = parseCustomerSignUp({ ...body, name, phone });
  if (!parsed.ok) return failure("invalid_input", parsed.error);
  const { email, password } = parsed.value;

  const limit = rateLimit(`mobile:signup:${ip}`, MAX_SIGNUPS_PER_HOUR, ONE_HOUR);
  if (!limit.ok) {
    return failure("rate_limited", `Too many sign-ups from this device. Try again in ${Math.ceil(limit.retryAfter / 60)} min.`);
  }

  const store = await findStoreByHost(normalizeHost(host));
  if (!store || store.status === "pending_setup") {
    return failure("not_found", "We couldn't find a store at that address. Check it and try again.");
  }
  const unavailable = await storeAvailability(store);
  if (unavailable) return { ok: false, ...unavailable };
  if (!(await hasFeature(store.id, FEATURES.MOBILE_COMMUNITY))) {
    return failure("forbidden", "This store doesn't take sign-ups in the app yet. Create your account on its website.");
  }
  if (await isEmailTaken(store.id, email)) return failure("conflict", EMAIL_TAKEN);

  const passwordHash = hashPassword(password);
  // An email that joined a group buy without an account: sign-up claims that row.
  const claimed = await claimGuestCustomer(store.id, email, { name, phone, age, gender, passwordHash });
  let customerId: string;
  if (claimed) {
    customerId = claimed.id;
  } else {
    try {
      const row = await withTenant(store.id, (db) =>
        db.storefrontCustomer.create({
          data: { tenantId: store.id, name, email, phone, age, gender, passwordHash, lastLoginAt: new Date() },
          select: { id: true },
        }),
      );
      customerId = row.id;
    } catch (e) {
      // Two sign-ups racing past the check above: the unique index decides.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return failure("conflict", EMAIL_TAKEN);
      }
      throw e;
    }
  }

  const session = await openSession(store, { kind: "customer", id: customerId }, ip, deviceLabel);
  if (!session.ok) return session;
  // openSession only ever returns tokens + me for a single named store.
  return { ok: true, data: session.data as LoginResponse };
}

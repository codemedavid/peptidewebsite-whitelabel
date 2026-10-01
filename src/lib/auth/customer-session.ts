import "server-only";
import { cookies } from "next/headers";
import { withTenant } from "@/lib/db/tenant-client";
import { encodeCustomerToken, verifyCustomerToken } from "./customer-token";
import { CUSTOMER_COOKIE_NAME, CUSTOMER_TTL_SECONDS } from "./customer-constants";
import { resolveCustomerSession } from "@/lib/storefront/customer-account";
import { currentAppShopperScope } from "./app-shopper-scope";

/**
 * Cookie wrapper for the storefront CUSTOMER session. The cookie only names the
 * customer; getSignedInCustomer re-reads the row on every call, so disabling an
 * account or changing its password (both bump sessionVersion) signs every
 * device out on its next request — no session table needed.
 *
 * Writes happen only in Server Actions (sign up / sign in / password change);
 * getSignedInCustomer is read-only and safe during render.
 */

export type SignedInCustomer = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  phone: string;
  status: string;
  sessionVersion: number;
  createdAt: Date;
};

export async function saveCustomerSession(
  tenantId: string,
  customerId: string,
  sessionVersion: number,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const jar = await cookies();
  jar.set({
    name: CUSTOMER_COOKIE_NAME,
    value: encodeCustomerToken({ tenantId, customerId, sessionVersion, iat: now, exp: now + CUSTOMER_TTL_SECONDS }),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CUSTOMER_TTL_SECONDS,
  });
}

export async function clearCustomerSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(CUSTOMER_COOKIE_NAME);
}

/**
 * The signed-in customer for THIS tenant, or null. Fails closed and never
 * throws: checkout calls it, and a missing secret or a DB hiccup must cost the
 * order its account link, not the order itself.
 */
export async function getSignedInCustomer(tenantId: string): Promise<SignedInCustomer | null> {
  // Pepweb app shop (lib/auth/app-shopper-scope.ts): the bearer token was
  // already verified against the DB, so the scope — never the cookie — names
  // the shopper. The row is still re-read so a disabled account fails closed.
  const scope = currentAppShopperScope();
  if (scope) return appShopper(scope.tenantId === tenantId ? scope.customerId : null, tenantId);
  try {
    const jar = await cookies();
    const token = jar.get(CUSTOMER_COOKIE_NAME)?.value;
    if (!token) return null;
    const claim = verifyCustomerToken(token);
    if (!claim) return null;
    const row = await findCustomer(tenantId, claim.customerId);
    return resolveCustomerSession(claim, row, tenantId) ? row : null;
  } catch {
    return null;
  }
}

const CUSTOMER_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  name: true,
  phone: true,
  status: true,
  sessionVersion: true,
  createdAt: true,
} as const;

function findCustomer(tenantId: string, customerId: string): Promise<SignedInCustomer | null> {
  return withTenant(tenantId, (db) =>
    db.storefrontCustomer.findFirst({ where: { id: customerId }, select: CUSTOMER_SELECT }),
  );
}

/** The app scope's customer, active and in THIS tenant — else null. Never throws. */
async function appShopper(customerId: string | null, tenantId: string): Promise<SignedInCustomer | null> {
  if (!customerId) return null;
  try {
    const row = await findCustomer(tenantId, customerId);
    return row && row.tenantId === tenantId && row.status === "active" ? row : null;
  } catch {
    return null;
  }
}

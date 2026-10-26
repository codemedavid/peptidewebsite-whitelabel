import "server-only";

// Cookie wrapper for the group-buy EMAIL PASS (codec: gb-pass-token.ts). A
// shopper who typed their email on a paid group buy's join page carries this
// instead of an account session; it names their customer row (an account or a
// guest — lib/storefront/guest-customer.ts) for GROUP-BUY ACCESS ONLY.
//
// getGroupBuyShopper is the one question every group-buy surface asks — the
// join page, the storefront catalog gate and checkout: the signed-in account
// first, else the email pass, else nobody. Read-only, never throws, fails closed.

import { cookies } from "next/headers";
import { withTenant } from "@/lib/db/tenant-client";
import { getSignedInCustomer } from "./customer-session";
import { currentAppShopperScope } from "./app-shopper-scope";
import { encodeGroupBuyPass, verifyGroupBuyPass, GB_PASS_COOKIE_NAME, GB_PASS_TTL_SECONDS } from "./gb-pass-token";

export type GroupBuyShopper = {
  id: string;
  name: string;
  email: string;
  /** account = signed in (website or app); email = typed their email only. */
  via: "account" | "email";
};

export async function saveGroupBuyPass(tenantId: string, customerId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const jar = await cookies();
  jar.set({
    name: GB_PASS_COOKIE_NAME,
    value: encodeGroupBuyPass({ tenantId, customerId, iat: now, exp: now + GB_PASS_TTL_SECONDS }),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GB_PASS_TTL_SECONDS,
  });
}

export async function clearGroupBuyPass(): Promise<void> {
  const jar = await cookies();
  jar.delete(GB_PASS_COOKIE_NAME);
}

/** The customer behind this request's email pass on THIS store, or null. */
async function passCustomer(tenantId: string): Promise<GroupBuyShopper | null> {
  const token = (await cookies()).get(GB_PASS_COOKIE_NAME)?.value;
  if (!token) return null;
  const claim = verifyGroupBuyPass(token);
  if (!claim || claim.tenantId !== tenantId) return null;
  const row = await withTenant(tenantId, (db) =>
    db.storefrontCustomer.findFirst({ where: { id: claim.customerId }, select: { id: true, name: true, email: true, status: true } }),
  );
  return row && row.status === "active" ? { id: row.id, name: row.name, email: row.email, via: "email" } : null;
}

/** Who is joining / buying a group buy: the account, else the email pass, else null. */
export async function getGroupBuyShopper(tenantId: string): Promise<GroupBuyShopper | null> {
  const account = await getSignedInCustomer(tenantId);
  if (account) return { id: account.id, name: account.name, email: account.email, via: "account" };
  // The app always names its shopper by bearer token — never by a website cookie.
  if (currentAppShopperScope()) return null;
  try {
    return await passCustomer(tenantId);
  } catch {
    return null;
  }
}

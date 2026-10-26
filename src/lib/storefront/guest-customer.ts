import "server-only";

// Email-only shoppers. A paid group buy lets a visitor join by typing their
// email — no sign-in, no account (lib/auth/gb-pass.ts). Paid Access keys every
// membership on a StorefrontCustomer row, so that email gets a GUEST row: a
// customer with no password. Nobody can sign in to it (verifyPassword refuses
// the sentinel), and creating a real account with the same email later CLAIMS
// the row (claimGuestCustomer), so the shopper keeps their group-buy access.

import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db/tenant-client";
import { normalizeCustomerEmail } from "./customer-account";

/** Not an scrypt hash — verifyPassword can never match it. */
export const GUEST_PASSWORD_HASH = "guest";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type GuestShopper = { id: string; name: string; email: string; status: string };

const SELECT = { id: true, name: true, email: true, status: true } as const;

/** A normalized email, or null when it isn't one. */
export function parseShopperEmail(v: unknown): string | null {
  const email = normalizeCustomerEmail(v);
  return EMAIL_RE.test(email) ? email : null;
}

/** "juan.delacruz@gmail.com" → "juan.delacruz" — what the admin queue shows. */
const nameFromEmail = (email: string) => email.split("@")[0].slice(0, 120) || email;

/** The store's customer row for this email (account or guest), or null. */
export function findCustomerByEmail(tenantId: string, email: string): Promise<GuestShopper | null> {
  return withTenant(tenantId, (db) =>
    db.storefrontCustomer.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: SELECT }),
  );
}

/** The row for this email — an existing account or guest — else a new guest. */
export async function findOrCreateGuestCustomer(tenantId: string, email: string): Promise<GuestShopper> {
  const existing = await findCustomerByEmail(tenantId, email);
  if (existing) return existing;
  try {
    return await withTenant(tenantId, (db) =>
      db.storefrontCustomer.create({
        data: { tenantId, email, name: nameFromEmail(email), passwordHash: GUEST_PASSWORD_HASH },
        select: SELECT,
      }),
    );
  } catch (e) {
    // Two tabs racing: the unique (tenantId, email) index decides, then re-read.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await findCustomerByEmail(tenantId, email);
      if (row) return row;
    }
    throw e;
  }
}

/**
 * Turn this email's GUEST row into a real account (sign-up with an email that
 * already joined a group buy). Returns the claimed row, or null when the email
 * has no guest row (it's free, or a real account already owns it).
 */
export async function claimGuestCustomer(
  tenantId: string,
  email: string,
  data: { name: string; phone: string; passwordHash: string; age?: number | null; gender?: string | null },
): Promise<{ id: string; sessionVersion: number } | null> {
  return withTenant(tenantId, async (db) => {
    const guest = await db.storefrontCustomer.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, passwordHash: GUEST_PASSWORD_HASH },
      select: { id: true },
    });
    if (!guest) return null;
    // Conditional on still being a guest: two sign-ups can't both claim it.
    const claimed = await db.storefrontCustomer.updateMany({
      where: { id: guest.id, passwordHash: GUEST_PASSWORD_HASH },
      data: { ...data, lastLoginAt: new Date(), sessionVersion: { increment: 1 } },
    });
    if (claimed.count !== 1) return null;
    return db.storefrontCustomer.findFirst({ where: { id: guest.id }, select: { id: true, sessionVersion: true } });
  });
}

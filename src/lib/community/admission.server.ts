import "server-only";

import { withTenant } from "@/lib/db/tenant-client";
import type { CustomerInfo } from "@/lib/mobile/auth";
import type { TenantContext } from "@/lib/tenant/context";
import { avatarHue } from "./keys";
import { communityJoinMode, type JoinMode } from "./membership";
import { defaultDisplayName } from "./validate";

/**
 * Letting a customer into the community. One function for every door — the
 * first app sign-in, `/me`, and each community request — so a store switched
 * to "open" admits people already waiting without anyone re-signing in.
 *
 *   open     → a new member is approved at once; a pending one is promoted.
 *   approval → a new member is filed as pending; nothing is promoted.
 *
 * Rejected and revoked members are never changed here: those are the owner's
 * decisions (a rejected customer can re-apply; see reapply()).
 */

/** Who admitted a member automatically (reviewedBy). */
export const AUTO_REVIEWER = "auto";

const MEMBER_SELECT = {
  status: true,
  reviewedAt: true,
  displayName: true,
  bio: true,
  avatarHue: true,
  reason: true,
  verifiedReseller: true,
  isAdmin: true,
  welcomedAt: true,
  mutedAt: true,
} as const;

export type MemberRow = {
  status: string;
  reviewedAt: Date | null;
  displayName: string;
  bio: string;
  avatarHue: number;
  reason: string | null;
  verifiedReseller: boolean;
  isAdmin: boolean;
  welcomedAt: Date | null;
  mutedAt: Date | null;
};

export function joinModeOf(tenant: TenantContext): JoinMode {
  return communityJoinMode(tenant.branding?.config);
}

/** The customer's membership after admission. One read when nothing changes. */
export async function admitCustomer(tenant: TenantContext, tenantId: string, customer: CustomerInfo): Promise<MemberRow> {
  const open = joinModeOf(tenant) === "open";
  return withTenant(tenantId, async (db) => {
    const existing = await db.communityMember.findFirst({ where: { customerId: customer.id }, select: MEMBER_SELECT });
    if (existing && !(open && existing.status === "pending")) return existing;

    const now = new Date();
    if (existing) {
      await db.communityMember.updateMany({
        where: { customerId: customer.id, status: "pending" },
        data: { status: "approved", reason: null, reviewedAt: now, reviewedBy: AUTO_REVIEWER },
      });
      return { ...existing, status: "approved", reason: null, reviewedAt: now };
    }
    // upsert, not create: two first requests racing must not collide on the unique key.
    return db.communityMember.upsert({
      where: { tenantId_customerId: { tenantId, customerId: customer.id } },
      create: {
        tenantId,
        customerId: customer.id,
        displayName: defaultDisplayName(customer.name),
        avatarHue: avatarHue(customer.id),
        status: open ? "approved" : "pending",
        reviewedAt: open ? now : null,
        reviewedBy: open ? AUTO_REVIEWER : null,
      },
      update: {},
      select: MEMBER_SELECT,
    });
  });
}

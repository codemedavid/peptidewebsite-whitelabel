import "server-only";

// Server half of paid group-buy access (pure rules: gb-access.ts). Every surface
// that hands group-buy data to a browser or the app — the storefront loader,
// the public price refresh, the app catalog, the chat card — runs its catalog
// through applyGroupBuyAccess, and checkout asks paidRoundCheckoutError. Both
// FAIL CLOSED: a viewer that can't be resolved is anonymous, and a membership
// that can't be read is no membership.

import { withTenant } from "@/lib/db/tenant-client";
import { isDemoMode } from "@/lib/demo/fixtures";
import { getSignedInCustomer } from "@/lib/auth/customer-session";
import { requireStorefrontAdmin } from "@/lib/auth/storefront-admin";
import type { Product } from "@/storefront/types";
import { groupBuyForOrder, type GroupBuy, type GroupBuyCapabilities } from "./group-buy";
import { resolveGroupBuyCaps, loadGroupBuys } from "./group-buy-server";
import { hasGroupBuyAccess } from "./gb-membership";
import {
  ANONYMOUS_VIEWER,
  buildGroupBuyTeaser,
  governingGroupBuy,
  isGroupBuyLocked,
  lockGroupBuyCatalog,
  requiresPaidJoin,
  type GroupBuyTeaser,
  type GroupBuyViewer,
} from "./gb-access";

export const GB_JOIN_REQUIRED_MESSAGE =
  "This group buy is for approved members. Join it (pay the join fee) and wait for approval before ordering.";
export const GB_JOIN_UNVERIFIED_MESSAGE =
  "We couldn't confirm your group-buy membership just now. Please try again in a moment.";

export const ADMIN_VIEWER: GroupBuyViewer = { kind: "admin" };

type Membership = { status: string; reviewReason: string };

/** The viewer's LATEST request on a round. Throws on a DB error — callers decide. */
async function latestMembership(tenantId: string, groupBuyId: string, customerId: string): Promise<Membership | null> {
  if (isDemoMode()) return null;
  return withTenant(tenantId, (db) =>
    db.groupBuyMembership.findFirst({
      where: { groupBuyId, customerId },
      orderBy: { createdAt: "desc" },
      select: { status: true, reviewReason: true },
    }),
  );
}

/** Website viewer: a signed-in store admin (owner/staff) of THIS store, else the
 *  signed-in customer, else anonymous. On first paint the admin session is
 *  always cleared, so the page renders as a shopper; the admin's own catalog
 *  reload (and the price refresh after sign-in) is what sees the round. */
export async function storefrontGroupBuyViewer(tenantId: string): Promise<GroupBuyViewer> {
  try {
    if ((await requireStorefrontAdmin()) === tenantId) return ADMIN_VIEWER;
    const customer = await getSignedInCustomer(tenantId);
    return customer ? { kind: "customer", customerId: customer.id } : ANONYMOUS_VIEWER;
  } catch {
    return ANONYMOUS_VIEWER;
  }
}

export type GroupBuyAccessResult = {
  products: Product[];
  /** Set only when the viewer is locked out of the governing round. */
  teaser: GroupBuyTeaser | null;
};

/**
 * The catalog this viewer may receive, plus the teaser when they are locked
 * out. A no-op (same array back, no I/O) for stores without paid access or
 * when the governing round is free — every existing storefront.
 */
export async function applyGroupBuyAccess(input: {
  tenantId: string;
  rounds: readonly GroupBuy[];
  caps: GroupBuyCapabilities;
  viewer: () => Promise<GroupBuyViewer>;
  products: Product[];
  now?: Date;
}): Promise<GroupBuyAccessResult> {
  const now = input.now ?? new Date();
  const round = governingGroupBuy(input.rounds, input.caps, now);
  if (!round || !requiresPaidJoin(round, input.caps)) return { products: input.products, teaser: null };

  let viewer: GroupBuyViewer = ANONYMOUS_VIEWER;
  try {
    viewer = await input.viewer();
  } catch {
    /* unresolvable viewer → anonymous (locked) */
  }
  let membership: Membership | null = null;
  if (viewer.kind === "customer") {
    try {
      membership = await latestMembership(input.tenantId, round.id, viewer.customerId);
    } catch {
      membership = null; // can't prove approval → locked
    }
  }
  if (!isGroupBuyLocked({ round, caps: input.caps, viewer, membershipStatus: membership?.status })) {
    return { products: input.products, teaser: null };
  }
  return {
    products: lockGroupBuyCatalog(input.products, round, input.caps, now),
    teaser: buildGroupBuyTeaser(round, input.caps, membership, now),
  };
}

/**
 * Checkout's gate for an order the server attributed to `round`. Null = may
 * proceed. Checkout never exempts admins: placing a group-buy order needs an
 * approved membership, whoever is holding the cart.
 */
export async function paidRoundCheckoutError(
  tenantId: string,
  round: Pick<GroupBuy, "id" | "paidJoin" | "joinFeeCents"> | null,
  caps: Pick<GroupBuyCapabilities, "enabled" | "paidAccess">,
): Promise<string | null> {
  if (!round || !requiresPaidJoin(round, caps)) return null;
  const customer = await getSignedInCustomer(tenantId);
  if (!customer) return GB_JOIN_REQUIRED_MESSAGE;
  try {
    const membership = await latestMembership(tenantId, round.id, customer.id);
    return hasGroupBuyAccess(membership?.status) ? null : GB_JOIN_REQUIRED_MESSAGE;
  } catch {
    return GB_JOIN_UNVERIFIED_MESSAGE;
  }
}

/**
 * Checkout's whole paid-access step, independent of the best-effort round
 * attribution (orders.ts stampGroupBuy swallows its errors so attribution never
 * blocks an order — which is exactly why this gate must not ride on it).
 * Re-derives the order's round the same way (groupBuyForOrder) and FAILS
 * CLOSED: if paid access is on and the rounds can't be read, nobody checks out.
 * No I/O past the entitlement read for stores without groupbuy.paid_access.
 */
export async function paidRoundCheckoutGate(
  tenantId: string,
  slug: string,
  orderedProductIds: readonly string[],
): Promise<string | null> {
  const caps = await resolveGroupBuyCaps(tenantId);
  if (!caps.enabled || !caps.paidAccess) return null;
  let rounds: GroupBuy[];
  try {
    rounds = await loadGroupBuys(tenantId, slug);
  } catch {
    return GB_JOIN_UNVERIFIED_MESSAGE;
  }
  return paidRoundCheckoutError(tenantId, groupBuyForOrder(rounds, caps, [...orderedProductIds]), caps);
}

/**
 * Would an ANONYMOUS visitor be allowed to see this product? False only when it
 * belongs to a paid round they're locked out of. Used by surfaces that render
 * outside the storefront loader — the /p/<slug> link preview, whose crawler
 * (Messenger, Facebook) is always anonymous. Fails closed on a failed read.
 */
export async function productVisibleToPublic(
  tenantId: string,
  slug: string,
  product: Pick<Product, "id" | "productType">,
): Promise<boolean> {
  const caps = await resolveGroupBuyCaps(tenantId);
  if (!caps.enabled || !caps.paidAccess) return true;
  try {
    const access = await applyGroupBuyAccess({
      tenantId,
      rounds: await loadGroupBuys(tenantId, slug),
      caps,
      viewer: async () => ANONYMOUS_VIEWER,
      products: [product as Product],
    });
    return access.products.length > 0;
  } catch {
    return false;
  }
}

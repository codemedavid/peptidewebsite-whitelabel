import "server-only";

// Server half of group-buy access (pure rules: gb-access.ts). Every surface
// that hands group-buy data to a browser or the app — the storefront loader,
// the public price refresh, the app catalog, the chat card — runs its catalog
// through applyGroupBuyAccess, and checkout asks paidRoundCheckoutGate. Both
// FAIL CLOSED: a viewer that can't be resolved is anonymous, and an access
// answer that can't be read is no access.
//
// Whether a round is gated and whether the viewer is in comes from Paid Access's
// public interface (@/modules/paid-access) — this file never reads its tables.

import { gatePolicies, gatePoliciesLive, getAccess, policyFor, type AccessResult } from "@/modules/paid-access";
import { previewSteps } from "@/modules/paid-access/client";
import { getGroupBuyShopper } from "@/lib/auth/gb-pass";
import { requireStorefrontAdmin } from "@/lib/auth/storefront-admin";
import { joinFeeLabel } from "@/lib/mobile/group-buy-share";
import type { Product } from "@/storefront/types";
import { groupBuyForOrder, type GroupBuy, type GroupBuyCapabilities } from "./group-buy";
import { resolveGroupBuyCaps, loadGroupBuys } from "./group-buy-server";
import {
  ANONYMOUS_VIEWER,
  buildGroupBuyTeaser,
  governingGroupBuy,
  isGroupBuyLocked,
  lockGroupBuyCatalog,
  type GroupBuyTeaser,
  type GroupBuyViewer,
} from "./gb-access";

export const GB_JOIN_REQUIRED_MESSAGE =
  "This group buy is for members. Join it from the group buy page (and finish the steps) before ordering.";
export const GB_JOIN_UNVERIFIED_MESSAGE =
  "We couldn't confirm your group-buy membership just now. Please try again in a moment.";

export const ADMIN_VIEWER: GroupBuyViewer = { kind: "admin" };

/** Website viewer: a signed-in store admin (owner/staff) of THIS store, else the
 *  signed-in customer or the shopper's group-buy email pass, else anonymous. On first paint the admin session is
 *  always cleared, so the page renders as a shopper; the admin's own catalog
 *  reload (and the price refresh after sign-in) is what sees the round. */
export async function storefrontGroupBuyViewer(tenantId: string): Promise<GroupBuyViewer> {
  try {
    if ((await requireStorefrontAdmin()) === tenantId) return ADMIN_VIEWER;
    const shopper = await getGroupBuyShopper(tenantId);
    return shopper ? { kind: "customer", customerId: shopper.id } : ANONYMOUS_VIEWER;
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
 * out. A no-op (same array back, one cached read) for stores without Paid Access
 * and for rounds the store chose to make Open. In a Paid Access store a round
 * nobody has set up yet is members-only (fail closed).
 */
export async function applyGroupBuyAccess(input: {
  tenantId: string;
  rounds: readonly GroupBuy[];
  caps: GroupBuyCapabilities;
  viewer: () => Promise<GroupBuyViewer>;
  products: Product[];
  currency?: string;
  now?: Date;
}): Promise<GroupBuyAccessResult> {
  const now = input.now ?? new Date();
  const round = governingGroupBuy(input.rounds, input.caps, now);
  if (!round) return { products: input.products, teaser: null };
  const policy = policyFor(await gatePolicies(input.tenantId), round.id);
  if (!policy?.gated) return { products: input.products, teaser: null };

  let viewer: GroupBuyViewer = ANONYMOUS_VIEWER;
  try {
    viewer = await input.viewer();
  } catch {
    /* unresolvable viewer → anonymous (locked) */
  }
  if (viewer.kind === "admin") return { products: input.products, teaser: null };

  let access: AccessResult | null = null;
  if (viewer.kind === "customer") {
    try {
      access = await getAccess({ tenantId: input.tenantId, groupBuyId: round.id, customerId: viewer.customerId, now });
    } catch {
      access = null; // can't prove membership → locked
    }
  }
  const gated = access ? access.gated : true;
  if (!isGroupBuyLocked({ gated, viewer, canAccess: access?.canAccess ?? false })) return { products: input.products, teaser: null };

  const locked = lockGroupBuyCatalog(input.products, round, input.caps, now);
  const amountLabel = joinFeeLabel(input.currency || "₱", policy.amountCents);
  return {
    products: locked,
    teaser: buildGroupBuyTeaser(
      round,
      input.caps,
      {
        visibility: access?.visibility ?? policy.visibility,
        steps: policy.ready ? previewSteps(policy, amountLabel) : ["Joining opens soon"],
        joinFeeCents: policy.ready && policy.steps.includes("payment") ? policy.amountCents : 0,
        amountLabel,
        productCount: Math.max(0, input.products.length - locked.length),
        maxSlots: policy.maxSlots,
        slotsTaken: policy.slotsTaken,
        membership: access?.status ? { status: access.status, reviewReason: access.reason, headline: access.headline } : null,
        copy: policy.copy,
      },
      now,
    ),
  };
}

/**
 * Checkout's gate for an order the server attributed to `round`. Null = may
 * proceed. Checkout never exempts admins: placing a group-buy order needs an
 * active membership, whoever is holding the cart. Reads LIVE (it decides).
 */
export async function paidRoundCheckoutError(tenantId: string, round: Pick<GroupBuy, "id"> | null): Promise<string | null> {
  if (!round) return null;
  let gated: boolean;
  try {
    // A round nobody has set up counts as gated (fail closed).
    gated = policyFor(await gatePoliciesLive(tenantId), round.id)?.gated ?? false;
  } catch {
    return GB_JOIN_UNVERIFIED_MESSAGE;
  }
  if (!gated) return null;
  // An account or an email pass (lib/auth/gb-pass.ts) — joining needs no account.
  const shopper = await getGroupBuyShopper(tenantId);
  if (!shopper) return GB_JOIN_REQUIRED_MESSAGE;
  try {
    const access = await getAccess({ tenantId, groupBuyId: round.id, customerId: shopper.id });
    return access.canAccess ? null : GB_JOIN_REQUIRED_MESSAGE;
  } catch {
    return GB_JOIN_UNVERIFIED_MESSAGE;
  }
}

/**
 * Checkout's whole access step, independent of the best-effort round
 * attribution (orders.ts stampGroupBuy swallows its errors so attribution never
 * blocks an order — which is exactly why this gate must not ride on it).
 * Re-derives the order's round the same way (groupBuyForOrder) and FAILS
 * CLOSED: if Paid Access is on and the rounds can't be read, nobody checks out.
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
  return paidRoundCheckoutError(tenantId, groupBuyForOrder(rounds, caps, [...orderedProductIds]));
}

/**
 * Would an ANONYMOUS visitor be allowed to see this product? False only when it
 * belongs to a gated round they're locked out of. Used by surfaces that render
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

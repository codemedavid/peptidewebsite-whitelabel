/**
 * Server-side subscription resolution — reads the operator-set paid window
 * (Tenant.status + subscriptionStartsAt/subscriptionEndsAt) and folds it through
 * the pure core (computeSubscriptionState, test:subscription-state).
 *
 * The paid sibling of lib/trial/trial-info.ts. Caching mirrors it exactly: an
 * outer React cache() dedupes within a render, an inner unstable_cache (5 min)
 * dedupes across requests and is busted by the same `tenant:${id}` tag every
 * tenant mutation revalidates.
 *
 * Fail-open: any read error resolves to "not on a subscription" — the public
 * storefront and admin must never 500 because the subscription join hiccuped.
 * This also covers the pending-db:push case ([[live-db-state]]): if the
 * subscription columns don't yet exist on the live DB the query throws and we
 * cleanly render no banner instead of crashing the page.
 */

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode } from "@/lib/demo/fixtures";
import { computeSubscriptionState, type SubscriptionState } from "./subscription-state";
import { isBillingCycle, type BillingCycle } from "./billing-cycle";

const NOT_ON_SUBSCRIPTION: SubscriptionState = { onSubscription: false, expired: false };

const loadSubscriptionWindow = (tenantId: string) =>
  unstable_cache(
    () =>
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          status: true,
          subscriptionCycle: true,
          subscriptionStartsAt: true,
          subscriptionEndsAt: true,
        },
      }),
    ["tenant-subscription", tenantId],
    { tags: [`tenant:${tenantId}`, `tenant:${tenantId}:subscription`], revalidate: 300 },
  )();

/** The tenant's resolved subscription state, computed server-side at call time. */
export const getSubscriptionState = cache(async (tenantId: string): Promise<SubscriptionState> => {
  if (isDemoMode()) return NOT_ON_SUBSCRIPTION;
  try {
    const tenant = await loadSubscriptionWindow(tenantId);
    if (!tenant) return NOT_ON_SUBSCRIPTION;
    return computeSubscriptionState(
      {
        status: tenant.status,
        subscriptionStartsAt: tenant.subscriptionStartsAt,
        subscriptionEndsAt: tenant.subscriptionEndsAt,
      },
      new Date(),
    );
  } catch {
    return NOT_ON_SUBSCRIPTION;
  }
});

/** Raw window descriptors for the operator setter + the "Type"/"Start date"
 *  rows in the tenant detail: the chosen billing cycle and start date. Reuses
 *  the same cached read as getSubscriptionState (one DB hit) and fails open to
 *  nulls, so a pending-db:push column just yields "no cycle set". */
export type SubscriptionMeta = { cycle: BillingCycle | null; startsAt: Date | null };

export const getSubscriptionMeta = cache(async (tenantId: string): Promise<SubscriptionMeta> => {
  if (isDemoMode()) return { cycle: null, startsAt: null };
  try {
    const tenant = await loadSubscriptionWindow(tenantId);
    return {
      cycle: isBillingCycle(tenant?.subscriptionCycle) ? tenant.subscriptionCycle : null,
      startsAt: tenant?.subscriptionStartsAt ?? null,
    };
  } catch {
    return { cycle: null, startsAt: null };
  }
});

/**
 * Server-side trial resolution — joins Tenant.status with the tenant's latest
 * trial OnboardingSubmission (the operator-managed window: Super Admin →
 * Onboarding → Package stat) and folds them through the pure core
 * (computeTrialState, test:trial-state).
 *
 * Caching mirrors lib/features/entitlements.ts: outer React cache() dedupes
 * within a render, inner unstable_cache (5 min) dedupes across requests and is
 * busted by the same `tenant:${id}` tag every tenant mutation revalidates.
 *
 * Fail-open: any read error resolves to "not on trial" — the public storefront
 * and admin must never 500 because the trial join hiccuped. Expiry enforcement
 * still holds because the next successful read re-locks.
 */

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode } from "@/lib/demo/fixtures";
import { hasFeature } from "@/lib/features/entitlements";
import type { FeatureKey } from "@/lib/features/catalog";
import { businessExclusiveLocked, computeTrialState, type TrialState } from "./trial-state";

const NOT_ON_TRIAL: TrialState = { onTrial: false, expired: false };

const loadTrialWindow = (tenantId: string) =>
  unstable_cache(
    () =>
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          status: true,
          onboardingSubmissions: {
            where: { trial: true },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { trial: true, trialStartsAt: true, trialEndsAt: true },
          },
        },
      }),
    ["tenant-trial", tenantId],
    { tags: [`tenant:${tenantId}`, `tenant:${tenantId}:trial`], revalidate: 300 },
  )();

/** The tenant's resolved trial state, computed server-side at call time. */
export const getTrialState = cache(async (tenantId: string): Promise<TrialState> => {
  if (isDemoMode()) return NOT_ON_TRIAL;
  try {
    const tenant = await loadTrialWindow(tenantId);
    const submission = tenant?.onboardingSubmissions[0];
    if (!tenant || !submission) return NOT_ON_TRIAL;
    return computeTrialState(
      {
        status: tenant.status,
        trial: submission.trial,
        trialStartsAt: submission.trialStartsAt,
        trialEndsAt: submission.trialEndsAt,
      },
      new Date(),
    );
  } catch {
    return NOT_ON_TRIAL;
  }
});

/**
 * Server gate for the Business-exclusive modules (Checkout Fee, Delivery
 * Note): locked during an ACTIVE trial (the trial plan is technically
 * entitled — the lock is the upsell) and otherwise whenever the entitlement is
 * missing/revoked (the trial's Starter downgrade). The UI mirror is
 * isAdminModuleLocked (storefront/visibility.ts, test:trial-gating); every
 * save action re-checks HERE so a stale client can't write through the lock.
 */
export async function isBusinessExclusiveLocked(
  tenantId: string,
  feature: FeatureKey,
): Promise<boolean> {
  const [state, entitled] = await Promise.all([
    getTrialState(tenantId),
    hasFeature(tenantId, feature),
  ]);
  return businessExclusiveLocked(state, entitled);
}

/**
 * Pure subscription-urgency classification — the signal the Super Admin uses to
 * spot tenants whose paid subscription is about to lapse (or already has). It's
 * a thin derivation over computeSubscriptionState (test:subscription-state), so
 * the "who's near due" surfaces and the tenant's own countdown banner agree by
 * construction.
 *
 *   - ok       — not on a subscription, or comfortably inside the window
 *   - due_soon — on a subscription, not yet expired, ≤ NEAR_DUE_DAYS remaining
 *   - overdue  — the window has lapsed (renewal is past due)
 *
 * Client-safe and side-effect free: callers pass `now`, so the tenants-list
 * badges + "Expiring soon" panel stay deterministic and testable. `endsAt` is an
 * ISO string so the result crosses the server→client boundary intact.
 */

import {
  computeSubscriptionState,
  type SubscriptionWindowInput,
} from "./subscription-state";

/** Tenants within this many days of their due date are flagged "due_soon". */
export const NEAR_DUE_DAYS = 7;

export type UrgencyLevel = "ok" | "due_soon" | "overdue";

export type SubscriptionUrgency =
  | { level: "ok" }
  | {
      level: "due_soon" | "overdue";
      /** Whole days remaining (0 once overdue). */
      daysLeft: number;
      /** Window end, ISO string. */
      endsAt: string;
    };

/** A flagged (non-ok) urgency — what the "Expiring soon" surfaces carry. */
export type FlaggedUrgency = Extract<SubscriptionUrgency, { level: "due_soon" | "overdue" }>;

const OK: SubscriptionUrgency = { level: "ok" };

/**
 * Classify a tenant's subscription window at `now`. Only paid tenants with an
 * operator-set end date are ever flagged; everything else is "ok" (byte-identical
 * to a tenant that has no window at all).
 */
export function subscriptionUrgency(
  input: SubscriptionWindowInput,
  now: Date,
  nearDueDays: number = NEAR_DUE_DAYS,
): SubscriptionUrgency {
  const state = computeSubscriptionState(input, now);
  if (!state.onSubscription) return OK;

  if (state.expired) {
    return { level: "overdue", daysLeft: state.daysLeft, endsAt: state.endsAt.toISOString() };
  }
  if (state.daysLeft <= nearDueDays) {
    return { level: "due_soon", daysLeft: state.daysLeft, endsAt: state.endsAt.toISOString() };
  }
  return OK;
}

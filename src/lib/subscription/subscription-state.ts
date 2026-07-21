/**
 * Pure subscription-window math — the single source every subscription-duration
 * surface renders from: the store-admin countdown banner ("X days left",
 * "Day X of Y", progress %) and the platform-admin tenant-detail window row.
 *
 * This is the PAID-tenant sibling of the trial-state core (trial-state.ts). The
 * trial window is governed by a trial-opted OnboardingSubmission on a
 * status:"trial" tenant; the subscription window is governed by an operator-set
 * Tenant.subscriptionEndsAt on a PAID tenant. A tenant is governed here only
 * when BOTH hold:
 *   - Tenant.status !== "trial"      (trial tenants show the trial banner, never
 *                                     both — the trial banner owns their chrome)
 *   - an operator-set subscriptionEndsAt exists (no end date → no banner, so a
 *     tenant with no window set stays byte-identical to legacy behavior)
 *
 * Client-safe and side-effect free: callers pass `now`, so results are
 * deterministic and testable (npm run test:subscription-state). Dates may arrive
 * as ISO strings after the brand JSON round-trip.
 */

export const DEFAULT_SUBSCRIPTION_DAYS = 30;

const DAY_MS = 86_400_000;

export type SubscriptionWindowInput = {
  /** Tenant.status — trial tenants are governed by the trial banner instead. */
  status: string;
  subscriptionStartsAt: Date | string | null | undefined;
  subscriptionEndsAt: Date | string | null | undefined;
};

export type SubscriptionState =
  | { onSubscription: false; expired: false }
  | {
      onSubscription: true;
      /** now >= endsAt — the period has lapsed (renewal due). */
      expired: boolean;
      /** Whole days remaining (ceil), clamped to [0, totalDays]. */
      daysLeft: number;
      /** 1-based current day, clamped to [1, totalDays]. */
      dayNum: number;
      /** Window length in days; DEFAULT_SUBSCRIPTION_DAYS when start is unknown. */
      totalDays: number;
      /** Progress used, 0–100 (100 once expired). */
      pctUsed: number;
      endsAt: Date;
    };

const NOT_ON_SUBSCRIPTION: SubscriptionState = { onSubscription: false, expired: false };

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** JSON-safe projection of an on-subscription SubscriptionState for the client
 *  Brand blob (endsAt as ISO string so demo-mode JSON round-trips keep it). */
export type BrandSubscription = {
  onSubscription: true;
  expired: boolean;
  daysLeft: number;
  dayNum: number;
  totalDays: number;
  pctUsed: number;
  endsAt: string;
};

/** Serialize a SubscriptionState for brand.subscription — undefined when not
 *  governed, so legacy brands stay byte-identical and no banner renders. */
export function brandSubscriptionFrom(state: SubscriptionState): BrandSubscription | undefined {
  if (!state.onSubscription) return undefined;
  const { endsAt, ...rest } = state;
  return { ...rest, endsAt: endsAt.toISOString() };
}

export function computeSubscriptionState(
  input: SubscriptionWindowInput,
  now: Date,
): SubscriptionState {
  const endsAt = toValidDate(input.subscriptionEndsAt);
  if (input.status === "trial" || !endsAt) return NOT_ON_SUBSCRIPTION;

  const startsAt = toValidDate(input.subscriptionStartsAt);
  const totalDays =
    startsAt && endsAt.getTime() > startsAt.getTime()
      ? Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / DAY_MS))
      : DEFAULT_SUBSCRIPTION_DAYS;

  const msLeft = endsAt.getTime() - now.getTime();
  const expired = msLeft <= 0;
  const daysLeft = expired ? 0 : clamp(Math.ceil(msLeft / DAY_MS), 0, totalDays);
  const dayNum = clamp(totalDays - daysLeft + 1, 1, totalDays);
  const pctUsed = expired
    ? 100
    : clamp(Math.round(((totalDays - daysLeft) / totalDays) * 100), 0, 100);

  return { onSubscription: true, expired, daysLeft, dayNum, totalDays, pctUsed, endsAt };
}

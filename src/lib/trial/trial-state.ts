/**
 * Pure trial-window math — the single source every trial surface renders from:
 * the store-admin countdown banner ("X days left", "Day X of 30", progress %),
 * the expiry gates (paused storefront / locked admin), and upgrade-credit copy.
 *
 * A tenant is governed by the trial system only when ALL hold:
 *   - Tenant.status === "trial"  (paid/suspended tenants are never gated here)
 *   - the onboarding submission opted into the trial (trial: true)
 *   - an operator-set trialEndsAt exists (operator-created tenants default to
 *     status "trial" with NO window — those must never see banners or gates)
 *
 * Client-safe and side-effect free: callers pass `now`, so results are
 * deterministic and testable (npm run test:trial-state). Dates may arrive as
 * ISO strings after the brand JSON round-trip.
 */

export const DEFAULT_TRIAL_DAYS = 30;

const DAY_MS = 86_400_000;

export type TrialWindowInput = {
  /** Tenant.status — only "trial" tenants are governed. */
  status: string;
  /** OnboardingSubmission.trial — explicit opt-in to the trial package. */
  trial: boolean;
  trialStartsAt: Date | string | null | undefined;
  trialEndsAt: Date | string | null | undefined;
};

export type TrialState =
  | { onTrial: false; expired: false }
  | {
      onTrial: true;
      /** now >= endsAt — drives the paused storefront + locked admin. */
      expired: boolean;
      /** Whole days remaining (ceil), clamped to [0, totalDays]. */
      daysLeft: number;
      /** 1-based current day, clamped to [1, totalDays]. */
      dayNum: number;
      /** Window length in days; DEFAULT_TRIAL_DAYS when start is unknown. */
      totalDays: number;
      /** Progress used, 0–100 (100 once expired). */
      pctUsed: number;
      endsAt: Date;
    };

const NOT_ON_TRIAL: TrialState = { onTrial: false, expired: false };

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeTrialState(input: TrialWindowInput, now: Date): TrialState {
  const endsAt = toValidDate(input.trialEndsAt);
  if (input.status !== "trial" || !input.trial || !endsAt) return NOT_ON_TRIAL;

  const startsAt = toValidDate(input.trialStartsAt);
  const totalDays =
    startsAt && endsAt.getTime() > startsAt.getTime()
      ? Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / DAY_MS))
      : DEFAULT_TRIAL_DAYS;

  const msLeft = endsAt.getTime() - now.getTime();
  const expired = msLeft <= 0;
  const daysLeft = expired ? 0 : clamp(Math.ceil(msLeft / DAY_MS), 0, totalDays);
  const dayNum = clamp(totalDays - daysLeft + 1, 1, totalDays);
  const pctUsed = expired
    ? 100
    : clamp(Math.round(((totalDays - daysLeft) / totalDays) * 100), 0, 100);

  return { onTrial: true, expired, daysLeft, dayNum, totalDays, pctUsed, endsAt };
}

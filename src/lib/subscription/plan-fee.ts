/**
 * Per-tenant plan-fee override rule (pure, no DB / no Next runtime).
 *
 * An operator can set a per-tenant recurring price (Tenant.subscriptionPriceCents,
 * the "Monthly price due" field in the Subscription window). When present it
 * overrides the plan-config list price wherever the tenant's recurring Plan fee /
 * MRR contribution is shown; when blank the plan-config price stands.
 *
 * A deliberate 0 is a real value (a comped tenant) and must override — so this is
 * an explicit null/validity check, never a truthiness check. Negative or
 * non-finite values are treated as unset and fall back.
 *
 * Guarded by scripts/test-plan-fee.ts (npm run test:plan-fee).
 */
export function effectivePlanFeeCents(
  priceCents: number | null | undefined,
  fallbackCents: number,
): number {
  if (priceCents != null && Number.isFinite(priceCents) && priceCents >= 0) {
    return priceCents;
  }
  return fallbackCents;
}

/**
 * Upper guardrail for a per-tenant monthly price (centavos) — ₱1M/mo, matching
 * the plan-config price clamp (lib/platform/plan-config.ts MAX_PRICE_CENTS). The
 * DB column is a 32-bit Int, so an unclamped operator typo could exceed its range
 * and error on save; clamping keeps the write in-bounds.
 */
export const MAX_SUBSCRIPTION_PRICE_CENTS = 100_000_000;

export type ResolvedPriceCents = { value: number | null } | { error: string };

/**
 * Validate + normalize an operator-entered per-tenant price (already in centavos).
 * null/undefined → cleared (null). Negative or non-finite → error. Otherwise the
 * value is rounded to a whole cent and clamped to MAX_SUBSCRIPTION_PRICE_CENTS.
 * 0 is a valid comped-tenant value.
 *
 * Guarded by scripts/test-plan-fee.ts (npm run test:plan-fee).
 */
export function resolvePriceCentsInput(
  input: number | null | undefined,
): ResolvedPriceCents {
  if (input == null) return { value: null };
  if (!Number.isFinite(input) || input < 0) {
    return { error: "Enter a valid monthly price." };
  }
  return { value: Math.min(Math.round(input), MAX_SUBSCRIPTION_PRICE_CENTS) };
}

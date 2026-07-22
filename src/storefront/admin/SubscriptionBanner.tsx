"use client";

import type { BrandSubscription } from "@/lib/subscription/subscription-state";

/**
 * Subscription-duration chrome for the store admin — the paid-tenant sibling of
 * TrialBanner. Rendered above every admin view when the tenant carries an
 * operator-set subscription window (brand.subscription, projected server-side in
 * page.tsx, so the countdown never trusts the browser clock).
 *
 *   - active period: dark-slate countdown bar — days left, blue progress
 *     ("Day X of Y", renewal date);
 *   - lapsed: dark-amber bar — the period has ended, renew CTA.
 *
 * Deliberately literal colors (not theme tokens): this is platform chrome, the
 * same on every store, and must stay readable under any theme preset — matching
 * how TrialBanner treats its own gold-on-green pairing.
 */
type Props = {
  subscription: BrandSubscription;
  /** Open the store-admin Billing view (pay & submit proof). */
  onOpenBilling?: () => void;
};

function endsLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

export function SubscriptionBanner({ subscription, onOpenBilling }: Props) {
  // Same literal-color treatment as the bar itself: platform chrome, readable
  // under any theme preset.
  const billingCta = onOpenBilling ? (
    <button
      type="button"
      className="admin-sub__billing"
      onClick={onOpenBilling}
      style={{
        marginLeft: "auto",
        padding: "4px 12px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.35)",
        background: "rgba(255,255,255,0.12)",
        color: "inherit",
        font: "inherit",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      View billing →
    </button>
  ) : null;

  if (subscription.expired) {
    return (
      <div className="admin-sub admin-sub--expired" role="status">
        <div className="admin-sub__head">
          <span className="admin-sub__dot" aria-hidden />
          <span className="admin-sub__title">Subscription ended</span>
          {billingCta}
        </div>
        <span className="admin-sub__note">
          Your subscription period ended on {endsLabel(subscription.endsAt)}. Submit your renewal
          payment on the Billing page or contact your provider.
        </span>
      </div>
    );
  }

  const daysWord = subscription.daysLeft === 1 ? "day" : "days";
  return (
    <div className="admin-sub" role="status">
      <div className="admin-sub__head">
        <span className="admin-sub__dot" aria-hidden />
        <span className="admin-sub__title">Subscription</span>
        <span className="admin-sub__sep">·</span>
        <span className="admin-sub__left">
          <b>{subscription.daysLeft}</b> {daysWord} left
        </span>
        {billingCta}
      </div>
      <div className="admin-sub__progress">
        <div className="admin-sub__track">
          <div className="admin-sub__fill" style={{ width: `${subscription.pctUsed}%` }} />
        </div>
        <div className="admin-sub__scale">
          <span>
            Day {subscription.dayNum} of {subscription.totalDays}
          </span>
          <span>Renews {endsLabel(subscription.endsAt)}</span>
        </div>
      </div>
    </div>
  );
}

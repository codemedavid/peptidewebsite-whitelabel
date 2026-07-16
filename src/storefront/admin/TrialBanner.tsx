"use client";

import type { BrandTrial } from "@/lib/trial/trial-state";

/**
 * Trial chrome for the store admin — rendered above every admin view while the
 * tenant is trial-governed (brand.trial projected server-side in page.tsx, so
 * the countdown never trusts the browser clock).
 *
 *   - active trial: dark-green countdown bar — days left, gold progress
 *     ("Day X of Y", end date), the credit reassurance and the upgrade CTA;
 *   - expired: dark-red bar — storefront is paused, preview + unlock CTAs.
 *
 * Deliberately literal colors (not theme tokens): this is platform chrome, the
 * same on every store, and the gold-on-green pairing must stay readable no
 * matter which theme preset the storefront runs.
 */
type Props = {
  trial: BrandTrial;
  onUpgrade: () => void;
  onPreviewStore: () => void;
};

function endsLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export function TrialBanner({ trial, onUpgrade, onPreviewStore }: Props) {
  if (trial.expired) {
    return (
      <div className="admin-trial admin-trial--expired" role="status">
        <div className="admin-trial__info">
          <div className="admin-trial__title">Your trial has ended</div>
          <div className="admin-trial__note">
            Your storefront is paused — customers currently see a &ldquo;We&rsquo;re currently on
            pause&rdquo; page.{" "}
            <button className="admin-trial__link" onClick={onPreviewStore}>
              Preview it
            </button>
          </div>
        </div>
        <button className="admin-trial__cta" onClick={onUpgrade}>
          Unlock with Business
        </button>
      </div>
    );
  }

  const daysWord = trial.daysLeft === 1 ? "day" : "days";
  return (
    <div className="admin-trial" role="status">
      <div className="admin-trial__head">
        <span className="admin-trial__dot" aria-hidden />
        <span className="admin-trial__title">{trial.totalDays}-Day Trial</span>
        <span className="admin-trial__sep">·</span>
        <span className="admin-trial__left">
          <b>{trial.daysLeft}</b> {daysWord} left
        </span>
      </div>
      <div className="admin-trial__progress">
        <div className="admin-trial__track">
          <div className="admin-trial__fill" style={{ width: `${trial.pctUsed}%` }} />
        </div>
        <div className="admin-trial__scale">
          <span>
            Day {trial.dayNum} of {trial.totalDays}
          </span>
          <span>Ends {endsLabel(trial.endsAt)}</span>
        </div>
      </div>
      <div className="admin-trial__side">
        <span className="admin-trial__note">
          Your trial payment is credited when you upgrade
        </span>
        <button className="admin-trial__cta" onClick={onUpgrade}>
          Upgrade to Business
        </button>
      </div>
    </div>
  );
}

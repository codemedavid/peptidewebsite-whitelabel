"use client";

import type { Brand } from "../types";

/**
 * The branded "We're currently on pause" card customers see in place of the
 * ENTIRE public storefront while a trial-expired store is paused
 * (isTrialPaused — StorefrontApp swaps the page for this; the checkout action
 * enforces the same rule server-side). #admin stays reachable so the owner
 * can upgrade or downgrade.
 */
export function StorePaused({ brand }: { brand: Brand }) {
  return (
    <main className="sf-paused">
      <div className="sf-paused__card">
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="sf-paused__logo" src={brand.logoUrl} alt={brand.name} />
        ) : (
          <div className="sf-paused__mark">{brand.name?.[0]?.toUpperCase() || "S"}</div>
        )}
        <h1 className="sf-paused__title">We&rsquo;re currently on pause</h1>
        <p className="sf-paused__copy">
          Our shop is taking a short break. Please check back soon — we&rsquo;ll be right back with
          your favorites.
        </p>
      </div>
    </main>
  );
}

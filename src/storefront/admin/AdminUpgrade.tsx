"use client";

import type { Brand } from "../types";

/**
 * Upgrade to Business — the in-admin upgrade/payment page every trial surface
 * links to (banner CTA, locked BUSINESS tiles, feature spotlight).
 *
 * Phase 3 skeleton: heading + value framing. Phase 4 fills in the order
 * summary (Business monthly − trial credit = due today from plan_config), the
 * operator's receiving payment methods and the proof-of-payment upload that
 * files an operator-approvable upgrade request.
 */
type Props = {
  brand: Brand;
  onBack: () => void;
};

export function AdminUpgrade({ brand, onBack }: Props) {
  return (
    <div className="admin">
      <main className="admin__inner admin-upgrade">
        <button className="admin-upgrade__back" onClick={onBack}>
          ← Back
        </button>
        <h1 className="admin-upgrade__title">Upgrade to Business</h1>
        <div className="admin-card">
          <p className="admin-upgrade__lede">
            Keep everything from your trial — unlimited products, orders, inventory and shipping —
            plus the Business exclusives: Sales Analytics, Product Card Customization, Checkout Fee
            and Delivery Note. Every new feature we release is included in Business, automatically.
          </p>
          {brand.trial && !brand.trial.expired && (
            <p className="admin-upgrade__note">
              Your trial payment is credited toward your first month when you upgrade.
            </p>
          )}
          <p className="admin-upgrade__note">
            Payment options are being prepared — contact support to complete your upgrade today.
          </p>
        </div>
      </main>
    </div>
  );
}

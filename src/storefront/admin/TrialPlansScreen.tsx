"use client";

import { useEffect, useState } from "react";
import { useStore } from "../store";
import { formatPesos } from "@/lib/admin/plans";
import { STARTER_COMBOS, STARTER_DOWNGRADE_PRODUCT_CAP } from "@/lib/trial/starter-downgrade";
import {
  getUpgradeContextAction,
  downgradeToStarterAction,
  type UpgradeContext,
} from "@/actions/upgrade";

/**
 * "Choose how to continue" — the screen a trial-expired store admin is locked
 * behind (AdminPage renders this instead of the dashboard once
 * brand.trial.expired). Two paths, Business deliberately framed as the better
 * deal per the brief:
 *   - Business (RECOMMENDED): everything from the trial + the exclusives, the
 *     trial credit applied → the Upgrade page;
 *   - Starter: exactly ONE combo (FAQ+Protocols or Calculator+Tracking),
 *     10-product cap, everything else stays locked → downgradeToStarterAction,
 *     then a full reload so the server re-projects brand/entitlements.
 */
export function TrialPlansScreen({ onUpgrade }: { onUpgrade: () => void }) {
  const { toast } = useStore();
  const [ctx, setCtx] = useState<UpgradeContext | null>(null);
  const [combo, setCombo] = useState(STARTER_COMBOS[0].id);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getUpgradeContextAction().then((res) => {
      if (!cancelled && !("error" in res)) setCtx(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDowngrade = async () => {
    setWorking(true);
    const res = await downgradeToStarterAction(combo);
    setWorking(false);
    if ("error" in res) return toast(res.error);
    toast("You're on Starter — your storefront is live again.");
    // Full reload: the server re-projects brand, entitlements and page toggles.
    setTimeout(() => window.location.reload(), 600);
  };

  const businessFeatures: { text: string; exclusive?: boolean }[] = [
    { text: "Unlimited products" },
    { text: "Everything in your trial — orders, inventory, shipping" },
    { text: "Promo codes, couriers, lab results & protocols" },
    { text: "Hero, banner & FAQ management" },
    { text: "Sales Analytics", exclusive: true },
    { text: "Product Card Customization", exclusive: true },
    { text: "Checkout Fee & Delivery Note tools", exclusive: true },
    { text: "Priority support" },
  ];

  return (
    <main className="admin__inner admin-plans">
      <div className="admin-plans__head">
        <h1 className="admin-plans__title">Choose how to continue</h1>
        <p className="admin-plans__sub">
          Reactivate your storefront instantly — keep everything with Business, or keep it simple
          with Starter.
        </p>
      </div>

      <div className="admin-plans__grid">
        {/* Business */}
        <section className="admin-plans__card admin-plans__card--business">
          <span className="admin-plans__flag">RECOMMENDED</span>
          <h2 className="admin-plans__name">Business</h2>
          <div className="admin-plans__price">
            <span className="admin-plans__amount">
              {ctx ? formatPesos(ctx.quote.businessCents) : "…"}
            </span>
            <span className="admin-plans__per">/ month</span>
          </div>
          {ctx && ctx.quote.creditCents > 0 && (
            <div className="admin-plans__credit">
              Your {formatPesos(ctx.quote.creditCents)} trial payment is deducted — pay only{" "}
              {formatPesos(ctx.quote.dueTodayCents)} today
            </div>
          )}
          <div className="admin-plans__divider" />
          <ul className="admin-plans__feats">
            {businessFeatures.map((f) => (
              <li key={f.text}>
                <span className="admin-plans__check">✓</span>
                <span>
                  {f.text}
                  {f.exclusive && <span className="admin-plans__excl">EXCLUSIVE</span>}
                </span>
              </li>
            ))}
          </ul>
          <div className="admin-plans__growing">
            <b>Always growing:</b> every new feature we launch is added to Business as an exclusive
            — at no extra cost.
          </div>
          <button className="admin-plans__cta" onClick={onUpgrade}>
            Upgrade to Business
          </button>
        </section>

        {/* Starter */}
        <section className="admin-plans__card">
          <h2 className="admin-plans__name">Starter</h2>
          <div className="admin-plans__price">
            <span className="admin-plans__amount">
              {ctx ? formatPesos(ctx.starterCents) : "…"}
            </span>
            <span className="admin-plans__per">/ month</span>
          </div>
          <div className="admin-plans__note">
            Pick <b>one</b> combination — the rest stays locked
          </div>
          <div className="admin-plans__divider" />
          <div className="admin-plans__combos">
            {STARTER_COMBOS.map((c) => (
              <label
                key={c.id}
                className={`admin-plans__combo${combo === c.id ? " is-active" : ""}`}
              >
                <input
                  type="radio"
                  name="starter-combo"
                  checked={combo === c.id}
                  onChange={() => setCombo(c.id)}
                />
                <span>
                  <b>{c.title}</b>
                  <span className="admin-plans__combo-sub">{c.sub}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="admin-plans__cap">
            ! Limited to <b>{STARTER_DOWNGRADE_PRODUCT_CAP} products</b> in your catalog
          </div>
          <div className="admin-plans__locked">
            No sales analytics, no card customization, and other tools stay locked on Starter.
          </div>
          <button
            className="admin-plans__cta admin-plans__cta--ghost"
            disabled={working}
            onClick={handleDowngrade}
          >
            {working ? "Switching…" : "Downgrade to Starter"}
          </button>
        </section>
      </div>
    </main>
  );
}

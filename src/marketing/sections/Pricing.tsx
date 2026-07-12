import Link from "next/link";
import { packagesFrom, TRIAL_PROMO } from "@/marketing/config";
import { getPlanConfig } from "@/lib/platform/plan-config-server";

export async function Pricing() {
  // Operator-edited pricing/features (Super Admin → Plans & Billing), falling
  // back to the code defaults when nothing has been saved.
  const packages = packagesFrom((await getPlanConfig()).plans);
  return (
    <section className="mk-section" id="pricing">
      <div className="mk-container">
        <div className="mk-section-head mk-center">
          <span className="mk-eyebrow">Simple packages</span>
          <h2 className="mk-h2">Pick the package that fits</h2>
          <p>One-time build, yours to keep. Start small and upgrade anytime.</p>
        </div>
        <div className="mk-trial-banner">
          <div>
            <span className="mk-trial-tag">{TRIAL_PROMO.tag}</span>
            <h3 className="mk-h3">{TRIAL_PROMO.title}</h3>
            <p>{TRIAL_PROMO.body}</p>
          </div>
          <Link href={TRIAL_PROMO.href} className="mk-btn mk-btn-primary">
            {TRIAL_PROMO.cta} →
          </Link>
        </div>
        <div className="mk-price-grid">
          {packages.map((p) => (
            <div
              key={p.key}
              className={`mk-price-card${p.highlighted ? " mk-price-card--featured" : ""}`}
            >
              <div className="mk-price-head">
                <span className="mk-price-name">{p.name}</span>
                {p.tag && <span className="mk-price-tag">{p.tag}</span>}
              </div>
              <div className="mk-price-amount">
                {p.discountLabel ? (
                  <>
                    <b>{p.discountLabel}</b>
                    <s>{p.priceLabel}</s>
                  </>
                ) : (
                  <b>{p.priceLabel}</b>
                )}
              </div>
              {p.highlighted && <p className="mk-price-trial-note">{TRIAL_PROMO.cardNote}</p>}
              <p className="mk-price-blurb">{p.blurb}</p>
              <ul className="mk-price-feats">
                {p.feats.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link
                href={`/get-started?plan=${p.key}`}
                className={`mk-btn ${p.highlighted ? "mk-btn-primary" : "mk-btn-ghost"}`}
              >
                Get Started
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

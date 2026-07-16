import Link from "next/link";
import {
  packagesFrom,
  INTRO_OFFER,
  PRICING_INTRO,
  PLAN_CTAS,
  type Package,
} from "@/marketing/config";
import { formatPesos } from "@/lib/admin/plans";
import { getPlanConfig } from "@/lib/platform/plan-config-server";

function SetupFeeNote({ p }: { p: Package }) {
  if (p.setupFeeCents <= 0) return null;
  if (p.setupFeeWaived) {
    return (
      <p className="mk-price-setup mk-price-setup--waived">
        ✓ FREE setup <s>Normally {formatPesos(p.setupFeeCents)}</s>
      </p>
    );
  }
  return <p className="mk-price-setup">+ {formatPesos(p.setupFeeCents)} one-time setup</p>;
}

export async function Pricing() {
  // Operator-edited pricing/features (Super Admin → Plans & Billing), falling
  // back to the code defaults when nothing has been saved.
  const config = await getPlanConfig();
  const packages = packagesFrom(config.plans);
  const trialLabel = formatPesos(config.trialPriceCents);
  const proMonthly = formatPesos(
    config.plans.find((p) => p.key === "pro")?.priceCents ?? 0,
  );
  return (
    <section className="mk-section" id="pricing">
      <div className="mk-container">
        <div className="mk-section-head mk-center">
          <span className="mk-eyebrow">{PRICING_INTRO.eyebrow}</span>
          <h2 className="mk-h2">{PRICING_INTRO.title}</h2>
          <p>{PRICING_INTRO.body}</p>
        </div>
        <div className="mk-offer">
          <div>
            <span className="mk-offer-tag">{INTRO_OFFER.tag}</span>
            <h3 className="mk-h3 mk-offer-title">
              {INTRO_OFFER.titleLead} <em>{trialLabel}</em>
              {INTRO_OFFER.titleTail}
            </h3>
            <p>
              Then {proMonthly}/month. {INTRO_OFFER.bodyTail}
            </p>
          </div>
          <Link href={INTRO_OFFER.href} className="mk-btn mk-btn-offer">
            {INTRO_OFFER.cta} →
          </Link>
        </div>
        <div className="mk-price-grid">
          {packages.map((p) => (
            <div
              key={p.key}
              className={`mk-price-card${p.highlighted ? " mk-price-card--featured" : ""}`}
            >
              {p.highlighted && p.tag && <span className="mk-price-pill">{p.tag}</span>}
              <span className="mk-price-name">{p.name}</span>
              {p.discountLabel ? (
                <>
                  <span className="mk-price-kicker">First month</span>
                  <div className="mk-price-amount mk-price-amount--promo">
                    <b>{p.discountLabel}</b>
                  </div>
                  <p className="mk-price-then">
                    then <b>{p.priceLabel}</b>/month
                  </p>
                </>
              ) : (
                <div className="mk-price-amount">
                  <b>{p.priceLabel}</b>
                  <span>/month</span>
                </div>
              )}
              <SetupFeeNote p={p} />
              <p className="mk-price-blurb">{p.blurb}</p>
              <ul className="mk-price-feats">
                {p.feats.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link
                href={`/get-started?plan=${p.key}${p.key === "pro" && p.discountLabel ? "&trial=1" : ""}`}
                className={`mk-btn ${p.highlighted ? "mk-btn-primary" : "mk-btn-ghost"}`}
              >
                {PLAN_CTAS[p.key] ?? "Get Started"}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import { Check } from "lucide-react";
import { PACKAGES } from "@/marketing/config";

export function Pricing() {
  return (
    <section className="mk-section" id="pricing">
      <div className="mk-container">
        <div className="mk-section-head mk-center">
          <span className="mk-eyebrow">Simple packages</span>
          <h2 className="mk-h2">Pick the package that fits</h2>
          <p className="mk-lead">
            One-time build, yours to keep. Start small and upgrade anytime — every package can grow
            with your business.
          </p>
        </div>
        <div className="mk-grid mk-grid-3">
          {PACKAGES.map((p) => (
            <div
              key={p.key}
              className={`mk-card mk-price-card${p.highlighted ? " mk-price-card--featured" : ""}`}
            >
              {p.tag && <span className="mk-price-tag">{p.tag}</span>}
              <div className="mk-price-name">{p.name}</div>
              <div className="mk-price-amount">
                <b>{p.priceLabel}</b>
              </div>
              <p className="mk-price-blurb">{p.blurb}</p>
              <ul className="mk-price-feats">
                {p.feats.map((f) => (
                  <li key={f}>
                    <Check size={17} /> {f}
                  </li>
                ))}
              </ul>
              <Link
                href={`/get-started?plan=${p.key}`}
                className={`mk-btn ${p.highlighted ? "mk-btn-primary" : "mk-btn-ghost"} mk-btn-block`}
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

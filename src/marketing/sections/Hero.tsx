import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { SITE } from "@/marketing/config";

export function Hero() {
  return (
    <section className="mk-hero">
      <div className="mk-container mk-hero-inner">
        <div>
          <span className="mk-chip">
            <Sparkles size={15} /> {SITE.hero.chip}
          </span>
          <h1 className="mk-h1" style={{ marginTop: 18 }}>
            {SITE.hero.line1} <span className="mk-gradient-text">{SITE.hero.line2}</span>
          </h1>
          <p className="mk-lead">{SITE.hero.sub}</p>
          <div className="mk-hero-cta">
            <Link href="/get-started" className="mk-btn mk-btn-primary mk-btn-lg">
              {SITE.hero.primaryCta} <ArrowRight size={18} />
            </Link>
            <a href="#demos" className="mk-btn mk-btn-ghost mk-btn-lg">
              {SITE.hero.secondaryCta}
            </a>
          </div>
          <div className="mk-hero-proof">
            <div>
              <b>2–5 days</b>
              <small>Average launch time</small>
            </div>
            <div>
              <b>100%</b>
              <small>Mobile-ready &amp; branded</small>
            </div>
            <div>
              <b>0%</b>
              <small>Payment gateway fees</small>
            </div>
          </div>
        </div>

        {/* Decorative storefront preview */}
        <div className="mk-hero-art" aria-hidden>
          <div className="mk-hero-art-bar">
            <i />
            <i />
            <i />
          </div>
          <div className="mk-hero-art-hero">
            <b>Your Brand</b>
            <span>Shop the collection →</span>
          </div>
          <div className="mk-hero-art-grid">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { HERO_BULLETS, SITE } from "@/marketing/config";

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
          <ul className="mk-hero-bullets">
            {HERO_BULLETS.map((b) => (
              <li key={b}>
                <CheckCircle2 size={18} /> {b}
              </li>
            ))}
          </ul>
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
              <b>3+ oras</b>
              <small>Nababawi mo kada araw</small>
            </div>
            <div>
              <b>24/7</b>
              <small>Sumasagot kahit tulog ka</small>
            </div>
            <div>
              <b>2–5 days</b>
              <small>Done-for-you setup</small>
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

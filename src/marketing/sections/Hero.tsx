import Link from "next/link";
import { HERO_STATS, SITE, storeUrl } from "@/marketing/config";

export function Hero() {
  const { hero } = SITE;
  return (
    <section className="mk-hero">
      <div className="mk-hero-inner">
        <span className="mk-eyebrow">{hero.eyebrow}</span>
        <h1 className="mk-h1">
          {hero.h1Lead} <em>{hero.h1Em}</em> {hero.h1Tail}
        </h1>
        <p className="mk-lead">{hero.sub}</p>
        <div className="mk-hero-cta">
          <Link href="/get-started" className="mk-btn mk-btn-primary">
            {hero.primaryCta} →
          </Link>
          <a href={storeUrl(hero.demoSlug)} className="mk-btn mk-btn-ghost">
            {hero.secondaryCta}
          </a>
        </div>
        <div className="mk-hero-stats">
          {HERO_STATS.map((s) => (
            <div key={s.value}>
              <b>{s.value}</b>
              <small>{s.label}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

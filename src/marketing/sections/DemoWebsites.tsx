import Link from "next/link";
import { ArrowUpRight, ArrowRight } from "lucide-react";
import { DEMO_SITES, storeUrl } from "@/marketing/config";

export function DemoWebsites() {
  return (
    <section className="mk-section" id="demos" style={{ background: "#fff" }}>
      <div className="mk-container">
        <div className="mk-section-head mk-center">
          <span className="mk-eyebrow">See it in action</span>
          <h2 className="mk-h2">Demo websites</h2>
          <p className="mk-lead">
            Real storefronts built on the platform. Open one to explore the catalog, checkout, and
            tracking — exactly what your customers will see.
          </p>
        </div>
        <div className="mk-grid mk-grid-3">
          {DEMO_SITES.map((d) => (
            <article key={d.name} className="mk-card mk-card--hover mk-demo-card">
              <div className="mk-demo-thumb" aria-hidden>
                <div className="mk-demo-mock">
                  <i className="bar" />
                  <i className="row" />
                  <i className="row short" />
                  <i className="row" />
                </div>
              </div>
              <div className="mk-demo-body">
                <div className="cat">{d.category}</div>
                <h3>{d.name}</h3>
                <p>{d.blurb}</p>
                <a
                  className="mk-btn mk-btn-soft"
                  href={storeUrl(d.slug)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View Demo <ArrowUpRight size={16} />
                </a>
              </div>
            </article>
          ))}

          {/* Conversion tile */}
          <article className="mk-card mk-card--hover mk-demo-card">
            <div className="mk-demo-thumb" aria-hidden style={{ background: "var(--grad-warm)" }} />
            <div className="mk-demo-body">
              <div className="cat">Your business</div>
              <h3>Your store here</h3>
              <p>Branded for you and ready to take orders in days. Let&apos;s build it.</p>
              <Link className="mk-btn mk-btn-primary" href="/get-started">
                Start Your Website <ArrowRight size={16} />
              </Link>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

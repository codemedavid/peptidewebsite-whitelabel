import { Star } from "lucide-react";
import { TESTIMONIALS } from "@/marketing/config";

export function Testimonials() {
  return (
    <section className="mk-section" style={{ background: "#fff" }}>
      <div className="mk-container">
        <div className="mk-section-head mk-center">
          <span className="mk-eyebrow">Loved by owners</span>
          <h2 className="mk-h2">Small businesses, big launches</h2>
        </div>
        <div className="mk-grid mk-grid-2">
          {TESTIMONIALS.map((t) => (
            <figure key={t.name} className="mk-card mk-quote" style={{ margin: 0 }}>
              <div className="mk-quote-stars" aria-label="5 out of 5 stars">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={16} fill="currentColor" strokeWidth={0} />
                ))}
              </div>
              <blockquote>
                <p>“{t.quote}”</p>
              </blockquote>
              <figcaption className="mk-quote-who">
                <span className="mk-avatar">{t.initials}</span>
                <span>
                  <b>{t.name}</b>
                  <small>{t.role}</small>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

import { COST_STATS, PAIN_INTRO, PAINS } from "@/marketing/config";

export function Pain() {
  return (
    <section className="mk-section">
      <div className="mk-container">
        <div className="mk-pain-grid">
          <div className="mk-pain-intro">
            <span className="mk-eyebrow">{PAIN_INTRO.eyebrow}</span>
            <h2 className="mk-h2">{PAIN_INTRO.title}</h2>
            <p>{PAIN_INTRO.body}</p>
          </div>
          <div className="mk-pain-list">
            {PAINS.map((p) => (
              <div key={p.q} className="mk-pain-item">
                <b>{p.q}</b>
                <p>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mk-dark-band">
          {COST_STATS.map((s) => (
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

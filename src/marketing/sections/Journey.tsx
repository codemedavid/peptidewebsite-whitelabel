import { JOURNEY_INTRO, JOURNEY_STEPS } from "@/marketing/config";

export function Journey() {
  return (
    <section className="mk-section">
      <div className="mk-container">
        <div className="mk-section-head mk-center">
          <span className="mk-eyebrow">{JOURNEY_INTRO.eyebrow}</span>
          <h2 className="mk-h2">{JOURNEY_INTRO.title}</h2>
          <p>{JOURNEY_INTRO.body}</p>
        </div>
        <div className="mk-journey">
          {JOURNEY_STEPS.map((s) => (
            <div key={s.n}>
              <div className="mk-journey-num">{s.n}</div>
              <b>{s.title}</b>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

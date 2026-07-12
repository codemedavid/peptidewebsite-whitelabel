import { FEATURES } from "@/marketing/config";

export function Features() {
  return (
    <section className="mk-section" id="features">
      <div className="mk-container">
        <div className="mk-features-head">
          <span className="mk-eyebrow">Ano’ng nasa loob</span>
          <h2 className="mk-h2">Everything you need to run a more organized business</h2>
        </div>
        <div className="mk-features-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="mk-feature">
              <b>{f.title}</b>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

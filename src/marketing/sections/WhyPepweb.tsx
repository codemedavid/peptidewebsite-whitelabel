import { VALUE_PROPS, SITE } from "@/marketing/config";

export function WhyPepweb() {
  return (
    <section className="mk-section mk-band">
      <div className="mk-container">
        <div className="mk-section-head mk-center">
          <span className="mk-eyebrow">Why {SITE.brand}</span>
          <h2 className="mk-h2">A platform, not just a website</h2>
        </div>
        <div className="mk-value-grid">
          {VALUE_PROPS.map((v) => (
            <div key={v.title} className="mk-value-card">
              <h3>{v.title}</h3>
              <p>{v.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

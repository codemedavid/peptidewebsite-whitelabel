import { WHY_MONTHLY } from "@/marketing/config";

export function WhyMonthly() {
  return (
    <section className="mk-section mk-band">
      <div className="mk-container">
        <div className="mk-why-grid">
          <div>
            <span className="mk-eyebrow">{WHY_MONTHLY.eyebrow}</span>
            <h2 className="mk-h2">{WHY_MONTHLY.title}</h2>
            <p className="mk-why-body">{WHY_MONTHLY.body}</p>
          </div>
          <div className="mk-why-list">
            {WHY_MONTHLY.items.map((item) => (
              <div key={item} className="mk-why-item">
                <span aria-hidden="true">✓</span> {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

import { VISION_CLOSER, VISION_STEPS } from "@/marketing/config";

export function FutureVision() {
  return (
    <section className="mk-section" id="vision" style={{ background: "#fff" }}>
      <div className="mk-container">
        <div className="mk-section-head mk-center">
          <span className="mk-eyebrow">Imagine this</span>
          <h2 className="mk-h2">Paano kung hindi ka na kailangan sa bawat order?</h2>
          <p className="mk-lead">
            Ganito ang isang sale kapag may system ka — mula dating ng customer hanggang confirmed
            na order.
          </p>
        </div>
        <div className="mk-flow">
          {VISION_STEPS.map((s) => (
            <div key={s.n} className="mk-flow-step">
              <span className="mk-flow-num">{s.n}</span>
              <div>
                <b>{s.title}</b>
                <p>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mk-pain-closer">{VISION_CLOSER}</p>
      </div>
    </section>
  );
}

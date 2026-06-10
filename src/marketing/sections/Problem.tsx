import { PAINS, PAIN_CLOSER } from "@/marketing/config";

export function Problem() {
  return (
    <section className="mk-section" id="problem" style={{ background: "#fff" }}>
      <div className="mk-container">
        <div className="mk-section-head mk-center">
          <span className="mk-eyebrow">Pamilyar ba ’to?</span>
          <h2 className="mk-h2">Parehong tanong. Araw-araw. Buong araw.</h2>
          <p className="mk-lead">
            Kung online seller ka, alam mo na ang routine — at alam mo kung paano nito kinakain ang
            buong araw mo.
          </p>
        </div>
        <div className="mk-grid mk-grid-3">
          {PAINS.map((p) => (
            <div key={p.q} className="mk-card mk-card--hover mk-pain">
              <p className="mk-pain-q">{p.q}</p>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
        <p className="mk-pain-closer">{PAIN_CLOSER}</p>
      </div>
    </section>
  );
}

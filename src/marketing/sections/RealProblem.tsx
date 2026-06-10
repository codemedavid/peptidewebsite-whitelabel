import { REAL_PROBLEM } from "@/marketing/config";

export function RealProblem() {
  return (
    <section className="mk-section mk-section--tight" id="real-problem">
      <div className="mk-container">
        <div className="mk-band-dark">
          <span className="mk-eyebrow mk-band-eyebrow">Ang totoong problema</span>
          <h2 className="mk-h2">
            {REAL_PROBLEM.line1}
            <br />
            <span className="mk-band-accent">{REAL_PROBLEM.line2}</span>
          </h2>
          <div className="mk-band-beats">
            {REAL_PROBLEM.beats.map((b) => (
              <p key={b.lead}>
                <b>{b.lead}</b> {b.rest}
              </p>
            ))}
          </div>
          <p className="mk-band-closer">{REAL_PROBLEM.closer}</p>
        </div>
      </div>
    </section>
  );
}

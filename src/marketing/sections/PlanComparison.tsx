import { COMPARISON } from "@/marketing/config";

function Mark({ on, featured }: { on: boolean; featured?: boolean }) {
  const cls = `mk-compare-mark${on ? " mk-compare-mark--on" : ""}${featured ? " mk-compare-mark--featured" : ""}`;
  return <div className={cls}>{on ? "✓" : "—"}</div>;
}

export function PlanComparison() {
  return (
    <section className="mk-section" id="compare">
      <div className="mk-container mk-compare-container">
        <div className="mk-section-head mk-center">
          <span className="mk-eyebrow">Compare plans</span>
          <h2 className="mk-h2">What&rsquo;s in each plan</h2>
        </div>
        <div className="mk-compare-scroll">
          <div className="mk-compare">
            <div className="mk-compare-row mk-compare-row--head">
              <div>Feature</div>
              <div className="mk-compare-col">Starter</div>
              <div className="mk-compare-col mk-compare-col--featured">Business</div>
              <div className="mk-compare-col">Automated</div>
            </div>
            {COMPARISON.map((row) => (
              <div key={row.label} className="mk-compare-row">
                <div>{row.label}</div>
                <Mark on={row.starter} />
                <Mark on={row.pro} featured />
                <Mark on={row.enterprise} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

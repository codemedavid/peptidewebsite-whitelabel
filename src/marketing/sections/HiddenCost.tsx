import { BellRing, Flame, TrendingDown, UserX, type LucideIcon } from "lucide-react";
import { COST_CARDS, COST_STATS } from "@/marketing/config";

const ICONS: Record<string, LucideIcon> = { UserX, TrendingDown, Flame, BellRing };

export function HiddenCost() {
  return (
    <section className="mk-section" id="hidden-cost">
      <div className="mk-container">
        <div className="mk-section-head mk-center">
          <span className="mk-eyebrow">The hidden cost</span>
          <h2 className="mk-h2">Magkano talaga ang halaga ng oras mo?</h2>
          <p className="mk-lead">
            Habang busy ka sa inquiries, may mga sales na nawawala. Bilangin natin nang totoo.
          </p>
        </div>
        <div className="mk-stat-band">
          {COST_STATS.map((s) => (
            <div key={s.value} className="mk-stat">
              <b>{s.value}</b>
              <small>{s.label}</small>
            </div>
          ))}
        </div>
        <div className="mk-grid mk-grid-4">
          {COST_CARDS.map((c) => {
            const Icon = ICONS[c.icon] ?? Flame;
            return (
              <div key={c.title} className="mk-card mk-card--hover mk-feature">
                <span className="mk-feature-icon">
                  <Icon size={22} />
                </span>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import { ArrowRight, Globe, Layers, Workflow, type LucideIcon } from "lucide-react";
import { SYSTEM_CARDS, SYSTEM_CLOSER } from "@/marketing/config";

const ICONS: Record<string, LucideIcon> = { Globe, Layers, Workflow };

export function SystemIntro() {
  return (
    <section className="mk-section" id="system">
      <div className="mk-container">
        <div className="mk-section-head mk-center">
          <span className="mk-eyebrow">The business system</span>
          <h2 className="mk-h2">
            Hindi lang ito website. <span className="mk-gradient-text">System ito.</span>
          </h2>
          <p className="mk-lead">{SYSTEM_CLOSER}</p>
        </div>
        <div className="mk-grid mk-grid-3">
          {SYSTEM_CARDS.map((c) => {
            const Icon = ICONS[c.icon] ?? Globe;
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
        <div className="mk-center" style={{ marginTop: 38 }}>
          <Link href="/get-started" className="mk-btn mk-btn-primary mk-btn-lg">
            Get Started <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}

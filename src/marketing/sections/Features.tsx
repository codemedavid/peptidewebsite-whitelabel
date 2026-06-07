import {
  ClipboardList,
  MessageCircle,
  Smartphone,
  Palette,
  PackagePlus,
  QrCode,
  Truck,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";
import { FEATURES } from "@/marketing/config";

const ICONS: Record<string, LucideIcon> = {
  ClipboardList,
  MessageCircle,
  Smartphone,
  Palette,
  PackagePlus,
  QrCode,
  Truck,
  LayoutDashboard,
};

export function Features() {
  return (
    <section className="mk-section" id="features">
      <div className="mk-container">
        <div className="mk-section-head mk-center">
          <span className="mk-eyebrow">Everything included</span>
          <h2 className="mk-h2">A complete store, not just a pretty page</h2>
          <p className="mk-lead">
            Every Jonina website ships with the tools you need to look professional and start
            selling from day one.
          </p>
        </div>
        <div className="mk-grid mk-grid-4">
          {FEATURES.map((f) => {
            const Icon = ICONS[f.icon] ?? ClipboardList;
            return (
              <div key={f.title} className="mk-card mk-card--hover mk-feature">
                <span className="mk-feature-icon">
                  <Icon size={22} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

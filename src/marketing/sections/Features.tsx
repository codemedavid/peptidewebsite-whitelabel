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
          <span className="mk-eyebrow">Ano’ng nasa loob</span>
          <h2 className="mk-h2">Everything You Need To Run A More Organized Business</h2>
          <p className="mk-lead">
            Lahat ng nasa system mo, may iisang trabaho: bawasan ang manual work at gawing mas
            organized ang operasyon mo araw-araw.
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

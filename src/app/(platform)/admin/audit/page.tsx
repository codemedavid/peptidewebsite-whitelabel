import {
  Activity,
  Box,
  ShoppingBag,
  Mail,
  Users,
  Building2,
  Layers,
  TrendingUp,
  CreditCard,
  AlertCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { requirePlatformUser } from "@/lib/auth/session";
import { getPlatformAudit } from "@/lib/admin/data";

export const dynamic = "force-dynamic";

const ICONS: Record<string, LucideIcon> = {
  Activity,
  Box,
  ShoppingBag,
  Mail,
  Users,
  Buildings: Building2,
  Layers,
  TrendUp: TrendingUp,
  Card: CreditCard,
  AlertCircle,
};

/** Render **bold** markers server-side without dangerouslySetInnerHTML. */
function renderText(text: string) {
  return text.split(/(\*\*.+?\*\*)/g).map((seg, i) =>
    seg.startsWith("**") && seg.endsWith("**") ? <strong key={i}>{seg.slice(2, -2)}</strong> : <span key={i}>{seg}</span>,
  );
}

export default async function AuditLogsPage() {
  await requirePlatformUser();
  const entries = await getPlatformAudit();

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Audit Logs</h1>
          <p className="page-sub">Platform-wide activity, most recent first</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3 className="card-title">Activity timeline</h3>
        </div>
        <div style={{ padding: "8px 0 12px" }}>
          {entries.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>No activity recorded yet.</div>}
          {entries.map((e, i) => {
            const IconCmp = ICONS[e.icon] ?? Activity;
            return (
              <div key={i} style={{ display: "flex", gap: 14, padding: "12px 20px" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div className="feed-dot" style={e.danger ? { width: 26, height: 26, background: "var(--danger-soft)", color: "var(--danger)" } : { width: 26, height: 26 }}>
                    <IconCmp width={13} height={13} />
                  </div>
                  {i < entries.length - 1 && <div style={{ flex: 1, width: 1, background: "var(--border-soft)", minHeight: 14 }} />}
                </div>
                <div style={{ flex: 1, paddingBottom: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <div style={{ fontSize: 13.5, color: "var(--ink-900)" }}>{renderText(e.text)}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-400)", whiteSpace: "nowrap" }}>{e.time}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

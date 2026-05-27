import { Layers } from "lucide-react";
import { requirePlatformUser } from "@/lib/auth/session";
import { getFeatureModules } from "@/lib/admin/data";
import { planMeta } from "@/lib/admin/plans";

export const dynamic = "force-dynamic";

const TIER_CLS: Record<string, string> = { starter: "badge-neutral", pro: "badge-info", enterprise: "badge-accent" };

export default async function FeatureModulesPage() {
  await requirePlatformUser();
  const { totalTenants, groups } = await getFeatureModules();

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Feature Modules</h1>
          <p className="page-sub">Platform-wide modules and their adoption across {totalTenants} tenants</p>
        </div>
      </div>

      {groups.map(({ group, items }) => (
        <div key={group} className="card mb-4">
          <div className="card-head">
            <h3 className="card-title">{group}</h3>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {items.length} modules
            </span>
          </div>
          <div>
            {items.map((f, i) => {
              const pct = totalTenants ? Math.round((f.adoption / totalTenants) * 100) : 0;
              return (
                <div
                  key={f.key}
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px", borderBottom: i < items.length - 1 ? "1px solid var(--border-soft)" : "none" }}
                >
                  <div className="fcat-icon">
                    <Layers />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink-900)" }}>{f.label}</span>
                      <span className={"badge " + (TIER_CLS[f.tier] ?? "badge-neutral")}>{planMeta(f.tier).label}+</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 2 }}>{f.description}</div>
                  </div>
                  <div style={{ width: 160 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 4 }}>
                      <span className="muted">Adoption</span>
                      <span className="tnum muted">
                        {f.adoption}/{totalTenants}
                      </span>
                    </div>
                    <div className="bar">
                      <span style={{ width: pct + "%" }} />
                    </div>
                  </div>
                  <code className="mono" style={{ fontSize: 11, color: "var(--ink-400)", width: 180, textAlign: "right" }}>
                    {f.key}
                  </code>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

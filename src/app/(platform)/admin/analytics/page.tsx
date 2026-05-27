import { DollarSign, Box, Building2, Users } from "lucide-react";
import { requirePlatformUser } from "@/lib/auth/session";
import { getPlatformOverview } from "@/lib/admin/data";

export const dynamic = "force-dynamic";

/** Server-rendered area chart (static — no hover; the dashboard has the interactive one). */
function AreaChart({ data, labels }: { data: number[]; labels: string[] }) {
  const w = 900,
    h = 240,
    pad = { l: 48, r: 16, t: 16, b: 28 };
  const max = Math.max(...data, 1) * 1.1;
  const stepX = (w - pad.l - pad.r) / (data.length - 1 || 1);
  const sx = (i: number) => pad.l + i * stepX;
  const sy = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  const path = data.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const area = path + ` L${sx(data.length - 1).toFixed(1)},${(h - pad.b).toFixed(1)} L${sx(0).toFixed(1)},${(h - pad.b).toFixed(1)} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" preserveAspectRatio="none" style={{ display: "block", height: 260 }}>
      <defs>
        <linearGradient id="anArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((t) => (
        <line key={t} x1={pad.l} x2={w - pad.r} y1={sy(max * t)} y2={sy(max * t)} stroke="var(--border-soft)" strokeDasharray="2 4" />
      ))}
      {labels.map((l, i) => (
        <text key={i} x={sx(i)} y={h - 8} fontSize="10.5" textAnchor="middle" fill="var(--ink-400)">
          {l}
        </text>
      ))}
      <path d={area} fill="url(#anArea)" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default async function AnalyticsPage() {
  await requirePlatformUser();
  const data = await getPlatformOverview();
  const k = data.kpis;
  const max = Math.max(...data.tenantGrowth, 1);

  const kpis = [
    { label: "Monthly revenue", value: "$" + Math.round(k.monthlyRevenueCents / 100 / 1000) + "k", icon: DollarSign },
    { label: "Total orders", value: k.totalOrders.toLocaleString(), icon: Box },
    { label: "Total tenants", value: k.totalTenants.toLocaleString(), icon: Building2 },
    { label: "Total customers", value: k.totalCustomers.toLocaleString(), icon: Users },
  ];

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-sub">Revenue, growth and order trends across the platform</p>
        </div>
      </div>

      <div className="grid-3 mb-4" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {kpis.map((kpi) => (
          <div key={kpi.label} className="kpi">
            <div className="kpi-label">
              <kpi.icon /> {kpi.label}
            </div>
            <div className="kpi-value">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="card mb-4">
        <div className="card-head">
          <div>
            <h3 className="card-title">Platform revenue</h3>
            <div className="card-sub">Order revenue · trailing 12 months</div>
          </div>
        </div>
        <div className="card-body" style={{ padding: 12 }}>
          <AreaChart data={data.revenueSeries.current} labels={data.revenueSeries.labels} />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3 className="card-title">Tenant growth</h3>
        </div>
        <div className="card-body">
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 180, padding: "4px 0 24px" }}>
            {data.tenantGrowth.map((v, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    width: "100%",
                    height: `${(v / max) * 100}%`,
                    background: "linear-gradient(180deg, var(--accent) 0%, var(--accent) 60%, rgba(47,98,245,0.5) 100%)",
                    borderRadius: "6px 6px 2px 2px",
                    minHeight: 4,
                  }}
                />
                <div style={{ fontSize: 10.5, color: "var(--ink-400)" }}>{data.revenueSeries.labels[i]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

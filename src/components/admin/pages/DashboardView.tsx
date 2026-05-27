"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CounterValue,
  FeedText,
  Ic,
  KPI,
  Sparkline,
  TenantAvatar,
} from "@/components/admin/shell/primitives";
import { useAdminUI } from "@/components/admin/shell/AdminShell";
import type { OverviewData } from "@/lib/admin/data";

/* ---------- revenue chart (SVG, hover tooltip) ---------- */
function RevenueChart({ series }: { series: OverviewData["revenueSeries"] }) {
  const w = 760,
    h = 240,
    pad = { l: 44, r: 16, t: 16, b: 30 };
  const data = series.current;
  const prev = series.previous;
  const labels = series.labels;
  const maxY = Math.max(...data, ...prev, 1) * 1.1;
  const stepX = (w - pad.l - pad.r) / (data.length - 1 || 1);
  const sx = (i: number) => pad.l + i * stepX;
  const sy = (v: number) => pad.t + (1 - v / maxY) * (h - pad.t - pad.b);
  const path = (arr: number[]) => arr.map((v, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const area = path(data) + ` L${sx(data.length - 1).toFixed(1)},${(h - pad.b).toFixed(1)} L${sx(0).toFixed(1)},${(h - pad.b).toFixed(1)} Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round((maxY * t) / 50000) * 50000);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div style={{ position: "relative", padding: "8px 0" }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        preserveAspectRatio="none"
        style={{ display: "block", height: 260 }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * w;
          let i = Math.round((x - pad.l) / stepX);
          i = Math.max(0, Math.min(data.length - 1, i));
          setHover(i);
        }}
      >
        <defs>
          <linearGradient id="revArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={sy(v)} y2={sy(v)} stroke="var(--border-soft)" strokeDasharray="2 4" />
            <text x={pad.l - 8} y={sy(v) + 4} fontSize="10.5" textAnchor="end" fill="var(--ink-400)" fontFamily="var(--font-mono)">
              {v >= 1000 ? "$" + v / 1000 + "k" : "$" + v}
            </text>
          </g>
        ))}
        {labels.map((l, i) => (
          <text key={i} x={sx(i)} y={h - 10} fontSize="10.5" textAnchor="middle" fill="var(--ink-400)">
            {l}
          </text>
        ))}
        <path d={path(prev)} fill="none" stroke="var(--ink-300)" strokeWidth="1.5" strokeDasharray="4 4" />
        <path d={area} fill="url(#revArea)" />
        <path d={path(data)} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((v, i) => (
          <circle key={i} cx={sx(i)} cy={sy(v)} r={hover === i ? 4.5 : 0} fill="var(--bg)" stroke="var(--accent)" strokeWidth="2" />
        ))}
        {hover !== null && <line x1={sx(hover)} x2={sx(hover)} y1={pad.t} y2={h - pad.b} stroke="var(--accent)" strokeOpacity="0.3" strokeWidth="1" />}
      </svg>
      {hover !== null && (
        <div
          style={{
            position: "absolute",
            left: `calc(${(sx(hover) / w) * 100}% - 70px)`,
            top: 4,
            background: "var(--bg)",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 11.5,
            boxShadow: "var(--shadow-md)",
            minWidth: 140,
            pointerEvents: "none",
          }}
        >
          <div style={{ color: "var(--ink-400)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{labels[hover]}</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "var(--ink-500)" }}>This year</span>
            <span className="tnum" style={{ fontWeight: 600 }}>
              ${(data[hover] / 1000).toFixed(0)}k
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 2 }}>
            <span style={{ color: "var(--ink-400)" }}>Prev year</span>
            <span className="tnum muted">${(prev[hover] / 1000).toFixed(0)}k</span>
          </div>
        </div>
      )}
    </div>
  );
}

function GrowthBars({ data, labels }: { data: number[]; labels: string[] }) {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 180, padding: "4px 0 24px" }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: "100%",
              height: `${(v / max) * 100}%`,
              background: "linear-gradient(180deg, var(--accent) 0%, var(--accent) 60%, rgba(47,98,245,0.5) 100%)",
              borderRadius: "6px 6px 2px 2px",
              minHeight: 4,
            }}
            title={`${labels[i]} · ${v} tenants`}
          />
          <div style={{ fontSize: 10.5, color: "var(--ink-400)" }}>{labels[i]}</div>
        </div>
      ))}
    </div>
  );
}

export function DashboardView({ data }: { data: OverviewData }) {
  const { openCreate } = useAdminUI();
  const [range, setRange] = useState("30d");
  const k = data.kpis;
  const maxRev = Math.max(...data.topTenants.map((t) => t.revenueCents), 1);

  const kpis = [
    { label: "Total tenants", value: <CounterValue value={k.totalTenants} />, delta: `+${k.newTenants30d} vs 30d`, deltaDir: "up" as const, icon: "Buildings", spark: data.sparks.tenants },
    { label: "Active subscriptions", value: <CounterValue value={k.activeSubscriptions} />, delta: "Live", deltaDir: "flat" as const, icon: "Card", spark: data.sparks.subscriptions },
    { label: "Monthly revenue", value: <CounterValue value={Math.round(k.monthlyRevenueCents / 100 / 1000)} prefix="$" suffix="k" />, delta: "MRR + 30d", deltaDir: "up" as const, icon: "DollarSign", spark: data.sparks.revenue },
    { label: "Total orders", value: <CounterValue value={k.totalOrders} />, delta: `+${k.newOrders30d} vs 30d`, deltaDir: "up" as const, icon: "Box", spark: data.sparks.orders },
    { label: "Total customers", value: <CounterValue value={k.totalCustomers} />, delta: "Lifetime", deltaDir: "flat" as const, icon: "Users", spark: data.sparks.customers, sparkColor: "var(--success)" },
    { label: "Active trials", value: <CounterValue value={k.activeTrials} />, delta: "In trial", deltaDir: "flat" as const, icon: "Sparkles", spark: data.sparks.trials, sparkColor: "var(--warn)" },
  ];

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Platform overview</h1>
          <p className="page-sub">Real-time metrics across all tenant storefronts</p>
        </div>
        <div className="page-actions">
          <div className="seg">
            {["24h", "7d", "30d", "90d", "1y"].map((r) => (
              <div key={r} className={"seg-item" + (range === r ? " active" : "")} onClick={() => setRange(r)}>
                {r}
              </div>
            ))}
          </div>
          <button className="btn btn-accent btn-sm" onClick={openCreate}>
            <Ic.Plus /> New tenant
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        {kpis.map((kpi, i) => (
          <KPI key={i} {...kpi} />
        ))}
      </div>

      <div className="grid-2 mb-4">
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">Platform revenue</h3>
              <div className="card-sub">Order revenue · trailing 12 months vs prior year</div>
            </div>
            <div className="row" style={{ gap: 14, fontSize: 11.5 }}>
              <span className="row" style={{ gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--accent)" }} />
                <span className="muted">This year</span>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <span style={{ width: 8, height: 2, background: "var(--ink-300)" }} />
                <span className="muted">Last year</span>
              </span>
            </div>
          </div>
          <div className="card-body" style={{ padding: 12 }}>
            <RevenueChart series={data.revenueSeries} />
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">Tenant growth</h3>
              <div className="card-sub">Active tenants by month</div>
            </div>
            <span className="badge badge-success">
              <Ic.TrendUp style={{ width: 11, height: 11 }} /> {k.totalTenants}
            </span>
          </div>
          <div className="card-body">
            <GrowthBars data={data.tenantGrowth} labels={data.revenueSeries.labels} />
            <div className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--border-soft)", paddingTop: 14, marginTop: -8 }}>
              <Stat label="Total" value={String(k.totalTenants)} />
              <Stat label="Active" value={String(k.activeSubscriptions)} />
              <Stat label="Trials" value={String(k.activeTrials)} tone="var(--success)" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">Top performing tenants</h3>
              <div className="card-sub">By total revenue</div>
            </div>
            <Link href="/tenants" className="btn btn-ghost btn-sm">
              View all <Ic.ArrowRight />
            </Link>
          </div>
          <div>
            {data.topTenants.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>No active tenants yet.</div>}
            {data.topTenants.map((t, i) => (
              <Link
                key={t.id}
                href={`/tenants/${t.slug}`}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < data.topTenants.length - 1 ? "1px solid var(--border-soft)" : "none" }}
              >
                <div style={{ width: 18, color: "var(--ink-400)", fontSize: 12, fontVariantNumeric: "tabular-nums", textAlign: "center" }}>{i + 1}</div>
                <TenantAvatar name={t.name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="tenant-name">{t.name}</div>
                  <div className="tenant-domain">{t.slug}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="tnum" style={{ fontWeight: 600 }}>
                    ${(t.revenueCents / 100 / 1000).toFixed(1)}k
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-400)" }} className="tnum">
                    {t.orders.toLocaleString()} orders
                  </div>
                </div>
                <div style={{ width: 70 }}>
                  <div className="bar">
                    <span style={{ width: `${Math.min(100, (t.revenueCents / maxRev) * 100)}%` }} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">Recent activity</h3>
              <div className="card-sub">Platform-wide events</div>
            </div>
            <Link href="/audit" className="btn btn-ghost btn-sm">
              All logs
            </Link>
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            {data.activity.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>No recent activity.</div>}
            {data.activity.map((a, i) => {
              const IconCmp = Ic[a.icon] || Ic.Activity;
              return (
                <div key={i} className="feed-item">
                  <div className="feed-dot" style={a.danger ? { background: "var(--danger-soft)", color: "var(--danger)" } : {}}>
                    <IconCmp />
                  </div>
                  <div className="feed-body">
                    <div>
                      <FeedText text={a.text} />
                    </div>
                    <div className="feed-time">{a.time}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--ink-400)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: tone }} className="tnum">
        {value}
      </div>
    </div>
  );
}
